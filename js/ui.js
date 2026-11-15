"use strict";
const S = { view: "movimenti", mese: "", cat: "", cerca: "", conto: "", stato: null, righe: [], scelta: null,
  per: { preset: "anno", mese: "", trim: "", anno: "", da: "", a: "", grp: "mese" },
  dett: null, dettEs: "", lato: "uscite" };
const COLORI = ["#AEB9FF", "#7FF0D6", "#F7D08A", "#D3B4FF", "#8FD3FF", "#FF9FB0", "#C9CDD6", "#B6F09C"];
const NON_CAT = "(da categorizzare)";
const fmt = (n) => { const [i, d] = n.toFixed(2).split("."); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + d; };
const euro = (v, segno) => (segno ? (v > 0 ? "+" : v < 0 ? "−" : "") : (v < 0 ? "−" : "")) + fmt(Math.abs(v)) + " €";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dataIt = (d) => d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4);
const MESI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
const meseIt = (m) => m ? MESI[+m.slice(5, 7) - 1] + " " + m.slice(0, 4) : "Tutti i mesi";
const coloreCat = (c) => { let h = 0; for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORI[h % COLORI.length]; };
const $ = (id) => document.getElementById(id);
let api;   // impostata da porta.js dopo lo sblocco (FinApi.creaApi)

function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 3200);
}

async function aggiornaStato() {
  S.stato = await api.stato();
  if (S.mese && !S.stato.mesi.includes(S.mese)) S.mese = "";
  if (S.conto && !S.stato.conti.some((c) => c.id === S.conto)) S.conto = "";
  if (!S.mese && S.stato.mesi.length && S._primo !== false) { S.mese = S.stato.mesi[0]; S._primo = false; }
  const p = S.per, m = S.stato.mesi;
  if (m.length) {
    if (!m.includes(p.mese)) p.mese = m[0];
    if (!trimestri().includes(p.trim)) p.trim = trimestri()[0];
    if (!anni().includes(p.anno)) p.anno = anni()[0];
    if (!p.da) { p.da = m[m.length - 1] + "-01"; p.a = new Date().toISOString().slice(0, 10); }
  }
  const b = $("badge");
  b.hidden = !S.stato.da_categorizzare; b.textContent = S.stato.da_categorizzare;
  if (typeof aggiornaBadgeAffitti === "function") await aggiornaBadgeAffitti();
}

const piuConti = () => S.stato.conti.length > 1;
const nomeContoSel = () => { const c = S.stato.conti.find((k) => k.id === S.conto); return c ? c.nome : (piuConti() ? "Tutti i conti" : S.stato.conti[0].nome); };

/* Scelta del conto (compare solo quando ce n'è più di uno). */
function campoConto(id) {
  if (!piuConti()) return "";
  return `<div class="field"><label for="${id}">Conto</label><select class="input" id="${id}" style="min-width:170px">
    <option value="">Tutti i conti</option>${S.stato.conti.map((c) => `<option value="${esc(c.id)}" ${c.id === S.conto ? "selected" : ""}>${esc(c.nome)}</option>`).join("")}</select></div>`;
}
function collegaConto(id) { if ($(id)) $(id).onchange = (e) => { S.conto = e.target.value; render(); }; }

function opzioniMese() {
  return `<option value="">Tutti i mesi</option>` + S.stato.mesi.map((m) => `<option value="${m}" ${m === S.mese ? "selected" : ""}>${meseIt(m)}</option>`).join("");
}

async function render() {
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("on", b.dataset.view === S.view));
  if (S.view === "movimenti") return renderMovimenti();
  if (S.view === "riepilogo") return renderRiepilogo();
  if (S.view === "conti") return renderConti();
  if (S.view === "affitti") return renderAffitti();
  if (S.view === "contratti") return renderContratti();
  if (S.view === "immobili") return renderImmobili();
  if (S.view === "insoluti") return renderInsoluti();
  if (S.view === "assicurazioni") return renderAssicurazioni();
  if (S.view === "scadenze") return renderScadenze();
  if (S.view === "dati") return renderDati();
  return renderRegole();
}

/* ---------- Movimenti ---------- */
async function renderMovimenti() {
  const r = await api.movimenti(S.mese, S.cat, S.cerca, S.conto);
  S.righe = r.righe;
  const main = $("main");
  const cats = S.stato.categorie;
  const focus = document.activeElement && document.activeElement.id === "f-cerca";
  main.innerHTML = `
    <div class="head">
      <div><div class="sub">${esc(nomeContoSel())} · ${esc(meseIt(S.mese))}</div><h1>Movimenti</h1></div>
      <button class="btn primary" type="button" id="btn-importa">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
        Importa estratto conto</button>
    </div>
    <div class="kpis">
      <div class="kpi glass"><div class="sub">Entrate</div><div class="v" style="color:var(--in)">${euro(r.entrate, true)}</div></div>
      <div class="kpi glass"><div class="sub">Uscite</div><div class="v" style="color:var(--out)">${euro(r.uscite, true)}</div></div>
      <div class="kpi glass"><div class="sub">Saldo</div><div class="v">${euro(r.entrate + r.uscite, true)}</div></div>
      <div class="kpi glass"><div class="sub">Da categorizzare</div><div class="v" style="color:var(--accent)">${r.da_categorizzare}</div></div>
    </div>
    <div class="filters compatti">
      ${campoConto("f-conto")}
      <div class="field"><label for="f-mese">Mese</label><select class="input" id="f-mese" style="min-width:180px">${opzioniMese()}</select></div>
      <div class="field"><label for="f-cat">Categoria</label><select class="input" id="f-cat" style="min-width:200px">
        <option value="">Tutte le categorie</option><option value="${NON_CAT}" ${S.cat === NON_CAT ? "selected" : ""}>Da categorizzare</option>
        ${cats.map((c) => `<option ${c === S.cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
      <div class="field" style="flex:1 1 240px"><label for="f-cerca">Cerca</label><input class="input" id="f-cerca" type="search" placeholder="Esselunga, Iren, bonifico…" value="${esc(S.cerca)}"></div>
      ${r.suggerimenti ? `<button class="btn" type="button" id="btn-sugg" style="border-color:rgba(110,240,200,.5)">Accetta ${r.suggerimenti} suggerimenti</button>` : ""}
    </div>
    <div class="panel glass">
      ${r.righe.length ? `<table class="lista">
        <thead><tr><th>Data</th><th>Descrizione</th><th>Categoria</th><th style="text-align:right">Importo</th></tr></thead>
        <tbody>${r.righe.map(rigaHtml).join("")}</tbody></table>`
      : `<div class="empty">${S.stato.mesi.length ? "Nessun movimento con questi filtri." : "Nessun movimento ancora.<br>Scarica la lista movimenti in Excel dal sito BNL e premi <b>Importa estratto conto</b>."}</div>`}
    </div>
    <div class="note">Clic su un movimento per cambiarne la categoria. I suggerimenti (bordo verde) vengono dai movimenti che hai già categorizzato.
      ${r.giroconti ? `<br>${r.giroconti} ${r.giroconti === 1 ? "giroconto" : "giroconti"} (ricariche tra conto e carta, ⇄) ${r.giroconti === 1 ? "è elencato" : "sono elencati"} ma non ${r.giroconti === 1 ? "conta" : "contano"} in entrate e uscite.` : ""}</div>`;
  collegaConto("f-conto");
  $("btn-importa").onclick = importa;
  $("f-mese").onchange = (e) => { S.mese = e.target.value; render(); };
  $("f-cat").onchange = (e) => { S.cat = e.target.value; render(); };
  const fc = $("f-cerca");
  fc.oninput = (e) => { S.cerca = e.target.value; clearTimeout(S._t); S._t = setTimeout(render, 250); };
  if (focus) { fc.focus(); fc.setSelectionRange(fc.value.length, fc.value.length); }
  if ($("btn-sugg")) $("btn-sugg").onclick = async () => { const x = await api.accetta_suggerimenti(null); toast(`Categorizzati ${x.applicati} movimenti`); await aggiornaStato(); render(); };
  main.querySelectorAll("tbody tr").forEach((tr) => tr.onclick = (ev) => {
    const id = +tr.dataset.id;
    if (ev.target.closest(".ok-btn")) { accettaUno(id); return; }
    apriCategoria(id);
  });
}

function rigaHtml(m) {
  let cat;
  if (m.categoria) cat = `<span class="chip"><span class="dot" style="background:${coloreCat(m.categoria)}"></span>${esc(m.categoria)}</span>`;
  else if (m.suggerita) cat = `<span class="sugg"><span class="chip">${esc(m.suggerita)}?</span><button class="ok-btn" type="button" aria-label="Conferma ${esc(m.suggerita)}">✓ Ok</button></span>`;
  else cat = `<span class="chip todo">+ Assegna categoria</span>`;
  const giro = m.categoria === "Giroconto";
  const extra = [];
  if (piuConti() && !S.conto && m.conto_nome) extra.push(esc(m.conto_nome));
  if (m.abbinato) extra.push(`⇄ ${esc(m.abbinato.conto_nome)} del ${dataIt(m.abbinato.data)}`);
  const sotto = extra.length ? `<div class="note" style="margin-top:3px">${extra.join(" · ")}</div>` : "";
  const colore = giro ? "var(--muted)" : m.importo < 0 ? "var(--out)" : "var(--in)";
  return `<tr data-id="${m.id}"><td class="date">${dataIt(m.data)}</td><td>${esc(m.descrizione)}${sotto}</td><td>${cat}</td>
    <td class="num" style="color:${colore}" ${giro ? `title="Giroconto: non conta in entrate e uscite"` : ""}>${giro ? "⇄ " : ""}${euro(m.importo, true)}</td></tr>`;
}

async function accettaUno(id) {
  await api.accetta_suggerimenti([id]);
  await aggiornaStato(); render();
}

function parolaSuggerita(desc) {
  const gen = new Set(["PAGAMENTO", "POS", "CARTA", "DEL", "ORE", "PRESSO", "BONIFICO", "FAVORE", "OPERAZIONE", "ADDEBITO", "SDD", "DEBIT", "EUR", "SPA", "SRL", "ACQUISTO", "CONTACTLESS"]);
  return desc.toUpperCase().split(/\s+/).filter((w) => w.length > 2 && !/\d/.test(w) && !gen.has(w)).slice(0, 2).join(" ");
}

function apriCategoria(id) {
  const m = S.righe.find((x) => x.id === id);
  if (!m) return;
  S.scelta = m.categoria || m.suggerita || null;
  const cats = S.stato.categorie;
  const modal = $("modal");
  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center"><h2 id="m-title" style="font-size:22px">Assegna categoria</h2>
      <button class="icon-btn" type="button" id="m-close" aria-label="Chiudi"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
    <div class="mov-box"><div><div style="font-weight:500">${esc(m.descrizione)}</div><div class="date" style="margin-top:4px">${dataIt(m.data)}</div></div>
      <div class="num" style="color:${m.importo < 0 ? "var(--out)" : "var(--in)"}">${euro(m.importo, true)}</div></div>
    <div class="field"><label>Categoria</label><div class="chips" id="m-chips">${cats.map((c) => `<button type="button" class="pick ${c === S.scelta ? "on" : ""}" data-c="${esc(c)}">${esc(c)}</button>`).join("")}</div></div>
    <div class="field"><label for="m-nuova">Oppure una nuova categoria</label><input class="input" id="m-nuova" placeholder="es. Palestra"></div>
    <div class="box">
      <label class="check"><input type="checkbox" id="m-regola" checked> Crea una regola per i prossimi movimenti</label>
      <label for="m-parola" class="note">Quando la descrizione contiene</label>
      <input class="input" id="m-parola" value="${esc(parolaSuggerita(m.descrizione))}" style="background:rgba(0,0,0,.35)">
      <div class="note">Lascia solo la parte che si ripete, di solito il nome del negozio.</div>
    </div>
    <div class="actions"><button class="btn" type="button" id="m-annulla">Annulla</button><button class="btn primary" type="button" id="m-salva">Salva</button></div>`;
  modal.setAttribute("aria-labelledby", "m-title");
  $("modal-bg").classList.add("open");
  modal.querySelectorAll(".pick").forEach((b) => b.onclick = () => {
    S.scelta = b.dataset.c; $("m-nuova").value = "";
    modal.querySelectorAll(".pick").forEach((x) => x.classList.toggle("on", x === b));
  });
  $("m-nuova").oninput = () => modal.querySelectorAll(".pick").forEach((x) => x.classList.remove("on"));
  $("m-close").onclick = $("m-annulla").onclick = chiudiModal;
  $("m-salva").onclick = async () => {
    const cat = $("m-nuova").value.trim() || S.scelta;
    if (!cat) { toast("Scegli una categoria"); return; }
    const parola = $("m-regola").checked ? $("m-parola").value.trim() : "";
    const r = await api.imposta_categoria(id, cat, parola);
    chiudiModal();
    toast(r.altri ? `Salvato. La regola ha categorizzato altri ${r.altri} movimenti` : "Salvato");
    await aggiornaStato(); render();
  };
}

function chiudiModal() { $("modal-bg").classList.remove("open"); $("modal").classList.remove("larga"); }
$("modal-bg").addEventListener("click", (e) => { if (e.target.id === "modal-bg") chiudiModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") chiudiModal(); });

/* Il pulsante apre la scelta file del browser (funziona anche da telefono). */
function importa() {
  const inp = $("file-estratto");
  inp.value = "";
  inp.onchange = async () => {
    const files = [...inp.files];
    if (!files.length) return;
    toast("Lettura in corso…");
    try { await importaFile(files); } catch (e) { toast("Errore: " + (e.message || e)); }
  };
  inp.click();
}

/* Estratto di una carta senza numero: lo chiede all'utente (ultime 4 cifre). */
function chiediCarta(nomeFile) {
  return new Promise((ok) => {
    const modal = $("modal");
    modal.innerHTML = `
      <h2 id="m-title" style="font-size:22px">Di quale carta è questo estratto?</h2>
      <div class="note">Il file <b>${esc(nomeFile)}</b> sembra l'estratto di una carta prepagata, ma non riporta il numero.
        Scrivi le <b>ultime 4 cifre</b> della carta: servono per tenerne separati i movimenti e abbinare le ricariche dal conto.</div>
      <div class="field"><label for="m-carta">Ultime 4 cifre</label><input class="input" id="m-carta" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="es. 1234"></div>
      <div class="actions"><button class="btn" type="button" id="m-salta">Non importare</button><button class="btn primary" type="button" id="m-ok">Importa</button></div>`;
    modal.setAttribute("aria-labelledby", "m-title");
    $("modal-bg").classList.add("open");
    $("m-carta").focus();
    const fine = (v) => { chiudiModal(); ok(v); };
    $("m-salta").onclick = () => fine(null);
    $("m-ok").onclick = () => {
      const v = $("m-carta").value.replace(/\D/g, "");
      if (v.length !== 4) { toast("Servono 4 cifre"); return; }
      fine(v);
    };
  });
}

async function importaFile(files) {
  const r = await api.importa(files, chiediCarta);
  if (r.annullato) return;
  await aggiornaStato();
  if (r.nuovi && S.stato.mesi.length) S.mese = S.stato.mesi[0];
  render();
  const modal = $("modal");
  const prop = r.nuovi && api.affitti_proposte ? (await api.affitti_proposte()).length : 0;
  const perFile = r.dettagli.length > 1 || r.dettagli.some((d) => d.conto !== "Conto BNL");
  modal.innerHTML = `
    <h2 id="m-title" style="font-size:22px">Importazione completata</h2>
    <div class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))">
      <div class="kpi glass"><div class="sub">Movimenti nuovi</div><div class="v" style="color:var(--in)">${r.nuovi}</div></div>
      <div class="kpi glass"><div class="sub">Già presenti</div><div class="v">${r.doppi}</div></div>
    </div>
    ${perFile ? `<div class="box">${r.dettagli.map((d) => `<div class="row"><span>${esc(d.conto)}</span><span class="date">${d.nuovi} nuovi · ${d.doppi} già presenti${d.spostati ? ` · ${d.spostati} spostati` : ""}</span></div>`).join("")}</div>` : ""}
    ${r.spostati ? `<div class="box"><b>${r.spostati} movimenti spostati dal Conto BNL alla carta</b><div class="note">Questo estratto era già stato importato nell'app del PC come se fosse del Conto BNL. Ora quei movimenti stanno nel conto della carta, con la data dell'acquisto e senza doppioni. Le categorie che avevi assegnato restano.</div></div>` : ""}
    ${r.conti_nuovi.length ? `<div class="box"><b>Nuovo conto: ${r.conti_nuovi.map(esc).join(", ")}</b><div class="note">I suoi movimenti sono separati da quelli del conto. Puoi vederli da soli con il filtro <b>Conto</b>.</div></div>` : ""}
    ${r.pendenti ? `<div class="box"><b>${r.pendenti} ${r.pendenti === 1 ? "movimento in attesa" : "movimenti in attesa"}</b><div class="note">Non ${r.pendenti === 1 ? "è" : "sono"} ancora ${r.pendenti === 1 ? "contabilizzato" : "contabilizzati"} dalla banca: ${r.pendenti === 1 ? "verrà importato" : "verranno importati"} la prossima volta, senza doppioni.</div></div>` : ""}
    ${r.abbinati ? `<div class="box"><b>${r.abbinati} ${r.abbinati === 1 ? "ricarica abbinata" : "ricariche abbinate"} tra conto e carta</b><div class="note">Sono diventate <b>Giroconto</b>: spostano soldi tra i tuoi conti, quindi non contano più come uscite. Contano invece i singoli acquisti fatti con la carta.</div></div>` : ""}
    ${r.ricariche_aperte ? `<div class="box" style="border-color:rgba(255,176,138,.45)"><b>${r.ricariche_aperte} ${r.ricariche_aperte === 1 ? "ricarica" : "ricariche"} dal conto senza abbinamento</b><div class="note">Non ho trovato sulla carta una ricarica con lo stesso importo entro 3 giorni. Restano tra le uscite in «Prepagata (non dettagliata)»: cercale in Movimenti con «Carta Numero».</div></div>` : ""}
    ${r.errori.length ? `<div class="box" style="border-color:rgba(255,176,138,.45)"><b>File non letti</b>${r.errori.map((e) => `<div class="note">${esc(e)}</div>`).join("")}
      <div class="note">Se è un file BNL, manda a Claude l'intestazione delle colonne (con i dati oscurati).</div></div>` : ""}
    ${prop ? `<div class="box" style="border-color:rgba(110,240,200,.45)"><b>${prop} ${prop === 1 ? "bonifico sembra un affitto" : "bonifici sembrano affitti"}</b><div class="note">Confermali nella sezione <b>Affitti</b>: un clic e il pagamento è registrato sul mese giusto.</div></div>` : ""}
    ${r.file.length ? `<div class="box"><b>Ricordati di eliminare i file scaricati</b><div class="note">Contengono i tuoi movimenti in chiaro e ora sono già nell'archivio cifrato.
      Il browser non può cancellarli da solo: eliminali dalla cartella Download (e svuota il cestino).<br>${r.file.map(esc).join("<br>")}</div></div>` : ""}
    <div class="actions"><button class="btn primary" type="button" id="m-tieni">Ok</button></div>`;
  $("modal-bg").classList.add("open");
  $("m-tieni").onclick = chiudiModal;
}

/* ---------- Periodi ---------- */
const pad = (n) => String(n).padStart(2, "0");
const fineMese = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const uniq = (a) => [...new Set(a)];
const anni = () => uniq(S.stato.mesi.map((m) => m.slice(0, 4)));
const trimestri = () => uniq(S.stato.mesi.map((m) => `${m.slice(0, 4)}-T${Math.floor((+m.slice(5, 7) + 2) / 3)}`));
const PRESET = [["mese", "Mese"], ["trimestre", "Trimestre"], ["anno", "Anno"], ["12mesi", "Ultimi 12 mesi"], ["tutto", "Tutto"], ["custom", "Personalizzato"]];
const GRP = [["mese", "Mesi"], ["trimestre", "Trimestri"], ["anno", "Anni"]];
const GRP_SING = { mese: "mese", trimestre: "trimestre", anno: "anno" };

function intervallo() {
  const p = S.per;
  if (p.preset === "mese") { const [y, m] = p.mese.split("-").map(Number); return [`${p.mese}-01`, `${p.mese}-${pad(fineMese(y, m))}`]; }
  if (p.preset === "trimestre") {
    const y = +p.trim.slice(0, 4), m1 = (+p.trim.slice(-1) - 1) * 3 + 1;
    return [`${y}-${pad(m1)}-01`, `${y}-${pad(m1 + 2)}-${pad(fineMese(y, m1 + 2))}`];
  }
  if (p.preset === "anno") return [`${p.anno}-01-01`, `${p.anno}-12-31`];
  if (p.preset === "12mesi") {
    const ult = S.stato.mesi[0], y = +ult.slice(0, 4), m = +ult.slice(5, 7), t = y * 12 + m - 1 - 11;
    return [`${Math.floor(t / 12)}-${pad(t % 12 + 1)}-01`, `${ult}-${pad(fineMese(y, m))}`];
  }
  if (p.preset === "custom" && p.da && p.a) return p.da <= p.a ? [p.da, p.a] : [p.a, p.da];
  return ["", ""];
}

function etichetta(k, lunga) {
  if (k.length === 4) return lunga ? "Anno " + k : k;
  if (k.includes("T")) return lunga ? `${k.slice(-1)}° trimestre ${k.slice(0, 4)}` : `T${k.slice(-1)} ${k.slice(2, 4)}`;
  return lunga ? meseIt(k) : `${MESI[+k.slice(5, 7) - 1].slice(0, 3)} ${k.slice(2, 4)}`;
}

/* Descrive un intervallo di date: "2025", "T3 2025", "Ott 25" oppure le date. */
function descriviIntervallo(da, a) {
  const y1 = +da.slice(0, 4), m1 = +da.slice(5, 7), y2 = +a.slice(0, 4), m2 = +a.slice(5, 7);
  const interi = da.slice(8) === "01" && +a.slice(8) === fineMese(y2, m2);
  if (interi) {
    const n = (y2 - y1) * 12 + m2 - m1 + 1;
    if (n === 12 && m1 === 1) return String(y1);
    if (n === 3 && m1 % 3 === 1) return etichetta(`${y1}-T${(m1 + 2) / 3}`);
    if (n === 1) return etichetta(da.slice(0, 7));
    return etichetta(da.slice(0, 7)) + " – " + etichetta(a.slice(0, 7));
  }
  return dataIt(da) + " – " + dataIt(a);
}

function titoloPeriodo() {
  const p = S.per;
  if (p.preset === "mese") return meseIt(p.mese);
  if (p.preset === "trimestre") return etichetta(p.trim, true);
  if (p.preset === "anno") return "Anno " + p.anno;
  if (p.preset === "12mesi") return "Ultimi 12 mesi";
  if (p.preset === "tutto") return "Tutto lo storico";
  const [da, a] = intervallo();
  return da ? dataIt(da) + " – " + dataIt(a) : "Periodo personalizzato";
}

function grpPredefinito(preset) {
  if (preset === "tutto") return S.stato.mesi.length > 24 ? "trimestre" : "mese";
  if (preset === "custom") return S.per.grp;
  return "mese";
}

/* Porta il periodo su un mese/trimestre/anno del grafico o della tabella. */
function zoomPeriodo(k) {
  const p = S.per;
  if (k.length === 4) { if (!anni().includes(k)) return false; p.preset = "anno"; p.anno = k; }
  else if (k.includes("T")) { if (!trimestri().includes(k)) return false; p.preset = "trimestre"; p.trim = k; }
  else { if (!S.stato.mesi.includes(k)) return false; p.preset = "mese"; p.mese = k; }
  p.grp = "mese";
  return true;
}

function barraPeriodo(senzaRaggruppa) {
  const p = S.per;
  const lista = { mese: S.stato.mesi, trimestre: trimestri(), anno: anni() }[p.preset];
  const val = { mese: p.mese, trimestre: p.trim, anno: p.anno }[p.preset];
  const i = lista ? lista.indexOf(val) : -1;
  let scelta = "";
  if (lista) scelta = `
    <button class="freccia" type="button" data-sposta="1" ${i >= lista.length - 1 ? "disabled" : ""} aria-label="Periodo precedente">‹</button>
    <select class="input" id="p-val" style="min-width:170px">${lista.map((k) => `<option value="${k}" ${k === val ? "selected" : ""}>${etichetta(k, true)}</option>`).join("")}</select>
    <button class="freccia" type="button" data-sposta="-1" ${i <= 0 ? "disabled" : ""} aria-label="Periodo successivo">›</button>`;
  if (p.preset === "custom") scelta = `
    <input class="input" type="date" id="p-da" value="${p.da}" aria-label="Dal"> <span class="note">→</span>
    <input class="input" type="date" id="p-a" value="${p.a}" aria-label="Al">`;
  return `<div class="periodo glass">
    <div class="seg" role="group" aria-label="Periodo">${PRESET.map(([k, t]) => `<button type="button" data-preset="${k}" class="${p.preset === k ? "on" : ""}">${t}</button>`).join("")}</div>
    <div style="display:flex;align-items:center;gap:8px">${scelta}</div>
    ${senzaRaggruppa ? "" : `<div style="display:flex;align-items:center;gap:8px;margin-left:auto"><span class="note">Raggruppa per</span>
      <div class="seg" role="group" aria-label="Raggruppa per">${GRP.map(([k, t]) => `<button type="button" data-grp="${k}" class="${p.grp === k ? "on" : ""}">${t}</button>`).join("")}</div></div>`}
  </div>`;
}

function collegaBarraPeriodo() {
  const p = S.per, main = $("main");
  main.querySelectorAll("[data-preset]").forEach((b) => b.onclick = () => { p.preset = b.dataset.preset; p.grp = grpPredefinito(p.preset); render(); });
  main.querySelectorAll("[data-grp]").forEach((b) => b.onclick = () => { p.grp = b.dataset.grp; render(); });
  const chiave = { mese: "mese", trimestre: "trim", anno: "anno" }[p.preset];
  if ($("p-val")) $("p-val").onchange = (e) => { p[chiave] = e.target.value; render(); };
  main.querySelectorAll("[data-sposta]").forEach((b) => b.onclick = () => {
    const sel = $("p-val"); sel.selectedIndex += +b.dataset.sposta; p[chiave] = sel.value; render();
  });
  if ($("p-da")) {
    $("p-da").onchange = (e) => { p.da = e.target.value; render(); };
    $("p-a").onchange = (e) => { p.a = e.target.value; render(); };
  }
}

/* Variazione rispetto a un periodo di confronto. meglio = +1 se crescere è positivo, -1 se è negativo. */
function deltaRiga(cur, prev, conf, meglio) {
  if (!conf || !conf.ok) return "";
  const lab = descriviIntervallo(conf.da, conf.a);
  if (Math.abs(prev) < 0.005) return `<span>— vs ${esc(lab)}</span>`;
  const d = cur - prev, pct = d / Math.abs(prev) * 100;
  const colore = Math.abs(pct) < 0.5 ? "var(--muted)" : (d * meglio > 0 ? "var(--in)" : "var(--out)");
  return `<span style="color:${colore}" title="${euro(d, true)}">${d >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1).replace(".", ",")}% <span style="color:var(--muted)">vs ${esc(lab)}</span></span>`;
}

function deltas(cur, chiave, conf, meglio) {
  if (!conf) return "";
  const righe = ["prec", "anno"].filter((t) => conf[t].ok && !(t === "anno" && conf.anno.da === conf.prec.da))
    .map((t) => deltaRiga(cur, chiave(conf[t]), conf[t], meglio)).join("");
  return righe ? `<div class="delta">${righe}</div>` : "";
}

function grafico(serie, cliccabile) {
  if (!serie.length) return `<div class="empty">Ancora nessun dato.</div>`;
  const max = Math.max(1, ...serie.map((s) => Math.max(s.entrate, -s.uscite)));
  // le colonne si stringono per stare nello schermo; si scorre solo con moltissimi periodi
  const cols = `repeat(${serie.length},minmax(0,1fr))`;
  const h = (v) => v ? Math.max(2, Math.round(v / max * 180)) : 0;
  const stessoAnno = new Set(serie.map((s) => s.periodo.slice(0, 4))).size === 1;
  const lab = (k) => {
    if (k.length === 7 && !k.includes("T")) {          // mese: "Gen" (se tutti dello stesso anno) o "Gen 25"; sul telefono "G"
      const m = MESI[+k.slice(5, 7) - 1];
      const corto = serie.length > 7 ? m[0] : m.slice(0, 3);
      const anno = !stessoAnno && (k.slice(5, 7) === "01" || k === serie[0].periodo) ? `<br>’${k.slice(2, 4)}` : "";
      return `<span class="lab-l">${stessoAnno ? m.slice(0, 3) : etichetta(k)}</span><span class="lab-s">${corto}${anno}</span>`;
    }
    if (k.includes("T")) return `<span class="lab-l">${etichetta(k)}</span><span class="lab-s">${stessoAnno ? "T" + k.slice(-1) : etichetta(k).replace(" ", "<br>")}</span>`;
    return `<span class="lab-l">${k}</span><span class="lab-s">${serie.length > 6 ? "’" + k.slice(2) : k}</span>`;
  };
  return `<div class="chart-wrap"><div style="min-width:${serie.length * 12}px">
    <div class="chart" style="grid-template-columns:${cols}">
      ${serie.map((s) => `<div class="col ${cliccabile ? "zoom" : ""}" data-k="${s.periodo}" title="${etichetta(s.periodo, true)}&#10;Entrate ${euro(s.entrate)}&#10;Uscite ${euro(s.uscite)}${cliccabile ? "&#10;Clic per aprire il periodo" : ""}">
        ${s.entrate ? `<div style="background:var(--in);box-shadow:0 0 14px rgba(110,240,200,.35);height:${h(s.entrate)}px"></div>` : ""}
        ${s.uscite ? `<div style="background:var(--out);box-shadow:0 0 14px rgba(255,176,138,.35);height:${h(-s.uscite)}px"></div>` : ""}</div>`).join("")}
    </div>
    <div class="chart-lab" style="grid-template-columns:${cols}">
      ${serie.map((s) => `<div class="note">${lab(s.periodo)}</div>`).join("")}</div>
  </div></div>`;
}

const legenda = `<div class="legend"><span><i class="sq" style="background:var(--in)"></i>Entrate</span><span><i class="sq" style="background:var(--out)"></i>Uscite</span></div>`;
const pct = (v) => (v * 100).toFixed(1).replace(".", ",") + "%";
const intero = (v) => fmt(Math.round(Math.abs(v))).slice(0, -3);

/* ---------- Riepilogo ---------- */
async function renderRiepilogo() {
  if (!S.stato.mesi.length) {
    $("main").innerHTML = `<div class="head"><div><div class="sub">Dove sono finiti i soldi</div><h1>Riepilogo</h1></div></div><div class="empty glass" style="border-radius:20px">Ancora nessun dato. Importa un estratto conto da Movimenti.</div>`;
    return;
  }
  if (S.dett !== null) return renderDettaglio();
  const [da, a] = intervallo();
  const r = await api.analisi(da, a, S.per.grp, S.conto);
  const c = r.confronti;
  const maxCat = Math.max(1, ...r.categorie.map((x) => Math.abs(x.totale)));
  const totUsc = Math.abs(r.uscite) || 1;
  const risp = r.entrate + r.uscite;
  const confCat = c && (c.anno.ok ? c.anno : c.prec.ok ? c.prec : null);
  $("main").innerHTML = `
    <div class="head">
      <div><div class="sub">Dove sono finiti i soldi${piuConti() ? ` · ${esc(nomeContoSel())}, giroconti esclusi` : ""}${a && r.a < a ? ` · periodo in corso, dati fino al ${dataIt(r.a)}` : ""}</div><h1>${esc(titoloPeriodo())}</h1></div>
      ${campoConto("r-conto")}
    </div>
    ${barraPeriodo()}
    <div class="kpis">
      <div class="kpi glass"><div class="sub">Entrate</div><div class="v" style="color:var(--in)">${euro(r.entrate, true)}</div>${deltas(r.entrate, (x) => x.entrate, c, 1)}</div>
      <div class="kpi glass"><div class="sub">Uscite</div><div class="v" style="color:var(--out)">${euro(r.uscite, true)}</div>${deltas(-r.uscite, (x) => -x.uscite, c, -1)}</div>
      <div class="kpi glass"><div class="sub">Risparmio</div><div class="v">${euro(risp, true)}</div>${deltas(risp, (x) => x.entrate + x.uscite, c, 1)}</div>
      <div class="kpi glass"><div class="sub">Tasso di risparmio</div><div class="v">${r.entrate > 0 ? pct(risp / r.entrate) : "—"}</div>
        <div class="delta"><span>${r.n} movimenti</span></div></div>
    </div>
    <div class="cards">
      <section class="card glass">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline"><h2>Uscite per categoria</h2><span class="note">Clic per l'esploso</span></div>
        <div style="display:flex;flex-direction:column;gap:2px">
        ${r.categorie.length ? r.categorie.map((x) => {
          const prev = confCat ? (confCat.categorie[x.categoria] || 0) : null;
          return `<button type="button" class="cat-row" data-cat="${esc(x.categoria)}">
            <div class="row" style="width:100%"><span>${esc(x.categoria)} <span class="note">· ${x.n}</span></span>
              <span class="date" style="font-size:12px">${euro(x.totale)} · ${(Math.abs(x.totale) / totUsc * 100).toFixed(1).replace(".", ",")}%</span></div>
            <div class="bar" style="width:100%"><div style="width:${(Math.abs(x.totale) / maxCat * 100).toFixed(1)}%;${x.categoria === NON_CAT ? "background:#5C616C;box-shadow:none" : ""}"></div></div>
            ${prev !== null ? `<div class="delta" style="margin-top:0">${deltaRiga(-x.totale, -prev, confCat, -1)}</div>` : ""}
          </button>`; }).join("") : `<div class="empty">Nessuna uscita in questo periodo.</div>`}
        </div>
      </section>
      <section class="card glass">
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px"><h2>Andamento per ${GRP_SING[r.grp]}</h2>${legenda}</div>
        ${grafico(r.serie, true)}
        <div style="overflow-x:auto"><table class="andamento" style="min-width:0;font-size:13px">
          <thead><tr><th style="padding:8px 0">Periodo</th><th style="padding:8px 0;text-align:right">Entrate</th><th style="padding:8px 0;text-align:right">Uscite</th><th style="padding:8px 0;text-align:right">Risparmio</th><th style="padding:8px 0;text-align:right">Tasso</th></tr></thead>
          <tbody>${r.serie.slice().reverse().map((s) => `<tr class="zoom-row" data-k="${s.periodo}"><td style="padding:9px 0">${etichetta(s.periodo, true)}</td>
            <td class="num" style="padding:9px 0;color:var(--in);font-size:12px">${euro(s.entrate, true)}</td>
            <td class="num" style="padding:9px 0;color:var(--out);font-size:12px">${euro(s.uscite, true)}</td>
            <td class="num" style="padding:9px 0;font-size:12px">${euro(s.entrate + s.uscite, true)}</td>
            <td class="num" style="padding:9px 0;font-size:12px;color:var(--muted)">${s.entrate > 0 ? pct((s.entrate + s.uscite) / s.entrate) : "—"}</td></tr>`).join("")}</tbody></table></div>
      </section>
      ${tabellaCategorie(r)}
    </div>`;
  collegaBarraPeriodo();
  collegaConto("r-conto");
  const main = $("main");
  main.querySelectorAll("[data-cat]").forEach((b) => b.onclick = () => apriDettaglio(b.dataset.cat));
  main.querySelectorAll(".col.zoom, .zoom-row").forEach((el) => el.onclick = () => { if (zoomPeriodo(el.dataset.k)) render(); });
  main.querySelectorAll("[data-lato]").forEach((b) => b.onclick = () => { S.lato = b.dataset.lato; render(); });
  main.querySelectorAll("td.c").forEach((td) => td.onclick = () => {
    zoomPeriodo(td.dataset.k); apriDettaglio(td.closest("tr").dataset.riga);
  });
}

/* ---------- Conti ---------- */
function schedaConto(c, totale) {
  const riga = (t, v, stile = "") => `<div class="row"><span class="note">${t}</span><span class="num" style="${stile}">${v}</span></div>`;
  const tipo = totale ? `${S.stato.conti.length} conti` : c.tipo === "prepagata" ? "Carta prepagata" : "Conto corrente";
  const saldo = totale || c.saldo_valido
    ? `<div class="v">${euro(c.saldo, true)}</div><div class="note">${totale ? "somma dei saldi" : `dal ${dataIt(c.dal)}`}</div>`
    : `<div class="v" style="color:var(--muted)">—</div><div class="note">${c.dal ? `movimenti solo dal ${dataIt(c.dal)}` : "nessun movimento"}</div>`;
  const giro = Math.abs(c.giroconti) >= 0.005
    ? riga("Giroconti ⇄", euro(c.giroconti, true), "color:var(--muted)") : "";
  return `<button type="button" class="conto-card glass ${totale ? "totale" : ""}" data-conto="${totale ? "" : esc(c.id)}"
      title="${totale ? "Apri i movimenti di tutti i conti" : `Apri i movimenti di ${esc(c.nome)}`}">
    <div class="row" style="align-items:baseline"><h2>${esc(totale ? "Totale" : c.nome)}</h2><span class="note">${tipo}</span></div>
    <div><div class="sub">Saldo${S.per.preset === "tutto" ? "" : " a fine periodo"}</div>${saldo}</div>
    <div class="conto-righe">
      ${riga("Entrate", euro(c.entrate, true), "color:var(--in)")}
      ${riga("Uscite", euro(c.uscite, true), "color:var(--out)")}
      ${giro}
      ${riga("Movimenti nel periodo", c.n)}
      ${riga("Ultimo movimento", c.ultimo ? dataIt(c.ultimo) : "—")}
    </div>
  </button>`;
}

async function renderConti() {
  if (!S.stato.mesi.length) {
    $("main").innerHTML = `<div class="head"><div><div class="sub">Saldo ed entrate/uscite di ogni conto</div><h1>Conti</h1></div></div><div class="empty glass" style="border-radius:20px">Ancora nessun dato. Importa un estratto conto da Movimenti.</div>`;
    return;
  }
  const [da, a] = intervallo();
  const r = await api.situazione_conti(da, a);
  const piu = r.conti.length > 1;
  $("main").innerHTML = `
    <div class="head"><div><div class="sub">Saldo ed entrate/uscite di ogni conto</div><h1>${esc(titoloPeriodo())}</h1></div></div>
    ${barraPeriodo(true)}
    <div class="conti">
      ${r.conti.map((c) => schedaConto(c, false)).join("")}
      ${piu ? schedaConto(r.totale, true) : ""}
    </div>
    <div class="note">Clic su un conto per vederne i movimenti. Entrate e uscite non comprendono i giroconti (ricariche tra conto e carta),
      che invece spostano il saldo. Il saldo è la somma dei movimenti importati: l'app non conosce il saldo iniziale,
      quindi vale dalla data indicata e può differire da quello della banca.</div>`;
  collegaBarraPeriodo();
  $("main").querySelectorAll("[data-conto]").forEach((b) => b.onclick = () => {
    S.view = "movimenti"; S.conto = b.dataset.conto; S.cat = ""; S.cerca = "";
    S.mese = S.per.preset === "mese" ? S.per.mese : "";
    render();
  });
}

/* ---------- Tabella categorie x periodi ---------- */
function tabellaCategorie(r) {
  const m = r.matrice, cols = m.colonne, righe = m[S.lato];
  const rgb = S.lato === "uscite" ? "255,176,138" : "110,240,200";
  const tot = cols.map((_, i) => righe.reduce((s, x) => s + x.valori[i], 0));
  const totale = tot.reduce((s, v) => s + v, 0);
  const cella = (v, max, k) => {
    const a = max ? Math.abs(v) / max * 0.38 : 0;
    return `<td class="c" data-k="${k}" style="background:rgba(${rgb},${a.toFixed(3)})">${v ? intero(v) : `<span style="color:#4A4E58">·</span>`}</td>`;
  };
  return `<section class="card glass" style="flex-basis:100%">
    <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;align-items:center">
      <div><h2>Categorie per ${GRP_SING[r.grp]}</h2><div class="note" style="margin-top:4px">Importi in euro arrotondati. Clic su una categoria o su una cella per l'esploso.</div></div>
      <div class="seg" role="group" aria-label="Tipo"><button type="button" data-lato="uscite" class="${S.lato === "uscite" ? "on" : ""}">Uscite</button><button type="button" data-lato="entrate" class="${S.lato === "entrate" ? "on" : ""}">Entrate</button></div>
    </div>
    ${righe.length ? `<div class="mat-wrap"><table class="mat">
      <thead><tr><th>Categoria</th>${cols.map((k) => `<th>${etichetta(k)}</th>`).join("")}<th>Totale</th><th>Media / ${GRP_SING[r.grp]}</th></tr></thead>
      <tbody>${righe.map((x) => {
        const max = Math.max(...x.valori.map(Math.abs));
        return `<tr data-riga="${esc(x.categoria)}" style="cursor:default"><td class="cat" data-cat="${esc(x.categoria)}">${esc(x.categoria)}</td>
          ${x.valori.map((v, i) => cella(v, max, cols[i])).join("")}
          <td class="t">${intero(x.totale)}</td><td class="t" style="color:var(--muted);font-weight:400">${intero(x.totale / cols.length)}</td></tr>`; }).join("")}</tbody>
      <tfoot><tr style="cursor:default"><td>Totale</td>${tot.map((v) => `<td class="t">${intero(v)}</td>`).join("")}<td class="t">${intero(totale)}</td><td class="t" style="color:var(--muted)">${intero(totale / cols.length)}</td></tr></tfoot>
    </table></div>` : `<div class="empty">Nessun movimento in questo periodo.</div>`}
  </section>`;
}

/* ---------- Esploso di una categoria ---------- */
function apriDettaglio(cat) { S.dett = cat; S.dettEs = ""; render(); }

async function renderDettaglio() {
  const [da, a] = intervallo();
  const r = await api.dettaglio(S.dett, da, a, S.per.grp, S.conto);
  S.righe = r.movimenti;
  const c = r.confronti;
  const spesa = r.uscite !== 0 || r.entrate === 0;
  const val = spesa ? -r.uscite : r.entrate;
  const chiave = spesa ? (x) => -(x.categorie[S.dett] || 0) : (x) => x.entrate;
  const nPer = r.serie.length || 1;
  const maxEs = Math.max(1, ...r.esercenti.map((e) => Math.abs(e.totale)));
  const righe = S.dettEs ? r.movimenti.filter((m) => m.esercente === S.dettEs) : r.movimenti;
  $("main").innerHTML = `
    <div class="head">
      <div><button class="crumb" type="button" id="d-back">‹ Riepilogo · ${esc(titoloPeriodo())}${piuConti() ? " · " + esc(nomeContoSel()) : ""}</button><h1>${esc(S.dett)}</h1></div>
      <button class="btn" type="button" id="d-mov">Vedi in Movimenti</button>
    </div>
    ${barraPeriodo()}
    <div class="kpis">
      <div class="kpi glass"><div class="sub">${spesa ? "Speso" : "Entrato"}</div><div class="v" style="color:${spesa ? "var(--out)" : "var(--in)"}">${euro(spesa ? r.uscite : r.entrate, true)}</div>${deltas(val, chiave, c, spesa ? -1 : 1)}</div>
      <div class="kpi glass"><div class="sub">Media per ${GRP_SING[r.grp]}</div><div class="v">${euro((spesa ? r.uscite : r.entrate) / nPer)}</div><div class="delta"><span>su ${nPer} ${nPer === 1 ? GRP_SING[r.grp] : { mese: "mesi", trimestre: "trimestri", anno: "anni" }[r.grp]}</span></div></div>
      <div class="kpi glass"><div class="sub">Movimenti</div><div class="v">${r.movimenti.length}</div><div class="delta"><span>${r.esercenti.length} esercenti</span></div></div>
      <div class="kpi glass"><div class="sub">Importo medio</div><div class="v">${r.movimenti.length ? euro(r.totale / r.movimenti.length) : "—"}</div></div>
    </div>
    <div class="cards">
      <section class="card glass">
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px"><h2>Andamento per ${GRP_SING[r.grp]}</h2>${legenda}</div>
        ${grafico(r.serie, false)}
      </section>
      <section class="card glass">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline"><h2>Esercenti</h2>
          ${S.dettEs ? `<button class="crumb" type="button" id="d-tutti">Mostra tutti ✕</button>` : `<span class="note">Clic per filtrare i movimenti</span>`}</div>
        <div style="display:flex;flex-direction:column;gap:2px;max-height:420px;overflow:auto">
        ${r.esercenti.length ? r.esercenti.map((e) => `
          <button type="button" class="cat-row ${e.nome === S.dettEs ? "on" : ""}" data-es="${esc(e.nome)}">
            <div class="row" style="width:100%"><span>${esc(e.nome)} <span class="note">· ${e.n}</span></span>
              <span class="date" style="font-size:12px">${euro(e.totale)}</span></div>
            <div class="bar" style="width:100%"><div style="width:${(Math.abs(e.totale) / maxEs * 100).toFixed(1)}%"></div></div>
          </button>`).join("") : `<div class="empty">Nessun movimento in questo periodo.</div>`}
        </div>
      </section>
    </div>
    <div class="panel glass">
      ${righe.length ? `<table class="lista">
        <thead><tr><th>Data</th><th>Descrizione</th><th>Categoria</th><th style="text-align:right">Importo</th></tr></thead>
        <tbody>${righe.map(rigaHtml).join("")}</tbody></table>` : `<div class="empty">Nessun movimento.</div>`}
    </div>
    <div class="note">Clic su un movimento per spostarlo in un'altra categoria.</div>`;
  collegaBarraPeriodo();
  const main = $("main");
  $("d-back").onclick = () => { S.dett = null; render(); };
  $("d-mov").onclick = () => { S.view = "movimenti"; S.cat = S.dett; S.cerca = ""; S.mese = S.per.preset === "mese" ? S.per.mese : ""; S.dett = null; render(); };
  if ($("d-tutti")) $("d-tutti").onclick = () => { S.dettEs = ""; render(); };
  main.querySelectorAll("[data-es]").forEach((b) => b.onclick = () => { S.dettEs = S.dettEs === b.dataset.es ? "" : b.dataset.es; render(); });
  main.querySelectorAll("tbody tr").forEach((tr) => tr.onclick = (ev) => {
    const id = +tr.dataset.id;
    if (ev.target.closest(".ok-btn")) { accettaUno(id); return; }
    apriCategoria(id);
  });
}

/* ---------- Regole ---------- */
async function renderRegole() {
  const regole = await api.regole();
  $("main").innerHTML = `
    <div class="head"><div><div class="sub">Se la descrizione contiene la parola, assegna la categoria. Vince la parola più lunga.</div><h1>Regole</h1></div></div>
    <div class="filters glass" style="padding:16px;border-radius:18px">
      <div class="field" style="flex:1 1 220px"><label for="g-parola">Parola</label><input class="input" id="g-parola" placeholder="es. DECATHLON"></div>
      <div class="field" style="flex:1 1 220px"><label for="g-cat">Categoria</label><input class="input" id="g-cat" list="g-cats" placeholder="es. Shopping">
        <datalist id="g-cats">${S.stato.categorie.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></div>
      <button class="btn primary" type="button" id="g-add">Aggiungi regola</button>
    </div>
    <div class="panel glass"><table class="regole">
      <thead><tr><th>Parola</th><th>Categoria</th><th></th></tr></thead>
      <tbody>${regole.map((g) => `<tr style="cursor:default"><td style="font-family:var(--mono)">${esc(g.parola)}</td>
        <td><span class="chip"><span class="dot" style="background:${coloreCat(g.categoria)}"></span>${esc(g.categoria)}</span></td>
        <td style="text-align:right"><button class="btn small" type="button" data-del="${g.id}" aria-label="Elimina regola ${esc(g.parola)}">Elimina</button></td></tr>`).join("")}</tbody>
    </table></div>`;
  $("g-add").onclick = async () => {
    const r = await api.aggiungi_regola($("g-parola").value, $("g-cat").value);
    if (!r.ok) { toast("Scrivi parola e categoria"); return; }
    toast(r.applicati ? `Regola aggiunta: categorizzati ${r.applicati} movimenti` : "Regola aggiunta");
    await aggiornaStato(); render();
  };
  $("main").querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => { await api.elimina_regola(+b.dataset.del); render(); });
}

/* ---------- Dati e sicurezza ---------- */
const dataOra = (s) => (s ? new Date(s).toLocaleString("it-IT") : "—");

/* Riquadro OneDrive della sezione Dati. */
function cardOneDrive(info) {
  const n = info.nuvola, ms = info.microsoft;
  const chi = ms.utente && ms.utente.email ? `<div class="row"><span>Account Microsoft</span><span class="date">${esc(ms.utente.email)}</span></div>` : "";
  if (!n) {
    return `<section class="card glass" style="flex-basis:100%">
      <h2>OneDrive</h2>
      <div class="note">Salva i dati <b>cifrati</b> su OneDrive per usarli da più dispositivi (telefono, PC) e con chi condivide le spese.
        Su OneDrive va solo il file cifrato: Microsoft non può leggerlo. La password resta solo vostra.</div>
      ${chi}
      <div style="display:flex;flex-wrap:wrap;gap:10px">
        <button class="btn primary" type="button" id="o-crea">Salva nel mio OneDrive</button>
        <button class="btn" type="button" id="o-link-apri">Usa un file condiviso con me…</button>
      </div>
      <div id="o-link-box" hidden class="field">
        <label for="o-link">Link di condivisione ricevuto</label>
        <input class="input" id="o-link" type="url" placeholder="https://1drv.ms/…" autocomplete="off">
        <div class="note">I dati di questo dispositivo verranno <b>uniti</b> a quelli del file condiviso (senza doppioni) e da quel momento userai la password di quel file.</div>
        <div><button class="btn" type="button" id="o-link-ok">Collega</button></div>
      </div>
      ${ms.collegato ? "" : `<div class="note">Ti verrà chiesto di accedere con il tuo account Microsoft; poi sblocca di nuovo l'app.</div>`}
    </section>`;
  }
  return `<section class="card glass" style="flex-basis:100%">
    <h2>OneDrive</h2>
    <div class="note">I dati sono sincronizzati con il file cifrato <b>${esc(n.nome || "")}</b> su OneDrive. Le modifiche partono da sole;
      quelle fatte su un altro dispositivo arrivano entro un minuto (o quando riapri l'app).</div>
    ${chi}
    <div class="row"><span>Stato</span><span class="date" id="o-stato">${esc(document.getElementById("safe-text").textContent)}</span></div>
    <div class="row"><span>Ultima sincronizzazione</span><span class="date">${esc(dataOra(n.sincronizzato_il))}</span></div>
    <div style="display:flex;flex-wrap:wrap;gap:10px">
      ${ms.collegato ? `<button class="btn primary" type="button" id="o-sync">Sincronizza ora</button>` : `<button class="btn primary" type="button" id="o-accedi">Accedi con Microsoft</button>`}
      <button class="btn" type="button" id="o-scollega">Scollega questo dispositivo</button>
    </div>
    <details><summary class="note" style="cursor:pointer">Come condividere con un'altra persona</summary>
      <div class="note">Dal sito o dall'app di OneDrive (con l'account di chi ha creato il file): cartella <b>Finanze</b> → <b>Condividi</b> →
        scrivi l'email dell'altra persona → permesso <b>Può modificare</b> → <b>Invia</b>. Lei riceve un'email: sul suo dispositivo apre questa app,
        sceglie <b>Apri i dati da OneDrive</b>, accede con il suo account Microsoft e incolla il link dell'email. Le serve anche la password dei dati,
        che le dai tu a voce (mai per email o messaggio).</div></details>
  </section>`;
}

function collegaCardOneDrive() {
  const P = window.Porta;
  const esegui = async (btn, fn) => {
    btn.disabled = true;
    try { await fn(); } catch (e) { window.avviso("OneDrive", esc(e.message || String(e))); }
    btn.disabled = false;
    await aggiornaStato(); render();
  };
  if ($("o-crea")) $("o-crea").onclick = (e) => esegui(e.currentTarget, async () => {
    const r = await P.collegaCrea();
    if (r && r.creato) toast("Dati salvati su OneDrive (cartella Finanze)");
  });
  if ($("o-link-apri")) $("o-link-apri").onclick = () => { $("o-link-box").hidden = false; $("o-link").focus(); };
  if ($("o-link-ok")) $("o-link-ok").onclick = (e) => esegui(e.currentTarget, () => P.collegaLink($("o-link").value));
  if ($("o-sync")) $("o-sync").onclick = (e) => esegui(e.currentTarget, () => P.sincronizza());
  if ($("o-accedi")) $("o-accedi").onclick = () => P.accediMicrosoft();
  if ($("o-scollega")) $("o-scollega").onclick = (e) => {
    if (!window.confirm("Scollegare questo dispositivo da OneDrive? I dati restano qui (cifrati) e su OneDrive, ma non si sincronizzano più.")) return;
    esegui(e.currentTarget, () => P.scollega());
  };
}

async function renderDati() {
  const P = window.Porta, info = await P.info();
  const quando = info.salvato_il ? new Date(info.salvato_il).toLocaleString("it-IT") : "—";
  const imp = await P.impronta();
  $("main").innerHTML = `
    <div class="head"><div><div class="sub">Archivio cifrato, OneDrive, backup, password</div><h1>Dati</h1></div></div>
    <div class="cards">
      ${cardOneDrive(info)}
      <section class="card glass">
        <h2>Sblocco con impronta</h2>
        ${imp.disponibile ? `<div class="note">Su <b>questo dispositivo</b> puoi aprire l'app con l'impronta (o il volto / il PIN del telefono) invece di scrivere la password.
          La password non viene salvata: l'impronta sblocca una chiave cifrata che resta qui. La password resta necessaria sugli altri dispositivi,
          dopo un cambio password e se l'impronta non funziona: non dimenticarla.</div>
          <div class="row"><span>Stato</span><span class="date">${imp.attivo ? "attivo" : "non attivo"}</span></div>
          <div>${imp.attivo ? `<button class="btn" type="button" id="d-imp-off">Disattiva</button>`
            : `<button class="btn primary" type="button" id="d-imp-on">Attiva lo sblocco con impronta</button>`}</div>`
        : `<div class="note">Questo dispositivo o browser non ha un sensore utilizzabile dalle app web (serve un telefono con impronta o volto,
          o un PC con Windows Hello). Continua a usare la password.</div>`}
      </section>
      <section class="card glass">
        <h2>Su questo dispositivo</h2>
        <div class="note">Una copia <b>cifrata</b> (AES-256) dei dati sta nella memoria di questo browser: serve per aprire l'app subito e anche senza rete.
          Senza la password nessuno può leggerla. Ogni modifica viene salvata subito.</div>
        <div class="row"><span>Movimenti</span><span class="date">${S.stato.n_movimenti}</span></div>
        <div class="row"><span>Ultimo salvataggio</span><span class="date">${esc(quando)}</span></div>
        <div class="row"><span>Dimensione archivio</span><span class="date">${(info.byte / 1024).toFixed(0)} KB</span></div>
        <div class="row"><span>Memoria protetta dalla pulizia del browser</span><span class="date">${info.persistente ? "sì" : "no"}</span></div>
      </section>
      <section class="card glass">
        <h2>Backup</h2>
        <div class="note">Scarica una copia dell'archivio <b>cifrato</b> (file .finanze). Si apre solo con la password in uso al momento del backup.
          Tienine una copia su una chiavetta o in un'altra cartella.</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px"><button class="btn primary" type="button" id="d-backup">Scarica backup cifrato</button></div>
        <div class="note">Per ripristinare un backup: <b>Blocca</b> e, nella schermata di sblocco, scegli <b>Ripristina un backup</b>.</div>
      </section>
      <section class="card glass">
        <h2>Blocco automatico</h2>
        <div class="note">Dopo questo tempo senza usare l'app, i dati vengono tolti dalla memoria e serve di nuovo la password.</div>
        <div class="seg" role="group" aria-label="Blocco automatico">${[2, 5, 10, 30].map((m) => `<button type="button" data-min="${m}" class="${info.minuti === m ? "on" : ""}">${m} min</button>`).join("")}</div>
      </section>
      <section class="card glass">
        <h2>Cambia password</h2>
        <div class="field"><label for="d-vecchia">Password attuale</label><input class="input" id="d-vecchia" type="password" autocomplete="current-password"></div>
        <div class="field"><label for="d-nuova">Nuova password (almeno 10 caratteri)</label><input class="input" id="d-nuova" type="password" autocomplete="new-password"></div>
        <div class="field"><label for="d-nuova2">Ripeti la nuova password</label><input class="input" id="d-nuova2" type="password" autocomplete="new-password"></div>
        <div class="note">Se perdi la password <b>i dati sono persi</b>: nessuno può recuperarli. I backup già scaricati restano con la vecchia password.
          Se usi OneDrive, gli altri dispositivi ti chiederanno la nuova password al prossimo aggiornamento.</div>
        <div><button class="btn" type="button" id="d-cambia">Cambia password</button></div>
      </section>
      <section class="card glass" style="border-color:rgba(255,176,138,.35)">
        <h2>Elimina i dati da questo dispositivo</h2>
        <div class="note">Cancella l'archivio cifrato da questo browser. Fallo solo se hai un backup o se i dati sono anche su un altro dispositivo.</div>
        <div class="field"><label for="d-conferma">Scrivi ELIMINA per confermare</label><input class="input" id="d-conferma" autocomplete="off"></div>
        <div><button class="btn" type="button" id="d-elimina">Elimina da questo dispositivo</button></div>
      </section>
    </div>`;
  collegaCardOneDrive();
  if ($("d-imp-on")) $("d-imp-on").onclick = async () => {
    const pw = await window.chiediPassword("Attiva lo sblocco con impronta", "Inserisci la password dei dati, poi conferma con l'impronta quando il telefono la chiede.");
    if (pw === null) return;
    try { await P.attivaImpronta(pw); toast("Sblocco con impronta attivo"); render(); }
    catch (e) { if (!e.annullato) window.avviso("Impronta", esc(e.message || String(e))); }
  };
  if ($("d-imp-off")) $("d-imp-off").onclick = async () => { await P.disattivaImpronta(); toast("Sblocco con impronta disattivato"); render(); };
  $("d-backup").onclick = () => P.scaricaBackup();
  $("main").querySelectorAll("[data-min]").forEach((b) => b.onclick = async () => { await P.impostaBlocco(+b.dataset.min); toast(`Blocco dopo ${b.dataset.min} minuti`); render(); });
  $("d-cambia").onclick = async () => {
    const v = $("d-vecchia").value, n = $("d-nuova").value, n2 = $("d-nuova2").value;
    if (n.length < 10) { toast("La nuova password deve avere almeno 10 caratteri"); return; }
    if (n !== n2) { toast("Le due password nuove non coincidono"); return; }
    $("d-cambia").disabled = true; toast("Cambio in corso…");
    try { await P.cambiaPassword(v, n); toast("Password cambiata. Scarica un nuovo backup."); render(); }
    catch (e) { toast(e.message || String(e)); $("d-cambia").disabled = false; }
  };
  $("d-elimina").onclick = async () => {
    if ($("d-conferma").value.trim() !== "ELIMINA") { toast("Scrivi ELIMINA per confermare"); return; }
    await P.eliminaTutto();
  };
}

/* ---------- Avvio (chiamato da porta.js dopo lo sblocco) ---------- */
document.querySelectorAll(".nav-btn").forEach((b) => b.onclick = () => { S.view = b.dataset.view; S.dett = null; if (S.aff) S.aff.dett = null; if (S.imm) S.imm.dett = null; render(); });
$("btn-backup").onclick = () => window.Porta.scaricaBackup();
$("btn-blocca").onclick = () => window.Porta.blocca();

async function avviaInterfaccia(nuovaApi) {
  api = nuovaApi;
  await aggiornaStato();
  render();
}
window.avviaInterfaccia = avviaInterfaccia;

/* Finestra di avviso semplice (html già sicuro). */
window.avviso = (titolo, html) => {
  $("modal").innerHTML = `<h2 id="m-title" style="font-size:22px">${esc(titolo)}</h2><div class="note" style="font-size:14px;color:var(--text)">${html}</div>
    <div class="actions"><button class="btn primary" type="button" id="m-ok">Ok</button></div>`;
  $("modal").setAttribute("aria-labelledby", "m-title");
  $("modal-bg").classList.add("open");
  $("m-ok").onclick = chiudiModal;
};
window.toast = toast;

/* Arrivati dati nuovi da OneDrive: ridisegna (senza interrompere una finestra aperta). */
window.datiAggiornati = async (msg) => {
  if (!api) return;
  await aggiornaStato();
  if (!$("modal-bg").classList.contains("open")) render();
  if (msg) toast(msg);
};
window.statoSyncCambiato = () => {
  const s = $("o-stato");
  if (s) s.textContent = $("safe-text").textContent;
};

/* Chiede una password in una finestra. -> Promise<string | null> */
window.chiediPassword = (titolo, testo) => new Promise((ok) => {
  $("modal").innerHTML = `<h2 id="m-title" style="font-size:22px">${esc(titolo)}</h2><div class="note">${esc(testo)}</div>
    <form id="m-form" class="field">
      <input type="text" name="username" value="Finanze personali" autocomplete="username" hidden>
      <label for="m-pw">Password</label><input class="input" id="m-pw" type="password" autocomplete="current-password">
      <div class="actions"><button class="btn" type="button" id="m-annulla">Annulla</button><button class="btn primary" type="submit">Ok</button></div>
    </form>`;
  $("modal").setAttribute("aria-labelledby", "m-title");
  $("modal-bg").classList.add("open");
  $("m-pw").focus();
  const fine = (v) => { chiudiModal(); ok(v); };
  $("m-annulla").onclick = () => fine(null);
  $("m-form").onsubmit = (e) => { e.preventDefault(); fine($("m-pw").value); };
});
