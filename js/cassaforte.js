/* Finanze personali – cifratura e archivio locale.

   Formato del file cifrato (testo, due righe):
     riga 1: intestazione JSON
             {"formato":"finanze-cifrato","versione":1,"kdf":"PBKDF2-SHA256","iterazioni":600000,
              "salt":"<base64 16 byte>","cifra":"AES-256-GCM","iv":"<base64 12 byte>"}
     riga 2: dati cifrati in base64 (AES-256-GCM, tag di 16 byte in coda)
   L'intestazione (riga 1, byte esatti) è usata come "additional data" di GCM:
   se viene alterata la decifratura fallisce.
   La chiave è derivata dalla password con PBKDF2-SHA256; la password non viene mai salvata.
   Tutto con WebCrypto del browser: nessuna libreria esterna. */
(function (G) {
"use strict";
const ITERAZIONI = 600000;
const MAX_ITERAZIONI = 10000000;
const enc = new TextEncoder(), dec = new TextDecoder();

const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const daB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const casuali = (n) => crypto.getRandomValues(new Uint8Array(n));

class PasswordErrata extends Error {}
class FileNonValido extends Error {}

async function derivaChiave(password, salt, iterazioni) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: iterazioni },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/* Sessione di cifratura: chiave in memoria (non estraibile), salt e iterazioni. */
async function nuovaSessione(password) {
  const salt = casuali(16);
  return { chiave: await derivaChiave(password, salt, ITERAZIONI), salt, iterazioni: ITERAZIONI };
}

async function cifra(sessione, oggetto) {
  const iv = casuali(12);
  const testata = JSON.stringify({
    formato: "finanze-cifrato", versione: 1, kdf: "PBKDF2-SHA256", iterazioni: sessione.iterazioni,
    salt: b64(sessione.salt), cifra: "AES-256-GCM", iv: b64(iv),
  });
  const dati = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(testata), tagLength: 128 },
    sessione.chiave, enc.encode(JSON.stringify(oggetto)));
  return testata + "\n" + b64(new Uint8Array(dati)) + "\n";
}

function leggiIntestazione(testo) {
  const nl = testo.indexOf("\n");
  if (nl < 0) throw new FileNonValido("File non riconosciuto.");
  const riga1 = testo.slice(0, nl);
  let h;
  try { h = JSON.parse(riga1); } catch (e) { throw new FileNonValido("File non riconosciuto."); }
  if (!h || h.formato !== "finanze-cifrato") throw new FileNonValido("Non è un file di Finanze personali.");
  if (h.versione !== 1) throw new FileNonValido(`Versione del file (${h.versione}) non supportata: aggiorna l'app.`);
  if (h.kdf !== "PBKDF2-SHA256" || h.cifra !== "AES-256-GCM") throw new FileNonValido("Cifratura non supportata.");
  if (!Number.isInteger(h.iterazioni) || h.iterazioni < 1 || h.iterazioni > MAX_ITERAZIONI) throw new FileNonValido("Intestazione non valida.");
  return { h, riga1, dati: testo.slice(nl + 1).trim() };
}

async function decifraCon(sessione, testo) {
  const { h, riga1, dati } = leggiIntestazione(testo);
  let chiaro;
  try {
    chiaro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: daB64(h.iv), additionalData: enc.encode(riga1), tagLength: 128 },
      sessione.chiave, daB64(dati));
  } catch (e) {
    throw new PasswordErrata("Password errata (o file danneggiato).");
  }
  return JSON.parse(dec.decode(chiaro));
}

/* true se il file è cifrato con la stessa chiave della sessione (stesso salt e iterazioni):
   altrimenti la password è stata cambiata altrove e serve di nuovo. */
function stessaChiave(sessione, testo) {
  const { h } = leggiIntestazione(testo);
  return h.salt === b64(sessione.salt) && h.iterazioni === sessione.iterazioni;
}

/* Apre un file cifrato con la password: restituisce {oggetto, sessione}. */
async function apri(testo, password) {
  const { h } = leggiIntestazione(testo);
  const salt = daB64(h.salt);
  const sessione = { chiave: await derivaChiave(password, salt, h.iterazioni), salt, iterazioni: h.iterazioni };
  return { oggetto: await decifraCon(sessione, testo), sessione };
}

/* ---------------------------------------------------------------------------
   Archivio locale (IndexedDB): contiene SOLO il testo cifrato.
   Nella fase 2 verrà affiancato/sostituito da OneDrive.
   --------------------------------------------------------------------------- */
const NOME_DB = "finanze-personali", STORE = "archivio", CHIAVE = "corrente";

function apriDb() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(NOME_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}

async function op(modo, fn) {
  const db = await apriDb();
  try {
    return await new Promise((ok, ko) => {
      const tx = db.transaction(STORE, modo);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => ok(req ? req.result : undefined);
      tx.onerror = () => ko(tx.error);
      tx.onabort = () => ko(tx.error);
    });
  } finally { db.close(); }
}

/* {testo, rev, salvato_il} oppure undefined */
const archivioLeggi = () => op("readonly", (s) => s.get(CHIAVE));
const archivioScrivi = (rec) => op("readwrite", (s) => s.put(rec, CHIAVE));
const archivioCancella = () => op("readwrite", (s) => s.delete(CHIAVE));

G.Cassaforte = {
  ITERAZIONI, PasswordErrata, FileNonValido,
  nuovaSessione, cifra, apri, decifraCon, leggiIntestazione, stessaChiave,
  archivioLeggi, archivioScrivi, archivioCancella,
};
})(globalThis);
