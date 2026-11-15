/* Finanze personali – allegati cifrati (contratti in PDF, scansioni…).

   Ogni allegato ha una sua chiave AES-256 casuale, che sta SOLO nel modello dei dati (a sua volta cifrato
   con la password). Il contenuto cifrato con quella chiave sta:
     - in questo browser (IndexedDB, record "allegato:<id>"), per aprirlo subito e offline;
     - su OneDrive, se il dispositivo è collegato, nel file "allegato-<id>.cifrato" accanto a finanze.finanze.
   Così il file dei dati resta piccolo, il cambio password non tocca gli allegati, ed eliminando
   l'allegato dal modello la sua chiave sparisce: le eventuali copie rimaste diventano illeggibili.
   Formato del contenuto (testo): "finanze-allegato-1\n<iv base64>\n<dati cifrati base64>\n",
   con l'id dell'allegato come "additional data" di GCM. */
(function (G) {
"use strict";
const K = G.Cassaforte, N = G.Nuvola, MS = G.Microsoft;
const PREFISSO = "allegato:", INTESTAZIONE = "finanze-allegato-1";
const MAX_BYTE = 15 * 1024 * 1024;
const enc = new TextEncoder();
const nomeRemoto = (id) => `allegato-${id}.cifrato`;
const nuovoId = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""));

async function chiaveDa(b64) { return crypto.subtle.importKey("raw", K.daB64(b64), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]); }

async function cifraByte(id, chiaveB64, dati) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(id), tagLength: 128 }, await chiaveDa(chiaveB64), dati);
  return `${INTESTAZIONE}\n${K.b64(iv)}\n${K.b64(new Uint8Array(ct))}\n`;
}

async function decifraTesto(meta, testo) {
  const [h, iv, dati] = String(testo).split("\n");
  if (h !== INTESTAZIONE || !iv || !dati) throw new Error("Allegato danneggiato.");
  try {
    return await crypto.subtle.decrypt({ name: "AES-GCM", iv: K.daB64(iv), additionalData: enc.encode(meta.id), tagLength: 128 },
      await chiaveDa(meta.chiave), K.daB64(dati));
  } catch (e) { throw new Error("Allegato danneggiato o non corrispondente."); }
}

/* Posizione del file dei dati su OneDrive (se questo dispositivo è collegato e l'accesso è attivo). */
async function posizione() {
  const rec = await K.archivioLeggi();
  return rec && rec.nuvola && MS.collegato() && navigator.onLine ? rec.nuvola : null;
}

let invioInCorso = null;

const Allegati = {
  MAX_BYTE,

  /* Cifra e salva un File. -> meta {id, nome, tipo, byte, chiave} da registrare nel modello. */
  async aggiungi(file) {
    if (file.size > MAX_BYTE) throw new Error(`Il file è troppo grande (massimo ${MAX_BYTE / 1048576} MB). Riduci la qualità della scansione.`);
    const id = nuovoId();
    const chiave = K.b64(crypto.getRandomValues(new Uint8Array(32)));
    const testo = await cifraByte(id, chiave, await file.arrayBuffer());
    await K.recordScrivi(PREFISSO + id, { testo, caricato: false });
    Allegati.inviaInAttesa().catch(() => {});
    return { id, nome: file.name || "documento", tipo: file.type || "application/octet-stream", byte: file.size, chiave };
  },

  /* Restituisce il Blob in chiaro (da questo dispositivo o, se manca, da OneDrive). */
  async apri(meta) {
    let rec = await K.recordLeggi(PREFISSO + meta.id);
    if (!rec) {
      const pos = await posizione();
      if (!pos) throw new Error("Questo allegato è stato aggiunto da un altro dispositivo: collegati a OneDrive (sezione Dati) per scaricarlo.");
      let testo;
      try { testo = await N.scaricaAccanto(pos, nomeRemoto(meta.id)); }
      catch (e) {
        if (e instanceof N.NonTrovato) throw new Error("L'allegato non è ancora su OneDrive: aprilo dal dispositivo da cui l'hai aggiunto (con la rete attiva) e riprova.");
        throw e;
      }
      rec = { testo, caricato: true };
      await K.recordScrivi(PREFISSO + meta.id, rec);
    }
    return new Blob([await decifraTesto(meta, rec.testo)], { type: meta.tipo || "application/octet-stream" });
  },

  async presenteQui(id) { return Boolean(await K.recordLeggi(PREFISSO + id)); },

  /* Toglie la copia locale e (se possibile) quella su OneDrive. La chiave è già sparita dal modello. */
  async elimina(meta) {
    await K.recordCancella(PREFISSO + meta.id).catch(() => {});
    try { const pos = await posizione(); if (pos) await N.eliminaAccanto(pos, nomeRemoto(meta.id)); } catch (e) { /* resta una copia illeggibile */ }
  },

  /* Carica su OneDrive gli allegati aggiunti mentre si era offline (o prima di collegarsi). */
  inviaInAttesa() {
    if (invioInCorso) return invioInCorso;
    invioInCorso = (async () => {
      const pos = await posizione();
      if (!pos) return 0;
      let n = 0;
      for (const k of await K.recordChiavi()) {
        if (typeof k !== "string" || !k.startsWith(PREFISSO)) continue;
        const rec = await K.recordLeggi(k);
        if (!rec || rec.caricato) continue;
        await N.caricaAccanto(pos, nomeRemoto(k.slice(PREFISSO.length)), rec.testo);
        await K.recordScrivi(k, { ...rec, caricato: true });
        n++;
      }
      return n;
    })().finally(() => { invioInCorso = null; });
    return invioInCorso;
  },

  /* Per il backup: {id: testo cifrato} degli allegati del modello. -> {dati, mancanti} */
  async perBackup(metas) {
    const dati = {}, mancanti = [];
    for (const m of metas || []) {
      let rec = await K.recordLeggi(PREFISSO + m.id);
      if (!rec) { try { await Allegati.apri(m); rec = await K.recordLeggi(PREFISSO + m.id); } catch (e) { /* */ } }
      if (rec) dati[m.id] = rec.testo; else mancanti.push(m.nome);
    }
    return { dati, mancanti };
  },

  /* Dal backup ripristinato: rimette gli allegati in questo browser (da inviare a OneDrive). */
  async daBackup(dati) {
    for (const [id, testo] of Object.entries(dati || {})) {
      if (typeof testo === "string" && testo.startsWith(INTESTAZIONE)) await K.recordScrivi(PREFISSO + id, { testo, caricato: false });
    }
  },

  async eliminaTuttiLocali() {
    for (const k of await K.recordChiavi()) if (typeof k === "string" && k.startsWith(PREFISSO)) await K.recordCancella(k);
  },
};

G.Allegati = Allegati;
})(globalThis);
