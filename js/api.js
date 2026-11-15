/* Finanze personali – API in memoria (porting di app.pyw, classe Api).
   Stesse firme e stessi risultati; i dati stanno nel "modello" e dopo ogni
   modifica viene chiamato salva() che li cifra e li memorizza. */
(function (G) {
"use strict";
const C = G.FinCore;
const NON_CAT = "(da categorizzare)";
const oggi = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const oraIso = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${oggi()}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const vuota = (c) => c === null || c === undefined;

const CONTO_BNL = () => ({ id: C.CONTO_BASE, nome: "Conto BNL", tipo: "conto", numero: null });
const VERSIONE_MODELLO = 3;

/* Modello vuoto: come un database nuovo (con le regole di base). */
function modelloVuoto() {
  return {
    formato: "finanze-dati", versione: VERSIONE_MODELLO, rev: 0, conti: [CONTO_BNL()],
    movimenti: [], regole: C.REGOLE_BASE.map(([p, c], i) => ({ id: i + 1, parola: p, categoria: c })),
    impostazioni: {},
    immobili: [], inquilini: [], contratti: [], pagamenti: [], spese: [], allegati: [], scarti: [],
  };
}

/* Dal JSON di strumenti/esporta_per_web.py (i movimenti senza conto sono del Conto BNL). */
function modelloDaExport(x) {
  if (!x || x.formato !== "finanze-export" || !Array.isArray(x.movimenti) || !Array.isArray(x.regole)) {
    throw new Error("Questo file non è un export dell'app desktop (esporta_per_web.py).");
  }
  const conti = [CONTO_BNL()];
  const idConto = (c) => {
    if (vuota(c) || c === "" || c === "Conto BNL" || c === C.CONTO_BASE) return C.CONTO_BASE;
    const s = String(c);
    if (!conti.some((k) => k.id === s)) conti.push({ id: s, nome: s, tipo: "conto", numero: null });
    return s;
  };
  const movimenti = x.movimenti.map((m) => ({
    id: +m.id, data: String(m.data), descrizione: String(m.descrizione), importo: +m.importo,
    categoria: vuota(m.categoria) ? null : String(m.categoria), impronta: String(m.impronta),
    importato_il: String(m.importato_il || ""), conto: idConto(m.conto), collegato: null,
  })).sort((a, b) => a.id - b.id);
  const regole = x.regole.map((r) => ({ id: +r.id, parola: String(r.parola), categoria: String(r.categoria) }))
    .sort((a, b) => a.id - b.id);
  const M = { formato: "finanze-dati", versione: 1, rev: 0, conti, movimenti, regole, impostazioni: Object.assign({}, x.impostazioni || {}) };
  migraModello(M);
  return M;
}

/* Aggiorna un modello vecchio (versione 1, senza conti). Restituisce true se è cambiato. */
function migraModello(M) {
  let cambiato = false;
  if (!Array.isArray(M.conti) || !M.conti.length) { M.conti = [CONTO_BNL()]; cambiato = true; }
  for (const m of M.movimenti) {
    if (!m.conto) { m.conto = C.CONTO_BASE; cambiato = true; }
    if (m.collegato === undefined) m.collegato = null;
  }
  if ((M.versione || 1) < 2) {
    // Ricariche ed estinzioni delle carte prepagate sul conto: senza l'estratto della carta non si sa
    // cosa è stato comprato, quindi vanno in "Prepagata (non dettagliata)" e restano tra le uscite.
    // Quando si importa l'estratto della carta, le ricariche abbinate diventano "Giroconto".
    for (const m of M.movimenti) {
      if (m.conto === C.CONTO_BASE && !m.collegato && C.rigaCartaSulConto(m.descrizione)) m.categoria = C.PREPAGATA_ND;
    }
    M.versione = 2; cambiato = true;
  }
  if (G.FinAffitti && G.FinAffitti.migra(M)) cambiato = true;          // versione 3: affitti e contratti
  if ((M.versione || 1) < 3) { M.versione = 3; cambiato = true; }
  return cambiato;
}

function creaApi(M, salva) {
  const prossimo = (lista) => lista.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  const perData = (a, b) => C.cmp(b.data, a.data) || (b.id - a.id);         // ORDER BY data DESC, id DESC

  const nomeConto = (id) => { const c = M.conti.find((k) => k.id === id); return c ? c.nome : id; };
  const delConto = (conto) => (m) => !conto || m.conto === conto;
  const giro = (m) => m.categoria === C.GIROCONTO;

  function categorie() {
    const s = new Set([...C.CATEGORIE_BASE, C.GIROCONTO]);
    for (const r of M.regole) s.add(r.categoria);
    for (const m of M.movimenti) if (!vuota(m.categoria)) s.add(m.categoria);
    return [...s].sort(C.cmp);
  }

  /* INSERT OR REPLACE INTO regole: la riga con la stessa parola viene sostituita (nuovo id). */
  function scriviRegola(parola, categoria) {
    const i = M.regole.findIndex((r) => r.parola === parola);
    if (i >= 0) M.regole.splice(i, 1);
    M.regole.push({ id: prossimo(M.regole), parola, categoria });
  }

  function riapplicaRegole(soloVuoti = true) {
    const regole = C.caricaRegole(M.regole);
    let n = 0;
    for (const m of M.movimenti) {
      if (soloVuoti && !vuota(m.categoria)) continue;
      const cat = C.categorizza(m.descrizione, regole);
      if (cat) { m.categoria = cat; n++; }
    }
    return n;
  }

  function like(cerca) {                          // LIKE '%cerca%' di SQLite (maiuscole indifferenti)
    const re = cerca.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
    return new RegExp(re, "is");
  }

  async function modificato() { M.rev = (M.rev || 0) + 1; await salva(); }

  /* ---- riepilogo: funzioni interne ---- */
  function minMax() {
    let lo = null, hi = null;
    for (const m of M.movimenti) { if (lo === null || m.data < lo) lo = m.data; if (hi === null || m.data > hi) hi = m.data; }
    return [lo, hi];
  }

  function intervallo(da, a) {
    const [lo, hi] = minMax();
    if (da && a) return [da, hi && hi >= da ? (a < hi ? a : hi) : a];   // periodo in corso: fino all'ultimo movimento
    return [lo || oggi(), hi || oggi()];
  }

  /* Senza categoria i giroconti sono esclusi: spostano soldi tra i propri conti, non sono né entrate né uscite. */
  function righe(da, a, categoria, conto) {
    return M.movimenti.filter((m) => m.data >= da && m.data <= a && (!conto || m.conto === conto) &&
      (categoria === NON_CAT ? vuota(m.categoria) : categoria ? m.categoria === categoria : !giro(m))).sort(perData);
  }

  const somma = (rr, f) => rr.reduce((s, r) => (f(r.importo) ? s + r.importo : s), 0);

  function confronti(da, a, fino, categoria, conto) {
    const out = {};
    const primo = minMax()[0] || "";
    const giorni = C.diffGiorni(fino, da);
    for (const tipo of ["prec", "anno"]) {
      let [s, e] = C.periodoConfronto(da, a, tipo);
      if (fino < a) { const lim = C.piuGiorni(s, giorni); if (lim < e) e = lim; }
      const ok = primo.slice(0, 7) <= s.slice(0, 7);          // i dati coprono tutto il periodo?
      const rr = ok ? righe(s, e, categoria, conto) : [];
      const perCat = new Map();
      for (const r of rr) if (r.importo < 0) { const k = r.categoria || NON_CAT; perCat.set(k, (perCat.get(k) || 0) + r.importo); }
      const cats = {};
      for (const [k, v] of perCat) cats[k] = C.round2(v);
      out[tipo] = {
        da: s, a: e, n: rr.length, ok: Boolean(primo) && ok,
        entrate: C.round2(somma(rr, (v) => v > 0)), uscite: C.round2(somma(rr, (v) => v < 0)), categorie: cats,
      };
    }
    return out;
  }

  function serieVuota(colonne) { return colonne.map((k) => ({ periodo: k, entrate: 0.0, uscite: 0.0 })); }

  const api = {
    NON_CAT,

    async stato() {
      const mesi = [...new Set(M.movimenti.map((m) => m.data.slice(0, 7)))].sort().reverse();
      return {
        mesi, categorie: categorie(), archivio: "locale",
        da_categorizzare: M.movimenti.filter((m) => vuota(m.categoria)).length,
        n_movimenti: M.movimenti.length,
        conti: M.conti.map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo, n: M.movimenti.filter((m) => m.conto === c.id).length })),
      };
    },

    /* I giroconti sono elencati ma non contano in entrate/uscite. */
    async movimenti(mese = "", categoria = "", cerca = "", conto = "") {
      const re = cerca ? like(cerca) : null;
      const sel = M.movimenti.filter((m) =>
        (!mese || m.data.slice(0, 7) === mese) && delConto(conto)(m) &&
        (categoria === NON_CAT ? vuota(m.categoria) : categoria ? m.categoria === categoria : true) &&
        (!re || re.test(m.descrizione))).sort(perData);
      const sugg = C.calcolaSuggerimenti(M.movimenti);
      const perId = new Map(M.movimenti.map((m) => [m.id, m]));
      let entrate = 0.0, uscite = 0.0, giroconti = 0;
      const out = sel.map((m) => {
        if (giro(m)) giroconti++;
        else if (m.importo >= 0) entrate += m.importo; else uscite += m.importo;
        const altro = m.collegato ? perId.get(m.collegato) : null;
        return { id: m.id, data: m.data, descrizione: m.descrizione, importo: m.importo, categoria: m.categoria,
          suggerita: vuota(m.categoria) ? (sugg.get(m.id) || null) : null,
          conto: m.conto, conto_nome: nomeConto(m.conto),
          abbinato: altro ? { conto_nome: nomeConto(altro.conto), data: altro.data, descrizione: altro.descrizione } : null };
      });
      return { righe: out, entrate: C.round2(entrate), uscite: C.round2(uscite), giroconti,
        da_categorizzare: out.filter((r) => vuota(r.categoria)).length,
        suggerimenti: out.filter((r) => r.suggerita).length };
    },

    async imposta_categoria(mid, categoria, parola = "") {
      categoria = (categoria || "").trim();
      if (!categoria) return { ok: false };
      const m = M.movimenti.find((x) => x.id === +mid);
      if (m) m.categoria = categoria;
      let altri = 0;
      parola = (parola || "").trim().toUpperCase();
      if (parola) { scriviRegola(parola, categoria); altri = riapplicaRegole(true); }
      await modificato();
      return { ok: true, altri };
    },

    async accetta_suggerimenti(ids = null) {
      let sugg = C.calcolaSuggerimenti(M.movimenti);
      if (ids && ids.length) { const v = new Set(ids.map(Number)); sugg = new Map([...sugg].filter(([k]) => v.has(k))); }
      for (const [mid, cat] of sugg) { const m = M.movimenti.find((x) => x.id === mid); if (m) m.categoria = cat; }
      if (sugg.size) await modificato();
      return { applicati: sugg.size };
    },

    async analisi(da = "", a = "", grp = "mese", conto = "") {
      const tutto = !(da && a);
      const finePeriodo = a;
      [da, a] = intervallo(da, a);
      const rr = righe(da, a, "", conto);
      const conf = tutto ? null : confronti(da, finePeriodo, a, "", conto);
      const colonne = C.elencoPeriodi(da, a, grp);
      const pos = new Map(colonne.map((k, i) => [k, i]));
      const serie = serieVuota(colonne);
      const mat = { uscite: new Map(), entrate: new Map() };
      const nCat = new Map();
      for (const r of rr) {
        const i = pos.get(C.chiavePeriodo(r.data, grp));
        const lato = r.importo > 0 ? "entrate" : "uscite";
        const k = r.categoria || NON_CAT;
        serie[i][lato] += r.importo;
        if (!mat[lato].has(k)) mat[lato].set(k, colonne.map(() => 0.0));
        mat[lato].get(k)[i] += r.importo;
        if (r.importo < 0) nCat.set(k, (nCat.get(k) || 0) + 1);
      }
      const blocco = (d) => [...d].map(([c, vals]) => ({ categoria: c, valori: vals.map(C.round2), totale: C.round2(vals.reduce((s, v) => s + v, 0)) }))
        .map((x, i) => [x, i]).sort((p, q) => (Math.abs(q[0].totale) - Math.abs(p[0].totale)) || (p[1] - q[1])).map((p) => p[0]);
      const usciteCat = blocco(mat.uscite);
      const cats = usciteCat.map((x) => ({ categoria: x.categoria, totale: x.totale, n: nCat.get(x.categoria) || 0 }));
      for (const s of serie) { s.entrate = C.round2(s.entrate); s.uscite = C.round2(s.uscite); }
      return {
        da, a, grp, tutto,
        entrate: C.round2(somma(rr, (v) => v > 0)), uscite: C.round2(somma(rr, (v) => v < 0)),
        n: rr.length, confronti: conf, categorie: cats, serie,
        matrice: { colonne, uscite: usciteCat, entrate: blocco(mat.entrate) },
      };
    },

    async dettaglio(categoria, da = "", a = "", grp = "mese", conto = "") {
      const tutto = !(da && a);
      const finePeriodo = a;
      [da, a] = intervallo(da, a);
      const rr = righe(da, a, categoria, conto);
      const conf = tutto ? null : confronti(da, finePeriodo, a, categoria, conto);
      const sugg = categoria === NON_CAT ? C.calcolaSuggerimenti(M.movimenti) : new Map();
      const colonne = C.elencoPeriodi(da, a, grp);
      const pos = new Map(colonne.map((k, i) => [k, i]));
      const serie = serieVuota(colonne);
      const esercenti = new Map();
      const movimenti = [];
      for (const r of rr) {
        const s = serie[pos.get(C.chiavePeriodo(r.data, grp))];
        s[r.importo > 0 ? "entrate" : "uscite"] += r.importo;
        const nome = C.nomeEsercente(r.descrizione);
        if (!esercenti.has(nome)) esercenti.set(nome, { totale: 0.0, n: 0 });
        const e = esercenti.get(nome); e.totale += r.importo; e.n += 1;
        movimenti.push({ id: r.id, data: r.data, descrizione: r.descrizione, importo: r.importo, categoria: r.categoria,
          esercente: nome, suggerita: sugg.get(r.id) || null, conto: r.conto, conto_nome: nomeConto(r.conto), abbinato: null });
      }
      for (const s of serie) { s.entrate = C.round2(s.entrate); s.uscite = C.round2(s.uscite); }
      const es = [...esercenti].map(([k, v]) => ({ nome: k, totale: C.round2(v.totale), n: v.n }))
        .map((x, i) => [x, i]).sort((p, q) => (Math.abs(q[0].totale) - Math.abs(p[0].totale)) || (p[1] - q[1])).map((p) => p[0]);
      return {
        categoria, da, a, grp, tutto,
        totale: C.round2(rr.reduce((s, r) => s + r.importo, 0)),
        entrate: C.round2(somma(rr, (v) => v > 0)), uscite: C.round2(somma(rr, (v) => v < 0)),
        confronti: conf, serie, esercenti: es, movimenti,
      };
    },

    /* Situazione per conto. Entrate/uscite del periodo senza giroconti; il saldo invece li comprende
       (spostano soldi tra i conti) ed è la somma di tutti i movimenti del conto fino alla fine del periodo:
       non conoscendo il saldo iniziale, vale "dal" primo movimento importato di quel conto. */
    async situazione_conti(da = "", a = "") {
      const tutto = !(da && a);
      const out = M.conti.map((c) => {
        const mm = M.movimenti.filter((m) => m.conto === c.id);
        let entrate = 0.0, uscite = 0.0, giroconti = 0.0, n = 0, saldo = 0.0, primo = null, ultimo = null;
        for (const m of mm) {
          if (primo === null || m.data < primo) primo = m.data;
          if (ultimo === null || m.data > ultimo) ultimo = m.data;
          if (tutto || m.data <= a) saldo += m.importo;
          if (!tutto && (m.data < da || m.data > a)) continue;
          n++;
          if (giro(m)) giroconti += m.importo;
          else if (m.importo >= 0) entrate += m.importo; else uscite += m.importo;
        }
        const r2 = C.round2;
        return { id: c.id, nome: c.nome, tipo: c.tipo, numero: c.numero || null,
          entrate: r2(entrate), uscite: r2(uscite), giroconti: r2(giroconti), n,
          saldo: r2(saldo), dal: primo, ultimo, n_totale: mm.length,
          saldo_valido: Boolean(primo) && (tutto || primo <= a) };
      });
      const somma = (k) => C.round2(out.reduce((s, c) => s + c[k], 0));
      const date = out.map((c) => c.dal).filter(Boolean).sort();
      return {
        da, a, tutto, conti: out,
        totale: { entrate: somma("entrate"), uscite: somma("uscite"), giroconti: somma("giroconti"),
          n: out.reduce((s, c) => s + c.n, 0), saldo: somma("saldo"),
          dal: date[0] || null, ultimo: out.map((c) => c.ultimo).filter(Boolean).sort().pop() || null },
      };
    },

    async regole() {
      return M.regole.slice().sort((x, y) => C.cmp(x.categoria, y.categoria) || C.cmp(x.parola, y.parola))
        .map((r) => ({ id: r.id, parola: r.parola, categoria: r.categoria }));
    },

    async aggiungi_regola(parola, categoria) {
      parola = (parola || "").trim().toUpperCase(); categoria = (categoria || "").trim();
      if (!parola || !categoria) return { ok: false };
      scriviRegola(parola, categoria);
      const n = riapplicaRegole(true);
      await modificato();
      return { ok: true, applicati: n };
    },

    async elimina_regola(rid) {
      const i = M.regole.findIndex((r) => r.id === +rid);
      if (i >= 0) { M.regole.splice(i, 1); await modificato(); }
      return { ok: true };
    },

    /* ---- import: riceve i File scelti con <input type="file">.
       chiediCarta(nomeFile) -> Promise<"1234" | null>: usata solo se un estratto carta non riporta il numero. ---- */
    async importa(files, chiediCarta = null) {
      if (!files || !files.length) return { annullato: true };
      let nuovi = 0, doppi = 0, pendenti = 0, spostati = 0;
      const ok = [], errori = [], contiNuovi = [], dettagli = [];
      for (const f of files) {
        try {
          const est = C.estraiEstratto(await f.arrayBuffer(), f.name);
          let conto = C.CONTO_BASE;
          if (est.carta) {
            let numero = est.carta.numero;
            if (!numero && chiediCarta) numero = await chiediCarta(f.name);
            numero = String(numero || "").replace(/\D/g, "").slice(-4);
            if (numero.length !== 4) { errori.push(`${f.name}: estratto di una carta senza numero, non importato.`); continue; }
            conto = assicuraCarta(numero, contiNuovi);
          }
          const [n, d, sp] = await importaMovimenti(est.movimenti, conto);
          nuovi += n; doppi += d; spostati += sp; pendenti += est.pendenti; ok.push(f.name);
          dettagli.push({ file: f.name, conto: nomeConto(conto), nuovi: n, doppi: d, spostati: sp, pendenti: est.pendenti });
        } catch (e) {
          errori.push(`${f.name}: ${e && e.message ? e.message : e}`);
        }
      }
      const abb = abbinaGiroconti();
      if (nuovi || spostati || abb.length || contiNuovi.length) await modificato();
      return { nuovi, doppi, spostati, errori, file: ok, pendenti, dettagli, conti_nuovi: contiNuovi, abbinati: abb.length,
        ricariche_aperte: ricaricheAperte() };
    },

    async conti() { return M.conti.map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo })); },
  };
  if (G.FinAffitti) Object.assign(api, G.FinAffitti.creaAffitti(M, modificato));
  return api;

  function assicuraCarta(numero, contiNuovi) {
    const c = C.contoCarta(numero);
    if (!M.conti.some((k) => k.id === c.id)) { M.conti.push(c); contiNuovi.push(c.nome); }
    return c.id;
  }

  /* Abbina le ricariche fatte dal conto (uscite) con le "Ricarica" sull'estratto della carta (entrate):
     stesso importo, date al massimo a 3 giorni di distanza; prima le coppie più vicine.
     Le coppie diventano "Giroconto" (una volta sola: poi la categoria si può cambiare a mano). */
  function abbinaGiroconti() {
    const carte = new Map(M.conti.filter((c) => c.tipo === "prepagata").map((c) => [c.numero, c.id]));
    if (!carte.size) return [];
    const dalConto = [], sullaCarta = [];
    for (const m of M.movimenti) {
      if (m.collegato) continue;
      if (m.conto === C.CONTO_BASE && m.importo < 0) {
        const r = C.rigaCartaSulConto(m.descrizione);
        if (r && r.ricarica && carte.has(r.numero)) dalConto.push([m, carte.get(r.numero)]);
      } else if (m.conto !== C.CONTO_BASE && C.eRicaricaCarta(m.descrizione, m.importo)) sullaCarta.push(m);
    }
    const coppie = [];
    for (const [b, idCarta] of dalConto) {
      for (const c of sullaCarta) {
        if (c.conto !== idCarta || C.round2(-b.importo) !== C.round2(c.importo)) continue;
        const dist = Math.abs(C.diffGiorni(c.data, b.data));
        if (dist <= 3) coppie.push([dist, b, c]);
      }
    }
    coppie.sort((p, q) => p[0] - q[0] || C.cmp(p[1].data, q[1].data) || p[1].id - q[1].id || p[2].id - q[2].id);
    const fatte = [];
    for (const [, b, c] of coppie) {
      if (b.collegato || c.collegato) continue;
      b.collegato = c.id; c.collegato = b.id;
      b.categoria = C.GIROCONTO; c.categoria = C.GIROCONTO;
      fatte.push([b.id, c.id]);
    }
    return fatte;
  }

  /* Ricariche verso carte con estratto importato ma senza abbinamento (restano tra le uscite). */
  function ricaricheAperte() {
    const carte = new Set(M.conti.filter((c) => c.tipo === "prepagata").map((c) => c.numero));
    return M.movimenti.filter((m) => {
      if (m.collegato || m.conto !== C.CONTO_BASE || m.importo >= 0) return false;
      const r = C.rigaCartaSulConto(m.descrizione);
      return r && r.ricarica && carte.has(r.numero);
    }).length;
  }

  /* core.importa_movimenti: inserisce evitando i doppioni (reimportare lo stesso file è innocuo). */
  async function importaMovimenti(movimenti, conto = C.CONTO_BASE) {
    const regole = C.caricaRegole(M.regole);
    const ora = oraIso();
    const esistenti = new Set(M.movimenti.map((m) => m.impronta));
    // movimenti della carta importati nel Conto BNL dall'app desktop (con la data contabile)
    const delContoPerImpronta = conto === C.CONTO_BASE ? null
      : new Map(M.movimenti.filter((m) => m.conto === C.CONTO_BASE).map((m) => [m.impronta, m]));
    const visti = new Map(), vistiCont = new Map();
    const chiaveDi = (d, desc, imp) => `${d}\u0000${desc}\u0000${imp === 0 ? 0 : imp}`;   // come la tupla Python (0.0 == -0.0)
    let nuovi = 0, doppi = 0, spostati = 0, id = prossimo(M.movimenti);
    for (const [d, desc, imp, dCont] of movimenti) {
      const chiave = chiaveDi(d, desc, imp);
      visti.set(chiave, (visti.get(chiave) || 0) + 1);            // movimenti identici nello stesso giorno
      const impr = await C.impronta(d, desc, imp, visti.get(chiave), conto);
      const kc = dCont ? chiaveDi(dCont, desc, imp) : null;
      if (kc) vistiCont.set(kc, (vistiCont.get(kc) || 0) + 1);   // contatore come lo calcolava l'app desktop
      if (esistenti.has(impr)) { doppi++; continue; }
      if (delContoPerImpronta && kc) {
        const vecchio = delContoPerImpronta.get(await C.impronta(dCont, desc, imp, vistiCont.get(kc), C.CONTO_BASE));
        if (vecchio) {
          // stesso movimento già presente nel conto: lo sposta sulla carta (con la data dell'acquisto)
          delContoPerImpronta.delete(vecchio.impronta);
          vecchio.conto = conto; vecchio.data = d; vecchio.impronta = impr;
          if (C.eRicaricaCarta(desc, imp)) vecchio.categoria = C.GIROCONTO;
          else if (vuota(vecchio.categoria)) vecchio.categoria = C.categorizza(desc, regole);
          esistenti.add(impr); spostati++;
          continue;
        }
      }
      esistenti.add(impr);
      let categoria;
      if (conto === C.CONTO_BASE && C.rigaCartaSulConto(desc)) categoria = C.PREPAGATA_ND;   // finché non c'è l'estratto della carta
      else if (conto !== C.CONTO_BASE && C.eRicaricaCarta(desc, imp)) categoria = C.GIROCONTO;
      else categoria = C.categorizza(desc, regole);
      M.movimenti.push({ id: id++, data: d, descrizione: desc, importo: imp, categoria, impronta: impr, importato_il: ora, conto, collegato: null });
      nuovi++;
    }
    return [nuovi, doppi, spostati];
  }
}

G.FinApi = { creaApi, modelloVuoto, modelloDaExport, migraModello, NON_CAT, GIROCONTO: C.GIROCONTO };
})(globalThis);
