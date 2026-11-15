/* Finanze personali – file cifrato su OneDrive (Microsoft Graph).
   Su OneDrive va SOLO il testo già cifrato: Microsoft non può leggere i dati.
   Il file sta in "Finanze/finanze.finanze" nel OneDrive di chi lo crea; gli altri lo aprono
   dal link di condivisione (l'API "condivisi con me" è in dismissione). */
(function (G) {
"use strict";
const GRAPH = "https://graph.microsoft.com/v1.0";
const CARTELLA = "Finanze", NOME_FILE = "finanze.finanze";
const MS = G.Microsoft;

class Conflitto extends Error {}          // il file è cambiato su OneDrive (If-Match fallito)
class NonTrovato extends Error {}
class ErroreRete extends Error {}

async function graph(percorso, { metodo = "GET", corpo = null, intestazioni = {}, tipo = "json" } = {}) {
  const fai = async () => fetch(percorso.startsWith("http") ? percorso : GRAPH + percorso, {
    method: metodo, body: corpo, cache: "no-store",
    headers: { Authorization: "Bearer " + await MS.token(), ...intestazioni },
  });
  let r;
  try { r = await fai(); } catch (e) { if (e instanceof MS.NonCollegato) throw e; throw new ErroreRete("OneDrive non raggiungibile (sei offline?)."); }
  if (r.status === 401) { sessionStorage.removeItem("fin_ms_token"); throw new MS.NonCollegato("Accesso a Microsoft scaduto."); }
  if (r.status === 412) throw new Conflitto("Il file su OneDrive è cambiato.");
  if (r.status === 404) throw new NonTrovato("File non trovato su OneDrive.");
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const e = new Error((j.error && j.error.message) || `OneDrive: errore ${r.status}`);
    e.stato = r.status; e.codice = j.error && j.error.code;
    throw e;
  }
  if (tipo === "json") return r.status === 204 ? null : r.json();
  return r.text();
}

const posizioneDa = (item) => ({ driveId: item.parentReference.driveId, itemId: item.id, nome: item.name });

/* Metadati del file: eTag e indirizzo temporaneo per scaricarlo (Graph non permette di scaricare
   /content da una pagina web per via del reindirizzamento: si usa downloadUrl, già autorizzato). */
/* Senza $select: con gli account personali il filtro può far sparire downloadUrl.
   Se l'indirizzo con driveId non trova il file, si riprova con /me/drive (il proprio OneDrive). */
async function leggiItem(pos) {
  try { return await graph(`/drives/${encodeURIComponent(pos.driveId)}/items/${encodeURIComponent(pos.itemId)}`); }
  catch (e) {
    if (!(e instanceof NonTrovato)) throw e;
    return graph(`/me/drive/items/${encodeURIComponent(pos.itemId)}`);
  }
}

async function meta(pos) {
  const it = await leggiItem(pos);
  return { eTag: it.eTag, url: it["@microsoft.graph.downloadUrl"] || null, modificato: it.lastModifiedDateTime,
    da: it.lastModifiedBy && it.lastModifiedBy.user ? it.lastModifiedBy.user.displayName : "", posizione: posizioneDa(it) };
}

async function scarica(pos) {
  const m = await meta(pos);
  if (!m.url || !/^https:\/\//i.test(m.url)) throw new Error("OneDrive non ha dato l'indirizzo per scaricare il file.");
  let r;
  try { r = await fetch(m.url, { cache: "no-store", credentials: "omit" }); } catch (e) { throw new ErroreRete("Download da OneDrive non riuscito."); }
  if (!r.ok) throw new Error(`Download da OneDrive: errore ${r.status}`);
  return { testo: await r.text(), eTag: m.eTag, meta: m };
}

/* Scrive il file solo se su OneDrive c'è ancora la versione eTag (altrimenti Conflitto). */
async function carica(pos, testo, eTag) {
  const opz = { metodo: "PUT", corpo: testo, intestazioni: { "Content-Type": "text/plain", "If-Match": eTag } };
  let it;
  try { it = await graph(`/drives/${encodeURIComponent(pos.driveId)}/items/${encodeURIComponent(pos.itemId)}/content`, opz); }
  catch (e) {
    if (!(e instanceof NonTrovato)) throw e;
    it = await graph(`/me/drive/items/${encodeURIComponent(pos.itemId)}/content`, opz);
  }
  return { eTag: it.eTag, posizione: posizioneDa(it) };
}

/* Crea Finanze/finanze.finanze nel proprio OneDrive (fallisce se esiste già). */
async function crea(testo) {
  try {
    const it = await graph(`/me/drive/root:/${CARTELLA}/${NOME_FILE}:/content?@microsoft.graph.conflictBehavior=fail`, {
      metodo: "PUT", corpo: testo, intestazioni: { "Content-Type": "text/plain" },
    });
    return { eTag: it.eTag, posizione: posizioneDa(it) };
  } catch (e) {
    if (e.stato === 409) { const x = new Error("Esiste già un file Finanze su OneDrive."); x.esiste = true; throw x; }
    throw e;
  }
}

/* Cerca il file nel proprio OneDrive. -> posizione | null */
async function trovaMio() {
  try { return posizioneDa(await graph(`/me/drive/root:/${CARTELLA}/${NOME_FILE}?$select=id,name,parentReference`)); }
  catch (e) { if (e instanceof NonTrovato) return null; throw e; }
}

/* Dal link di condivisione (del file o della cartella Finanze). */
async function daLink(link) {
  link = String(link || "").trim();
  if (!/^https:\/\/([a-z0-9-]+\.)*(1drv\.ms|onedrive\.live\.com|onedrive\.com|sharepoint\.com)\//i.test(link)) {
    throw new Error("Questo non sembra un link di condivisione di OneDrive.");
  }
  const cod = "u!" + btoa(unescape(encodeURIComponent(link))).replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  let it;
  try { it = await graph(`/shares/${cod}/driveItem`, { intestazioni: { Prefer: "redeemSharingLink" } }); }
  catch (e) {
    if (e.stato === 403 || e.codice === "accessDenied") { const x = new Error("Accesso negato al file condiviso."); x.negato = true; throw x; }
    throw e;
  }
  if (it.folder) {
    const figli = await graph(`/drives/${encodeURIComponent(it.parentReference.driveId)}/items/${encodeURIComponent(it.id)}/children?$select=id,name,file,parentReference`);
    const f = (figli.value || []).find((x) => x.name === NOME_FILE) || (figli.value || []).find((x) => x.file && /\.finanze$/i.test(x.name));
    if (!f) throw new Error("Nella cartella condivisa non c'è il file finanze.finanze.");
    return posizioneDa(f);
  }
  return posizioneDa(it);
}

/* ---- File accanto a finanze.finanze (allegati cifrati), nella stessa cartella ---- */
async function cartella(pos) {
  const it = await leggiItem(pos);
  return { driveId: it.parentReference.driveId, id: it.parentReference.id };
}
const percorsoAccanto = (c, nome) => `/drives/${encodeURIComponent(c.driveId)}/items/${encodeURIComponent(c.id)}:/${encodeURIComponent(nome)}`;

async function caricaAccanto(pos, nome, testo) {
  const c = await cartella(pos);
  await graph(percorsoAccanto(c, nome) + ":/content", { metodo: "PUT", corpo: testo, intestazioni: { "Content-Type": "text/plain" } });
}

async function scaricaAccanto(pos, nome) {
  const c = await cartella(pos);
  const it = await graph(percorsoAccanto(c, nome));
  const url = it["@microsoft.graph.downloadUrl"];
  if (!url || !/^https:\/\//i.test(url)) throw new Error("OneDrive non ha dato l'indirizzo per scaricare l'allegato.");
  let r;
  try { r = await fetch(url, { cache: "no-store", credentials: "omit" }); } catch (e) { throw new ErroreRete("Download da OneDrive non riuscito."); }
  if (!r.ok) throw new Error(`Download da OneDrive: errore ${r.status}`);
  return r.text();
}

async function eliminaAccanto(pos, nome) {
  const c = await cartella(pos);
  try { await graph(percorsoAccanto(c, nome), { metodo: "DELETE" }); } catch (e) { if (!(e instanceof NonTrovato)) throw e; }
}

G.Nuvola = { Conflitto, NonTrovato, ErroreRete, CARTELLA, NOME_FILE, meta, scarica, carica, crea, trovaMio, daLink,
  caricaAccanto, scaricaAccanto, eliminaAccanto };
})(globalThis);
