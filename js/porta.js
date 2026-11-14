/* Finanze personali – schermata di sblocco, primo avvio, salvataggio cifrato, blocco automatico. */
(function () {
"use strict";
const K = window.Cassaforte, A = window.FinApi;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MIN_PASSWORD = 10;

let sessione = null;     // {chiave, salt, iterazioni}: la password non viene conservata
let modello = null;
let revBase = null;      // revisione dell'archivio quando l'abbiamo letto/scritto
let coda = Promise.resolve();
let ultimaAttivita = Date.now();
let timerBlocco = null;

/* ---------------------------------------------------------------------------
   Salvataggio: cifra il modello e lo scrive nell'archivio locale (in serie).
   --------------------------------------------------------------------------- */
function salva() {
  const giro = coda.then(async () => {
    if (!sessione || !modello) return;
    const attuale = await K.archivioLeggi();
    if (attuale && revBase !== null && attuale.rev !== revBase) {
      // un'altra scheda/finestra ha salvato nel frattempo: non sovrascrivere
      try { sessionStorage.setItem("finanze_msg", "I dati erano stati modificati in un'altra finestra dell'app: questa è stata bloccata per non sovrascriverli e l'ultima modifica fatta qui non è stata salvata. Sblocca per vedere i dati aggiornati."); } catch (e) { /* */ }
      bloccaSubito();
      throw new Error("conflitto");
    }
    const testo = await K.cifra(sessione, modello);
    await K.archivioScrivi({ testo, rev: modello.rev, salvato_il: new Date().toISOString() });
    revBase = modello.rev;
  });
  coda = giro.catch(() => {});
  return giro;
}

async function entra(oggetto, sess, rev) {
  sessione = sess; modello = oggetto; revBase = rev;
  if (!modello.impostazioni) modello.impostazioni = {};
  if (A.migraModello(modello)) {          // archivio di una versione precedente (senza conti)
    modello.rev = (modello.rev || 0) + 1;
    await salva();
  }
  document.body.classList.remove("chiusa");
  $("porta").hidden = true;
  avviaControlloInattivita();
  await window.avviaInterfaccia(A.creaApi(modello, salva));
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
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
   Funzioni usate dalla sezione "Dati"
   --------------------------------------------------------------------------- */
function scaricaFile(nome, testo, tipo) {
  const url = URL.createObjectURL(new Blob([testo], { type: tipo }));
  const a = document.createElement("a");
  a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const oggiCompatto = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; };

window.Porta = {
  blocca,
  async scaricaBackup() {
    await coda;
    const testo = await K.cifra(sessione, modello);
    scaricaFile(`finanze_backup_${oggiCompatto()}.finanze`, testo, "application/octet-stream");
    window.toast("Backup cifrato scaricato");
  },
  async info() {
    const rec = await K.archivioLeggi();
    let persistente = false;
    try { persistente = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; } catch (e) { /* */ }
    return { salvato_il: rec && rec.salvato_il, byte: rec ? rec.testo.length : 0, minuti: minutiBlocco(), persistente };
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
  },
  async eliminaTutto() {
    await coda;
    await K.archivioCancella();
    bloccaSubito();
  },
};

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
  const primo = $("porta-box").querySelector("input[type=password]");
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

async function schermataSblocco() {
  let msg = "";
  try { msg = sessionStorage.getItem("finanze_msg") || ""; sessionStorage.removeItem("finanze_msg"); } catch (e) { /* */ }
  mostra(`${msg ? `<div class="box" style="border-color:rgba(255,176,138,.45)"><div class="note" style="color:var(--text)">${esc(msg)}</div></div>` : ""}
    <div class="brand" style="padding:0"><img src="icone/icona-64.png" alt="" width="40" height="40"> Finanze</div>
    <h2 style="font-size:24px">Sblocca</h2>
    <form id="p-form" class="field" autocomplete="on">
      <input type="text" name="username" value="Finanze personali" autocomplete="username" hidden>
      <label for="p-pw">Password</label>
      <input class="input" id="p-pw" type="password" autocomplete="current-password" required>
      <div class="note" id="p-err" hidden style="color:var(--out)"></div>
      <button class="btn primary" id="p-ok" type="submit" style="justify-content:center;margin-top:8px">Sblocca</button>
    </form>
    <div class="note">I dati sono cifrati su questo dispositivo. Lo sblocco richiede qualche secondo.</div>
    <button class="crumb" type="button" id="p-ripristina">Ripristina un backup…</button>`);
  $("p-form").onsubmit = async (ev) => {
    ev.preventDefault();
    errore(""); attesa(true, "Sblocco…");
    try {
      const rec = await K.archivioLeggi();
      const { oggetto, sessione: s } = await K.apri(rec.testo, $("p-pw").value);
      await entra(oggetto, s, rec.rev);
    } catch (e) {
      errore(e instanceof K.PasswordErrata ? "Password errata." : (e.message || String(e)));
      attesa(false, "Sblocca");
      $("p-pw").select();
    }
  };
  $("p-ripristina").onclick = () => schermataRipristino(true);
}

async function schermataBenvenuto() {
  mostra(`
    <div class="brand" style="padding:0"><img src="icone/icona-64.png" alt="" width="40" height="40"> Finanze</div>
    <h2 style="font-size:24px">Benvenuto</h2>
    <div class="note">Su questo dispositivo non ci sono ancora dati. Come vuoi iniziare?</div>
    <button class="btn primary" type="button" id="p-json" style="justify-content:center">Importa i dati dall'app desktop (.json)</button>
    <button class="btn" type="button" id="p-backup" style="justify-content:center">Ripristina un backup cifrato (.finanze)</button>
    <button class="btn" type="button" id="p-vuoto" style="justify-content:center">Inizia da zero</button>
    <div class="note">Il file .json si crea sul PC con <span style="font-family:var(--mono)">strumenti\\esporta_per_web.py</span> (vedi LEGGIMI).</div>`);
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

function schermataNuovaPassword(m, intro, fileJson) {
  mostra(`
    <h2 style="font-size:24px">Scegli la password</h2>
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
         Consiglio: vai in <b>Dati</b> e scarica subito un backup cifrato da tenere su una chiavetta.`);
    } catch (e) { errore(e.message || String(e)); attesa(false, "Cifra e apri"); }
  };
}

async function schermataRipristino(sostituisce) {
  const f = await scegliFile(".finanze,.txt,application/octet-stream");
  if (!f) return;
  const testo = await f.text();
  try { K.leggiIntestazione(testo); } catch (e) { window.alert(e.message || String(e)); return; }
  mostra(`
    <h2 style="font-size:24px">Ripristina backup</h2>
    <div class="note">File: <b>${esc(f.name)}</b>. Inserisci la password usata quando è stato fatto il backup.</div>
    ${sostituisce ? `<div class="box" style="border-color:rgba(255,176,138,.45)"><b>Attenzione</b><div class="note">I dati attuali su questo dispositivo verranno <b>sostituiti</b> da quelli del backup.</div></div>` : ""}
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
      const rev = (oggetto.rev || 0) + 1;
      oggetto.rev = rev;
      await K.archivioScrivi({ testo: await K.cifra(s, oggetto), rev, salvato_il: new Date().toISOString() });
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
  let rec = null;
  try { rec = await K.archivioLeggi(); }
  catch (e) { mostra(`<h2>Memoria non disponibile</h2><div class="note">Il browser non consente di salvare dati (navigazione privata?). ${esc(e.message || e)}</div>`); return; }
  if (rec) schermataSblocco(); else schermataBenvenuto();
}

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
avvio();
})();
