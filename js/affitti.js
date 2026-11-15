/* Finanze personali – Affitti e Contratti (logica).

   I dati stanno nello stesso modello cifrato dei movimenti (quindi: cifratura AES-256, backup,
   sincronizzazione con OneDrive e unione tra dispositivi valgono anche qui). Liste nel modello:
     immobili   {id, nome, indirizzo (via), civico, interno, cap, tipologia, superficie, vani, piano, catasto,
                 amministratore, amministratore_tel, costo_amministrazione (€/mese a mio carico), canone_richiesto, lavori, note}
     inquilini  {id, nome, codice_fiscale, email, telefono, riconoscimento, note}   (anagrafica dei titolari)
     contratti  {id, immobile, inquilini:[titolare, cointestatari…], occupanti:[{id, nome, relazione, nascita, minore}],
                 tipo, regime ("cedolare"|"ordinario"), inizio, durata_mesi, rinnovo_mesi, preavviso_mesi,
                 canone, spese_mensili, quota_amministrazione, giorno_pagamento, deposito, istat, registrazione, chiuso_il, note,
                 n_persone, n_minori (dichiarati: valgono se le persone non sono elencate una per una),
                 inizio_stimato (inizio ricavato dalla scadenza, es. da un import), incassi_dal "AAAA-MM" (prima non si controllano i pagamenti)}
                 (cedolare: booleano dei contratti salvati prima di "regime"; si continua a scriverlo per compatibilità)
     tipi_contratto {id, nome, durata, rinnovo, preavviso, regime, istat, note}   tipi creati dall'utente
     pagamenti  {id, contratto, mese "AAAA-MM", importo, data, metodo, movimento (impronta|null), note}
     spese      {id, immobile, contratto|null, data, descrizione, importo (>0), tipo, a_carico, rimborsata, note}
     allegati   {id, contratto|null, immobile|null, nome, tipo, byte, chiave, aggiunto_il}   (contenuto cifrato a parte: allegati.js)
     scarti     {id = impronta del movimento}  bonifici segnati come "non è un affitto"
   Gli id sono casuali (uuid) così due dispositivi non si scontrano. */
(function (G) {
"use strict";

const LISTE = ["immobili", "inquilini", "contratti", "pagamenti", "spese", "allegati", "scarti", "tipi_contratto", "assicurazioni", "promemoria"];
/* assicurazioni {id, immobile|null, compagnia, numero, tipo, contraente, premio (annuo), frazionamento (1|2|4|12),
                  decorrenza, durata_mesi, tacito_rinnovo, preavviso_giorni, massimale, agente, disdetta_il, note}
   promemoria    {id, data, titolo, immobile|null, ripeti ("no"|"mese"|"anno"), fatti:[date], note} */
const TIPI_ASSIC = { globale: "Globale fabbricati", incendio: "Incendio e scoppio", rc: "RC della proprietà", multirischio: "Multirischio casa",
  locativo: "Rischio locativo (dell'inquilino)", canone: "Tutela legale / canone garantito", altro: "Altro" };
const MESI_IT = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const CONTRAENTI = { proprietario: "Io (proprietario)", inquilino: "Inquilino", condominio: "Condominio" };
const CAT_AFFITTI = "Affitti incassati";
const TIPI = {
  "4+4": { nome: "Canone libero 4+4", durata: 48, rinnovo: 48, preavviso: 6, regime: "cedolare", istat: false },
  "3+2": { nome: "Canone concordato 3+2", durata: 36, rinnovo: 24, preavviso: 6, regime: "cedolare", istat: false },
  "transitorio": { nome: "Transitorio (1-18 mesi)", durata: 12, rinnovo: 0, preavviso: 0, regime: "cedolare", istat: false },
  "studenti": { nome: "Studenti universitari (6-36 mesi)", durata: 12, rinnovo: 0, preavviso: 0, regime: "cedolare", istat: false },
  "6+6": { nome: "Uso diverso / commerciale 6+6", durata: 72, rinnovo: 72, preavviso: 12, regime: "ordinario", istat: true },
  "altro": { nome: "Altro", durata: 12, rinnovo: 0, preavviso: 0, regime: "ordinario", istat: false },
};
const REGIMI = { cedolare: "Cedolare secca", ordinario: "Tassazione ordinaria (IRPEF)" };
const RELAZIONI = { coniuge: "Coniuge / partner", figlio: "Figlio/a", genitore: "Genitore", parente: "Altro parente", coinquilino: "Coinquilino", altro: "Altro" };
const TIPOLOGIE = { appartamento: "Appartamento", casa: "Casa indipendente", stanza: "Stanza", box: "Box / posto auto", negozio: "Negozio / ufficio", altro: "Altro" };
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
function dovutoMese(c) { return r2((c.canone || 0) + (c.spese_mensili || 0) + (c.quota_amministrazione || 0)); }
const regimeDi = (c) => (c.regime === "cedolare" || c.regime === "ordinario" ? c.regime : c.cedolare ? "cedolare" : "ordinario");

/* Età in anni compiuti alla data rif (null se la data di nascita manca). */
function eta(nascita, rif) {
  if (!valida(nascita) || nascita > rif) return null;
  let a = +rif.slice(0, 4) - +nascita.slice(0, 4);
  if (rif.slice(5) < nascita.slice(5)) a--;
  return a;
}
const minorenne = (o, rif) => { const e = eta(o.nascita, rif); return e === null ? Boolean(o.minore) : e < 18; };

/* Giorno di scadenza della rata del mese (es. il 5), limitato alla fine del mese. */
function scadenzaRata(c, mese) {
  const g = Math.min(intero(c.giorno_pagamento, 1, 31, 5), giorniMese(+mese.slice(0, 4), +mese.slice(5, 7)));
  return `${mese}-${p2(g)}`;
}

/* Primo mese in cui si controlla il pagamento: inizio del contratto, o "incassi_dal" se è dopo. */
const primoMeseDovuto = (c) => (c.incassi_dal && c.incassi_dal > meseDi(c.inizio) ? c.incassi_dal : meseDi(c.inizio));

/* Indirizzo leggibile: via, civico, interno, CAP. */
function indirizzoCompleto(i) {
  if (!i) return "";
  const via = [i.indirizzo, i.civico].filter(Boolean).join(" ").trim();
  return [via, i.interno ? `int. ${i.interno}` : "", i.cap].filter(Boolean).join(", ");
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
  /* Tipo del contratto: quelli di legge (TIPI) o quelli creati dall'utente. */
  function tipoInfo(k) {
    if (TIPI[k]) return { id: k, ...TIPI[k], personalizzato: false };
    const t = perId("tipi_contratto", k);
    return t ? { ...t, personalizzato: true } : { id: "altro", ...TIPI.altro, personalizzato: false };
  }
  function elencoTipi() {
    return [...Object.keys(TIPI).filter((k) => k !== "altro").map((k) => tipoInfo(k)),
      ...M.tipi_contratto.slice().sort((a, b) => a.nome.localeCompare(b.nome, "it")).map((t) => ({ ...t, personalizzato: true })),
      tipoInfo("altro")];
  }
  function persone(c, rif) {
    const tit = (c.inquilini || []).map((i) => perId("inquilini", i)).filter(Boolean);
    const occ = (Array.isArray(c.occupanti) ? c.occupanti : []).map((o) => ({ ...o, eta: eta(o.nascita, rif), minorenne: minorenne(o, rif),
      relazione_nome: RELAZIONI[o.relazione] || "" }));
    const elencate = tit.length + occ.length, minori = occ.filter((o) => o.minorenne).length;
    return { titolare: tit[0] || null, cointestatari: tit.slice(1), occupanti: occ,
      n_persone: Math.max(elencate, +c.n_persone || 0), n_minori: Math.max(minori, +c.n_minori || 0),
      persone_dichiarate: (+c.n_persone || 0) > elencate };
  }

  /* Mese per mese: dovuto, pagato, stato. */
  function mesiContratto(c, fino = oggi()) {
    if (!valida(c.inizio)) return [];
    const ultimo = ultimoMese(c, fino), primo = primoMeseDovuto(c);
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
    const pp = persone(c, rif), reg = regimeDi(c);
    return {
      id: c.id, immobile: c.immobile, immobile_nome: imm ? imm.nome : "(casa eliminata)", indirizzo: indirizzoCompleto(imm),
      inquilini: nomiInquilini(c), inquilini_id: (c.inquilini || []).slice(),
      titolare: pp.titolare ? pp.titolare.nome : "—", titolare_id: pp.titolare ? pp.titolare.id : null,
      titolare_email: pp.titolare ? pp.titolare.email || "" : "", titolare_telefono: pp.titolare ? pp.titolare.telefono || "" : "",
      cointestatari: pp.cointestatari.map((i) => i.nome), occupanti: pp.occupanti, n_persone: pp.n_persone, n_minori: pp.n_minori,
      persone_dichiarate: pp.persone_dichiarate, inizio_stimato: Boolean(c.inizio_stimato), incassi_dal: c.incassi_dal || null,
      tipo: c.tipo, tipo_nome: tipoInfo(c.tipo).nome, inizio: c.inizio, chiuso_il: c.chiuso_il || null,
      attivo: !c.chiuso_il || c.chiuso_il >= rif,
      canone: c.canone || 0, spese_mensili: c.spese_mensili || 0, quota_amministrazione: c.quota_amministrazione || 0,
      dovuto: dovutoMese(c), giorno_pagamento: intero(c.giorno_pagamento, 1, 31, 5),
      deposito: c.deposito || 0, regime: reg, regime_nome: REGIMI[reg], cedolare: reg === "cedolare", istat: Boolean(c.istat) && reg !== "cedolare",
      registrazione: c.registrazione || "",
      ultimo_pagamento: M.pagamenti.filter((p) => p.contratto === c.id).reduce((x, p) => (p.data > x ? p.data : x), "") || null,
      arretrati, mesi_arretrati: scaduti.length, max_giorni_ritardo: scaduti.reduce((x, m) => Math.max(x, m.giorni), 0),
      mesi_insoluti: scaduti.map((m) => ({ mese: m.mese, dovuto: m.dovuto, pagato: m.pagato, residuo: m.residuo, giorni: m.giorni })),
      spese_da_rimborsare: speseDaRimborsare(c),
      mese_attuale: attuale,
      in_casa_dal: dal, in_casa_da: c.inizio_stimato && dal === c.inizio ? "" : durataTesto(dal, fineCasa),
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
  function pulisciOccupanti(lista, vecchi) {
    return (Array.isArray(lista) ? lista : []).slice(0, 30).map((o) => {
      const nome = testo(o.nome, 120);
      if (!nome) return null;
      const nascita = valida(o.nascita) && o.nascita <= oggi() ? o.nascita : "";
      const v = (vecchi || []).find((k) => k.id === o.id);
      return { id: v ? v.id : nuovoId(), nome, relazione: RELAZIONI[o.relazione] ? o.relazione : "altro", nascita,
        minore: nascita ? eta(nascita, oggi()) < 18 : Boolean(o.minore) };
    }).filter(Boolean);
  }

  function pulisciContratto(x, vecchio) {
    const t = tipoInfo(x.tipo);
    const regime = x.regime === "cedolare" || x.regime === "ordinario" ? x.regime : t.regime || "ordinario";
    return {
      id: vecchio ? vecchio.id : nuovoId(),
      immobile: testo(x.immobile, 64), inquilini: (Array.isArray(x.inquilini) ? x.inquilini : []).map((i) => testo(i, 64)).filter(Boolean),
      occupanti: pulisciOccupanti(x.occupanti, vecchio && vecchio.occupanti),
      tipo: t.id, regime, inizio: valida(x.inizio) ? x.inizio : oggi(),
      durata_mesi: intero(x.durata_mesi, 1, 240, t.durata), rinnovo_mesi: intero(x.rinnovo_mesi, 0, 240, t.rinnovo),
      preavviso_mesi: intero(x.preavviso_mesi, 0, 24, t.preavviso),
      canone: numero(x.canone), spese_mensili: numero(x.spese_mensili), quota_amministrazione: numero(x.quota_amministrazione),
      giorno_pagamento: intero(x.giorno_pagamento, 1, 31, 5),
      deposito: numero(x.deposito), cedolare: regime === "cedolare", istat: (x.istat === undefined ? Boolean(t.istat) : Boolean(x.istat)) && regime !== "cedolare",
      registrazione: testo(x.registrazione, 200), chiuso_il: valida(x.chiuso_il) ? x.chiuso_il : null, note: testo(x.note),
      n_persone: tieni(x, vecchio, "n_persone", (v) => intero(v, 0, 30, 0) || null),
      n_minori: tieni(x, vecchio, "n_minori", (v) => intero(v, 0, 30, 0) || null),
      inizio_stimato: tieni(x, vecchio, "inizio_stimato", Boolean),
      incassi_dal: tieni(x, vecchio, "incassi_dal", (v) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || "")) ? String(v) : null)),
    };
  }
  /* Campo nuovo: se non arriva (form vecchio, import parziale) resta il valore di prima. */
  function tieni(x, vecchio, k, pulisci) {
    if (x[k] !== undefined) return pulisci(x[k]);
    return vecchio && vecchio[k] !== undefined ? vecchio[k] : pulisci(null);
  }

  function sostituisci(lista, nuovo) {
    const i = M[lista].findIndex((x) => x.id === nuovo.id);
    if (i >= 0) M[lista][i] = nuovo; else M[lista].push(nuovo);
    return nuovo;
  }

  /* Campi della casa: quelli non indicati restano come prima. */
  function pulisciImmobile(x, v) {
    const k = (campo, f) => (x[campo] !== undefined ? f(x[campo]) : v && v[campo] !== undefined ? v[campo] : f(null));
    return {
      indirizzo: k("indirizzo", (t) => testo(t, 300)), civico: k("civico", (t) => testo(t, 20)), interno: k("interno", (t) => testo(t, 20)),
      cap: k("cap", (t) => testo(t, 10)),
      tipologia: k("tipologia", (t) => (TIPOLOGIE[t] ? t : "appartamento")),
      superficie: k("superficie", (t) => intero(t, 0, 100000, 0) || null), vani: k("vani", (t) => numero(t) || null),
      piano: k("piano", (t) => testo(t, 30)), catasto: k("catasto", (t) => testo(t, 300)),
      amministratore: k("amministratore", (t) => testo(t, 300)), amministratore_tel: k("amministratore_tel", (t) => testo(t, 60)),
      costo_amministrazione: k("costo_amministrazione", (t) => numero(t)),
      canone_richiesto: k("canone_richiesto", (t) => numero(t)), lavori: k("lavori", (t) => testo(t, 2000)), note: k("note", (t) => testo(t)),
    };
  }

  /* ---------- importazione delle case da un foglio Excel (già letto da analizzaFoglio) ---------- */
  const chiaveCasa = (i) => normParole([i.indirizzo, i.civico, i.interno ? "INT " + i.interno : ""].filter(Boolean).join(" "));
  function trovaTipo(testoTipo, n) {
    const t = String(testoTipo || "").toLowerCase();
    const parole = normParole(t);
    let id = null;
    if (/4\s*\+\s*4/.test(t) || /\blibero\b/.test(t)) id = "4+4";
    else if (/3\s*\+\s*2/.test(t) || /concordat/.test(t)) id = "3+2";
    else if (/6\s*\+\s*6/.test(t) || /commercial|uso diverso|negozio/.test(t)) id = "6+6";
    else if (/transitori/.test(t)) id = "transitorio";
    else if (/student|universit/.test(t)) id = "studenti";
    const regime = /cedolare/.test(t) ? "cedolare" : /ordinari|irpef/.test(t) ? "ordinario" : null;
    if (id || !parole || /^(CEDOLARE( SECCA)?|ORDINARIO)$/.test(parole)) return { id: id || "4+4", regime };
    const nome = testo(testoTipo, 100);
    let tipo = M.tipi_contratto.find((x) => x.nome.toLowerCase() === nome.toLowerCase());
    if (!tipo) {
      tipo = sostituisci("tipi_contratto", { id: nuovoId(), nome, durata: 12, rinnovo: 0, preavviso: 0, regime: regime || "ordinario", istat: false,
        note: "Creato dall'import Excel: controlla durata, rinnovo e preavviso" });
      n.tipi++;
    }
    return { id: tipo.id, regime };
  }

  function importaVoce(v, opz, n) {
    // casa
    const casa = v.casa;
    const chiave = chiaveCasa(casa), nomeCasa = casa.nome;
    let imm = M.immobili.find((i) => (chiave && chiaveCasa(i) === chiave) || normParole(i.nome) === normParole(nomeCasa));
    const campi = {};
    for (const [k2, val] of Object.entries(casa)) if (k2 !== "nome" && !(imm && k2 === "note") && val !== null && val !== "" && val !== undefined) campi[k2] = val;
    if (!opz.amm_inquilino && v.contratto && v.contratto.costo_amm) campi.costo_amministrazione = v.contratto.costo_amm;
    if (imm) { Object.assign(imm, pulisciImmobile(campi, imm)); n.case_agg++; }
    else { imm = sostituisci("immobili", { id: nuovoId(), nome: nomeCasa, ...pulisciImmobile(campi, null) }); n.case_nuove++; }

    // inquilino
    let inq = null;
    const q = v.inquilino;
    if (q && q.nome) {
      const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.email || "") ? q.email : "";
      const nota = q.email && !email ? `Email nel file: ${q.email}` : "";
      inq = M.inquilini.find((i) => normParole(i.nome) === normParole(q.nome));
      if (inq) {
        if (q.telefono) inq.telefono = testo(q.telefono, 40);
        if (email) inq.email = testo(email, 200);
        n.inquilini_agg++;
      } else {
        inq = sostituisci("inquilini", { id: nuovoId(), nome: testo(q.nome, 120), codice_fiscale: "", email: testo(email, 200), telefono: testo(q.telefono, 40),
          riconoscimento: "", note: nota });
        n.inquilini++;
      }
    }

    // contratto (solo con un inquilino; senza, l'affitto diventa il canone richiesto della casa sfitta)
    const k = v.contratto || {};
    if (!inq) {
      if (k.canone > 0) imm.canone_richiesto = k.canone;
    } else {
      const tipo = trovaTipo(k.tipo, n);
      const info = tipoInfo(tipo.id);
      const scad = valida(k.scadenza) ? k.scadenza : null;
      const inizio = scad ? piuMesi(piuGiorni(scad, 1), -info.durata) : `${opz.incassi_dal}-01`;
      const attivi = M.contratti.filter((c) => c.immobile === imm.id && (!c.chiuso_il || c.chiuso_il >= oggi()));
      const stesso = attivi.find((c) => (c.inquilini || [])[0] === inq.id);
      const quota = opz.amm_inquilino ? k.costo_amm || 0 : 0;
      const note = [k.note, scad ? "" : "Scadenza non indicata nel file: controlla data di inizio e durata."].filter(Boolean).join("\n");
      if (stesso) {
        const agg = { ...stesso, tipo: tipo.id, canone: k.canone > 0 ? k.canone : stesso.canone, quota_amministrazione: quota || stesso.quota_amministrazione,
          note: k.note ? testo(k.note) : stesso.note };
        if (tipo.regime) agg.regime = tipo.regime;
        if (stesso.inizio_stimato && scad) { agg.inizio = inizio; agg.durata_mesi = info.durata; agg.rinnovo_mesi = info.rinnovo; agg.preavviso_mesi = info.preavviso; }
        if (k.n_persone !== null) agg.n_persone = k.n_persone;
        if (k.n_minori !== null) agg.n_minori = k.n_minori;
        sostituisci("contratti", pulisciContratto(agg, stesso));
        n.contratti_agg++;
      } else if (attivi.length) {
        n.avvisi.push(`${imm.nome}: c'è già un contratto in corso con un altro titolare, non ho creato quello di ${inq.nome}.`);
      } else {
        sostituisci("contratti", pulisciContratto({ immobile: imm.id, inquilini: [inq.id], occupanti: [], tipo: tipo.id, regime: tipo.regime || undefined,
          inizio, canone: k.canone, spese_mensili: 0, quota_amministrazione: quota, giorno_pagamento: 5, deposito: 0, note,
          n_persone: k.n_persone, n_minori: k.n_minori, inizio_stimato: true, incassi_dal: opz.incassi_dal }, null));
        n.contratti++;
        if (!(k.canone > 0)) n.avvisi.push(`${imm.nome}: affitto mensile non indicato, completalo nel contratto.`);
      }
    }

    // polizza
    const p = v.polizza;
    if (p) {
      const num = normParole(p.numero);
      const a = (num && M.assicurazioni.find((x) => normParole(x.numero) === num)) ||
        M.assicurazioni.find((x) => x.immobile === imm.id && p.compagnia && normParole(x.compagnia) === normParole(p.compagnia)) || null;
      // senza scadenza nel file: la faccio cadere oggi, così la polizza risulta "in scadenza" e va controllata
      const decorrenza = valida(p.scadenza) ? piuMesi(p.scadenza, -12) : a ? a.decorrenza : piuMesi(oggi(), -12);
      const base = a ? { ...a } : { tipo: "altro", contraente: "proprietario", frazionamento: 1, tacito_rinnovo: false, preavviso_giorni: 0, massimale: "", agente: "", disdetta_il: null, note: "" };
      const dati = { ...base, immobile: imm.id, compagnia: p.compagnia || base.compagnia || "Da completare", numero: p.numero || base.numero || "",
        premio: p.premio > 0 ? p.premio : base.premio || 0, decorrenza, durata_mesi: 12,
        note: [base.note, p.info && !a ? `Dal file: ${p.info}` : "", !valida(p.scadenza) && !a ? "Scadenza non indicata nel file." : ""].filter(Boolean).join("\n") };
      sostituisci("assicurazioni", pulisciAssic(dati, a));
      if (a) n.polizze_agg++; else n.polizze++;
    }
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
        if (c.istat && regimeDi(c) !== "cedolare") out.push({ ...base, data: ann, tipo: "istat", testo: "Aggiornamento ISTAT del canone" });
        if (regimeDi(c) !== "cedolare") out.push({ ...base, data: ann, tipo: "registro", testo: "Imposta di registro annuale (entro 30 giorni)" });
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
    const occ = (c.occupanti || []).map((o) => `${o.nome}${RELAZIONI[o.relazione] && o.relazione !== "altro" ? ` (${RELAZIONI[o.relazione].toLowerCase()})` : ""}`);
    const cf = (i) => `${i.nome}${i.codice_fiscale ? ` (C.F. ${i.codice_fiscale})` : ""}`;
    return {
      casa: imm.nome || "", indirizzo: indirizzoCompleto(imm), catasto: imm.catasto || "",
      titolare: inq[0] ? inq[0].nome : "", titolare_cf: inq[0] ? cf(inq[0]) : "",
      inquilini: inq.map((i) => i.nome).join(", "),
      inquilini_cf: inq.map(cf).join(", "),
      occupanti: occ.length ? occ.join(", ") : "nessun altro",
      tipo: tipoInfo(c.tipo).nome, regime: REGIMI[regimeDi(c)], inizio: it(c.inizio), fine: it(sc.fine),
      durata_mesi: String(c.durata_mesi || ""), rinnovo_mesi: String(c.rinnovo_mesi || ""), preavviso_mesi: String(c.preavviso_mesi || ""),
      canone: e(c.canone), canone_annuo: e((c.canone || 0) * 12), spese_mensili: e(c.spese_mensili),
      quota_amministrazione: e(c.quota_amministrazione), totale_mensile: e(dovutoMese(c)), deposito: e(c.deposito),
      giorno_pagamento: String(c.giorno_pagamento || ""), cedolare: regimeDi(c) === "cedolare" ? "sì" : "no", oggi: it(oggi()),
    };
  }

  /* ---------- insoluti: contratti non saldati fino in fondo ---------- */
  const ORDINE_LIV = { critico: 0, grave: 1, lieve: 2, rimborsi: 3 };
  function livello(r) {
    if (r.arretrati <= 0) return "rimborsi";
    if (!r.attivo || r.max_giorni_ritardo > 60 || r.mesi_arretrati >= 3) return "critico";
    if (r.max_giorni_ritardo > 20 || r.mesi_arretrati >= 2) return "grave";
    return "lieve";
  }
  function insoluti(rif = oggi()) {
    return contrattiValidi().map((c) => riepilogoContratto(c, rif))
      .filter((r) => r.arretrati > 0 || r.spese_da_rimborsare > 0)
      .map((r) => ({ ...r, livello: livello(r), totale_dovuto: r2(r.arretrati + r.spese_da_rimborsare),
        spese_aperte: M.spese.filter((s) => s.contratto === r.id && s.a_carico === "inquilino" && !s.rimborsata).map((s) => ({ ...s })) }))
      .sort((a, b) => ORDINE_LIV[a.livello] - ORDINE_LIV[b.livello] || b.totale_dovuto - a.totale_dovuto);
  }

  /* ---------- assicurazioni ---------- */
  function periodiAssic(a, fino) {
    // scadenze annuali (o della durata indicata): con il tacito rinnovo continuano finché non c'è una disdetta
    const dur = intero(a.durata_mesi, 1, 120, 12), out = [];
    if (!valida(a.decorrenza)) return out;
    for (let k = 1; k < 400; k++) {
      const fine = piuMesi(a.decorrenza, dur * k), inizio = piuMesi(a.decorrenza, dur * (k - 1));
      out.push({ inizio, fine });
      if (!a.tacito_rinnovo || (a.disdetta_il && a.disdetta_il <= fine) || fine >= fino) break;
    }
    return out;
  }
  function statoAssic(a, rif = oggi()) {
    const pp = periodiAssic(a, rif);
    const cur = pp.find((p) => p.fine >= rif) || pp[pp.length - 1] || null;
    const fine = cur ? cur.fine : null;
    const pre = intero(a.preavviso_giorni, 0, 365, 0);
    const disdetta_entro = fine && a.tacito_rinnovo && !a.disdetta_il && pre ? piuGiorni(fine, -pre) : null;
    const fraz = [1, 2, 4, 12].includes(+a.frazionamento) ? +a.frazionamento : 1;
    let prossima_rata = null;
    if (cur && fine >= rif) for (let i = 0; i < fraz; i++) { const d = piuMesi(cur.inizio, (12 / fraz) * i); if (d >= rif) { prossima_rata = d; break; } }
    if (!prossima_rata && fine && fine >= rif && a.tacito_rinnovo && !a.disdetta_il) prossima_rata = fine;
    const scaduta = !fine || fine < rif;
    const tra = fine ? diffGiorni(fine, rif) : null;
    const imm = a.immobile ? perId("immobili", a.immobile) : null;
    return { ...a, immobile_nome: imm ? imm.nome : "", tipo_nome: TIPI_ASSIC[a.tipo] || "Altro", contraente_nome: CONTRAENTI[a.contraente] || "",
      scadenza: fine, disdetta_entro, prossima_rata, rata: r2((a.premio || 0) / fraz), frazionamento: fraz,
      stato: scaduta ? "scaduta" : (tra <= 30 || (disdetta_entro && diffGiorni(disdetta_entro, rif) <= 30)) ? "in_scadenza" : "attiva",
      tra_giorni: tra, allegati: M.allegati.filter((x) => x.assicurazione === a.id).length };
  }
  function pulisciAssic(x, v) {
    return { id: v ? v.id : nuovoId(), immobile: perId("immobili", x.immobile) ? x.immobile : null,
      compagnia: testo(x.compagnia, 120), numero: testo(x.numero, 80), tipo: TIPI_ASSIC[x.tipo] ? x.tipo : "altro",
      contraente: CONTRAENTI[x.contraente] ? x.contraente : "proprietario", premio: numero(x.premio),
      frazionamento: [1, 2, 4, 12].includes(+x.frazionamento) ? +x.frazionamento : 1,
      decorrenza: valida(x.decorrenza) ? x.decorrenza : oggi(), durata_mesi: intero(x.durata_mesi, 1, 120, 12),
      tacito_rinnovo: Boolean(x.tacito_rinnovo), preavviso_giorni: intero(x.preavviso_giorni, 0, 365, 0),
      massimale: testo(x.massimale, 120), agente: testo(x.agente, 200), disdetta_il: valida(x.disdetta_il) ? x.disdetta_il : null, note: testo(x.note) };
  }

  /* ---------- calendario: tutte le scadenze tra due date ---------- */
  function eventi(da, a, rif = oggi()) {
    const out = [];
    const add = (e) => { if (e.data >= da && e.data <= a) out.push({ ...e, stato: e.stato || (e.data < rif ? "passato" : "futuro") }); };
    for (const c of contrattiValidi()) {
      const imm = perId("immobili", c.immobile), tit = nomiInquilini(c)[0] || "";
      const base = { contratto: c.id, immobile: c.immobile, immobile_nome: imm.nome, chi: tit };
      // rate del mese
      const pag = new Map();
      for (const p of M.pagamenti) if (p.contratto === c.id) pag.set(p.mese, r2((pag.get(p.mese) || 0) + p.importo));
      const dov = dovutoMese(c), m0 = primoMeseDovuto(c) > meseDi(da) ? primoMeseDovuto(c) : meseDi(da), m1 = ultimoMese(c, a);
      if (dov > 0) for (const mese of mesiTra(m0, m1)) {
        const scad = scadenzaRata(c, mese), pagato = pag.get(mese) || 0;
        add({ ...base, data: scad, tipo: "rata", titolo: "Affitto " + MESI_IT[+mese.slice(5, 7) - 1], mese, importo: dov, residuo: r2(Math.max(0, dov - pagato)),
          stato: pagato >= dov - 0.005 ? "fatto" : scad < rif ? "scaduto" : "futuro" });
      }
      // fine dei periodi contrattuali e termini di disdetta
      const durata = intero(c.durata_mesi, 1, 240, 12), rinnovo = intero(c.rinnovo_mesi, 0, 240, 0), pre = intero(c.preavviso_mesi, 0, 24, 0);
      for (let k = 0, mesi = durata; k < 100; k++, mesi += rinnovo) {
        const fine = piuGiorni(piuMesi(c.inizio, mesi), -1);
        if (c.chiuso_il && fine > c.chiuso_il) break;
        add({ ...base, data: fine, tipo: "contratto", titolo: rinnovo ? "Scadenza contratto (rinnovo tacito)" : "Fine del contratto" });
        if (pre) add({ ...base, data: piuMesi(piuGiorni(fine, 1), -pre), tipo: "disdetta", titolo: "Ultimo giorno per la disdetta del contratto" });
        if (!rinnovo || fine > a) break;
      }
      if (c.chiuso_il) add({ ...base, data: c.chiuso_il, tipo: "contratto", titolo: "Contratto chiuso (uscita)", stato: "passato" });
      // anniversari: ISTAT e imposta di registro (non con la cedolare secca)
      if (regimeDi(c) !== "cedolare") for (let n = 1; n < 100; n++) {
        const d = piuMesi(c.inizio, 12 * n);
        if (d > a || (c.chiuso_il && d > c.chiuso_il)) break;
        if (d < da) continue;
        add({ ...base, data: d, tipo: "registro", titolo: "Imposta di registro annuale (entro 30 giorni)" });
        if (c.istat) add({ ...base, data: d, tipo: "istat", titolo: "Aggiornamento ISTAT del canone" });
      }
    }
    for (const x of M.assicurazioni) {
      const s = statoAssic(x, rif), imm = x.immobile ? perId("immobili", x.immobile) : null;
      const nomePol = x.tipo === "altro" && x.compagnia ? x.compagnia : s.tipo_nome;
      const base = { assicurazione: x.id, immobile: x.immobile, immobile_nome: imm ? imm.nome : "", chi: x.compagnia };
      const pre = intero(x.preavviso_giorni, 0, 365, 0);
      for (const p of periodiAssic(x, a)) {
        add({ ...base, data: p.fine, tipo: "assicurazione", titolo: `Scadenza polizza ${nomePol}` });
        if (x.tacito_rinnovo && !x.disdetta_il && pre) add({ ...base, data: piuGiorni(p.fine, -pre), tipo: "disdetta", titolo: `Ultimo giorno per disdire la polizza ${nomePol}` });
        for (let i = 0; i < s.frazionamento; i++) {
          const d = piuMesi(p.inizio, (12 / s.frazionamento) * i);
          if (x.premio > 0) add({ ...base, data: d, tipo: "premio", titolo: `Premio polizza ${nomePol}`, importo: s.rata });
        }
      }
    }
    for (const p of M.promemoria) {
      if (!valida(p.data)) continue;
      const imm = p.immobile ? perId("immobili", p.immobile) : null;
      const fatti = new Set(p.fatti || []);
      const passo = p.ripeti === "mese" ? 1 : p.ripeti === "anno" ? 12 : 0;
      for (let k = 0; k < 1200; k++) {
        const d = passo ? piuMesi(p.data, passo * k) : p.data;
        if (d > a) break;
        if (d >= da) add({ promemoria: p.id, immobile: p.immobile, immobile_nome: imm ? imm.nome : "", chi: "", data: d, tipo: "promemoria", titolo: p.titolo,
          note: p.note || "", ripeti: p.ripeti, stato: fatti.has(d) ? "fatto" : d < rif ? "scaduto" : "futuro" });
        if (!passo) break;
      }
    }
    return out.sort((x, y) => (x.data < y.data ? -1 : x.data > y.data ? 1 : 0));
  }

  /* ---------- immobili ---------- */
  function schedaImmobile(i, anno, rif) {
    const contr = contrattiValidi().filter((c) => c.immobile === i.id);
    const rr = contr.map((c) => riepilogoContratto(c, rif)).sort((a, b) => (b.inizio < a.inizio ? -1 : 1));
    const att = rr.find((r) => r.attivo) || null;
    const ultimaUscita = rr.filter((r) => r.chiuso_il && r.chiuso_il < rif).reduce((x, r) => (r.chiuso_il > x ? r.chiuso_il : x), "");
    const ids = new Set(contr.map((c) => c.id));
    const incassato = r2(M.pagamenti.filter((p) => ids.has(p.contratto) && p.mese.startsWith(anno)).reduce((t, p) => t + p.importo, 0));
    const spese = r2(M.spese.filter((s) => s.immobile === i.id && s.a_carico !== "inquilino" && s.data.startsWith(anno)).reduce((t, s) => t + s.importo, 0));
    const assic = M.assicurazioni.filter((a) => a.immobile === i.id).map((a) => statoAssic(a, rif));
    const assicAttive = assic.filter((a) => a.stato !== "scaduta");
    const arretrati = r2(rr.reduce((t, r) => t + r.arretrati + r.spese_da_rimborsare, 0));
    const prossimi = eventi(rif, piuGiorni(rif, 365), rif).filter((e) => e.immobile === i.id && e.tipo !== "rata" && e.tipo !== "premio");
    return {
      ...i, stato: att ? "affittata" : "sfitta", contratto: att,
      sfitta_dal: att ? null : ultimaUscita || null, giorni_sfitta: !att && ultimaUscita ? diffGiorni(rif, ultimaUscita) : null,
      in_scadenza: Boolean(att && (att.scaduto || (att.scadenza && diffGiorni(att.scadenza, rif) <= 90) || (att.disdetta_entro && diffGiorni(att.disdetta_entro, rif) <= 60 && att.disdetta_entro >= rif))),
      insoluto: arretrati, n_contratti: rr.length,
      incassato_anno: incassato, spese_anno: spese, netto_anno: r2(incassato - spese),
      assicurazioni: assic, assicurata: assicAttive.length > 0, assic_in_scadenza: assicAttive.some((a) => a.stato === "in_scadenza"),
      assic_prossima: assicAttive.reduce((x, a) => (!x || a.scadenza < x ? a.scadenza : x), null),
      n_documenti: M.allegati.filter((a) => a.immobile === i.id || ids.has(a.contratto)).length,
      prossima: prossimi[0] || null,
      tipologia_nome: TIPOLOGIE[i.tipologia] || "", indirizzo_completo: indirizzoCompleto(i),
    };
  }

  /* ======================= API ======================= */
  return {
    affitti_tipi() { return { contratti: elencoTipi(), spese: TIPI_SPESA, regimi: REGIMI, relazioni: RELAZIONI, tipologie: TIPOLOGIE, assicurazioni: TIPI_ASSIC, contraenti: CONTRAENTI }; },

    /* ---------- tipi di contratto creati dall'utente ---------- */
    async salva_tipo_contratto(x) {
      const nome = testo(x.nome, 100);
      if (!nome) return { ok: false, errore: "Scrivi il nome del tipo di contratto." };
      if (elencoTipi().some((t) => t.id !== x.id && t.nome.toLowerCase() === nome.toLowerCase())) return { ok: false, errore: "Esiste già un tipo con questo nome." };
      const v = x.id ? perId("tipi_contratto", x.id) : null;
      const regime = x.regime === "cedolare" ? "cedolare" : "ordinario";
      const r = sostituisci("tipi_contratto", { id: v ? v.id : nuovoId(), nome, durata: intero(x.durata, 1, 240, 12), rinnovo: intero(x.rinnovo, 0, 240, 0),
        preavviso: intero(x.preavviso, 0, 24, 0), regime, istat: Boolean(x.istat) && regime !== "cedolare", note: testo(x.note, 500) });
      await modificato();
      return { ok: true, id: r.id };
    },
    async elimina_tipo_contratto(id) {
      const n = M.contratti.filter((c) => c.tipo === id).length;
      if (n) return { ok: false, errore: `Il tipo è usato da ${n} ${n === 1 ? "contratto" : "contratti"}: cambia prima il loro tipo.` };
      M.tipi_contratto = M.tipi_contratto.filter((t) => t.id !== id);
      await modificato();
      return { ok: true };
    },

    /* ---------- insoluti ---------- */
    async insoluti() {
      const l = insoluti();
      return { elenco: l, totale: r2(l.reduce((t, r) => t + r.totale_dovuto, 0)), arretrati: r2(l.reduce((t, r) => t + r.arretrati, 0)),
        rimborsi: r2(l.reduce((t, r) => t + r.spese_da_rimborsare, 0)), n_contratti: l.filter((r) => r.arretrati > 0).length,
        oltre_20: l.filter((r) => r.max_giorni_ritardo > 20).length };
    },

    /* ---------- immobili ---------- */
    async immobili_elenco(anno = "") {
      const rif = oggi();
      anno = /^\d{4}$/.test(String(anno)) ? String(anno) : rif.slice(0, 4);
      const cc = M.immobili.map((i) => schedaImmobile(i, anno, rif)).sort((a, b) => a.nome.localeCompare(b.nome, "it"));
      const aff = cc.filter((c) => c.stato === "affittata");
      return { anno, oggi: rif, case: cc, n: cc.length, affittate: aff.length, sfitte: cc.length - aff.length,
        occupazione: cc.length ? Math.round((aff.length / cc.length) * 100) : 0,
        canoni_mensili: r2(aff.reduce((t, c) => t + c.contratto.canone, 0)),
        incassato_anno: r2(cc.reduce((t, c) => t + c.incassato_anno, 0)), spese_anno: r2(cc.reduce((t, c) => t + c.spese_anno, 0)),
        netto_anno: r2(cc.reduce((t, c) => t + c.netto_anno, 0)),
        senza_assicurazione: cc.filter((c) => !c.assicurata).length };
    },
    async immobile_dettaglio(id, anno = "") {
      const i = perId("immobili", id);
      if (!i) return null;
      const rif = oggi();
      anno = /^\d{4}$/.test(String(anno)) ? String(anno) : rif.slice(0, 4);
      const s = schedaImmobile(i, anno, rif);
      const contr = contrattiValidi().filter((c) => c.immobile === id);
      const ids = new Set(contr.map((c) => c.id));
      const anni = new Set([rif.slice(0, 4)]);
      for (const p of M.pagamenti) if (ids.has(p.contratto)) anni.add(p.mese.slice(0, 4));
      for (const x of M.spese) if (x.immobile === id) anni.add(x.data.slice(0, 4));
      const perAnno = [...anni].filter((y) => y <= rif.slice(0, 4)).sort().reverse().map((y) => {
        const inc = r2(M.pagamenti.filter((p) => ids.has(p.contratto) && p.mese.startsWith(y)).reduce((t, p) => t + p.importo, 0));
        const sp = r2(M.spese.filter((x) => x.immobile === id && x.a_carico !== "inquilino" && x.data.startsWith(y)).reduce((t, x) => t + x.importo, 0));
        return { anno: y, incassato: inc, spese: sp, netto: r2(inc - sp) };
      });
      const nomeContr = (cid) => { const c = perId("contratti", cid); return c ? `Contratto ${nomiInquilini(c)[0] || ""} dal ${c.inizio.slice(8, 10)}/${c.inizio.slice(5, 7)}/${c.inizio.slice(0, 4)}` : ""; };
      return {
        ...s, anno, anni: perAnno,
        contratti: contr.map((c) => riepilogoContratto(c, rif)).sort((a, b) => (b.inizio < a.inizio ? -1 : 1)),
        spese: M.spese.filter((x) => x.immobile === id).sort((a, b) => (b.data < a.data ? -1 : 1)).map((x) => ({ ...x })),
        allegati: M.allegati.filter((a) => a.immobile === id || ids.has(a.contratto))
          .map((a) => ({ id: a.id, nome: a.nome, tipo: a.tipo, byte: a.byte, aggiunto_il: a.aggiunto_il, di: a.immobile === id ? "Casa" : nomeContr(a.contratto), della_casa: a.immobile === id })),
        eventi: eventi(rif, piuGiorni(rif, 365), rif).filter((e) => e.immobile === id).slice(0, 12),
      };
    },

    /* ---------- assicurazioni ---------- */
    async assicurazioni_elenco() {
      const rif = oggi();
      const l = M.assicurazioni.map((a) => statoAssic(a, rif)).sort((a, b) => ((a.stato === "scaduta") - (b.stato === "scaduta")) ||
        ((a.scadenza || "9") < (b.scadenza || "9") ? -1 : (a.scadenza || "9") > (b.scadenza || "9") ? 1 : 0));
      const attive = l.filter((a) => a.stato !== "scaduta");
      const coperte = new Set(attive.map((a) => a.immobile).filter(Boolean));
      return { elenco: l, premi_annui: r2(attive.filter((a) => a.contraente === "proprietario").reduce((t, a) => t + (a.premio || 0), 0)),
        attive: attive.length, in_scadenza: l.filter((a) => a.stato === "in_scadenza").length,
        scoperte: M.immobili.filter((i) => !coperte.has(i.id)).map((i) => ({ id: i.id, nome: i.nome })) };
    },
    async assicurazione(id) { const a = perId("assicurazioni", id); return a ? { dati: { ...a }, stato: statoAssic(a),
      allegati: M.allegati.filter((x) => x.assicurazione === id).map((x) => ({ id: x.id, nome: x.nome, tipo: x.tipo, byte: x.byte, aggiunto_il: x.aggiunto_il })) } : null; },
    async salva_assicurazione(x) {
      if (!testo(x.compagnia)) return { ok: false, errore: "Scrivi la compagnia assicurativa." };
      if (!valida(x.decorrenza)) return { ok: false, errore: "Indica la data di decorrenza (inizio copertura)." };
      const v = x.id ? perId("assicurazioni", x.id) : null;
      const r = sostituisci("assicurazioni", pulisciAssic(x, v));
      await modificato();
      return { ok: true, id: r.id };
    },
    async elimina_assicurazione(id) {
      const tolti = M.allegati.filter((a) => a.assicurazione === id);
      M.assicurazioni = M.assicurazioni.filter((a) => a.id !== id);
      M.allegati = M.allegati.filter((a) => a.assicurazione !== id);
      await modificato();
      return { ok: true, allegati_tolti: tolti };
    },

    /* ---------- calendario e promemoria ---------- */
    async calendario(da, a) {
      if (!valida(da) || !valida(a) || a < da) return [];
      return eventi(da, a);
    },
    async salva_promemoria(x) {
      const titolo = testo(x.titolo, 200);
      if (!titolo) return { ok: false, errore: "Scrivi cosa ricordare." };
      if (!valida(x.data)) return { ok: false, errore: "Indica la data." };
      const v = x.id ? perId("promemoria", x.id) : null;
      sostituisci("promemoria", { id: v ? v.id : nuovoId(), data: x.data, titolo, immobile: perId("immobili", x.immobile) ? x.immobile : null,
        ripeti: ["mese", "anno"].includes(x.ripeti) ? x.ripeti : "no", fatti: v ? (v.fatti || []).filter((d) => d >= x.data) : [], note: testo(x.note, 1000) });
      await modificato();
      return { ok: true };
    },
    async promemoria_dati(id) { const p = perId("promemoria", id); return p ? { ...p, fatti: (p.fatti || []).slice() } : null; },
    async elimina_promemoria(id) { M.promemoria = M.promemoria.filter((p) => p.id !== id); await modificato(); return { ok: true }; },
    async promemoria_fatto(id, data, fatto) {
      const p = perId("promemoria", id);
      if (!p || !valida(data)) return { ok: false, errore: "Promemoria non trovato." };
      const s = new Set(p.fatti || []);
      if (fatto) s.add(data); else s.delete(data);
      p.fatti = [...s].sort();
      await modificato();
      return { ok: true };
    },

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

    /* voci: da FinAffitti.analizzaFoglio; opz: {incassi_dal "AAAA-MM", amm_inquilino}. Una sola scrittura alla fine. */
    async importa_case(voci, opz = {}) {
      const o = { incassi_dal: /^\d{4}-(0[1-9]|1[0-2])$/.test(opz.incassi_dal || "") ? opz.incassi_dal : meseDi(oggi()), amm_inquilino: opz.amm_inquilino !== false };
      const n = { case_nuove: 0, case_agg: 0, inquilini: 0, inquilini_agg: 0, contratti: 0, contratti_agg: 0, polizze: 0, polizze_agg: 0, tipi: 0, avvisi: [] };
      for (const v of Array.isArray(voci) ? voci : []) {
        try { importaVoce(v, o, n); } catch (e) { n.avvisi.push(`Riga ${v.riga}: ${e.message || e}`); }
      }
      await modificato();
      return { ok: true, ...n };
    },

    async salva_immobile(x) {
      const nome = testo(x.nome, 120);
      if (!nome) return { ok: false, errore: "Scrivi un nome per la casa (es. Via Roma 12, int. 3)." };
      const v = x.id ? perId("immobili", x.id) : null;
      const r = sostituisci("immobili", { ...(v || {}), ...pulisciImmobile(x, v), id: v ? v.id : nuovoId(), nome });
      await modificato();
      return { ok: true, id: r.id };
    },

    async elimina_immobile(id) {
      if (M.contratti.some((c) => c.immobile === id)) return { ok: false, errore: "Ci sono contratti su questa casa: elimina prima quelli." };
      const tolti = M.allegati.filter((a) => a.immobile === id);
      M.immobili = M.immobili.filter((x) => x.id !== id);
      M.spese = M.spese.filter((s) => s.immobile !== id);
      M.allegati = M.allegati.filter((a) => a.immobile !== id);
      for (const a of M.assicurazioni) if (a.immobile === id) a.immobile = null;
      for (const p of M.promemoria) if (p.immobile === id) p.immobile = null;
      await modificato();
      return { ok: true, allegati_tolti: tolti };
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

    /* Contratto: x può contenere nuova_casa {nome, indirizzo}, titolare (id) o nuovo_titolare {nome, email, telefono, codice_fiscale},
       cointestatari [id] (altri intestatari già in anagrafica) e occupanti [{nome, relazione, nascita, minore}]. */
    async salva_contratto(x) {
      const v = x.id ? perId("contratti", x.id) : null;
      if (!valida(x.inizio)) return { ok: false, errore: "Indica la data di inizio del contratto." };
      if (numero(x.canone) <= 0) return { ok: false, errore: "Indica il canone mensile." };
      let titolare = x.titolare || null;
      const n = x.nuovo_titolare;
      if (n && testo(n.nome)) {
        const email = testo(n.email, 200);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, errore: `Email non valida per ${testo(n.nome)}.` };
        const cf = testo(n.codice_fiscale, 16).toUpperCase().replace(/\s/g, "");
        if (cf && !/^[A-Z0-9]{11,16}$/.test(cf)) return { ok: false, errore: "Il codice fiscale del titolare non sembra valido." };
        titolare = null;
        if (x.nuova_casa && !testo(x.nuova_casa.nome)) return { ok: false, errore: "Scegli la casa (o scrivine una nuova)." };
        if (!x.nuova_casa && !perId("immobili", x.immobile)) return { ok: false, errore: "Scegli la casa (o scrivine una nuova)." };
        titolare = sostituisci("inquilini", { id: nuovoId(), nome: testo(n.nome, 120), codice_fiscale: cf, email, telefono: testo(n.telefono, 40), riconoscimento: "", note: "" }).id;
      }
      if (!perId("inquilini", titolare)) return { ok: false, errore: "Indica il titolare del contratto." };
      if (x.nuova_casa && testo(x.nuova_casa.nome)) {
        const r = sostituisci("immobili", { id: nuovoId(), nome: testo(x.nuova_casa.nome, 120), indirizzo: testo(x.nuova_casa.indirizzo, 300), tipologia: "appartamento", note: "" });
        x.immobile = r.id;
      }
      if (!perId("immobili", x.immobile)) return { ok: false, errore: "Scegli la casa (o scrivine una nuova)." };
      const altri = Array.isArray(x.cointestatari) ? x.cointestatari : v ? (v.inquilini || []).slice(1) : [];
      x.inquilini = [titolare, ...altri.filter((i) => i !== titolare && perId("inquilini", i))];
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
        const dentro = (mese) => mese >= primoMeseDovuto(c) && (!c.chiuso_il || mese <= meseDi(c.chiuso_il));
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
      const ins = insoluti(rif);
      const ritardi = ins.filter((r) => r.arretrati > 0).length;
      const urgenti = scadenzeInArrivo(30, rif).filter((s) => s.tipo === "scaduto" || s.tipo === "disdetta" || s.tipo === "scadenza").length;
      const assic = M.assicurazioni.map((a) => statoAssic(a, rif)).filter((a) => a.stato === "in_scadenza").length;
      const prom = eventi(piuGiorni(rif, -60), rif, rif).filter((e) => e.tipo === "promemoria" && e.stato === "scaduto").length;
      const prossimi7 = eventi(rif, piuGiorni(rif, 7), rif).filter((e) => e.stato === "futuro" && e.tipo !== "rata" && e.tipo !== "premio").length;
      return { ritardi, insoluti: ins.length, insoluto_totale: r2(ins.reduce((t, r) => t + r.totale_dovuto, 0)),
        proposte: proposte().length, scadenze: urgenti, assicurazioni: assic, calendario: prom + prossimi7 };
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
    /* dest: id del contratto, oppure {contratto} | {immobile} | {assicurazione} */
    async allegato_registra(dest, meta) {
      const d = typeof dest === "string" ? { contratto: dest } : dest || {};
      const rif = d.contratto && perId("contratti", d.contratto) ? { contratto: d.contratto }
        : d.immobile && perId("immobili", d.immobile) ? { contratto: null, immobile: d.immobile }
        : d.assicurazione && perId("assicurazioni", d.assicurazione) ? { contratto: null, assicurazione: d.assicurazione } : null;
      if (!rif) return { ok: false };
      M.allegati.push({ id: meta.id, ...rif, nome: testo(meta.nome, 200), tipo: testo(meta.tipo, 100),
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
dati catastali: {{catasto}}.

1. DURATA
Il contratto ha durata di {{durata_mesi}} mesi, dal {{inizio}} al {{fine}}.
Alla scadenza si rinnova per {{rinnovo_mesi}} mesi salvo disdetta da inviare con lettera raccomandata o PEC
almeno {{preavviso_mesi}} mesi prima della scadenza, nei casi e con le modalità previste dalla legge.

2. CANONE
Il canone annuo è di euro {{canone_annuo}}, da pagare in rate mensili anticipate di euro {{canone}}
entro il giorno {{giorno_pagamento}} di ogni mese, tramite bonifico bancario sul conto indicato dal locatore.
Regime fiscale scelto dal locatore: {{regime}}.

3. ONERI ACCESSORI
Oltre al canone il conduttore versa un acconto mensile di euro {{spese_mensili}} per gli oneri accessori
(spese condominiali, pulizia scale, ecc.) e una quota mensile di euro {{quota_amministrazione}} per le spese di
amministrazione, per un totale mensile di euro {{totale_mensile}}, salvo conguaglio annuale sulla base del
rendiconto dell'amministratore.

4. DEPOSITO CAUZIONALE
Il conduttore versa al locatore un deposito cauzionale di euro {{deposito}}, non imputabile in conto canoni,
che sarà restituito al termine della locazione previa verifica dello stato dell'immobile.

5. USO E MANUTENZIONE
L'immobile è destinato esclusivamente ad abitazione del conduttore e delle persone con lui conviventi:
{{occupanti}}. È vietata la sublocazione, anche parziale.
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

/* ---------------------------------------------------------------------------
   Import da Excel: riconosce le colonne dalle intestazioni e prepara una voce per riga
   (casa, inquilino, contratto, polizza). Non scrive nulla: lo fa importa_case dopo l'anteprima.
   --------------------------------------------------------------------------- */
const CAMPI_IMPORT = {
  superficie: "Superficie (m²)", indirizzo: "Indirizzo (via)", civico: "Civico", interno: "Interno", cap: "CAP",
  tipologia: "Tipologia della casa", vani: "Vani", piano: "Piano", amministratore: "Amministratore", amministratore_tel: "Telefono amministratore",
  inq_nome: "Inquilino (titolare)", inq_tel: "Telefono inquilino", inq_email: "Email inquilino", n_persone: "Persone in casa", n_minori: "Minorenni",
  tipo: "Tipo di contratto", scadenza: "Scadenza del contratto", canone: "Affitto mensile", costo_amm: "Costo amministrazione",
  note: "Note sul contratto", assic_info: "Assicurazione (descrizione)", assic_compagnia: "Compagnia assicurativa", assic_numero: "Numero di polizza",
  assic_scadenza: "Scadenza della polizza", assic_premio: "Costo della polizza", lavori: "Lavori in corso",
};
// in ordine: la prima regola che corrisponde vince (le più specifiche prima)
const REGOLE_COLONNE = [
  ["assic_info", (h) => /ASSICURAZIONE SULLA CASA|CON CHI/.test(h)],
  ["assic_compagnia", (h) => /AZIENDA|COMPAGNIA/.test(h)],
  ["assic_scadenza", (h) => /SCADENZA/.test(h) && /POLIZZA|ASSICURAZ/.test(h)],
  ["assic_premio", (h) => /(COSTO|PREMIO|IMPORTO)/.test(h) && /POLIZZA|ASSICURAZ/.test(h)],
  ["assic_numero", (h) => /POLIZZA/.test(h)],
  ["amministratore_tel", (h) => /AMMINISTRATORE/.test(h) && /CELL|TEL/.test(h)],
  ["costo_amm", (h) => /AMMINISTRAZIONE|CONDOMINI/.test(h)],
  ["amministratore", (h) => /AMMINISTRATORE/.test(h)],
  ["inq_tel", (h) => /(INQUILINO|LOCATARIO)/.test(h) && /CELL|TEL/.test(h)],
  ["inq_email", (h) => /MAIL/.test(h)],
  ["n_minori", (h) => /MINOR/.test(h)],
  ["n_persone", (h) => /OCCUPANTI|PERSONE/.test(h)],
  ["tipo", (h) => /CONTRATTO/.test(h) && /TIPO/.test(h)],
  ["scadenza", (h) => /SCADENZA/.test(h)],
  ["canone", (h) => /AFFITTO|CANONE|PIGIONE/.test(h)],
  ["note", (h) => /^NOTE/.test(h)],
  ["inq_nome", (h) => /INQUILINO|LOCATARIO|CONDUTTORE/.test(h)],
  ["tipologia", (h) => /TIPOLOGIA|TIPO DI IMMOBILE/.test(h)],
  ["superficie", (h) => /METRI|^MQ$|SUPERFICIE/.test(h)],
  ["civico", (h) => /CIVICO/.test(h)],
  ["interno", (h) => /^INT(ERNO)?$/.test(h)],
  ["cap", (h) => /^CAP$/.test(h)],
  ["indirizzo", (h) => /INDIRIZZO|^VIA$/.test(h)],
  ["vani", (h) => /VANI|LOCALI/.test(h)],
  ["piano", (h) => /PIANO/.test(h)],
  ["lavori", (h) => /LAVORI/.test(h)],
];
function campoColonna(intestazione) {
  const h = normParole(intestazione);
  if (!h) return null;
  const r = REGOLE_COLONNE.find(([, f]) => f(h));
  return r ? r[0] : null;
}

const vuoto = (v) => v === null || v === undefined || String(v).trim() === "";
const NO = /^(NO|N|NESSUN[AO]?|NESSUNO|NON|ASSENTE|ASSENTI|X|0)$/;
function cella(v) {
  if (vuoto(v)) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v).replace(".", ",");
  return String(v).replace(/\s+/g, " ").trim().replace(/^[-–—/]+$/, "");
}
function soldi(v) {
  if (typeof v === "number") return Math.abs(r2(v));
  const m = String(v ?? "").match(/-?\d[\d.,]*/);
  if (!m) return 0;
  const n = G.FinCore ? G.FinCore.parseImporto(m[0].replace(/[.,]$/, "")) : parseFloat(m[0].replace(",", "."));
  return Number.isFinite(n) ? Math.abs(r2(n)) : 0;
}
function contaPersone(v) {
  if (typeof v === "number") return Math.max(0, Math.min(30, Math.round(v)));
  const t = normParole(v);
  if (!t) return null;
  if (NO.test(t)) return 0;
  const m = t.match(/\d+/);
  if (m) return Math.min(30, +m[0]);
  if (/^(SI|SÌ|S)\b/.test(t)) return 1;
  return null;
}
function dataCella(v) {
  if (vuoto(v)) return null;
  const d = G.FinCore ? G.FinCore.parseData(typeof v === "string" ? v.trim() : v) : null;
  return d && valida(d) ? d : null;
}
function tipologiaDa(t) {
  const x = normParole(t);
  if (!x) return null;
  if (/STANZA|CAMERA|POSTO LETTO/.test(x)) return "stanza";
  if (/BOX|GARAGE|AUTORIMESSA|POSTO AUTO|CANTINA/.test(x)) return "box";
  if (/NEGOZIO|UFFICIO|LABORATORIO|MAGAZZINO|COMMERCIAL|CAPANNONE/.test(x)) return "negozio";
  if (/VILLA|INDIPENDENTE|CASA|SCHIERA|RUSTICO/.test(x)) return "casa";
  if (/APPARTAMENTO|ALLOGGIO|LOCALE|MONO|BILO|TRILO|QUADRI|ATTICO|MANSARDA|LOFT/.test(x)) return "appartamento";
  return "altro";
}

function analizzaFoglio(righe) {
  const R = (Array.isArray(righe) ? righe : []).map((r) => (Array.isArray(r) ? r : []));
  // riga delle intestazioni: la prima (fra le prime 20) con almeno 4 colonne riconosciute
  let testa = -1, best = 0;
  for (let i = 0; i < Math.min(R.length, 20); i++) {
    const n = R[i].filter((c) => campoColonna(cella(c))).length;
    if (n >= 4 && n > best) { testa = i; best = n; break; }
  }
  if (testa < 0) return { ok: false, errore: "Non trovo la riga delle intestazioni (Indirizzo, Inquilino, Affitto…). Controlla che sia nel primo foglio." };
  const usati = new Set();
  const colonne = R[testa].map((h, j) => {
    const titolo = cella(h);
    let campo = campoColonna(titolo);
    if (campo && usati.has(campo)) campo = null;     // la stessa informazione in due colonne: uso la prima
    if (campo) usati.add(campo);
    return { j, titolo, campo, nome_campo: campo ? CAMPI_IMPORT[campo] : "" };
  }).filter((c) => c.titolo);
  const col = Object.fromEntries(colonne.filter((c) => c.campo).map((c) => [c.campo, c.j]));
  const v = (r, k) => (col[k] === undefined ? null : r[col[k]]);
  const t = (r, k) => cella(v(r, k));

  const voci = [], scartate = [];
  for (let i = testa + 1; i < R.length; i++) {
    const r = R[i];
    if (!r.some((c) => !vuoto(c))) continue;
    const ind = t(r, "indirizzo"), inq = t(r, "inq_nome");
    if (!ind && !inq) { scartate.push(i + 1); continue; }
    const civico = t(r, "civico"), interno = t(r, "interno");
    let cap = t(r, "cap");
    if (/^\d{1,4}$/.test(cap)) cap = cap.padStart(5, "0");             // Excel toglie gli zeri iniziali (00185)
    const nome = [ind || `Casa riga ${i + 1}`, civico].filter(Boolean).join(" ") + (interno ? `, int. ${interno}` : "");
    const lavori = t(r, "lavori");
    const nInq = NO.test(normParole(inq)) ? "" : inq;
    const info = t(r, "assic_info"), compagnia = t(r, "assic_compagnia"), numero = t(r, "assic_numero");
    const premio = soldi(v(r, "assic_premio")), scadPol = dataCella(v(r, "assic_scadenza"));
    const infoUtile = info && !NO.test(normParole(info)) && !/^(SI|SÌ|S)$/.test(normParole(info));
    const haPolizza = Boolean(compagnia || numero || premio || scadPol || infoUtile);
    const tipoRaw = t(r, "tipologia");
    voci.push({
      riga: i + 1,
      casa: { nome, indirizzo: ind, civico, interno, cap, tipologia: tipologiaDa(tipoRaw), superficie: soldi(v(r, "superficie")) || null,
        vani: soldi(v(r, "vani")) || null, piano: t(r, "piano"), amministratore: t(r, "amministratore"), amministratore_tel: t(r, "amministratore_tel"),
        lavori: lavori && !NO.test(normParole(lavori)) ? lavori : "",
        note: tipologiaDa(tipoRaw) === "altro" ? `Tipologia nel file: ${tipoRaw}` : "" },
      inquilino: nInq ? { nome: nInq, telefono: t(r, "inq_tel"), email: t(r, "inq_email").replace(/^mailto:/i, "") } : null,
      contratto: { tipo: t(r, "tipo"), scadenza: dataCella(v(r, "scadenza")), scadenza_testo: t(r, "scadenza"), canone: soldi(v(r, "canone")),
        costo_amm: soldi(v(r, "costo_amm")), n_persone: contaPersone(v(r, "n_persone")), n_minori: contaPersone(v(r, "n_minori")), note: NO.test(normParole(t(r, "note"))) ? "" : t(r, "note") },
      polizza: haPolizza ? { info: infoUtile ? info : "", compagnia: compagnia || (infoUtile && !numero ? info.replace(/^(si|sì)\b[\s,:-]*/i, "").replace(/^con\s+/i, "") : ""), numero,
        scadenza: scadPol, premio } : null,
    });
  }
  return { ok: true, riga_intestazioni: testa + 1, colonne, voci, scartate,
    non_usate: colonne.filter((c) => !c.campo).map((c) => c.titolo),
    mancanti: ["indirizzo", "inq_nome", "canone"].filter((k) => col[k] === undefined).map((k) => CAMPI_IMPORT[k]) };
}

G.FinAffitti = { analizzaFoglio, CAMPI_IMPORT, creaAffitti, migra, LISTE, TIPI, TIPI_SPESA, TIPI_ASSIC, CONTRAENTI, REGIMI, RELAZIONI, TIPOLOGIE, CAT_AFFITTI, MODELLO_BASE, durataTesto };
})(globalThis);
