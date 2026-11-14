/* Finanze personali – sblocco con impronta (o volto / PIN del telefono) al posto della password.

   Come funziona (WebAuthn con estensione PRF, tutto nel browser):
   - all'attivazione si crea una passkey per questo sito, protetta dal sensore del dispositivo;
   - la passkey, dopo il riconoscimento dell'impronta, restituisce un segreto (PRF) che esiste solo
     dentro il dispositivo / gestore delle passkey e non si può ottenere senza l'impronta;
   - con quel segreto si cifra la chiave dei dati (derivata dalla password) e la si conserva qui, in IndexedDB.
   La password non viene salvata. Se la password cambia, l'impronta va riattivata.
   Vale solo per questo dispositivo e questo browser. */
(function (G) {
"use strict";
const K = G.Cassaforte;
const enc = new TextEncoder();
const RECORD = "impronta";
const casuali = (n) => crypto.getRandomValues(new Uint8Array(n));

class ImprontaNonValida extends Error {}

async function disponibile() {
  try {
    return Boolean(G.PublicKeyCredential && G.isSecureContext &&
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch (e) { return false; }
}

const leggi = () => K.recordLeggi(RECORD).catch(() => null);
const attiva_ = async () => Boolean(await leggi());
const disattiva = () => K.recordCancella(RECORD).catch(() => {});

async function chiaveDaPrf(prf) {
  const base = await crypto.subtle.importKey("raw", prf, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode("finanze-impronta-v1") },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/* Chiede l'impronta e restituisce il segreto PRF della passkey. */
async function segreto(idCredenziale, prfSalt) {
  let cred;
  try {
    cred = await navigator.credentials.get({ publicKey: {
      challenge: casuali(32), timeout: 60000, userVerification: "required",
      allowCredentials: [{ type: "public-key", id: idCredenziale }],
      extensions: { prf: { eval: { first: prfSalt } } },
    } });
  } catch (e) { throw annullato(e); }
  const r = cred && cred.getClientExtensionResults().prf;
  if (!r || !r.results || !r.results.first) throw new Error("Il dispositivo non ha restituito la chiave dell'impronta.");
  return new Uint8Array(r.results.first);
}

function annullato(e) {
  if (e && (e.name === "NotAllowedError" || e.name === "AbortError")) { const x = new Error("Impronta annullata."); x.annullato = true; return x; }
  return e;
}

/* Attiva lo sblocco con impronta. testo = dati cifrati attuali (per verificare la password). */
async function attiva(password, testo) {
  const { h } = K.leggiIntestazione(testo);
  const salt = K.daB64(h.salt);
  const grezza = await K.chiaveGrezza(password, salt, h.iterazioni);
  await K.decifraCon(await K.sessioneDaGrezza(grezza, salt, h.iterazioni), testo);     // password giusta?

  const prfSalt = casuali(32);
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: {
      rp: { name: "Finanze personali" },
      user: { id: casuali(16), name: "Finanze personali", displayName: "Finanze personali" },
      challenge: casuali(32), timeout: 60000,
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
      extensions: { prf: { eval: { first: prfSalt } } },
    } });
  } catch (e) { throw annullato(e); }
  const est = cred.getClientExtensionResults().prf;
  if (!est || (!est.enabled && !(est.results && est.results.first))) {
    throw new Error("Questo telefono o browser non permette lo sblocco con impronta per le app web. Continua a usare la password.");
  }
  const id = new Uint8Array(cred.rawId);
  // alcuni dispositivi danno il segreto già alla creazione, altri solo chiedendo l'impronta una seconda volta
  const prf = est.results && est.results.first ? new Uint8Array(est.results.first) : await segreto(id, prfSalt);
  const iv = casuali(12);
  const cifrata = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chiaveDaPrf(prf), grezza));
  grezza.fill(0);
  await K.recordScrivi(RECORD, { versione: 1, id: K.b64(id), prfSalt: K.b64(prfSalt), iv: K.b64(iv), chiave: K.b64(cifrata),
    salt: h.salt, iterazioni: h.iterazioni, creato_il: new Date().toISOString() });
}

/* Sblocca con l'impronta: restituisce la sessione {chiave, salt, iterazioni}.
   ImprontaNonValida se la password è cambiata (va riattivata). */
async function sblocca(testo) {
  const r = await leggi();
  if (!r) throw new ImprontaNonValida("Sblocco con impronta non attivo.");
  const { h } = K.leggiIntestazione(testo);
  if (h.salt !== r.salt || h.iterazioni !== r.iterazioni) {
    await disattiva();
    throw new ImprontaNonValida("La password dei dati è cambiata: sblocca con la password e riattiva l'impronta in Dati.");
  }
  const prf = await segreto(K.daB64(r.id), K.daB64(r.prfSalt));
  let grezza;
  try {
    grezza = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: K.daB64(r.iv) }, await chiaveDaPrf(prf), K.daB64(r.chiave)));
  } catch (e) { throw new ImprontaNonValida("Impronta non valida per questi dati: sblocca con la password."); }
  const s = await K.sessioneDaGrezza(grezza, K.daB64(r.salt), r.iterazioni);
  grezza.fill(0);
  return s;
}

G.Impronta = { disponibile, attiva, sblocca, disattiva, attivo: attiva_, ImprontaNonValida };
})(globalThis);
