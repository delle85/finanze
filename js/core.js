/* Finanze personali – logica (porting fedele di core.py).
   Lettura estratti conto, regole, suggerimenti, periodi. Nessun accesso alla rete. */
(function (G) {
"use strict";

const CATEGORIE_BASE = [
  "Spesa alimentare", "Casa e utenze", "Auto e trasporti", "Ristoranti e bar",
  "Salute", "Abbonamenti", "Shopping", "Stipendio", "Trasferimenti",
  "Contanti", "Commissioni banca", "Altro",
];

const REGOLE_BASE = [
  ["ESSELUNGA", "Spesa alimentare"], ["COOP", "Spesa alimentare"],
  ["CONAD", "Spesa alimentare"], ["CARREFOUR", "Spesa alimentare"],
  ["LIDL", "Spesa alimentare"], ["EUROSPIN", "Spesa alimentare"],
  [" PAM ", "Spesa alimentare"], ["BASKO", "Spesa alimentare"],
  ["IREN", "Casa e utenze"], ["ENEL", "Casa e utenze"],
  [" TIM ", "Casa e utenze"], ["FASTWEB", "Casa e utenze"],
  ["VODAFONE", "Casa e utenze"], ["ILIAD", "Casa e utenze"],
  ["TELEPASS", "Auto e trasporti"], ["AUTOSTRADE", "Auto e trasporti"],
  [" ENI ", "Auto e trasporti"], ["Q8", "Auto e trasporti"],
  ["TAMOIL", "Auto e trasporti"], ["ESSO", "Auto e trasporti"],
  ["TRENITALIA", "Auto e trasporti"], [" AMT ", "Auto e trasporti"],
  ["FARMACIA", "Salute"],
  ["NETFLIX", "Abbonamenti"], ["SPOTIFY", "Abbonamenti"],
  ["AMAZON PRIME", "Abbonamenti"], ["DISNEY", "Abbonamenti"],
  ["ANTHROPIC", "Abbonamenti"], ["CLAUDE", "Abbonamenti"],
  ["AMAZON", "Shopping"],
  ["STIPENDIO", "Stipendio"], ["EMOLUMENTI", "Stipendio"],
  ["PRELIEVO", "Contanti"], ["PRELEVAMENTO", "Contanti"],
  ["COMMISSIONI", "Commissioni banca"], ["CANONE", "Commissioni banca"],
  ["IMPOSTA DI BOLLO", "Commissioni banca"],
];

/* ---------------------------------------------------------------------------
   Utilità "come Python"
   --------------------------------------------------------------------------- */
const pySplit = (s) => s.split(/\s+/).filter(Boolean);           // str.split()
const collassa = (s) => pySplit(s).join(" ");                      // " ".join(s.split())
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);                // ordinamento per codice
/* round(x, 2) di Python. toFixed usa il valore binario esatto come Python;
   i pareggi esatti (x,xx5 rappresentabile) non capitano con importi in centesimi. */
const round2 = (x) => Number(x.toFixed(2));
/* f"{x:.2f}" di Python (conserva il segno di -0.0). */
const fmt2 = (x) => (x < 0 || Object.is(x, -0) ? "-" : "") + Math.abs(x).toFixed(2);

/* ---------------------------------------------------------------------------
   Lettura file (ArrayBuffer -> righe)
   --------------------------------------------------------------------------- */
function decodifica(bytes) {
  try {
    let b = bytes;
    if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) b = b.subarray(3);   // utf-8-sig
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch (e) {
    return new TextDecoder("windows-1252").decode(bytes);                     // cp1252 / latin-1
  }
}

/* Tabella HTML (molte banche esportano un ".xls" che in realtà è HTML).
   Stessa logica di _TabellaHTML: ogni <tr> è una riga, ogni <td>/<th> una cella. */
function righeHtml(testo) {
  const doc = new DOMParser().parseFromString(testo, "text/html");   // inerte: nessuno script eseguito
  const righe = [];
  for (const tr of doc.querySelectorAll("tr")) {
    const riga = [];
    for (const c of tr.children) {
      if (c.tagName === "TD" || c.tagName === "TH") riga.push(collassa(c.textContent));
    }
    righe.push(riga);
  }
  return righe;
}

/* Rilevamento del separatore CSV (versione semplificata di csv.Sniffer). */
function separatore(campione) {
  const linee = campione.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let migliore = null, punti = 0;
  for (const sep of [";", ",", "\t", "|"]) {
    const conti = linee.map((l) => contaFuoriVirgolette(l, sep));
    const freq = {};
    for (const n of conti) if (n > 0) freq[n] = (freq[n] || 0) + 1;
    let modo = 0, quante = 0;
    for (const [n, q] of Object.entries(freq)) if (q > quante || (q === quante && +n > modo)) { modo = +n; quante = q; }
    const p = quante * 1000 + modo;
    if (quante && p > punti) { punti = p; migliore = sep; }
  }
  return migliore || ";";
}

function contaFuoriVirgolette(linea, sep) {
  let n = 0, dentro = false;
  for (const ch of linea) {
    if (ch === '"') dentro = !dentro;
    else if (ch === sep && !dentro) n++;
  }
  return n;
}

function leggiCsv(testo, sep) {
  const righe = [];
  let riga = [], campo = "", dentro = false, i = 0;
  const fine = () => { riga.push(campo); campo = ""; };
  while (i < testo.length) {
    const ch = testo[i];
    if (dentro) {
      if (ch === '"') {
        if (testo[i + 1] === '"') { campo += '"'; i++; } else dentro = false;
      } else campo += ch;
    } else if (ch === '"' && campo === "") dentro = true;
    else if (ch === sep) fine();
    else if (ch === "\n" || ch === "\r") {
      fine(); righe.push(riga); riga = [];
      if (ch === "\r" && testo[i + 1] === "\n") i++;
    } else campo += ch;
    i++;
  }
  if (campo !== "" || riga.length) { fine(); righe.push(riga); }
  return righe;
}

/* Restituisce il file come lista di righe (liste di valori). Excel tramite SheetJS locale. */
function leggiRighe(buffer, nome) {
  const raw = new Uint8Array(buffer);
  const ext = (nome.match(/\.[^.\\/]+$/) || [""])[0].toLowerCase();
  // inizio = raw[:4096].lstrip().lower()
  let k = 0;
  while (k < raw.length && k < 4096 && /\s/.test(String.fromCharCode(raw[k]))) k++;
  const inizio = new TextDecoder("latin1").decode(raw.subarray(k, 4096)).toLowerCase();

  if (inizio.startsWith("<") || inizio.includes("<table")) return righeHtml(decodifica(raw));

  const pk = raw[0] === 0x50 && raw[1] === 0x4B && raw[2] === 0x03 && raw[3] === 0x04;
  const ole = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1].every((v, j) => raw[j] === v);
  if (pk || ole || [".xlsx", ".xlsm", ".xls"].includes(ext)) {
    if (!G.XLSX) throw new Error("Lettore Excel non disponibile.");
    // senza cellDates: le date arrivano come numero seriale, gestito da parseData (niente fusi orari)
    const wb = G.XLSX.read(raw, { type: "array", cellDates: false, cellHTML: false, cellFormula: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const righe = G.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    righe.foglio = wb.SheetNames[0] || "";
    return righe;
  }

  const testo = decodifica(raw);
  return leggiCsv(testo, separatore(testo.slice(0, 4096)));
}

/* ---------------------------------------------------------------------------
   Interpretazione valori
   --------------------------------------------------------------------------- */
const norm = (v) => collassa(String(v ?? "")).toLowerCase();

const iso = (y, m, d) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const giorniMese = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function daGiorniUTC(ms) { const d = new Date(ms); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }

// Regex di strptime (_strptime.py): %d, %m, %Y, %y
const RD = "(3[01]|[12]\\d|0[1-9]|[1-9]| [1-9])", RM = "(1[0-2]|0[1-9]|[1-9])", RY = "(\\d\\d\\d\\d)", Ry = "(\\d\\d)";
const FORMATI = [
  [new RegExp(`^${RD}/${RM}/${RY}$`), "dmY"], [new RegExp(`^${RD}-${RM}-${RY}$`), "dmY"],
  [new RegExp(`^${RD}\\.${RM}\\.${RY}$`), "dmY"], [new RegExp(`^${RY}-${RM}-${RD}$`), "Ymd"],
  [new RegExp(`^${RD}/${RM}/${Ry}$`), "dmy"], [new RegExp(`^${RD}-${RM}-${Ry}$`), "dmy"],
  [new RegExp(`^${RD}\\.${RM}\\.${Ry}$`), "dmy"], [new RegExp(`^${RY}/${RM}/${RD}$`), "Ymd"],
];

function parseData(v) {
  if (v instanceof Date) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === "number" && v > 30000 && v < 70000) {          // numero seriale Excel
    return daGiorniUTC(Date.UTC(1899, 11, 30) + Math.trunc(v) * 86400000);
  }
  if (typeof v === "boolean") return null;
  const s0 = String(v ?? "").trim();
  if (!s0) return null;
  const s = pySplit(s0)[0];
  for (const [re, ord] of FORMATI) {
    const m = s.match(re);
    if (!m) continue;
    let y, mo, d;
    if (ord === "Ymd") { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else { d = +m[1]; mo = +m[2]; y = +m[3]; if (ord === "dmy") y += y <= 68 ? 2000 : 1900; }
    if (y < 1 || d > giorniMese(y, mo)) continue;                 // es. 31/02: ValueError in Python
    return iso(y, mo, d);
  }
  return null;
}

const FLOAT_PY = /^[+-]?(\d(_?\d)*(\.(\d(_?\d)*)?)?|\.\d(_?\d)*)([eE][+-]?\d(_?\d)*)?$/;

function parseImporto(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  let s = String(v).replaceAll("€", "").replaceAll("EUR", "").replaceAll("eur", "");
  s = s.replaceAll("\xa0", "").replaceAll(" ", "").trim();
  if (!s) return null;
  let neg = false;
  if (s.startsWith("(") && s.endsWith(")")) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith("-")) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  else if (s.startsWith("+")) s = s.slice(1);
  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replaceAll(".", "").replace(/,/g, ".");   // 1.234,56
    else s = s.replaceAll(",", "");                                                               // 1,234.56
  } else if (s.includes(",")) s = s.replaceAll(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replaceAll(".", "");                            // 1.234
  if (!FLOAT_PY.test(s)) return null;
  const n = Number(s.replaceAll("_", ""));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

function trova(celle, chiavi, escludi) {
  for (const k of chiavi) for (let j = 0; j < celle.length; j++) if (!escludi.has(j) && celle[j] === k) return j;
  for (const k of chiavi) for (let j = 0; j < celle.length; j++) if (!escludi.has(j) && celle[j].startsWith(k)) return j;
  return null;
}

function mappaIntestazione(riga) {
  const celle = (riga || []).map(norm);
  const colData = trova(celle, ["data contabile", "data operazione", "data registrazione", "data movimento", "data"], new Set());
  if (colData === null) return null;
  const usate = new Set([colData]);
  const colImp = trova(celle, ["importo"], usate);
  const colDare = trova(celle, ["dare", "addebiti", "addebito", "uscite", "uscita"], usate);
  const colAvere = trova(celle, ["avere", "accrediti", "accredito", "entrate", "entrata"], usate);
  if (colImp === null && colDare === null && colAvere === null) return null;
  for (const c of [colImp, colDare, colAvere]) if (c !== null) usate.add(c);
  const parole = ["descrizione", "causale", "dettaglio", "operazione", "beneficiario", "motivazione", "esercente", "note"];
  const colDesc = [];
  celle.forEach((c, j) => { if (!usate.has(j) && !c.startsWith("data") && parole.some((p) => c.includes(p))) colDesc.push(j); });
  // usate solo per gli estratti delle carte (data dell'acquisto e movimenti non ancora contabilizzati)
  const colMov = trova(celle, ["data movimento"], new Set());
  const colCont = trova(celle, ["data contabile"], new Set());
  return { data: colData, importo: colImp, dare: colDare, avere: colAvere, desc: colDesc, mov: colMov, cont: colCont };
}

/* Riconosce l'estratto di una carta (prepagata) dal blocco informazioni sopra l'intestazione.
   -> null se non è una carta, altrimenti {numero: ultime 4 cifre o null} */
function riconosciCarta(righe, fineIntestazione) {
  let carta = /carta/i.test(righe.foglio || ""), numero = null;
  for (let i = 0; i < fineIntestazione; i++) {
    const riga = (righe[i] || []).map((v) => collassa(String(v ?? "")));
    riga.forEach((c, j) => {
      const n = c.toLowerCase();
      if (n.includes("informazioni carta") || n.includes("carta prepagata")) carta = true;
      if (n.startsWith("numero carta")) {
        carta = true;
        const resto = [n.replace(/^numero carta\s*:?/, ""), ...riga.slice(j + 1)].join(" ");
        const cifre = resto.replace(/\D/g, "");
        if (cifre.length >= 4 && numero === null) numero = cifre.slice(-4);
      }
    });
  }
  return carta ? { numero } : null;
}

/* Restituisce [[data_iso, descrizione, importo], ...] */
function estraiMovimenti(buffer, nome) {
  return estraiEstratto(buffer, nome).movimenti;
}

/* Come estraiMovimenti, ma dice anche se è l'estratto di una carta.
   Per le carte: data = "Data Movimento" (giorno dell'acquisto); le righe "Non contabilizzato"
   vengono saltate e contate in "pendenti" (arriveranno con il prossimo estratto). */
function estraiEstratto(buffer, nome) {
  const righe = leggiRighe(buffer, nome);
  let mappa = null, inizio = 0;
  for (let i = 0; i < Math.min(60, righe.length); i++) {
    mappa = mappaIntestazione(righe[i]);
    if (mappa) { inizio = i + 1; break; }
  }
  if (!mappa) throw new Error("Non trovo l'intestazione delle colonne (Data / Importo / Descrizione).");
  const carta = riconosciCarta(righe, inizio - 1);
  const colData = carta && mappa.mov !== null ? mappa.mov : mappa.data;
  const colCont = carta && mappa.mov !== null && mappa.cont !== null && mappa.cont !== mappa.mov ? mappa.cont : null;
  const cella = (riga, j) => (j !== null && j < riga.length ? riga[j] : null);
  const movimenti = [];
  let pendenti = 0;
  for (const riga0 of righe.slice(inizio)) {
    const riga = riga0 || [];
    const d = parseData(cella(riga, colData));
    if (!d) continue;                                   // righe di saldo, totali, note
    const dCont = colCont !== null ? parseData(cella(riga, colCont)) : null;
    if (colCont !== null && !dCont) { pendenti++; continue; }   // "Non contabilizzato"
    let imp;
    if (mappa.importo !== null) imp = parseImporto(cella(riga, mappa.importo));
    else {
      const dare = parseImporto(cella(riga, mappa.dare)), avere = parseImporto(cella(riga, mappa.avere));
      imp = dare === null && avere === null ? null : Math.abs(avere || 0) - Math.abs(dare || 0);
    }
    if (imp === null) continue;
    const pezzi = [];
    for (const j of mappa.desc) {
      const t = collassa(String(cella(riga, j) ?? ""));
      if (t && !pezzi.includes(t)) pezzi.push(t);
    }
    // per le carte il 4° valore è la data contabile: l'app desktop importava con quella data
    const mov = [d, pezzi.join(" - ") || "(senza descrizione)", round2(imp)];
    if (dCont) mov.push(dCont);
    movimenti.push(mov);
  }
  if (!movimenti.length && !pendenti) throw new Error("Intestazione trovata ma nessun movimento valido.");
  return { movimenti, carta, pendenti };
}

/* ---------------------------------------------------------------------------
   Conti, carte prepagate e giroconti
   --------------------------------------------------------------------------- */
const CONTO_BASE = "bnl";
const GIROCONTO = "Giroconto";
const PREPAGATA_ND = "Prepagata (non dettagliata)";
const contoCarta = (numero) => ({ id: "carta-" + numero, nome: "Prepagata …" + numero, tipo: "prepagata", numero });

/* Movimento del conto che riguarda una carta prepagata: ricarica, acquisto o estinzione.
   -> {numero: ultime 4 cifre, ricarica: true se è un trasferimento verso la carta} oppure null */
function rigaCartaSulConto(descrizione) {
  const d = descrizione.toUpperCase();
  const m = d.match(/CARTA\s+N(?:UMERO|\.)?\s*:?\s*(\d{4,})/);
  if (!m || !/PREPAGAT|ESTINZIONE/.test(d)) return null;
  return { numero: m[1].slice(-4), ricarica: /(RICARICA|ACQUISTO) CARTA PREPAGATA/.test(d) };
}

/* La riga dell'estratto carta che corrisponde a una ricarica dal conto. */
const eRicaricaCarta = (descrizione, importo) => importo > 0 && /^RICARICA\b/i.test(descrizione.trim());

/* ---------------------------------------------------------------------------
   Regole e impronta
   --------------------------------------------------------------------------- */
/* Regole ordinate per lunghezza decrescente (a parità, ordine di inserimento come SQLite). */
function caricaRegole(regole) {
  return regole.map((r) => [r.parola.toUpperCase(), r.categoria])
    .map((r, i) => [r, i]).sort((a, b) => (b[0][0].length - a[0][0].length) || (a[1] - b[1])).map((x) => x[0]);
}

function categorizza(descrizione, regole) {
  const d = " " + descrizione.toUpperCase() + " ";
  for (const [parola, cat] of regole) if (d.includes(parola)) return cat;
  return null;
}

async function sha256hex(testo) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(testo));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* Stessa impronta di core.importa_movimenti: sha256("data|descrizione|importo:.2f|n").
   Per gli altri conti (carte) l'impronta comincia con l'id del conto, così due conti non si confondono;
   per il conto principale resta identica a quella dell'app desktop. */
const impronta = (d, desc, imp, n, conto) =>
  sha256hex(`${conto && conto !== "bnl" ? conto + "|" : ""}${d}|${desc}|${fmt2(imp)}|${n}`);

/* ---------------------------------------------------------------------------
   Suggerimenti dallo storico
   --------------------------------------------------------------------------- */
const GENERICHE = new Set([
  "PAGAMENTO", "POS", "CARTA", "DEL", "ORE", "PRESSO", "BONIFICO", "FAVORE",
  "OPERAZIONE", "ADDEBITO", "SDD", "DEBIT", "EUR", "CON", "PER", "VIA", "SPA",
  "SRL", "SAS", "SNC", "DIRETTO", "DISPOSIZIONE", "ESEGUITO", "ITA", "ITALIA",
  "CONTACTLESS", "VISA", "MASTERCARD", "MAESTRO", "BANCOMAT", "ACQUISTO",
]);
const NON_ESERCENTE = new Set(["DEBITO", "CREDITO", "CASSA", "ORDINARIO", "USCITA", "ENTRATA", "PAS"]);

function chiaveEsercente(descrizione) {
  const s = descrizione.toUpperCase().replace(/\p{Nd}/gu, " ");
  return s.split(/[^A-ZÀ-Ý]+/).filter((w) => [...w].length > 2 && !GENERICHE.has(w)).join(" ");
}

const title = (s) => s.replace(/[A-Za-zÀ-ÿ]+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

function nomeEsercente(descrizione) {
  const parole = pySplit(chiaveEsercente(descrizione)).filter((w) => !NON_ESERCENTE.has(w));
  return title(parole.slice(0, 4).join(" ")) || "(altro)";
}

/* --- difflib.SequenceMatcher (porting di CPython) --- */
function matchingBlocks(a, b) {
  const b2j = new Map();
  for (let i = 0; i < b.length; i++) { const e = b[i]; if (!b2j.has(e)) b2j.set(e, []); b2j.get(e).push(i); }
  const n = b.length;
  if (n >= 200) {                                    // autojunk
    const ntest = Math.floor(n / 100) + 1;
    for (const [e, idx] of [...b2j]) if (idx.length > ntest) b2j.delete(e);
  }
  function longest(alo, ahi, blo, bhi) {
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const nuovo = new Map();
      for (const j of b2j.get(a[i]) || []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        nuovo.set(j, k);
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = nuovo;
    }
    // bjunk è vuoto (nessun isjunk): l'estensione vale anche per gli elementi "popolari" tolti da b2j
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) { besti--; bestj--; bestsize++; }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
    return [besti, bestj, bestsize];
  }
  const coda = [[0, a.length, 0, b.length]], blocchi = [];
  while (coda.length) {
    const [alo, ahi, blo, bhi] = coda.pop();
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (k) {
      blocchi.push([i, j, k]);
      if (alo < i && blo < j) coda.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) coda.push([i + k, ahi, j + k, bhi]);
    }
  }
  blocchi.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  return blocchi;
}

function ratio(a, b) {
  const m = matchingBlocks(a, b).reduce((s, x) => s + x[2], 0);
  const t = a.length + b.length;
  return t ? 2.0 * m / t : 1.0;
}

function quickRatio(a, b) {
  const full = new Map();
  for (const e of b) full.set(e, (full.get(e) || 0) + 1);
  const avail = new Map();
  let m = 0;
  for (const e of a) {
    const num = avail.has(e) ? avail.get(e) : (full.get(e) || 0);
    avail.set(e, num - 1);
    if (num > 0) m++;
  }
  const t = a.length + b.length;
  return t ? 2.0 * m / t : 1.0;
}

/* difflib.get_close_matches(word, possibilities, n=1, cutoff) -> migliore o null */
function piuSimile(word, possibilita, cutoff) {
  const b = [...word];
  let best = null;
  for (const x of possibilita) {
    const a = [...x];
    const t = a.length + b.length;
    const rq = t ? 2.0 * Math.min(a.length, b.length) / t : 1.0;
    if (rq < cutoff) continue;
    if (quickRatio(a, b) < cutoff) continue;
    const r = ratio(a, b);
    if (r < cutoff) continue;
    if (!best || r > best[0] || (r === best[0] && cmp(x, best[1]) > 0)) best = [r, x];   // nlargest su (score, x)
  }
  return best ? best[1] : null;
}

/* {id: categoria} per i movimenti senza categoria, in base a quelli già categorizzati.
   movimenti in ordine di id (come la tabella SQLite). */
function calcolaSuggerimenti(movimenti) {
  const perChiave = new Map();
  for (const m of movimenti) {
    if (m.categoria === null || m.categoria === undefined) continue;
    const k = chiaveEsercente(m.descrizione);
    if (!k) continue;
    if (!perChiave.has(k)) perChiave.set(k, new Map());
    const c = perChiave.get(k);
    c.set(m.categoria, (c.get(m.categoria) || 0) + 1);
  }
  const out = new Map();
  if (!perChiave.size) return out;
  const migliore = new Map();
  for (const [k, c] of perChiave) {
    let top = null, n = -1;
    for (const [cat, q] of c) if (q > n) { top = cat; n = q; }        // primo a parità (max di Python)
    migliore.set(k, top);
  }
  const chiavi = [...migliore.keys()];
  const cache = new Map();
  for (const m of movimenti) {
    if (m.categoria !== null && m.categoria !== undefined) continue;
    const k = chiaveEsercente(m.descrizione);
    if (!k) continue;
    if (migliore.has(k)) { out.set(m.id, migliore.get(k)); continue; }
    if (!cache.has(k)) cache.set(k, piuSimile(k, chiavi, 0.8));
    const simile = cache.get(k);
    if (simile !== null) out.set(m.id, migliore.get(simile));
  }
  return out;
}

/* ---------------------------------------------------------------------------
   Periodi e confronti
   --------------------------------------------------------------------------- */
function chiavePeriodo(d, grp) {
  if (grp === "anno") return d.slice(0, 4);
  if (grp === "trimestre") return `${d.slice(0, 4)}-T${Math.floor((+d.slice(5, 7) + 2) / 3)}`;
  return d.slice(0, 7);
}

function elencoPeriodi(da, a, grp) {
  const out = [];
  let y = +da.slice(0, 4), m = +da.slice(5, 7);
  const fy = +a.slice(0, 4), fm = +a.slice(5, 7);
  while (y < fy || (y === fy && m <= fm)) {
    const k = chiavePeriodo(iso(y, m, 1), grp);
    if (!out.length || out[out.length - 1] !== k) out.push(k);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

const ms = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const piuGiorni = (d, n) => daGiorniUTC(ms(d) + n * 86400000);
const diffGiorni = (d2, d1) => Math.round((ms(d2) - ms(d1)) / 86400000);
const fineDelMese = (d) => +d.slice(8, 10) === giorniMese(+d.slice(0, 4), +d.slice(5, 7));

function menoUnAnno(d) {
  const y = +d.slice(0, 4) - 1, m = +d.slice(5, 7), g = +d.slice(8, 10);
  return iso(y, m, g > giorniMese(y, m) ? 28 : g);      // 29 febbraio -> 28
}

function inizioMeseSpostato(d, mesi) {
  const t = +d.slice(0, 4) * 12 + +d.slice(5, 7) - 1 + mesi;
  return iso(Math.floor(t / 12), (t % 12) + 1, 1);
}

/* Periodo precedente ('prec') o stesso periodo dell'anno prima ('anno'). */
function periodoConfronto(da, a, tipo) {
  if (tipo === "anno") {
    const s = menoUnAnno(da);
    let e = menoUnAnno(a);
    if (fineDelMese(a)) e = piuGiorni(inizioMeseSpostato(e, 1), -1);   // fine mese resta fine mese
    return [s, e];
  }
  if (+da.slice(8, 10) === 1 && fineDelMese(a)) {                       // mesi interi
    const n = (+a.slice(0, 4) - +da.slice(0, 4)) * 12 + +a.slice(5, 7) - +da.slice(5, 7) + 1;
    return [inizioMeseSpostato(da, -n), piuGiorni(da, -1)];
  }
  const giorni = diffGiorni(a, da) + 1;
  return [piuGiorni(da, -giorni), piuGiorni(da, -1)];
}

G.FinCore = {
  CATEGORIE_BASE, REGOLE_BASE, round2, fmt2, cmp,
  leggiRighe, parseData, parseImporto, estraiMovimenti, estraiEstratto,
  CONTO_BASE, GIROCONTO, PREPAGATA_ND, contoCarta, rigaCartaSulConto, eRicaricaCarta,
  caricaRegole, categorizza, impronta, sha256hex,
  chiaveEsercente, nomeEsercente, piuSimile, ratio, calcolaSuggerimenti,
  chiavePeriodo, elencoPeriodi, periodoConfronto, piuGiorni, diffGiorni,
};
})(globalThis);
