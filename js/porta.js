/* Finanze personali – schermata di sblocco, primo avvio, salvataggio cifrato, blocco automatico,
   sincronizzazione con OneDrive.

   Archivio locale (IndexedDB), un solo record:
     { testo, rev, salvato_il,                       testo = dati cifrati (copia locale per avvio rapido e offline)
       nuvola: { driveId, itemId, nome, eTag,        posizione del file su OneDrive e versione che conosciamo
                 base,                               testo cifrato dell'ultima versione sincronizzata (per unire)
                 sporco,                             true = modifiche locali non ancora su OneDrive
                 sincronizzato_il } }
   Su OneDrive va solo il testo cifrato. */
(function () {
"use strict";
const K = window.Cassaforte, A = window.FinApi, MS = window.Microsoft, N = window.Nuvola, U = window.Unione, I = window.Impronta;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MIN_PASSWORD = 10;
const K_DOPO = "fin_dopo", K_LINK = "fin_link", K_RIMBALZO = "fin_rimbalzo", K_MSG = "finanze_msg";

let sessione = null;     // {chiave, salt, iterazioni}: la password non viene conservata
let modello = null;
let revBase = null;      // revisione dell'archivio quando l'abbiamo letto/scritto
let coda = Promise.resolve();
let ultimaAttivita = Date.now();
let timerBlocco = null, timerSync = null, timerControllo = null;
let statoSync = { stato: "locale", messaggio: "" };

const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) { /* */ } } };

/* Mette in coda (una cosa alla volta: salvataggi e sincronizzazioni non si sovrappongono). */
function inCoda(fn) {
  const giro = coda.then(fn);
  coda = giro.catch(() => {});
  return giro;
}

/* ---------------------------------------------------------------------------
   Salvataggio locale
   --------------------------------------------------------------------------- */
function salva() {
  return inCoda(async () => {
    if (!sessione || !modello) return;
    const attuale = await K.archivioLeggi();
    if (attuale && revBase !== null && attuale.rev !== revBase) {
      // un'altra scheda/finestra ha salvato nel frattempo: non sovrascrivere
      ss.set(K_MSG, "I dati erano stati modificati in un'altra finestra dell'app: questa è stata bloccata per non sovrascriverli e l'ultima modifica fatta qui non è stata salvata. Sblocca per vedere i dati aggiornati.");
      bloccaSubito();
      throw new Error("conflitto");
    }
    const testo = await K.cifra(sessione, modello);
    const rec = { testo, rev: modello.rev, salvato_il: new Date().toISOString() };
    if (attuale && attuale.nuvola) rec.nuvola = { ...attuale.nuvola, sporco: true };
    await K.archivioScrivi(rec);
    revBase = modello.rev;
    if (rec.nuvola) { mostraStato("attesa"); programmaSync(1500); }
  });
}

/* Sostituisce il contenuto del modello in memoria (l'API lo usa per riferimento). */
function sostituisciModello(nuovo) {
  for (const k of Object.keys(modello)) delete modello[k];
  Object.assign(modello, nuovo);
  if (!modello.impostazioni) modello.impostazioni = {};
  A.migraModello(modello);
}

/* ---------------------------------------------------------------------------
   Sincronizzazione con OneDrive
   --------------------------------------------------------------------------- */
const TESTI_STATO = {
  locale: "Dati cifrati su questo dispositivo",
  ok: "Sincronizzato con OneDrive",
  attesa: "Modifiche in attesa di invio a OneDrive",
  invio: "Sincronizzazione…",
  offline: "Offline: le modifiche partiranno al ritorno della rete",
  accesso: "Accedi a Microsoft per sincronizzare",
  errore: "Sincronizzazione non riuscita",
};
function mostraStato(stato, messaggio = "") {
  statoSync = { stato, messaggio };
  const t = $("safe-text");
  if (t) t.textContent = TESTI_STATO[stato] + (messaggio && stato === "errore" ? ": " + messaggio : "");
  const s = $("safe");
  if (s) s.classList.toggle("avviso", ["accesso", "errore", "offline"].includes(stato));
  if (window.statoSyncCambiato) window.statoSyncCambiato(statoSync);
}

function programmaSync(ms) {
  clearTimeout(timerSync);
  timerSync = setTimeout(() => { sincronizza().catch(() => {}); }, ms);
}

function sincronizza() {
  return inCoda(async () => {
    if (!sessione || !modello) return;
    const rec = await K.archivioLeggi();
    if (!rec || !rec.nuvola) { mostraStato("locale"); return; }
    if (!navigator.onLine) { mostraStato(rec.nuvola.sporco ? "offline" : "ok"); return; }
    if (!MS.collegato()) { mostraStato("accesso"); return; }
    mostraStato("invio");
    try {
      await sincronizzaRecord(rec);
      if (window.Allegati) window.Allegati.inviaInAttesa().catch(() => {});
    } catch (e) {
      if (e instanceof MS.NonCollegato) mostraStato("accesso");
      else if (e instanceof N.ErroreRete) mostraStato("offline");
      else { mostraStato("errore", e.message || String(e)); console.error(e); }
    }
  });
}

async function scriviRec(testo, nuvola) {
  const rec = { testo, rev: modello.rev, salvato_il: new Date().toISOString(), nuvola };
  await K.archivioScrivi(rec);
  revBase = modello.rev;
  return rec;
}

async function sincronizzaRecord(rec) {
  for (let tentativo = 0; tentativo < 4; tentativo++) {
    const nv = rec.nuvola;
    const revInizio = modello.rev;
    const m = await N.meta(nv);
    if (m.eTag === nv.eTag) {
      if (!nv.sporco) { mostraStato("ok"); return; }
      try {
        const r = await N.carica(nv, rec.testo, nv.eTag);
        rec = await scriviRec(rec.testo, { ...nv, eTag: r.eTag, base: rec.testo, sporco: false, sincronizzato_il: new Date().toISOString() });
        mostraStato("ok");
        return;
      } catch (e) { if (!(e instanceof N.Conflitto)) throw e; continue; }
    }
    // Su OneDrive c'è una versione nuova (dell'altro dispositivo)
    const { testo: remoto, eTag } = await N.scarica(nv);
    if (!K.stessaChiave(sessione, remoto)) { passwordCambiataAltrove(rec, remoto, eTag); return; }
    const loro = await K.decifraCon(sessione, remoto);
    if (modello.rev !== revInizio) { rec = await K.archivioLeggi(); continue; }   // modificato qui nel frattempo: si riprova
    if (!nv.sporco) {
      sostituisciModello(loro);
      modello.rev = Math.max(loro.rev || 0, revBase || 0) + 1;
      await scriviRec(await K.cifra(sessione, modello), { ...nv, eTag, base: remoto, sporco: false, sincronizzato_il: new Date().toISOString() });
      mostraStato("ok");
      datiAggiornati("Dati aggiornati da OneDrive");
      return;
    }
    // modifiche da entrambe le parti: si uniscono
    const base = nv.base && K.stessaChiave(sessione, nv.base) ? await K.decifraCon(sessione, nv.base).catch(() => null) : null;
    sostituisciModello(U.unisci(base, modello, loro, "nostro"));
    const testo = await K.cifra(sessione, modello);
    try {
      const r = await N.carica(nv, testo, eTag);
      await scriviRec(testo, { ...nv, eTag: r.eTag, base: testo, sporco: false, sincronizzato_il: new Date().toISOString() });
      mostraStato("ok");
      datiAggiornati("Le tue modifiche sono state unite a quelle arrivate da OneDrive");
      return;
    } catch (e) {
      if (!(e instanceof N.Conflitto)) throw e;
      // nel frattempo è cambiato di nuovo: si salva l'unione in locale e si riprova
      rec = await scriviRec(testo, { ...nv, eTag, base: remoto, sporco: true });
    }
  }
  throw new Error("il file cambia troppo spesso, riprovo più tardi");
}

function datiAggiornati(msg) {
  if (window.datiAggiornati) window.datiAggiornati(msg);
}

/* La password del file è stata cambiata su un altro dispositivo: si prende il file nuovo e si chiede la password. */
async function passwordCambiataAltrove(rec, remoto, eTag) {
  const persi = rec.nuvola.sporco;
  await K.archivioScrivi({ testo: remoto, rev: (rec.rev || 0) + 1, salvato_il: new Date().toISOString(),
    nuvola: { ...rec.nuvola, eTag, base: remoto, sporco: false } });
  ss.set(K_MSG, "La password dei dati è stata cambiata su un altro dispositivo: sblocca con la nuova password." +
    (persi ? " Le ultime modifiche fatte qui e non ancora inviate a OneDrive sono andate perse." : ""));
  bloccaSubito();
}

function avviaControlloRemoto() {
  clearInterval(timerControllo);
  timerControllo = setInterval(() => { if (!document.hidden) sincronizza().catch(() => {}); }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && sessione) programmaSync(300); });
  window.addEventListener("online", () => { if (sessione) programmaSync(300); });
  window.addEventListener("offline", () => { if (sessione && statoSync.stato !== "locale") mostraStato("offline"); });
}

/* ---------------------------------------------------------------------------
   Entrata e blocco
   --------------------------------------------------------------------------- */
async function entra(oggetto, sess, rev) {
  sessione = sess; modello = oggetto; revBase = rev;
  if (!modello.impostazioni) modello.impostazioni = {};
  let daBackup = false;
  if (modello._allegati) {                // backup ripristinato: gli allegati tornano nel loro archivio
    if (window.Allegati) await window.Allegati.daBackup(modello._allegati);
    delete modello._allegati;
    daBackup = true;
  }
  if (A.migraModello(modello) || daBackup) {   // archivio di una versione precedente, o da ripulire
    modello.rev = (modello.rev || 0) + 1;
    await salva();
  }
  document.body.classList.remove("chiusa");
  $("porta").hidden = true;
  avviaControlloInattivita();
  await window.avviaInterfaccia(A.creaApi(modello, salva));
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  const rec = await K.archivioLeggi();
  mostraStato(rec && rec.nuvola ? (MS.collegato() ? "invio" : "accesso") : "locale");
  avviaControlloRemoto();
  await riprendiAzione();
  sincronizza().catch(() => {});
}

/* Azione chiesta prima di andare alla pagina di accesso Microsoft (es. "crea" il file su OneDrive). */
async function riprendiAzione() {
  const dopo = ss.get(K_DOPO);
  ss.set(K_DOPO, null);
  if (!dopo || !MS.collegato()) return;
  try {
    if (dopo === "crea") await Porta.collegaCrea();
    else if (dopo === "link") { const l = ss.get(K_LINK); ss.set(K_LINK, null); if (l) await Porta.collegaLink(l); }
  } catch (e) { window.avviso("OneDrive", esc(e.message || String(e))); }
}

/* Blocco: toglie tutto dalla memoria ricaricando la pagina. */
async function blocca() {
  try { await coda; } catch (e) { /* già gestito */ }
  bloccaSubito();
}
function bloccaSubito() {
  sessione = null; modello = null;
  document.body.classList.add("chiusa");
  location.reload();
}

function minutiBlocco() { return modello && +modello.impostazioni.blocco_minuti || 10; }

function avviaControlloInattivita() {
  ultimaAttivita = Date.now();
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"]) {
    window.addEventListener(ev, () => { ultimaAttivita = Date.now(); }, { passive: true, capture: true });
  }
  const controlla = () => { if (sessione && Date.now() - ultimaAttivita > minutiBlocco() * 60000) blocca(); };
  clearInterval(timerBlocco);
  timerBlocco = setInterval(controlla, 10000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) controlla(); });
}

/* ---------------------------------------------------------------------------
   Collegamento a OneDrive (dalla sezione "Dati", con i dati già aperti)
   --------------------------------------------------------------------------- */
/* Apre un file su OneDrive: se la chiave è diversa chiede la password di quel file. -> {oggetto, sessione, testo, eTag} */
async function apriRemoto(pos, chiediPassword) {
  const { testo, eTag } = await N.scarica(pos);
  K.leggiIntestazione(testo);
  if (sessione && K.stessaChiave(sessione, testo)) return { oggetto: await K.decifraCon(sessione, testo), sessione, testo, eTag };
  for (;;) {
    const pw = await chiediPassword();
    if (pw === null) throw new Error("Collegamento annullato.");
    try { const r = await K.apri(testo, pw); return { ...r, testo, eTag }; }
    catch (e) { if (!(e instanceof K.PasswordErrata)) throw e; window.toast("Password errata"); }
  }
}

/* Unisce i dati di questo dispositivo con quelli del file su OneDrive e li salva lì (con la password del file). */
async function collegaEsistente(pos) {
  const r = await apriRemoto(pos, () => window.chiediPassword("Password del file su OneDrive",
    "Il file su OneDrive è protetto da un'altra password. Inseriscila: da ora userai quella anche su questo dispositivo."));
  if (!r.oggetto || r.oggetto.formato !== "finanze-dati") throw new Error("Il file su OneDrive non contiene dati di Finanze personali.");
  await inCoda(async () => {
    const prima = modello.movimenti.length;
    sessione = r.sessione;
    sostituisciModello(U.unisci(null, modello, r.oggetto, "loro"));
    const testo = await K.cifra(sessione, modello);
    const c = await N.carica(pos, testo, r.eTag);
    await scriviRec(testo, { ...c.posizione, eTag: c.eTag, base: testo, sporco: false, sincronizzato_il: new Date().toISOString() });
    mostraStato("ok");
    datiAggiornati(`Collegato a OneDrive: ${modello.movimenti.length} movimenti (${prima} erano su questo dispositivo)`);
  });
}

const Porta = window.Porta = {
  blocca,
  /* Il backup comprende anche gli allegati (contratti PDF), cifrati con le loro chiavi dentro il file cifrato. */
  async scaricaBackup() {
    await coda;
    const lista = (modello.allegati || []);
    const al = lista.length && window.Allegati ? await window.Allegati.perBackup(lista) : { dati: {}, mancanti: [] };
    const testo = await K.cifra(sessione, lista.length ? { ...modello, _allegati: al.dati } : modello);
    scaricaFile(`finanze_backup_${oggiCompatto()}.finanze`, testo, "application/octet-stream");
    if (al.mancanti.length) window.avviso("Backup scaricato, ma incompleto", `Questi allegati non sono su questo dispositivo né raggiungibili su OneDrive, quindi non sono nel backup: <b>${al.mancanti.map(esc).join(", ")}</b>. Fai il backup dal dispositivo da cui li hai aggiunti.`);
    else window.toast("Backup cifrato scaricato");
  },
  async info() {
    const rec = await K.archivioLeggi();
    let persistente = false;
    try { persistente = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; } catch (e) { /* */ }
    return { salvato_il: rec && rec.salvato_il, byte: rec ? rec.testo.length : 0, minuti: minutiBlocco(), persistente,
      nuvola: rec && rec.nuvola ? { nome: rec.nuvola.nome, sporco: rec.nuvola.sporco, sincronizzato_il: rec.nuvola.sincronizzato_il } : null,
      microsoft: { collegato: MS.collegato(), utente: MS.utente() }, stato: statoSync };
  },
  async impostaBlocco(min) {
    modello.impostazioni.blocco_minuti = String(min);
    modello.rev = (modello.rev || 0) + 1;
    await salva();
  },
  async cambiaPassword(vecchia, nuova) {
    const rec = await K.archivioLeggi();
    try { await K.apri(rec.testo, vecchia); } catch (e) { throw new Error("La password attuale non è corretta."); }
    sessione = await K.nuovaSessione(nuova);
    modello.rev = (modello.rev || 0) + 1;
    await salva();
    await I.disattiva();          // la chiave è cambiata: l'impronta va riattivata
  },
  async eliminaTutto() {
    await coda;
    if (window.Allegati) await window.Allegati.eliminaTuttiLocali();
    await K.archivioCancella();
    await I.disattiva();
    bloccaSubito();
  },
  sincronizza: () => sincronizza(),
  /* Sblocco con impronta su questo dispositivo */
  async impronta() { return { disponibile: await I.disponibile(), attivo: await I.attivo() }; },
  async attivaImpronta(password) {
    await coda;
    const rec = await K.archivioLeggi();
    try { await I.attiva(password, rec.testo); }
    catch (e) { if (e instanceof K.PasswordErrata) throw new Error("Password errata."); throw e; }
  },
  disattivaImpronta: () => I.disattiva(),
  /* Va alla pagina di accesso Microsoft; i dati sono già salvati, al ritorno si sblocca di nuovo. */
  async accediMicrosoft(dopo = "", link = "") {
    await coda;
    ss.set(K_DOPO, dopo || null);
    ss.set(K_LINK, link || null);
    return MS.accedi({ dopo });
  },
  esciMicrosoft() { MS.esci(); mostraStato("accesso"); },
  /* Crea il file nel proprio OneDrive con i dati di questo dispositivo. */
  async collegaCrea() {
    if (!MS.collegato()) return Porta.accediMicrosoft("crea");
    const rec = await K.archivioLeggi();
    try {
      const r = await N.crea(rec.testo);
      await inCoda(async () => {
        const attuale = await K.archivioLeggi();
        await K.archivioScrivi({ ...attuale, nuvola: { ...r.posizione, eTag: r.eTag, base: rec.testo, sporco: attuale.testo !== rec.testo, sincronizzato_il: new Date().toISOString() } });
      });
      mostraStato("ok");
      sincronizza().catch(() => {});
      return { creato: true };
    } catch (e) {
      if (!e.esiste) throw e;
      const pos = await N.trovaMio();
      await collegaEsistente(pos);
      return { creato: false, unito: true };
    }
  },
  /* Collega al file condiviso da un'altra persona (link ricevuto). */
  async collegaLink(link) {
    if (!MS.collegato()) return Porta.accediMicrosoft("link", link);
    let pos;
    try { pos = await N.daLink(link); }
    catch (e) {
      if (e.negato && !MS.scopeEsteso()) {
        ss.set(K_DOPO, "link"); ss.set(K_LINK, link);
        window.avviso("Serve un permesso in più", "Microsoft non permette di aprire il file condiviso con il permesso base. Ti porto alla pagina di accesso per concedere anche l'accesso ai <b>file condivisi con te</b>; poi sblocca di nuovo.");
        setTimeout(() => MS.accedi({ dopo: "link", esteso: true }), 2500);
        return { annullato: true };
      }
      throw e;
    }
    await collegaEsistente(pos);
    return { unito: true };
  },
  async scollega() {
    await inCoda(async () => {
      const rec = await K.archivioLeggi();
      delete rec.nuvola;
      await K.archivioScrivi(rec);
    });
    mostraStato("locale");
  },
};

function scaricaFile(nome, testo, tipo) {
  const url = URL.createObjectURL(new Blob([testo], { type: tipo }));
  const a = document.createElement("a");
  a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const oggiCompatto = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; };

/* ---------------------------------------------------------------------------
   Schermate della porta d'ingresso
   --------------------------------------------------------------------------- */
const AVVISO = `<div class="box" style="border-color:rgba(255,176,138,.45)"><b>Importante: se perdi la password, i dati sono persi.</b>
  <div class="note">La password non viene salvata da nessuna parte e non esiste un modo per recuperarla: né tu, né Microsoft, né altri
  potrete aprire i dati senza. Scrivila su carta e tienila in un posto sicuro. Una frase di 4-5 parole è facile da ricordare e difficile da indovinare.</div></div>`;

function mostra(html) {
  document.body.classList.add("chiusa");
  $("porta").hidden = false;
  $("porta-box").innerHTML = html;
  const primo = $("porta-box").querySelector("input[type=password], input[type=url]");
  if (primo) primo.focus();
}

function errore(msg) { const e = $("p-err"); if (e) { e.textContent = msg; e.hidden = !msg; } }

function attesa(on, testo) {
  const b = $("p-ok");
  if (b) { b.disabled = on; if (testo) b.textContent = testo; }
}

/* Sceglie un file con il selettore del browser. */
function scegliFile(accept) {
  return new Promise((ok) => {
    const inp = $("file-porta");
    inp.accept = accept; inp.value = "";
    inp.onchange = () => ok(inp.files[0] || null);
    inp.click();
  });
}

const MARCHIO = `<div class="brand" style="padding:0"><img src="icone/icona-64.png" alt="" width="40" height="40"> Finanze</div>`;

function riquadroMessaggio() {
  const msg = ss.get(K_MSG) || "";
  ss.set(K_MSG, null);
  return msg ? `<div class="box" style="border-color:rgba(255,176,138,.45)"><div class="note" style="color:var(--text)">${esc(msg)}</div></div>` : "";
}

async function schermataSblocco(rit) {
  const rec = await K.archivioLeggi();
  const online = rec && rec.nuvola;
  const serveMs = online && !MS.collegato();
  const conImpronta = await I.attivo() && await I.disponibile();
  mostra(`${riquadroMessaggio()}${MARCHIO}
    <h2 style="font-size:1.5rem">Sblocca</h2>
    ${conImpronta ? `<button class="btn primary" type="button" id="p-impronta" style="justify-content:center">Sblocca con impronta</button>
      <div class="note" id="p-err-imp" hidden style="color:var(--out)"></div>
      <div class="note" style="text-align:center">oppure con la password</div>` : ""}
    ${serveMs ? `<div class="box"><b>Non sei collegato a Microsoft</b><div class="note">Puoi sbloccare e usare i dati di questo dispositivo, ma per ricevere e inviare
      le modifiche su OneDrive devi accedere.${rit && rit.errore && !rit.serveAccesso ? `<br><span style="color:var(--out)">${esc(rit.errore)}</span>` : ""}</div>
      <button class="btn" type="button" id="p-ms" style="justify-content:center">Accedi con Microsoft</button></div>` : ""}
    <form id="p-form" class="field" autocomplete="on">
      <input type="text" name="username" value="Finanze personali" autocomplete="username" hidden>
      <label for="p-pw">Password</label>
      <input class="input" id="p-pw" type="password" autocomplete="current-password" required>
      <div class="note" id="p-err" hidden style="color:var(--out)"></div>
      <button class="btn primary" id="p-ok" type="submit" style="justify-content:center;margin-top:8px">Sblocca</button>
    </form>
    <div class="note">${online ? `Dati cifrati, sincronizzati con OneDrive${MS.utente() ? ` (${esc(MS.utente().email)})` : ""}.` : "I dati sono cifrati su questo dispositivo."} Lo sblocco richiede qualche secondo.</div>
    <button class="crumb" type="button" id="p-ripristina">Ripristina un backup…</button>`);
  $("p-form").onsubmit = async (ev) => {
    ev.preventDefault();
    errore(""); attesa(true, "Sblocco…");
    try {
      const r = await K.archivioLeggi();
      const { oggetto, sessione: s } = await K.apri(r.testo, $("p-pw").value);
      await entra(oggetto, s, r.rev);
    } catch (e) {
      errore(e instanceof K.PasswordErrata ? "Password errata." : (e.message || String(e)));
      attesa(false, "Sblocca");
      $("p-pw").select();
    }
  };
  if ($("p-ms")) $("p-ms").onclick = () => MS.accedi({});
  $("p-ripristina").onclick = () => schermataRipristino(true);
  if (conImpronta) {
    $("p-pw").blur();
    $("p-ok").classList.remove("primary");
    const b = $("p-impronta"), err = (m) => { $("p-err-imp").textContent = m; $("p-err-imp").hidden = !m; };
    b.onclick = async () => {
      err(""); b.disabled = true; b.textContent = "Sblocco…";
      try {
        const r = await K.archivioLeggi();
        const s = await I.sblocca(r.testo);
        await entra(await K.decifraCon(s, r.testo), s, r.rev);
      } catch (e) {
        b.disabled = false; b.textContent = "Sblocca con impronta";
        if (e.annullato) return;
        err(e.message || String(e));
        if (e instanceof I.ImprontaNonValida) { await I.disattiva(); b.hidden = true; $("p-pw").focus(); }
      }
    };
  }
}

async function schermataBenvenuto(rit) {
  mostra(`${riquadroMessaggio()}${MARCHIO}
    <h2 style="font-size:1.5rem">Benvenuto</h2>
    <div class="note">Su questo dispositivo non ci sono ancora dati. Come vuoi iniziare?</div>
    ${rit && !rit.ok && rit.errore ? `<div class="note" style="color:var(--out)">${esc(rit.errore)}</div>` : ""}
    <button class="btn primary" type="button" id="p-online" style="justify-content:center">Apri i dati da OneDrive</button>
    <button class="btn" type="button" id="p-json" style="justify-content:center">Importa i dati dall'app desktop (.json)</button>
    <button class="btn" type="button" id="p-backup" style="justify-content:center">Ripristina un backup cifrato (.finanze)</button>
    <button class="btn" type="button" id="p-vuoto" style="justify-content:center">Inizia da zero</button>
    <div class="note">«Apri da OneDrive» va bene sia per il file nel tuo OneDrive sia per quello che qualcuno ha condiviso con te.
      Il file .json si crea sul PC con <span style="font-family:var(--mono)">strumenti\\esporta_per_web.py</span> (vedi LEGGIMI).</div>`);
  $("p-online").onclick = () => (MS.collegato() ? schermataApriOnline() : MS.accedi({ dopo: "apri-onedrive" }));
  $("p-json").onclick = async () => {
    const f = await scegliFile(".json,application/json");
    if (!f) return;
    let m;
    try { m = A.modelloDaExport(JSON.parse(await f.text())); }
    catch (e) { window.alert(e.message || String(e)); return; }
    schermataNuovaPassword(m, `Trovati <b>${m.movimenti.length}</b> movimenti e <b>${m.regole.length}</b> regole in ${esc(f.name)}.`, f.name);
  };
  $("p-backup").onclick = () => schermataRipristino(false);
  $("p-vuoto").onclick = () => schermataNuovaPassword(A.modelloVuoto(), "Archivio nuovo, con le regole di base.");
}

/* Primo avvio su un dispositivo nuovo: cerca il file nel proprio OneDrive, altrimenti chiede il link. */
async function schermataApriOnline(msgErrore = "") {
  mostra(`${MARCHIO}<h2 style="font-size:1.5rem">Apri da OneDrive</h2><div class="note">Cerco il file nel tuo OneDrive…</div>`);
  let pos = null;
  try { if (!msgErrore) pos = await N.trovaMio(); }
  catch (e) { if (e instanceof MS.NonCollegato) return MS.accedi({ dopo: "apri-onedrive" }); msgErrore = e.message; }
  if (pos) return schermataPasswordOnline(pos);
  const u = MS.utente();
  mostra(`${MARCHIO}<h2 style="font-size:1.5rem">Apri da OneDrive</h2>
    <div class="note">${u ? `Collegato come <b>${esc(u.email)}</b>. ` : ""}Nel tuo OneDrive non c'è il file <b>${N.CARTELLA}/${N.NOME_FILE}</b>.
      Se qualcuno lo ha condiviso con te, incolla qui il link che hai ricevuto (dall'email di OneDrive: «Apri»/«Visualizza», poi copia l'indirizzo).</div>
    <form id="p-form" class="field" style="gap:10px">
      <label for="p-link">Link di condivisione</label>
      <input class="input" id="p-link" type="url" placeholder="https://1drv.ms/…" required autocomplete="off">
      <div class="note" id="p-err" ${msgErrore ? "" : "hidden"} style="color:var(--out)">${esc(msgErrore)}</div>
      <div class="actions"><button class="btn" type="button" id="p-indietro">Indietro</button>
        <button class="btn primary" id="p-ok" type="submit">Apri</button></div>
    </form>
    <button class="crumb" type="button" id="p-altro">Usa un altro account Microsoft</button>`);
  $("p-indietro").onclick = avvio;
  $("p-altro").onclick = () => { MS.esci(); MS.accedi({ dopo: "apri-onedrive" }); };
  $("p-form").onsubmit = async (ev) => {
    ev.preventDefault();
    errore(""); attesa(true, "Apertura…");
    const link = $("p-link").value;
    try {
      schermataPasswordOnline(await N.daLink(link));
    } catch (e) {
      if (e.negato && !MS.scopeEsteso()) { ss.set(K_LINK, link); return MS.accedi({ dopo: "apri-link", esteso: true }); }
      errore(e.message || String(e)); attesa(false, "Apri");
    }
  };
}

async function schermataPasswordOnline(pos) {
  mostra(`${MARCHIO}<h2 style="font-size:1.5rem">Apri da OneDrive</h2><div class="note">Scarico il file cifrato…</div>`);
  let testo, eTag;
  try { ({ testo, eTag } = await N.scarica(pos)); K.leggiIntestazione(testo); }
  catch (e) { return schermataApriOnline(e.message || String(e)); }
  mostra(`${MARCHIO}<h2 style="font-size:1.5rem">Password dei dati</h2>
    <div class="note">Trovato <b>${esc(pos.nome)}</b> su OneDrive. Inserisci la password con cui è protetto (la stessa usata sugli altri dispositivi).</div>
    <form id="p-form" class="field" style="gap:10px">
      <input type="text" name="username" value="Finanze personali" autocomplete="username" hidden>
      <label for="p-pw">Password</label>
      <input class="input" id="p-pw" type="password" autocomplete="current-password" required>
      <div class="note" id="p-err" hidden style="color:var(--out)"></div>
      <div class="actions"><button class="btn" type="button" id="p-indietro">Indietro</button>
        <button class="btn primary" id="p-ok" type="submit">Apri</button></div>
    </form>`);
  $("p-indietro").onclick = avvio;
  $("p-form").onsubmit = async (ev) => {
    ev.preventDefault();
    errore(""); attesa(true, "Sblocco…");
    try {
      const { oggetto, sessione: s } = await K.apri(testo, $("p-pw").value);
      if (!oggetto || oggetto.formato !== "finanze-dati") throw new Error("Il file non contiene dati di Finanze personali.");
      if (await K.archivioLeggi()) throw new Error("Esiste già un archivio su questo dispositivo: ricarica la pagina.");
      const rev = (oggetto.rev || 0) + 1;
      oggetto.rev = rev;
      await K.archivioScrivi({ testo: await K.cifra(s, oggetto), rev, salvato_il: new Date().toISOString(),
        nuvola: { ...pos, eTag, base: testo, sporco: false, sincronizzato_il: new Date().toISOString() } });
      await entra(oggetto, s, rev);
    } catch (e) {
      errore(e instanceof K.PasswordErrata ? "Password errata." : (e.message || String(e)));
      attesa(false, "Apri");
    }
  };
}

function schermataNuovaPassword(m, intro, fileJson) {
  mostra(`
    <h2 style="font-size:1.5rem">Scegli la password</h2>
    <div class="note">${intro}</div>
    <form id="p-form" class="field" style="gap:10px">
      <input type="text" name="username" value="Finanze personali" autocomplete="username" hidden>
      <label for="p-pw">Password (almeno ${MIN_PASSWORD} caratteri)</label>
      <input class="input" id="p-pw" type="password" autocomplete="new-password" required>
      <label for="p-pw2">Ripeti la password</label>
      <input class="input" id="p-pw2" type="password" autocomplete="new-password" required>
      ${AVVISO}
      <label class="check"><input type="checkbox" id="p-capito"> Ho capito: se perdo la password, perdo i dati.</label>
      <div class="note" id="p-err" hidden style="color:var(--out)"></div>
      <div class="actions"><button class="btn" type="button" id="p-indietro">Indietro</button>
        <button class="btn primary" id="p-ok" type="submit">Cifra e apri</button></div>
    </form>`);
  $("p-indietro").onclick = avvio;
  $("p-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const pw = $("p-pw").value;
    if (pw.length < MIN_PASSWORD) return errore(`La password deve avere almeno ${MIN_PASSWORD} caratteri.`);
    if (pw !== $("p-pw2").value) return errore("Le due password non coincidono.");
    if (!$("p-capito").checked) return errore("Conferma di aver capito l'avviso.");
    errore(""); attesa(true, "Cifratura…");
    try {
      if (await K.archivioLeggi()) throw new Error("Esiste già un archivio su questo dispositivo: ricarica la pagina.");
      const s = await K.nuovaSessione(pw);
      m.rev = 1;
      await K.archivioScrivi({ testo: await K.cifra(s, m), rev: 1, salvato_il: new Date().toISOString() });
      await entra(m, s, 1);
      if (fileJson) window.avviso("Dati importati e cifrati",
        `Ora <b>elimina il file ${esc(fileJson)}</b> (e svuota il cestino): contiene i movimenti in chiaro.<br><br>
         Poi vai in <b>Dati</b>: puoi salvarli su OneDrive (cifrati) e scaricare un backup da tenere su una chiavetta.`);
    } catch (e) { errore(e.message || String(e)); attesa(false, "Cifra e apri"); }
  };
}

async function schermataRipristino(sostituisce) {
  const f = await scegliFile(".finanze,.txt,application/octet-stream");
  if (!f) return;
  const testo = await f.text();
  try { K.leggiIntestazione(testo); } catch (e) { window.alert(e.message || String(e)); return; }
  mostra(`
    <h2 style="font-size:1.5rem">Ripristina backup</h2>
    <div class="note">File: <b>${esc(f.name)}</b>. Inserisci la password usata quando è stato fatto il backup.</div>
    ${sostituisce ? `<div class="box" style="border-color:rgba(255,176,138,.45)"><b>Attenzione</b><div class="note">I dati attuali su questo dispositivo verranno <b>sostituiti</b> da quelli del backup
      (e, se il dispositivo è collegato a OneDrive, il backup verrà unito ai dati online alla prossima sincronizzazione).</div></div>` : ""}
    <form id="p-form" class="field" style="gap:10px">
      <input type="text" name="username" value="Finanze personali" autocomplete="username" hidden>
      <label for="p-pw">Password del backup</label>
      <input class="input" id="p-pw" type="password" autocomplete="current-password" required>
      <div class="note" id="p-err" hidden style="color:var(--out)"></div>
      <div class="actions"><button class="btn" type="button" id="p-indietro">Annulla</button>
        <button class="btn primary" id="p-ok" type="submit">Ripristina</button></div>
    </form>`);
  $("p-indietro").onclick = avvio;
  $("p-form").onsubmit = async (ev) => {
    ev.preventDefault();
    errore(""); attesa(true, "Verifica…");
    try {
      const { oggetto, sessione: s } = await K.apri(testo, $("p-pw").value);
      if (!oggetto || oggetto.formato !== "finanze-dati") throw new Error("Contenuto del backup non riconosciuto.");
      const prec = await K.archivioLeggi();
      const rev = Math.max(oggetto.rev || 0, prec ? prec.rev || 0 : 0) + 1;
      oggetto.rev = rev;
      const rec = { testo: await K.cifra(s, oggetto), rev, salvato_il: new Date().toISOString() };
      // collegato a OneDrive: il backup diventa una modifica locale (senza base comune) da unire
      if (prec && prec.nuvola) rec.nuvola = { ...prec.nuvola, base: null, sporco: true };
      await K.archivioScrivi(rec);
      await entra(oggetto, s, rev);
      window.toast("Backup ripristinato");
    } catch (e) {
      errore(e instanceof K.PasswordErrata ? "Password errata." : (e.message || String(e)));
      attesa(false, "Ripristina");
    }
  };
}

async function avvio() {
  if (!window.crypto || !crypto.subtle || !window.indexedDB) {
    mostra(`<h2>Browser non adatto</h2><div class="note">Serve un browser recente aperto da un indirizzo https (o da localhost).</div>`);
    return;
  }
  const rit = await MS.gestisciRitorno();
  if (rit && rit.dopo) ss.set(K_DOPO, rit.dopo);
  let rec = null;
  try { rec = await K.archivioLeggi(); }
  catch (e) { mostra(`<h2>Memoria non disponibile</h2><div class="note">Il browser non consente di salvare dati (navigazione privata?). ${esc(e.message || e)}</div>`); return; }

  // primo avvio "Apri da OneDrive": si riprende dopo l'accesso Microsoft
  const dopo = ss.get(K_DOPO);
  if (!rec && (dopo === "apri-onedrive" || dopo === "apri-link")) {
    ss.set(K_DOPO, null);
    if (rit && !rit.ok) return schermataBenvenuto(rit);
    if (dopo === "apri-link") {
      const link = ss.get(K_LINK); ss.set(K_LINK, null);
      try { return schermataPasswordOnline(await N.daLink(link)); }
      catch (e) { return schermataApriOnline(e.message || String(e)); }
    }
    return schermataApriOnline();
  }
  if (!rec) return schermataBenvenuto(rit);

  // archivio collegato a OneDrive ma senza accesso in questa scheda: rientro "silenzioso" (una volta per scheda)
  if (rec.nuvola && !MS.collegato() && navigator.onLine && !rit && !ss.get(K_RIMBALZO)) {
    ss.set(K_RIMBALZO, "1");
    if (MS.utente()) return MS.accedi({ silenzioso: true });
  }
  schermataSblocco(rit);
}

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
avvio();
})();
