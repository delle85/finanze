/* Finanze personali – unione di due versioni dei dati (quando due dispositivi modificano insieme).

   Unione "a tre vie": base = ultima versione comune, nostro = questo dispositivo, loro = OneDrive.
   - movimenti: identificati dall'impronta (non dall'id, che può differire tra dispositivi);
     campo per campo: vince chi ha cambiato rispetto alla base; se hanno cambiato entrambi, vince "preferisci".
   - regole: identificate dalla parola; conti: dall'id; impostazioni: dalla chiave.
   - un elemento tolto da una parte e non modificato dall'altra resta tolto.
   Nessun dato viene sovrascritto alla cieca. */
(function (G) {
"use strict";

const uguali = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/* Unione di una singola voce (oggetti con gli stessi campi). */
function unisciVoce(b, o, t, campi, vinceNostro) {
  if (!o && !t) return null;
  if (o && !t) return b && uguali(o, b) ? null : o;      // loro l'hanno tolta: resta tolta se noi non l'abbiamo cambiata
  if (t && !o) return b && uguali(t, b) ? null : t;
  const r = {};
  for (const f of campi) {
    if (b && uguali(o[f], b[f])) r[f] = t[f];
    else if (b && uguali(t[f], b[f])) r[f] = o[f];
    else if (!b && (t[f] === null || t[f] === undefined)) r[f] = o[f];     // senza base: un valore vince sul vuoto
    else if (!b && (o[f] === null || o[f] === undefined)) r[f] = t[f];
    else r[f] = vinceNostro ? o[f] : t[f];
  }
  return r;
}

function unisciMappe(mb, mo, mt, campi, vinceNostro) {
  const chiavi = new Set([...mo.keys(), ...mt.keys()]);
  const out = new Map();
  for (const k of chiavi) {
    const v = unisciVoce(mb.get(k), mo.get(k), mt.get(k), campi, vinceNostro);
    if (v) out.set(k, v);
  }
  return out;
}

/* Movimenti: "collegato" è un id, lo traduco nell'impronta del movimento collegato prima di unire. */
function mappaMovimenti(M) {
  const perId = new Map((M ? M.movimenti : []).map((m) => [m.id, m.impronta]));
  return new Map((M ? M.movimenti : []).map((m) => [m.impronta, {
    data: m.data, descrizione: m.descrizione, importo: m.importo, categoria: m.categoria ?? null,
    conto: m.conto || "bnl", collegatoImp: m.collegato ? (perId.get(m.collegato) || null) : null,
    importato_il: m.importato_il || "", _id: m.id,
  }]));
}

const CAMPI_MOV = ["data", "descrizione", "importo", "categoria", "conto", "collegatoImp", "importato_il"];

/* base può essere null (nessuna versione comune: unione di due archivi indipendenti).
   preferisci: "nostro" | "loro" in caso di modifica dello stesso campo da entrambe le parti. */
function unisci(base, nostro, loro, preferisci = "nostro") {
  const vn = preferisci === "nostro";

  // --- movimenti ---
  const mb = mappaMovimenti(base), mo = mappaMovimenti(nostro), mt = mappaMovimenti(loro);
  const mov = unisciMappe(mb, mo, mt, CAMPI_MOV, vn);
  // id: si tengono quelli di OneDrive, poi i nostri se liberi, altrimenti nuovi
  const usati = new Set(), finale = new Map();
  let prossimo = 1;
  for (const M of [nostro, loro, base]) if (M) for (const m of M.movimenti) prossimo = Math.max(prossimo, m.id + 1);
  const ordine = [...mov.keys()].sort((a, b) => (mt.has(b) - mt.has(a)));
  for (const k of ordine) {
    const preferito = mt.has(k) ? mt.get(k)._id : mo.get(k)._id;
    const id = usati.has(preferito) ? prossimo++ : preferito;
    usati.add(id); finale.set(k, id);
  }
  const movimenti = [...mov].map(([imp, v]) => ({
    id: finale.get(imp), data: v.data, descrizione: v.descrizione, importo: v.importo, categoria: v.categoria,
    impronta: imp, importato_il: v.importato_il, conto: v.conto,
    collegato: v.collegatoImp && finale.has(v.collegatoImp) ? finale.get(v.collegatoImp) : null,
  })).sort((a, b) => a.id - b.id);
  // un collegamento deve essere reciproco: se l'altra metà non punta indietro, si toglie
  const perId = new Map(movimenti.map((m) => [m.id, m]));
  for (const m of movimenti) if (m.collegato && (perId.get(m.collegato) || {}).collegato !== m.id) m.collegato = null;

  // --- regole (per parola) ---
  const rm = (M) => new Map((M ? M.regole : []).map((r) => [r.parola, { categoria: r.categoria, _id: r.id }]));
  const rb = rm(base), ro = rm(nostro), rt = rm(loro);
  const reg = unisciMappe(rb, ro, rt, ["categoria"], vn);
  // ordine: quello di OneDrive, poi le nuove nostre (l'ordine conta a parità di lunghezza)
  const ordReg = [...reg.keys()].sort((a, b) => {
    const pa = rt.has(a) ? rt.get(a)._id : 1e9 + ro.get(a)._id, pb = rt.has(b) ? rt.get(b)._id : 1e9 + ro.get(b)._id;
    return pa - pb;
  });
  const regole = ordReg.map((p, i) => ({ id: i + 1, parola: p, categoria: reg.get(p).categoria }));

  // --- conti (per id) ---
  const cm = (M) => new Map((M && M.conti ? M.conti : []).map((c) => [c.id, c]));
  const cb = cm(base), co = cm(nostro), ct = cm(loro);
  const contiMap = unisciMappe(cb, co, ct, ["id", "nome", "tipo", "numero"], vn);
  const conti = [...contiMap.values()].sort((a, b) => (a.id === "bnl" ? -1 : b.id === "bnl" ? 1 : a.id < b.id ? -1 : 1));

  // --- impostazioni (per chiave) ---
  const im = (M) => new Map(Object.entries((M && M.impostazioni) || {}).map(([k, v]) => [k, { v }]));
  const impMap = unisciMappe(im(base), im(nostro), im(loro), ["v"], vn);
  const impostazioni = {};
  for (const [k, x] of impMap) impostazioni[k] = x.v;

  return {
    formato: "finanze-dati",
    versione: Math.max(nostro.versione || 1, loro.versione || 1),
    rev: Math.max(nostro.rev || 0, loro.rev || 0) + 1,
    conti, movimenti, regole, impostazioni,
  };
}

G.Unione = { unisci };
})(globalThis);
