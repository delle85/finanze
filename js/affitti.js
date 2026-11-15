/* Finanze personali – Affitti e Contratti (logica).

   I dati stanno nello stesso modello cifrato dei movimenti (quindi: cifratura AES-256, backup,
   sincronizzazione con OneDrive e unione tra dispositivi valgono anche qui). Liste nel modello:
     immobili   {id, nome, indirizzo, note}
     inquilini  {id, nome, codice_fiscale, email, telefono, riconoscimento, note}
     contratti  {id, immobile, inquilini:[id], tipo, inizio, durata_mesi, rinnovo_mesi, preavviso_mesi,
                 canone, spese_mensili, giorno_pagamento, deposito, cedolare, istat, registrazione, chiuso_il, note}
     pagamenti  {id, contratto, mese "AAAA-MM", importo, data, metodo, movimento (impronta|null), note}
     spese      {id, immobile, contratto|null, data, descrizione, importo (>0), tipo, a_carico, rimborsata, note}
     allegati   {id, contratto, nome, tipo, byte, chiave, aggiunto_il}   (il contenuto è cifrato a parte: allegati.js)
     scarti     {id = impronta del movimento}  bonifici segnati come "non è un affitto"
   Gli id sono casuali (uuid) così due dispositivi non si scontrano. */
(function (G) {
"use strict";

const LISTE = ["immobili", "inquilini", "contratti", "pagamenti", "spese", "allegati", "scarti"];
const CAT_AFFITTI = "Affitti incassati";
const TIPI = {
  "4+4": { nome: "Canone libero 4+4", durata: 48, rinnovo: 48, preavviso: 6 },
  "3+2": { nome: "Canone concordato 3+2", durata: 36, rinnovo: 24, preavviso: 6 },
  "transitorio": { nome: "Transitorio (1-18 mesi)", durata: 12, rinnovo: 0, preavviso: 0 },
  "studenti": { nome: "Studenti universitari (6-36 mesi)", durata: 12, rinnovo: 0, preavviso: 0 },
  "6+6": { nome: "Uso diverso / commerciale 6+6", durata: 72, rinnovo: 72, preavviso: 12 },
  "altro": { nome: "Altro", durata: 12, rinnovo: 0, preavviso: 0 },
};
const TIPI_SPESA = { amministrazione: "Amministrazione / condominio", manutenzione: "Manutenzione e riparazioni",
  tasse: "Tasse (IMU, registro…)", utenze: "Utenze", assicurazione: "Assicurazione", altro: "Altro" };

/* ---------- date (stringhe AAAA-MM-GG, ora locale) ---------- */
const p2 = (n) => String(n).padStart(2, "0");
const oggi = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const giorniMese = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();          // m = 1..12
function piuMesi(iso, n) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
  const t = y * 12 + (m - 1) + n, ny = Math.floor(t / 12), nm = t % 12 + 1;
  return `${ny}-${p2(nm)}-${p2(Math.min(d, giorniMese(ny, nm)))}`;
}
const utc = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const diffGiorni = (a, b) => Math.round((utc(a) - utc(b)) / 86400000);         // a - b
const piuGiorni = (iso, n) => new Date(utc(iso) + n * 86400000).toISOString().slice(0, 10);
const meseDi = (iso) => iso.slice(0, 7);
const mesePiu = (mese, n) => piuMesi(mese + "-01", n).slice(0, 7);
function mesiTra(da, a) { const out = []; for (let m = da; m <= a; m = mesePiu(m, 1)) out.push(m); return out; }
const r2 = (x) => Math.round(x * 100) / 100;
const valida = (iso) => typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso);

/* Durata leggibile: "3 anni e 4 mesi". */
function durataTesto(da, a) {
  if (!valida(da) || !valida(a) || a < da) return "";
  let mesi = (+a.slice(0, 4) - +da.slice(0, 4)) * 12 + (+a.slice(5, 7) - +da.slice(5, 7));
  if (+a.slice(8, 10) < +da.slice(8, 10)) mesi--;
  const anni = Math.floor(mesi / 12), m = mesi % 12;
  const pa = anni ? `${anni} ${anni === 1 ? "anno" : "anni"}` : "", pm = m ? `${m} ${m === 1 ? "mese" : "mesi"}` : "";
  if (pa && pm) return `${pa} e ${pm}`;
  return pa || pm || `${diffGiorni(a, da)} giorni`;
}

const nuovoId = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => p2(b.toString(16))).join(""));
const testo = (v, max = 2000) => String(v ?? "").trim().slice(0, max);
/* Importi scritti all'italiana ("1.234,56", "650,5") o col punto decimale ("650.50"). */
function numero(v) {
  if (typeof v === "number") return Number.isFinite(v) ? r2(v) : 0;
  let s = String(v ?? "").replace(/[€\s]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (!/^-?\d+\.\d{1,2}$/.test(s)) s = s.replace(/\./g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? r2(n) : 0;
}
const intero = (v, min, max, def) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
const normParole = (s) => String(s || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]+/g, " ").trim();

/* Aggiunge le liste mancanti (modelli precedenti). true se è cambiato qualcosa. */
function migra(M) {
  let c = false;
  for (const k of LISTE) if (!Array.isArray(M[k])) { M[k] = []; c = true; }
  return c;
}

/* ---------------------------------------------------------------------------
   Calcoli su un contratto
   --------------------------------------------------------------------------- */
function dovutoMese(c) { return r2((c.canone || 0) + (c.spese_mensili || 0)); }

/* Giorno di scadenza della rata del mese (es. il 5), limitato alla fine del mese. */
function scadenzaRata(c, mese) {
  const g = Math.min(intero(c.giorno_pagamento, 1, 31, 5), giorniMese(+mese.slice(0, 4), +mese.slice(5, 7)));
  return `${mese}-${p2(g)}`;
}

/* Ultimo mese dovuto: fino al mese di chiusura (o di oggi). */
function ultimoMese(c, fino) {
  const fine = c.chiuso_il && c.chiuso_il < fino ? c.chiuso_il : fino;
  return meseDi(fine);
}

/* Prossima scadenza contrattuale (con i rinnovi taciti) e termine per la disdetta. */
function scadenze(c, rif = oggi()) {
  if (!valida(c.inizio)) return { fine: null, disdetta: null, periodo: 0, scaduto: false };
  const durata = intero(c.durata_mesi, 1, 240, 12), rinnovo = intero(c.rinnovo_mesi, 0, 240, 0);
  let fine = piuGiorni(piuMesi(c.inizio, durata), -1), periodo = 1;
  while (rinnovo && fine < rif && periodo < 100) { fine = piuGiorni(piuMesi(piuGiorni(fine, 1), rinnovo), -1); periodo++; }
  const pre = intero(c.preavviso_mesi, 0, 24, 0);
  const disdetta = pre ? piuMesi(piuGiorni(fine, 1), -pre) : null;
  return { fine, disdetta, periodo, scaduto: fine < rif, rinnovo };
}

/* Prossimo anniversario dalla data di inizio (per ISTAT e imposta di registro annuale). */
function prossimoAnniversario(inizio, rif) {
  if (!valida(inizio)) return null;
  let anni = Math.max(1, +rif.slice(0, 4) - +inizio.slice(0, 4) - 1), d = piuMesi(inizio, anni * 12);
  while (d < rif) d = piuMesi(inizio, ++anni * 12);
  return d;
}

function creaAffitti(M, modificato) {
  migra(M);
  const perId = (lista, id) => M[lista].find((x) => x.id === id) || null;
  const contrattoValido = (c) => c && perId("immobili", c.immobile) && valida(c.inizio);

  function nomiInquilini(c) { return (c.inquilini || []).map((i) => perId("inquilini", i)).filter(Boolean).map((i) => i.nome); }

  /* Mese per mese: dovuto, pagato, stato. */
  function mesiContratto(c, fino = oggi()) {
    if (!valida(c.inizio)) return [];
    const ultimo = ultimoMese(c, fino), primo = meseDi(c.inizio);
    if (ultimo < primo) return [];
    const pag = new Map();
    for (const p of M.pagamenti) if (p.contratto === c.id) pag.set(p.mese, r2((pag.get(p.mese) || 0) + p.importo));
    const dov = dovutoMese(c), out = [];
    for (const mese of mesiTra(primo, ultimo)) {
      const pagato = pag.get(mese) || 0, scad = scadenzaRata(c, mese);
      let stato, giorni = 0;
      if (dov <= 0 || pagato >= dov - 0.005) stato = "pagato";
      else if (fino > scad) { stato = pagato > 0 ? "parziale" : "ritardo"; giorni = diffGiorni(fino, scad); }
      else stato = pagato > 0 ? "parziale" : "attesa";
      out.push({ mese, dovuto: dov, pagato, residuo: r2(Math.max(0, dov - pagato)), stato, giorni, scadenza: scad });
    }
    return out;
  }

  function speseDaRimborsare(c) {
    return r2(M.spese.filter((s) => s.contratto === c.id && s.a_carico === "inquilino" && !s.rimborsata).reduce((t, s) => t + s.importo, 0));
  }

  /* Da quando l'inquilino (o gli inquilini) è nella casa: contratti precedenti sulla stessa casa con gli stessi inquilini. */
  function inCasaDal(c) {
    let dal = c.inizio;
    for (const k of M.contratti) {
      if (k.id === c.id || k.immobile !== c.immobile || !valida(k.inizio) || k.inizio >= dal) continue;
      if ((k.inquilini || []).some((i) => (c.inquilini || []).includes(i))) dal = k.inizio;
    }
    return dal;
  }

  function riepilogoContratto(c, rif = oggi()) {
    const mesi = mesiContratto(c, rif);
    const scaduti = mesi.filter((m) => m.stato === "ritardo" || m.stato === "parziale" && rif > m.scadenza);
    const arretrati = r2(scaduti.reduce((t, m) => t + m.residuo, 0));
    const attuale = mesi.length && mesi[mesi.length - 1].mese === meseDi(rif) ? mesi[mesi.length - 1] : null;
    const imm = perId("immobili", c.immobile);
    const sc = scadenze(c, rif);
    const dal = inCasaDal(c);
    const fineCasa = c.chiuso_il && c.chiuso_il < rif ? c.chiuso_il : rif;
    return {
      id: c.id, immobile: c.immobile, immobile_nome: imm ? imm.nome : "(casa eliminata)", indirizzo: imm ? imm.indirizzo : "",
      inquilini: nomiInquilini(c), inquilini_id: (c.inquilini || []).slice(),
      tipo: c.tipo, tipo_nome: (TIPI[c.tipo] || TIPI.altro).nome, inizio: c.inizio, chiuso_il: c.chiuso_il || null,
      attivo: !c.chiuso_il || c.chiuso_il >= rif,
      canone: c.canone || 0, spese_mensili: c.spese_mensili || 0, dovuto: dovutoMese(c), giorno_pagamento: intero(c.giorno_pagamento, 1, 31, 5),
      deposito: c.deposito || 0, cedolare: Boolean(c.cedolare), istat: Boolean(c.istat), registrazione: c.registrazione || "",
      arretrati, mesi_arretrati: scaduti.length, max_giorni_ritardo: scaduti.reduce((x, m) => Math.max(x, m.giorni), 0),
      spese_da_rimborsare: speseDaRimborsare(c),
      mese_attuale: attuale,
      in_casa_dal: dal, in_casa_da: durataTesto(dal, fineCasa),
      scadenza: sc.fine, disdetta_entro: sc.disdetta, periodo: sc.periodo, scaduto: sc.scaduto && !c.chiuso_il,
      allegati: M.allegati.filter((a) => a.contratto === c.id).length,
      note: c.note || "",
    };
  }

  const contrattiValidi = () => M.contratti.filter(contrattoValido);
  const ordinaContratti = (a, b) => (a.attivo === b.attivo ? 0 : a.attivo ? -1 : 1) || a.immobile_nome.localeCompare(b.immobile_nome, "it") || (b.inizio < a.inizio ? -1 : 1);

  /* ---------- riconoscimento dei bonifici degli inquilini ---------- */
  function paroleInquilino(i) {
    const scelte = String(i.riconoscimento || "").split(/[,;\n]/).map(normParole).filter((s) => s.length >= 3);
    if (scelte.length) return scelte;
    const n = normParole(i.nome).split(" ").filter((w) => w.length >= 2);
    if (n.length < 2) return n.length && n[0].length >= 4 ? [n[0]] : [];
    return [n.join(" "), n.slice().reverse().join(" ")];
  }

  function movimentiCollegati() {
    const s = new Set();
    for (const p of M.pagamenti) if (p.movimento) s.add(p.movimento);
    for (const x of M.spese) if (x.movimento) s.add(x.movimento);
    for (const x of M.scarti) s.add(x.id);
    return s;
  }

  /* Primo mese con qualcosa ancora da pagare (o il mese del bonifico). */
  function primoMeseAperto(c, dataMov) {
    const mesi = mesiContratto(c, piuMesi(dataMov, 1));
    const aperto = mesi.find((m) => m.residuo > 0 && m.mese <= meseDi(piuMesi(dataMov, 1)));
    return aperto ? aperto.mese : meseDi(dataMov);
  }

  function proposte() {
    const usati = movimentiCollegati();
    const contr = contrattiValidi();
    if (!contr.length) return [];
    const minimo = contr.reduce((x, c) => (piuGiorni(c.inizio, -31) < x ? piuGiorni(c.inizio, -31) : x), "9999");
    const parole = new Map(contr.map((c) => [c.id, (c.inquilini || []).map((i) => perId("inquilini", i)).filter(Boolean).flatMap(paroleInquilino)]));
    const out = [];
    for (const m of M.movimenti) {
      if (m.importo <= 0 || m.categoria === "Giroconto" || m.data < minimo || usati.has(m.impronta)) continue;
      const desc = " " + normParole(m.descrizione) + " ";
      let migliore = null;
      for (const c of contr) {
        if (m.data < piuGiorni(c.inizio, -31) || (c.chiuso_il && m.data > piuGiorni(c.chiuso_il, 62))) continue;
        const nome = parole.get(c.id).some((p) => desc.includes(" " + p + " "));
        const dov = dovutoMese(c);
        const imp = dov > 0 && (Math.abs(m.importo - dov) < 0.01 || Math.abs(m.importo - c.canone) < 0.01 ||
          (Math.round(m.importo / dov) >= 2 && Math.round(m.importo / dov) <= 12 && Math.abs(m.importo - Math.round(m.importo / dov) * dov) < 0.01));
        const parolaAffitto = /\b(AFFITTO|CANONE|LOCAZIONE|PIGIONE)\b/.test(desc);
        const punti = (nome ? 2 : 0) + (imp ? 1 : 0) + (parolaAffitto && imp ? 1 : 0);
        if (!nome && !(imp && parolaAffitto)) continue;
        if (!migliore || punti > migliore.punti) migliore = { c, punti, nome, imp };
      }
      if (!migliore) continue;
      const c = migliore.c, imm = perId("immobili", c.immobile);
      out.push({ impronta: m.impronta, data: m.data, descrizione: m.descrizione, importo: m.importo,
        contratto: c.id, immobile_nome: imm.nome, inquilini: nomiInquilini(c), dovuto: dovutoMese(c),
        mese: primoMeseAperto(c, m.data), sicuro: migliore.nome && migliore.imp, per_nome: migliore.nome });
    }
    return out.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));   // dal più vecchio: i mesi si riempiono in ordine
  }

  /* Distribuisce un importo sui mesi ancora aperti a partire da "mese" (prima i più vecchi). */
  function distribuisci(c, importo, mese) {
    const pag = new Map();
    for (const p of M.pagamenti) if (p.contratto === c.id) pag.set(p.mese, r2((pag.get(p.mese) || 0) + p.importo));
    const dov = dovutoMese(c), out = [];
    let resto = r2(importo), m = mese, giri = 0;
    while (resto > 0.005 && giri++ < 36) {
      const manca = dov > 0 ? r2(Math.max(0, dov - (pag.get(m) || 0))) : resto;
      if (manca > 0.005) { const q = r2(Math.min(manca, resto)); out.push([m, q]); resto = r2(resto - q); }
      m = mesePiu(m, 1);
    }
    if (resto > 0.005) { if (out.length) out[out.length - 1][1] = r2(out[out.length - 1][1] + resto); else out.push([mese, resto]); }
    return out;
  }

  /* ---------- pulizia dei campi in ingresso ---------- */
  function pulisciContratto(x, vecchio) {
    const tipo = TIPI[x.tipo] ? x.tipo : "altro";
    const t = TIPI[tipo];
    return {
      id: vecchio ? vecchio.id : nuovoId(),
      immobile: testo(x.immobile, 64), inquilini: (Array.isArray(x.inquilini) ? x.inquilini : []).map((i) => testo(i, 64)).filter(Boolean),
      tipo, inizio: valida(x.inizio) ? x.inizio : oggi(),
      durata_mesi: intero(x.durata_mesi, 1, 240, t.durata), rinnovo_mesi: intero(x.rinnovo_mesi, 0, 240, t.rinnovo),
      preavviso_mesi: intero(x.preavviso_mesi, 0, 24, t.preavviso),
      canone: numero(x.canone), spese_mensili: numero(x.spese_mensili), giorno_pagamento: intero(x.giorno_pagamento, 1, 31, 5),
      deposito: numero(x.deposito), cedolare: Boolean(x.cedolare), istat: Boolean(x.istat) && !x.cedolare,
      registrazione: testo(x.registrazione, 200), chiuso_il: valida(x.chiuso_il) ? x.chiuso_il : null, note: testo(x.note),
    };
  }

  function sostituisci(lista, nuovo) {
    const i = M[lista].findIndex((x) => x.id === nuovo.id);
    if (i >= 0) M[lista][i] = nuovo; else M[lista].push(nuovo);
    return nuovo;
  }

  /* ---------- scadenze in arrivo ---------- */
  function scadenzeInArrivo(giorni = 180, rif = oggi()) {
    const limite = piuGiorni(rif, giorni), out = [];
    for (const c of contrattiValidi()) {
      if (c.chiuso_il && c.chiuso_il < rif) continue;
      const r = riepilogoContratto(c, rif);
      const base = { contratto: c.id, immobile_nome: r.immobile_nome, inquilini: r.inquilini };
      if (r.scaduto) out.push({ ...base, data: r.scadenza, tipo: "scaduto", testo: "Contratto scaduto: rinnova o segna la chiusura" });
      else if (r.scadenza && r.scadenza <= limite) out.push({ ...base, data: r.scadenza, tipo: "scadenza", testo: c.rinnovo_mesi ? "Scadenza del contratto (si rinnova da solo se nessuno dà disdetta)" : "Fine del contratto" });
      if (r.disdetta_entro && !r.scaduto && r.disdetta_entro <= limite) {
        out.push({ ...base, data: r.disdetta_entro, tipo: "disdetta", testo: "Ultimo giorno per inviare la disdetta (raccomandata/PEC)" });
      }
      const ann = prossimoAnniversario(c.inizio, rif);
      if (ann && ann <= limite) {
        if (c.istat && !c.cedolare) out.push({ ...base, data: ann, tipo: "istat", testo: "Aggiornamento ISTAT del canone" });
        if (!c.cedolare) out.push({ ...base, data: ann, tipo: "registro", testo: "Imposta di registro annuale (entro 30 giorni)" });
      }
    }
    return out.map((s) => ({ ...s, tra_giorni: diffGiorni(s.data, rif) })).sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  }

  /* ---------- bozza del contratto dal modello ---------- */
  function datiPerModello(c) {
    const imm = perId("immobili", c.immobile) || {};
    const inq = (c.inquilini || []).map((i) => perId("inquilini", i)).filter(Boolean);
    const sc = scadenze(c, c.inizio);
    const it = (d) => (valida(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
    const e = (v) => (v || 0).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return {
      casa: imm.nome || "", indirizzo: imm.indirizzo || "",
      inquilini: inq.map((i) => i.nome).join(", "),
      inquilini_cf: inq.map((i) => `${i.nome}${i.codice_fiscale ? ` (C.F. ${i.codice_fiscale})` : ""}`).join(", "),
      tipo: (TIPI[c.tipo] || TIPI.altro).nome, inizio: it(c.inizio), fine: it(sc.fine),
      durata_mesi: String(c.durata_mesi || ""), rinnovo_mesi: String(c.rinnovo_mesi || ""), preavviso_mesi: String(c.preavviso_mesi || ""),
      canone: e(c.canone), canone_annuo: e((c.canone || 0) * 12), spese_mensili: e(c.spese_mensili), deposito: e(c.deposito),
      giorno_pagamento: String(c.giorno_pagamento || ""), cedolare: c.cedolare ? "sì" : "no", oggi: it(oggi()),
    };
  }

  /* ======================= API ======================= */
  return {
    affitti_tipi() { return { contratti: TIPI, spese: TIPI_SPESA }; },

    async anagrafiche() {
      const att = contrattiValidi().map((c) => riepilogoContratto(c)).filter((r) => r.attivo);
      return {
        immobili: M.immobili.map((i) => {
          const c = att.find((r) => r.immobile === i.id);
          return { ...i, inquilini_attuali: c ? c.inquilini : [], contratto_attivo: c ? c.id : null,
            n_contratti: M.contratti.filter((k) => k.immobile === i.id).length };
        }).sort((a, b) => a.nome.localeCompare(b.nome, "it")),
        inquilini: M.inquilini.map((i) => {
          const c = att.find((r) => r.inquilini_id.includes(i.id));
          return { ...i, casa: c ? c.immobile_nome : "", in_casa_da: c ? c.in_casa_da : "", in_casa_dal: c ? c.in_casa_dal : "",
            contratto_attivo: c ? c.id : null, n_contratti: M.contratti.filter((k) => (k.inquilini || []).includes(i.id)).length };
        }).sort((a, b) => a.nome.localeCompare(b.nome, "it")),
      };
    },

    async salva_immobile(x) {
      const nome = testo(x.nome, 120);
      if (!nome) return { ok: false, errore: "Scrivi un nome per la casa (es. Via Roma 12, int. 3)." };
      const v = x.id ? perId("immobili", x.id) : null;
      const r = sostituisci("immobili", { id: v ? v.id : nuovoId(), nome, indirizzo: testo(x.indirizzo, 300), note: testo(x.note) });
      await modificato();
      return { ok: true, id: r.id };
    },

    async elimina_immobile(id) {
      if (M.contratti.some((c) => c.immobile === id)) return { ok: false, errore: "Ci sono contratti su questa casa: elimina prima quelli." };
      M.immobili = M.immobili.filter((x) => x.id !== id);
      M.spese = M.spese.filter((s) => s.immobile !== id);
      await modificato();
      return { ok: true };
    },

    async salva_inquilino(x) {
      const nome = testo(x.nome, 120);
      if (!nome) return { ok: false, errore: "Scrivi nome e cognome." };
      const email = testo(x.email, 200);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, errore: "L'indirizzo email non sembra valido." };
      const cf = testo(x.codice_fiscale, 16).toUpperCase().replace(/\s/g, "");
      if (cf && !/^[A-Z0-9]{11,16}$/.test(cf)) return { ok: false, errore: "Il codice fiscale non sembra valido (16 caratteri, o 11 cifre per una ditta)." };
      const v = x.id ? perId("inquilini", x.id) : null;
      const r = sostituisci("inquilini", { id: v ? v.id : nuovoId(), nome, codice_fiscale: cf, email, telefono: testo(x.telefono, 40),
        riconoscimento: testo(x.riconoscimento, 300), note: testo(x.note) });
      await modificato();
      return { ok: true, id: r.id };
    },

    async elimina_inquilino(id) {
      if (M.contratti.some((c) => (c.inquilini || []).includes(id))) return { ok: false, errore: "L'inquilino è in un contratto: toglilo dal contratto o elimina il contratto." };
      M.inquilini = M.inquilini.filter((x) => x.id !== id);
      await modificato();
      return { ok: true };
    },

    /* Contratto: x può contenere nuova_casa {nome, indirizzo} e nuovi_inquilini [{nome, email, telefono, codice_fiscale}]. */
    async salva_contratto(x) {
      const v = x.id ? perId("contratti", x.id) : null;
      if (x.nuova_casa && testo(x.nuova_casa.nome)) {
        const r = sostituisci("immobili", { id: nuovoId(), nome: testo(x.nuova_casa.nome, 120), indirizzo: testo(x.nuova_casa.indirizzo, 300), note: "" });
        x.immobile = r.id;
      }
      if (!perId("immobili", x.immobile)) return { ok: false, errore: "Scegli la casa (o scrivine una nuova)." };
      const ids = Array.isArray(x.inquilini) ? x.inquilini.slice() : [];
      for (const n of x.nuovi_inquilini || []) {
        if (!testo(n.nome)) continue;
        const email = testo(n.email, 200);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, errore: `Email non valida per ${testo(n.nome)}.` };
        const r = sostituisci("inquilini", { id: nuovoId(), nome: testo(n.nome, 120), codice_fiscale: testo(n.codice_fiscale, 16).toUpperCase(),
          email, telefono: testo(n.telefono, 40), riconoscimento: "", note: "" });
        ids.push(r.id);
      }
      x.inquilini = ids.filter((i) => perId("inquilini", i));
      if (!x.inquilini.length) return { ok: false, errore: "Indica almeno un inquilino." };
      if (!valida(x.inizio)) return { ok: false, errore: "Indica la data di inizio del contratto." };
      if (numero(x.canone) <= 0) return { ok: false, errore: "Indica il canone mensile." };
      const c = sostituisci("contratti", pulisciContratto(x, v));
      await modificato();
      return { ok: true, id: c.id };
    },

    async elimina_contratto(id) {
      M.contratti = M.contratti.filter((c) => c.id !== id);
      M.pagamenti = M.pagamenti.filter((p) => p.contratto !== id);
      const tolti = M.allegati.filter((a) => a.contratto === id);
      M.allegati = M.allegati.filter((a) => a.contratto !== id);
      for (const s of M.spese) if (s.contratto === id) s.contratto = null;
      await modificato();
      return { ok: true, allegati_tolti: tolti };
    },

    async contratto(id) {
      const c = perId("contratti", id);
      if (!c) return null;
      return { dati: { ...c, inquilini: (c.inquilini || []).slice() }, riepilogo: riepilogoContratto(c),
        allegati: M.allegati.filter((a) => a.contratto === id).map((a) => ({ id: a.id, nome: a.nome, tipo: a.tipo, byte: a.byte, aggiunto_il: a.aggiunto_il })),
        email: (c.inquilini || []).map((i) => perId("inquilini", i)).filter((i) => i && i.email).map((i) => ({ nome: i.nome, email: i.email })) };
    },

    async contratti_elenco() {
      return { contratti: contrattiValidi().map((c) => riepilogoContratto(c)).sort(ordinaContratti),
        scadenze: scadenzeInArrivo(), n_immobili: M.immobili.length, n_inquilini: M.inquilini.length };
    },

    /* Situazione degli affitti: schede, griglia mesi dell'anno, totali. */
    async affitti_stato(anno = "") {
      const rif = oggi();
      anno = /^\d{4}$/.test(String(anno)) ? String(anno) : rif.slice(0, 4);
      const contr = contrattiValidi();
      const rr = contr.map((c) => riepilogoContratto(c, rif));
      const mesiAnno = Array.from({ length: 12 }, (_, i) => `${anno}-${p2(i + 1)}`);
      const griglia = contr.filter((c) => c.inizio.slice(0, 4) <= anno && (!c.chiuso_il || c.chiuso_il.slice(0, 4) >= anno)).map((c) => {
        const mm = new Map(mesiContratto(c, rif).map((m) => [m.mese, m]));
        const dentro = (mese) => mese >= meseDi(c.inizio) && (!c.chiuso_il || mese <= meseDi(c.chiuso_il));
        const r = rr.find((x) => x.id === c.id);
        return { contratto: c.id, immobile_nome: r.immobile_nome, inquilini: r.inquilini,
          celle: mesiAnno.map((mese) => mm.get(mese) || { mese, stato: dentro(mese) ? "futuro" : "fuori", dovuto: dentro(mese) ? dovutoMese(c) : 0, pagato: 0, residuo: 0, giorni: 0 }) };
      }).sort((a, b) => a.immobile_nome.localeCompare(b.immobile_nome, "it"));
      const incassato = r2(M.pagamenti.filter((p) => p.mese.startsWith(anno) && perId("contratti", p.contratto)).reduce((t, p) => t + p.importo, 0));
      const speseAnno = M.spese.filter((s) => s.data.startsWith(anno));
      const anni = new Set([rif.slice(0, 4)]);
      for (const p of M.pagamenti) anni.add(p.mese.slice(0, 4));
      for (const s of M.spese) anni.add(s.data.slice(0, 4));
      for (const c of contr) anni.add(c.inizio.slice(0, 4));
      const attivi = rr.filter((r) => r.attivo);
      return {
        oggi: rif, anno, anni: [...anni].filter((a) => a <= rif.slice(0, 4)).sort().reverse(), mesi: mesiAnno,
        schede: rr.filter((r) => r.attivo || r.arretrati > 0).sort(ordinaContratti),
        griglia, incassato,
        atteso: r2(griglia.reduce((t, g) => t + g.celle.reduce((s, c) => s + (c.stato === "fuori" ? 0 : c.dovuto), 0), 0)),
        arretrati: r2(rr.reduce((t, r) => t + r.arretrati, 0)),
        in_ritardo: rr.filter((r) => r.arretrati > 0).length,
        spese: r2(speseAnno.filter((s) => s.a_carico !== "inquilino").reduce((t, s) => t + s.importo, 0)),
        spese_inquilini: r2(rr.reduce((t, r) => t + r.spese_da_rimborsare, 0)),
        n_contratti: attivi.length, n_immobili: M.immobili.length,
        proposte: proposte().length,
      };
    },

    /* Numeri per il badge nel menu. */
    async affitti_avvisi() {
      const rif = oggi();
      const ritardi = contrattiValidi().map((c) => riepilogoContratto(c, rif)).filter((r) => r.arretrati > 0).length;
      const urgenti = scadenzeInArrivo(30, rif).filter((s) => s.tipo === "scaduto" || s.tipo === "disdetta" || s.tipo === "scadenza").length;
      return { ritardi, proposte: proposte().length, scadenze: urgenti };
    },

    async affitti_dettaglio(id) {
      const c = perId("contratti", id);
      if (!c) return null;
      const rif = oggi();
      const pag = M.pagamenti.filter((p) => p.contratto === id).sort((a, b) => (b.mese < a.mese ? -1 : b.mese > a.mese ? 1 : (b.data < a.data ? -1 : 1)));
      return {
        riepilogo: riepilogoContratto(c, rif), mesi: mesiContratto(c, rif).reverse(),
        pagamenti: pag.map((p) => ({ ...p })),
        spese: M.spese.filter((s) => s.immobile === c.immobile).sort((a, b) => (b.data < a.data ? -1 : 1)).map((s) => ({ ...s })),
        incassato_totale: r2(pag.reduce((t, p) => t + p.importo, 0)),
      };
    },

    async affitti_proposte() { return proposte(); },

    /* Conferma un bonifico come affitto: lo distribuisce sui mesi aperti e mette la categoria al movimento. */
    async affitti_conferma(impronta, contrattoId, mese) {
      const m = M.movimenti.find((x) => x.impronta === impronta);
      const c = perId("contratti", contrattoId);
      if (!m || !c) return { ok: false, errore: "Movimento o contratto non trovato." };
      if (movimentiCollegati().has(impronta)) return { ok: false, errore: "Questo bonifico è già stato registrato." };
      const parti = distribuisci(c, m.importo, /^\d{4}-\d{2}$/.test(mese) ? mese : primoMeseAperto(c, m.data));
      for (const [mm, q] of parti) M.pagamenti.push({ id: nuovoId(), contratto: c.id, mese: mm, importo: q, data: m.data, metodo: "bonifico", movimento: impronta, note: "" });
      if (!m.categoria) m.categoria = CAT_AFFITTI;
      await modificato();
      return { ok: true, mesi: parti.map((p) => p[0]) };
    },

    /* Dal bonifico più vecchio: ogni mese viene ricalcolato dopo aver registrato i precedenti. */
    async affitti_conferma_tutte() {
      let n = 0;
      for (const p of proposte()) {
        if (!p.sicuro) continue;
        const c = perId("contratti", p.contratto), m = M.movimenti.find((x) => x.impronta === p.impronta);
        for (const [mm, q] of distribuisci(c, p.importo, primoMeseAperto(c, p.data))) M.pagamenti.push({ id: nuovoId(), contratto: c.id, mese: mm, importo: q, data: p.data, metodo: "bonifico", movimento: p.impronta, note: "" });
        if (m && !m.categoria) m.categoria = CAT_AFFITTI;
        n++;
      }
      if (n) await modificato();
      return { confermati: n };
    },

    async affitti_scarta(impronta) {
      if (!M.scarti.some((s) => s.id === impronta)) M.scarti.push({ id: impronta });
      await modificato();
      return { ok: true };
    },

    /* Pagamento a mano (contanti, assegno, bonifico non importato). Se "dividi" e l'importo copre più mesi lo distribuisce. */
    async salva_pagamento(x) {
      const c = perId("contratti", x.contratto);
      if (!c) return { ok: false, errore: "Scegli il contratto." };
      const importo = numero(x.importo);
      if (importo <= 0) return { ok: false, errore: "Indica l'importo pagato." };
      if (!/^\d{4}-\d{2}$/.test(x.mese || "")) return { ok: false, errore: "Indica il mese a cui si riferisce." };
      const data = valida(x.data) ? x.data : oggi();
      const metodo = ["bonifico", "contanti", "assegno", "altro"].includes(x.metodo) ? x.metodo : "altro";
      if (x.id) {
        const v = perId("pagamenti", x.id);
        if (!v) return { ok: false, errore: "Pagamento non trovato." };
        Object.assign(v, { contratto: c.id, mese: x.mese, importo, data, metodo, note: testo(x.note) });
      } else {
        const parti = x.dividi ? distribuisci(c, importo, x.mese) : [[x.mese, importo]];
        for (const [mm, q] of parti) M.pagamenti.push({ id: nuovoId(), contratto: c.id, mese: mm, importo: q, data, metodo, movimento: null, note: testo(x.note) });
      }
      await modificato();
      return { ok: true };
    },

    async elimina_pagamento(id) {
      M.pagamenti = M.pagamenti.filter((p) => p.id !== id);
      await modificato();
      return { ok: true };
    },

    async salva_spesa(x) {
      if (!perId("immobili", x.immobile)) return { ok: false, errore: "Scegli la casa." };
      const importo = numero(x.importo);
      if (importo <= 0) return { ok: false, errore: "Indica l'importo." };
      const descrizione = testo(x.descrizione, 200);
      if (!descrizione) return { ok: false, errore: "Scrivi una descrizione (es. Rata condominio 3° trimestre)." };
      const a_carico = x.a_carico === "inquilino" ? "inquilino" : "proprietario";
      let contratto = null;
      if (a_carico === "inquilino") {
        const att = contrattiValidi().find((c) => c.immobile === x.immobile && (!c.chiuso_il || c.chiuso_il >= (x.data || oggi())));
        contratto = perId("contratti", x.contratto) ? x.contratto : att ? att.id : null;
        if (!contratto) return { ok: false, errore: "Non c'è un contratto attivo su questa casa a cui addebitare la spesa." };
      }
      const v = x.id ? perId("spese", x.id) : null;
      sostituisci("spese", { id: v ? v.id : nuovoId(), immobile: x.immobile, contratto, data: valida(x.data) ? x.data : oggi(), descrizione, importo,
        tipo: TIPI_SPESA[x.tipo] ? x.tipo : "altro", a_carico, rimborsata: a_carico === "inquilino" && Boolean(x.rimborsata),
        movimento: v ? v.movimento || null : null, note: testo(x.note) });
      await modificato();
      return { ok: true };
    },

    async elimina_spesa(id) {
      M.spese = M.spese.filter((s) => s.id !== id);
      await modificato();
      return { ok: true };
    },

    async spese_anno(anno) {
      return M.spese.filter((s) => s.data.startsWith(String(anno))).sort((a, b) => (b.data < a.data ? -1 : 1))
        .map((s) => ({ ...s, immobile_nome: (perId("immobili", s.immobile) || {}).nome || "" }));
    },

    /* ---------- allegati: qui solo i dati (nome, chiave); il contenuto cifrato lo gestisce allegati.js ---------- */
    async allegato_registra(contrattoId, meta) {
      if (!perId("contratti", contrattoId)) return { ok: false };
      M.allegati.push({ id: meta.id, contratto: contrattoId, nome: testo(meta.nome, 200), tipo: testo(meta.tipo, 100),
        byte: +meta.byte || 0, chiave: meta.chiave, aggiunto_il: new Date().toISOString() });
      await modificato();
      return { ok: true };
    },
    async allegato_meta(id) { const a = perId("allegati", id); return a ? { ...a } : null; },
    async allegato_elimina(id) {
      const a = perId("allegati", id);
      M.allegati = M.allegati.filter((x) => x.id !== id);
      await modificato();
      return a ? { ...a } : null;
    },

    /* ---------- modello del contratto ---------- */
    async modello_contratto() { return M.impostazioni.modello_contratto || MODELLO_BASE; },
    async salva_modello_contratto(t) {
      if (t === null || String(t).trim() === "" ) delete M.impostazioni.modello_contratto;
      else M.impostazioni.modello_contratto = String(t).slice(0, 100000);
      await modificato();
      return { ok: true };
    },
    async dati_bozza(id) { const c = perId("contratti", id); return c ? { campi: datiPerModello(c), modello: M.impostazioni.modello_contratto || MODELLO_BASE } : null; },
  };
}

/* Modello di partenza: una traccia da adattare (va verificata con un professionista o un'associazione
   di categoria; per il 3+2 vale il modello dell'accordo territoriale del Comune). */
const MODELLO_BASE = `CONTRATTO DI LOCAZIONE AD USO ABITATIVO
({{tipo}})

BOZZA DA VERIFICARE – generata il {{oggi}}

Il/La sottoscritto/a ____________________ (di seguito "locatore")
concede in locazione a {{inquilini_cf}} (di seguito "conduttore"), che accetta,
l'unità immobiliare sita in {{indirizzo}} ({{casa}}), composta da ____________________,
dati catastali: foglio ____ particella ____ subalterno ____ categoria ____.

1. DURATA
Il contratto ha durata di {{durata_mesi}} mesi, dal {{inizio}} al {{fine}}.
Alla scadenza si rinnova per {{rinnovo_mesi}} mesi salvo disdetta da inviare con lettera raccomandata o PEC
almeno {{preavviso_mesi}} mesi prima della scadenza, nei casi e con le modalità previste dalla legge.

2. CANONE
Il canone annuo è di euro {{canone_annuo}}, da pagare in rate mensili anticipate di euro {{canone}}
entro il giorno {{giorno_pagamento}} di ogni mese, tramite bonifico bancario sul conto indicato dal locatore.
Regime della cedolare secca: {{cedolare}}.

3. ONERI ACCESSORI
Oltre al canone il conduttore versa un acconto mensile di euro {{spese_mensili}} per gli oneri accessori
(spese condominiali, pulizia scale, ecc.), salvo conguaglio annuale sulla base del rendiconto dell'amministratore.

4. DEPOSITO CAUZIONALE
Il conduttore versa al locatore un deposito cauzionale di euro {{deposito}}, non imputabile in conto canoni,
che sarà restituito al termine della locazione previa verifica dello stato dell'immobile.

5. USO E MANUTENZIONE
L'immobile è destinato esclusivamente ad abitazione del conduttore. È vietata la sublocazione, anche parziale.
Le riparazioni di piccola manutenzione sono a carico del conduttore; quelle straordinarie a carico del locatore.

6. RECESSO DEL CONDUTTORE
Il conduttore può recedere per gravi motivi con preavviso di almeno 6 mesi tramite raccomandata o PEC.

7. ATTESTATO DI PRESTAZIONE ENERGETICA
Il conduttore dichiara di aver ricevuto le informazioni e la documentazione sulla prestazione energetica (APE).

8. REGISTRAZIONE
Il contratto sarà registrato a cura del locatore entro 30 giorni dalla firma.

9. DATI PERSONALI
Le parti si autorizzano reciprocamente al trattamento dei dati personali per le sole finalità del presente contratto.

Letto, approvato e sottoscritto.

Luogo e data ____________________

Il locatore ____________________          Il conduttore ____________________
`;

G.FinAffitti = { creaAffitti, migra, LISTE, TIPI, TIPI_SPESA, CAT_AFFITTI, MODELLO_BASE, durataTesto };
})(globalThis);
