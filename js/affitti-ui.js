"use strict";
/* Finanze personali – interfaccia di Affitti e Contratti.
   Usa le funzioni comuni di ui.js (S, api, esc, euro, dataIt, MESI, $, toast, chiudiModal, render…).
   Tutti i testi scritti dall'utente passano da esc() prima di finire nella pagina. */

S.aff = { anno: "", dett: null };
S.con = { tab: "contratti", filtro: "attivi" };

const MESI_BREVI = MESI.map((m) => m.slice(0, 3));
const meseBreve = (m) => MESI_BREVI[+m.slice(5, 7) - 1] + " " + m.slice(0, 4);
const oggiIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const importoIt = (v) => (v ? fmt(v) : "");
const val = (id) => ($(id) ? $(id).value : "");
const KB = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
const ICONA_X = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>`;

function apriModal(html, larga = false) {
  const m = $("modal");
  m.innerHTML = html;
  m.classList.toggle("larga", larga);
  m.setAttribute("aria-labelledby", "m-title");
  $("modal-bg").classList.add("open");
  if ($("m-close")) $("m-close").onclick = chiudiModal;
  if ($("m-annulla")) $("m-annulla").onclick = chiudiModal;
}
const testaModal = (titolo, sotto = "") => `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
  <div><h2 id="m-title" style="font-size:22px">${esc(titolo)}</h2>${sotto ? `<div class="note" style="margin-top:4px">${sotto}</div>` : ""}</div>
  <button class="icon-btn" type="button" id="m-close" aria-label="Chiudi">${ICONA_X}</button></div>`;

async function conErrore(fn) {
  try { const r = await fn(); if (r && r.ok === false) { toast(r.errore || "Operazione non riuscita"); return null; } return r || { ok: true }; }
  catch (e) { toast("Errore: " + (e.message || e)); return null; }
}
async function dopoModifica(msg) { chiudiModal(); if (msg) toast(msg); await aggiornaStato(); render(); }

/* Badge nel menu: inquilini in ritardo + bonifici da confermare; scadenze entro 30 giorni. */
async function aggiornaBadgeAffitti() {
  if (!api.affitti_avvisi) return;
  const a = await api.affitti_avvisi();
  const b1 = $("badge-aff"), b2 = $("badge-con");
  if (b1) { const n = a.ritardi + a.proposte; b1.hidden = !n; b1.textContent = n; b1.title = `${a.ritardi} in ritardo, ${a.proposte} bonifici da confermare`; }
  if (b2) { b2.hidden = !a.scadenze; b2.textContent = a.scadenze; b2.title = "Scadenze entro 30 giorni"; }
}

/* =====================================================================
   AFFITTI
   ===================================================================== */
function badgeStato(s) {
  if (!s.attivo) return `<span class="stato grigio">Chiuso</span>`;
  if (s.arretrati > 0) return `<span class="stato rosso">In ritardo · ${s.max_giorni_ritardo} gg</span>`;
  const m = s.mese_attuale;
  if (!m) return `<span class="stato grigio">—</span>`;
  if (m.stato === "pagato") return `<span class="stato verde">✓ ${esc(MESI[+m.mese.slice(5, 7) - 1])} pagato</span>`;
  if (m.stato === "parziale") return `<span class="stato giallo">Pagato in parte</span>`;
  return `<span class="stato grigio">Scade il ${dataIt(m.scadenza).slice(0, 5)}</span>`;
}

function schedaAffitto(s) {
  const riga = (t, v, stile = "") => `<div class="row"><span class="note">${t}</span><span class="num" style="${stile}">${v}</span></div>`;
  return `<button type="button" class="conto-card glass" data-aff="${esc(s.id)}" title="Apri la situazione di ${esc(s.immobile_nome)}">
    <div class="row" style="align-items:flex-start"><h2>${esc(s.immobile_nome)}</h2>${badgeStato(s)}</div>
    <div class="note" style="margin-top:-6px">${esc(s.inquilini.join(", ") || "—")}</div>
    <div><div class="sub">Canone${s.spese_mensili ? " + spese" : ""} al mese</div><div class="v">${euro(s.dovuto)}</div>
      <div class="note">entro il giorno ${s.giorno_pagamento}${s.spese_mensili ? ` · canone ${euro(s.canone)} + spese ${euro(s.spese_mensili)}` : ""}</div></div>
    <div class="conto-righe">
      ${riga("Arretrati", s.arretrati ? `${euro(s.arretrati)} <span class="note">(${s.mesi_arretrati} ${s.mesi_arretrati === 1 ? "mese" : "mesi"})</span>` : "nessuno", s.arretrati ? "color:var(--late)" : "color:var(--in)")}
      ${s.spese_da_rimborsare ? riga("Spese da rimborsare", euro(s.spese_da_rimborsare), "color:var(--warn)") : ""}
      ${riga("In casa da", esc(s.in_casa_da || "—"))}
      ${riga(s.scaduto ? "Contratto scaduto il" : "Scadenza contratto", s.scadenza ? dataIt(s.scadenza) : "—", s.scaduto ? "color:var(--late)" : "")}
    </div>
  </button>`;
}

const SIMBOLO = { pagato: "✓", parziale: "½", ritardo: "!", attesa: "·", futuro: "", fuori: "" };
const TITOLO_STATO = { pagato: "Pagato", parziale: "Pagato in parte", ritardo: "Non pagato, in ritardo", attesa: "In attesa (non ancora scaduto)", futuro: "Mese futuro", fuori: "Fuori contratto" };

function tabellaGriglia(r) {
  if (!r.griglia.length) return `<div class="empty">Nessun contratto nel ${esc(r.anno)}.</div>`;
  return `<div class="tab-scroll"><table class="griglia">
    <thead><tr><th>Casa</th>${r.mesi.map((m) => `<th>${MESI_BREVI[+m.slice(5, 7) - 1]}</th>`).join("")}<th style="text-align:right">Incassato</th></tr></thead>
    <tbody>${r.griglia.map((g) => `<tr>
      <td class="g-nome"><div style="font-weight:500">${esc(g.immobile_nome)}</div><div class="note">${esc(g.inquilini.join(", "))}</div></td>
      ${g.celle.map((c) => {
        const tit = `${MESI[+c.mese.slice(5, 7) - 1]}: ${TITOLO_STATO[c.stato]}` + (c.stato === "fuori" ? "" : ` · pagato ${euro(c.pagato)} su ${euro(c.dovuto)}${c.giorni ? ` · ${c.giorni} giorni di ritardo` : ""}`);
        return `<td class="g s-${c.stato}" ${c.stato === "fuori" ? "" : `data-gc="${esc(g.contratto)}" data-gm="${c.mese}" data-res="${c.residuo || c.dovuto}" tabindex="0" role="button"`} title="${esc(tit)}" aria-label="${esc(tit)}">${SIMBOLO[c.stato]}</td>`;
      }).join("")}
      <td class="num">${euro(g.celle.reduce((t, c) => t + c.pagato, 0))}</td></tr>`).join("")}</tbody></table></div>
    <div class="legend g-legenda">${["pagato", "parziale", "ritardo", "attesa"].map((s) => `<span><i class="g s-${s}">${SIMBOLO[s] || "·"}</i>${TITOLO_STATO[s]}</span>`).join("")}</div>`;
}

function tabellaSpese(spese, conCasa = true) {
  const T = FinAffitti.TIPI_SPESA;
  return `<table class="aff">
    <thead><tr><th>Data</th>${conCasa ? `<th class="nasc-tel">Casa</th>` : ""}<th>Descrizione</th><th class="nasc-tel">Tipo</th><th>A carico</th><th style="text-align:right">Importo</th></tr></thead>
    <tbody>${spese.map((s) => `<tr data-spesa="${esc(s.id)}"><td class="date">${dataIt(s.data)}</td>${conCasa ? `<td class="nasc-tel">${esc(s.immobile_nome || "")}</td>` : ""}
      <td>${esc(s.descrizione)}${conCasa ? `<div class="note solo-tel">${esc(s.immobile_nome || "")}</div>` : ""}</td><td class="nasc-tel note">${esc(T[s.tipo] || s.tipo)}</td>
      <td>${s.a_carico === "inquilino" ? `<span class="stato ${s.rimborsata ? "verde" : "giallo"}">Inquilino${s.rimborsata ? " · rimborsata" : " · da rimborsare"}</span>` : `<span class="note">Proprietario</span>`}</td>
      <td class="num" style="color:var(--out)">${euro(s.importo)}</td></tr>`).join("")}</tbody></table>`;
}

function rigaProposta(p, contratti) {
  return `<div class="prop-riga" data-imp="${esc(p.impronta)}">
    <div class="prop-mov"><div><span class="num" style="color:var(--in)">${euro(p.importo, true)}</span> <span class="date">${dataIt(p.data)}</span>
      ${p.sicuro ? `<span class="stato verde" title="Nome e importo corrispondono">sicuro</span>` : `<span class="stato giallo" title="${p.per_nome ? "Il nome corrisponde, l'importo no" : "L'importo corrisponde e la causale parla di affitto, il nome no"}">da verificare</span>`}</div>
      <div class="note" style="overflow-wrap:anywhere">${esc(p.descrizione)}</div></div>
    <select class="input p-contratto" aria-label="Contratto">${contratti.map((c) => `<option value="${esc(c.id)}" ${c.id === p.contratto ? "selected" : ""}>${esc(c.immobile_nome)} – ${esc(c.inquilini.join(", "))}</option>`).join("")}</select>
    <input class="input p-mese" type="month" value="${p.mese}" aria-label="Primo mese pagato" title="Primo mese pagato (se l'importo copre più mesi viene distribuito)">
    <div style="display:flex;gap:8px"><button class="btn small primary p-ok" type="button">Conferma</button><button class="btn small p-no" type="button" title="Non chiederlo più">Non è un affitto</button></div>
  </div>`;
}

async function renderAffitti() {
  if (S.aff.dett) return renderAffittoDettaglio();
  const r = await api.affitti_stato(S.aff.anno);
  S.aff.anno = r.anno;
  const main = $("main");
  if (!r.n_contratti && !r.schede.length && !r.griglia.length) {
    main.innerHTML = `<div class="head"><div><div class="sub">Chi ha pagato, chi è in ritardo, spese delle case</div><h1>Affitti</h1></div></div>
      <div class="card glass" style="max-width:640px">
        <h2>Iniziamo</h2>
        <div class="note" style="font-size:14px;color:var(--text)">Per seguire gli affitti serve un <b>contratto</b>: casa, inquilino, canone e giorno di pagamento.
          Lo crei in un'unica schermata. Poi, quando importi l'estratto conto, l'app riconosce da sola i bonifici degli inquilini e ti chiede solo di confermarli.</div>
        <div class="note">Tutto resta nell'archivio cifrato con la tua password, come i movimenti.</div>
        <div><button class="btn primary" type="button" id="a-primo">+ Aggiungi il primo contratto</button></div>
      </div>`;
    $("a-primo").onclick = () => apriFormContratto(null);
    return;
  }
  const proposte = r.proposte ? await api.affitti_proposte() : [];
  const contratti = proposte.length ? (await api.contratti_elenco()).contratti : [];
  const spese = await api.spese_anno(r.anno);
  const sicure = proposte.filter((p) => p.sicuro).length;
  main.innerHTML = `
    <div class="head"><div><div class="sub">Situazione al ${dataIt(r.oggi)}</div><h1>Affitti</h1></div>
      <div class="azioni"><button class="btn" type="button" id="a-spesa">+ Spesa</button>
        <button class="btn primary" type="button" id="a-pag">+ Registra pagamento</button></div></div>
    <div class="kpis">
      <div class="kpi glass"><div class="sub">Incassato ${esc(r.anno)}</div><div class="v" style="color:var(--in)">${euro(r.incassato)}</div><div class="note">su ${euro(r.atteso)} previsti nell'anno</div></div>
      <div class="kpi glass"><div class="sub">Arretrati</div><div class="v" style="color:${r.arretrati ? "var(--late)" : "var(--text)"}">${euro(r.arretrati)}</div><div class="note">rate scadute non pagate</div></div>
      <div class="kpi glass"><div class="sub">In ritardo</div><div class="v" style="color:${r.in_ritardo ? "var(--late)" : "var(--text)"}">${r.in_ritardo} <span class="note" style="font-size:14px">su ${r.n_contratti}</span></div><div class="note">contratti con arretrati</div></div>
      <div class="kpi glass"><div class="sub">Spese ${esc(r.anno)}</div><div class="v" style="color:var(--out)">${euro(r.spese)}</div><div class="note">a tuo carico${r.spese_inquilini ? ` · ${euro(r.spese_inquilini)} da farti rimborsare` : ""}</div></div>
    </div>
    ${proposte.length ? `<section class="card glass" style="border-color:rgba(110,240,200,.35)">
      <div class="row" style="align-items:center;flex-wrap:wrap"><h2>Bonifici riconosciuti dall'estratto conto (${proposte.length})</h2>
        ${sicure > 1 ? `<button class="btn small" type="button" id="a-tutte">Conferma i ${sicure} sicuri</button>` : ""}</div>
      <div class="note">Questi accrediti sembrano affitti. Controlla contratto e mese, poi conferma: se l'importo copre più mesi viene diviso da solo.
        «Non è un affitto» lo nasconde per sempre.</div>
      <div>${proposte.map((p) => rigaProposta(p, contratti)).join("")}</div>
    </section>` : ""}
    <div class="conti">${r.schede.map(schedaAffitto).join("")}</div>
    <section class="panel glass pannello">
      <div class="pannello-testa"><h2>Pagamenti mese per mese</h2>
        <select class="input" id="a-anno" aria-label="Anno" style="min-height:38px">${r.anni.map((a) => `<option ${a === r.anno ? "selected" : ""}>${esc(a)}</option>`).join("")}</select></div>
      ${tabellaGriglia(r)}
      <div class="note" style="padding:0 22px">Clic su un mese per registrare un pagamento.</div>
    </section>
    <section class="panel glass pannello">
      <div class="pannello-testa"><h2>Spese delle case ${esc(r.anno)}</h2><button class="btn small" type="button" id="a-spesa2">+ Spesa</button></div>
      ${spese.length ? tabellaSpese(spese) : `<div class="empty" style="padding:24px">Nessuna spesa nel ${esc(r.anno)}. Registra rate di condominio e amministrazione, riparazioni, IMU, assicurazione…<br>
        Se una spesa è a carico dell'inquilino, l'app la tiene tra i rimborsi da chiedere.</div>`}
    </section>`;
  $("a-pag").onclick = () => apriPagamento({});
  $("a-spesa").onclick = $("a-spesa2").onclick = () => apriSpesa({});
  $("a-anno").onchange = (e) => { S.aff.anno = e.target.value; render(); };
  main.querySelectorAll("[data-aff]").forEach((b) => b.onclick = () => { S.aff.dett = b.dataset.aff; render(); });
  main.querySelectorAll("[data-gc]").forEach((td) => {
    const apri = () => apriPagamento({ contratto: td.dataset.gc, mese: td.dataset.gm, importo: +td.dataset.res });
    td.onclick = apri; td.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); apri(); } };
  });
  main.querySelectorAll("[data-spesa]").forEach((tr) => tr.onclick = () => apriSpesa(spese.find((s) => s.id === tr.dataset.spesa)));
  if ($("a-tutte")) $("a-tutte").onclick = async () => { const x = await conErrore(() => api.affitti_conferma_tutte()); if (x) await dopoModifica(`Registrati ${x.confermati} pagamenti`); };
  main.querySelectorAll(".prop-riga").forEach((riga) => {
    riga.querySelector(".p-ok").onclick = async () => {
      const x = await conErrore(() => api.affitti_conferma(riga.dataset.imp, riga.querySelector(".p-contratto").value, riga.querySelector(".p-mese").value));
      if (x) await dopoModifica(x.mesi.length > 1 ? `Pagamento registrato su ${x.mesi.length} mesi (${x.mesi.map(meseBreve).join(", ")})` : `Pagamento di ${meseIt(x.mesi[0])} registrato`);
    };
    riga.querySelector(".p-no").onclick = async () => { await api.affitti_scarta(riga.dataset.imp); await dopoModifica("Ok, non lo chiederò più"); };
  });
}

async function renderAffittoDettaglio() {
  const d = await api.affitti_dettaglio(S.aff.dett);
  if (!d) { S.aff.dett = null; return render(); }
  const s = d.riepilogo, main = $("main");
  const METODI = { bonifico: "Bonifico", contanti: "Contanti", assegno: "Assegno", altro: "Altro" };
  main.innerHTML = `
    <div class="head"><div><button class="btn small" type="button" id="ad-indietro">← Affitti</button>
      <h1 style="margin-top:10px">${esc(s.immobile_nome)}</h1><div class="sub">${esc(s.inquilini.join(", "))} · ${esc(s.tipo_nome)}</div></div>
      <div class="azioni"><button class="btn" type="button" id="ad-contratto">Contratto e documenti</button>
        <button class="btn" type="button" id="ad-spesa">+ Spesa</button><button class="btn primary" type="button" id="ad-pag">+ Registra pagamento</button></div></div>
    <div class="kpis">
      <div class="kpi glass"><div class="sub">Al mese</div><div class="v">${euro(s.dovuto)}</div><div class="note">entro il giorno ${s.giorno_pagamento}</div></div>
      <div class="kpi glass"><div class="sub">Arretrati</div><div class="v" style="color:${s.arretrati ? "var(--late)" : "var(--in)"}">${euro(s.arretrati)}</div><div class="note">${s.arretrati ? `${s.mesi_arretrati} ${s.mesi_arretrati === 1 ? "mese" : "mesi"}, fino a ${s.max_giorni_ritardo} giorni` : "tutto in regola"}</div></div>
      <div class="kpi glass"><div class="sub">Incassato in totale</div><div class="v" style="color:var(--in)">${euro(d.incassato_totale)}</div><div class="note">dal ${dataIt(s.inizio)}</div></div>
      <div class="kpi glass"><div class="sub">In casa da</div><div class="v" style="font-size:20px">${esc(s.in_casa_da || "—")}</div><div class="note">dal ${dataIt(s.in_casa_dal)}</div></div>
    </div>
    <section class="panel glass pannello"><div class="pannello-testa"><h2>Mese per mese</h2></div>
      <table class="aff"><thead><tr><th>Mese</th><th style="text-align:right">Dovuto</th><th style="text-align:right">Pagato</th><th>Stato</th></tr></thead>
      <tbody>${d.mesi.map((m) => `<tr data-m="${m.mese}" data-res="${m.residuo}"><td>${esc(meseIt(m.mese))}</td><td class="num">${euro(m.dovuto)}</td>
        <td class="num" style="color:${m.pagato ? "var(--in)" : "var(--muted)"}">${euro(m.pagato)}</td>
        <td><span class="stato ${m.stato === "pagato" ? "verde" : m.stato === "ritardo" ? "rosso" : m.stato === "parziale" ? "giallo" : "grigio"}">${TITOLO_STATO[m.stato]}${m.giorni ? ` · ${m.giorni} gg` : ""}</span></td></tr>`).join("")}</tbody></table>
    </section>
    <section class="panel glass pannello"><div class="pannello-testa"><h2>Pagamenti registrati</h2></div>
      ${d.pagamenti.length ? `<table class="aff"><thead><tr><th>Data</th><th>Mese</th><th class="nasc-tel">Come</th><th style="text-align:right">Importo</th></tr></thead>
      <tbody>${d.pagamenti.map((p) => `<tr data-pag="${esc(p.id)}"><td class="date">${dataIt(p.data)}</td><td>${esc(meseIt(p.mese))}</td>
        <td class="nasc-tel note">${METODI[p.metodo] || ""}${p.movimento ? " · dall'estratto conto" : ""}${p.note ? ` · ${esc(p.note)}` : ""}</td>
        <td class="num" style="color:var(--in)">${euro(p.importo)}</td></tr>`).join("")}</tbody></table>` : `<div class="empty" style="padding:24px">Nessun pagamento registrato.</div>`}
    </section>
    <section class="panel glass pannello"><div class="pannello-testa"><h2>Spese di questa casa</h2></div>
      ${d.spese.length ? tabellaSpese(d.spese, false) : `<div class="empty" style="padding:24px">Nessuna spesa registrata.</div>`}
    </section>`;
  $("ad-indietro").onclick = () => { S.aff.dett = null; render(); };
  $("ad-pag").onclick = () => apriPagamento({ contratto: s.id });
  $("ad-spesa").onclick = () => apriSpesa({ immobile: s.immobile });
  $("ad-contratto").onclick = () => apriContratto(s.id);
  main.querySelectorAll("[data-m]").forEach((tr) => tr.onclick = () => apriPagamento({ contratto: s.id, mese: tr.dataset.m, importo: +tr.dataset.res || s.dovuto }));
  main.querySelectorAll("[data-pag]").forEach((tr) => tr.onclick = () => apriPagamento(d.pagamenti.find((p) => p.id === tr.dataset.pag)));
  main.querySelectorAll("[data-spesa]").forEach((tr) => tr.onclick = () => apriSpesa(d.spese.find((x) => x.id === tr.dataset.spesa)));
}

/* ---------- Registra / modifica un pagamento ---------- */
async function apriPagamento(p) {
  const el = (await api.contratti_elenco()).contratti;
  if (!el.length) { toast("Prima aggiungi un contratto (sezione Contratti)"); return; }
  const mod = Boolean(p.id);
  const c0 = el.find((c) => c.id === p.contratto) || el.find((c) => c.attivo) || el[0];
  const mese = p.mese || oggiIso().slice(0, 7);
  apriModal(`${testaModal(mod ? "Modifica pagamento" : "Registra pagamento", mod && p.movimento ? "Collegato a un bonifico dell'estratto conto" : "")}
    <div class="field"><label for="pg-c">Contratto</label><select class="input" id="pg-c">${el.map((c) => `<option value="${esc(c.id)}" ${c.id === c0.id ? "selected" : ""}>${esc(c.immobile_nome)} – ${esc(c.inquilini.join(", "))}${c.attivo ? "" : " (chiuso)"}</option>`).join("")}</select></div>
    <div class="form-griglia">
      <div class="field"><label for="pg-mese">Mese a cui si riferisce</label><input class="input" id="pg-mese" type="month" value="${esc(mese)}"></div>
      <div class="field"><label for="pg-imp">Importo (€)</label><input class="input" id="pg-imp" inputmode="decimal" autocomplete="off" value="${esc(importoIt(p.importo !== undefined ? p.importo : c0.dovuto))}"></div>
      <div class="field"><label for="pg-data">Pagato il</label><input class="input" id="pg-data" type="date" value="${esc(p.data || oggiIso())}"></div>
      <div class="field"><label for="pg-met">Come</label><select class="input" id="pg-met">${[["bonifico", "Bonifico"], ["contanti", "Contanti"], ["assegno", "Assegno"], ["altro", "Altro"]].map(([v, t]) => `<option value="${v}" ${(p.metodo || "bonifico") === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label for="pg-note">Note</label><input class="input" id="pg-note" value="${esc(p.note || "")}" placeholder="facoltative"></div>
    ${mod ? "" : `<label class="check"><input type="checkbox" id="pg-dividi" checked> Se l'importo copre più mesi, dividilo sui mesi ancora da pagare</label>`}
    <div class="actions">${mod ? `<button class="btn" type="button" id="pg-del" style="margin-right:auto">Elimina</button>` : ""}
      <button class="btn" type="button" id="m-annulla">Annulla</button><button class="btn primary" type="button" id="pg-ok">Salva</button></div>`);
  $("pg-c").onchange = () => { const c = el.find((x) => x.id === val("pg-c")); if (c && !mod) $("pg-imp").value = importoIt(c.dovuto); };
  $("pg-ok").onclick = async () => {
    const x = await conErrore(() => api.salva_pagamento({ id: p.id, contratto: val("pg-c"), mese: val("pg-mese"), importo: val("pg-imp"),
      data: val("pg-data"), metodo: val("pg-met"), note: val("pg-note"), dividi: $("pg-dividi") ? $("pg-dividi").checked : false }));
    if (x) await dopoModifica("Pagamento salvato");
  };
  if ($("pg-del")) $("pg-del").onclick = async () => {
    if (!window.confirm("Eliminare questo pagamento?" + (p.movimento ? " Il bonifico tornerà tra quelli da confermare." : ""))) return;
    await api.elimina_pagamento(p.id); await dopoModifica("Pagamento eliminato");
  };
}

/* ---------- Spesa di una casa ---------- */
async function apriSpesa(s) {
  const an = await api.anagrafiche();
  if (!an.immobili.length) { toast("Prima aggiungi una casa (sezione Contratti)"); return; }
  const mod = Boolean(s.id), T = FinAffitti.TIPI_SPESA;
  const inq = s.a_carico === "inquilino";
  apriModal(`${testaModal(mod ? "Modifica spesa" : "Nuova spesa", "Condominio, amministrazione, riparazioni, tasse…")}
    <div class="form-griglia">
      <div class="field"><label for="sp-casa">Casa</label><select class="input" id="sp-casa">${an.immobili.map((i) => `<option value="${esc(i.id)}" ${i.id === s.immobile ? "selected" : ""}>${esc(i.nome)}</option>`).join("")}</select></div>
      <div class="field"><label for="sp-tipo">Tipo</label><select class="input" id="sp-tipo">${Object.entries(T).map(([k, t]) => `<option value="${k}" ${k === (s.tipo || "amministrazione") ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
      <div class="field"><label for="sp-data">Data</label><input class="input" id="sp-data" type="date" value="${esc(s.data || oggiIso())}"></div>
      <div class="field"><label for="sp-imp">Importo (€)</label><input class="input" id="sp-imp" inputmode="decimal" autocomplete="off" value="${esc(importoIt(s.importo))}"></div>
    </div>
    <div class="field"><label for="sp-desc">Descrizione</label><input class="input" id="sp-desc" value="${esc(s.descrizione || "")}" placeholder="es. Rata condominio 4° trimestre"></div>
    <div class="field"><label>A carico di</label><div class="seg" role="group" aria-label="A carico di">
      <button type="button" data-car="proprietario" class="${inq ? "" : "on"}">Proprietario (io)</button><button type="button" data-car="inquilino" class="${inq ? "on" : ""}">Inquilino (da rimborsare)</button></div></div>
    <label class="check" id="sp-rimb-l" ${inq ? "" : "hidden"}><input type="checkbox" id="sp-rimb" ${s.rimborsata ? "checked" : ""}> L'inquilino l'ha già rimborsata</label>
    <div class="field"><label for="sp-note">Note</label><input class="input" id="sp-note" value="${esc(s.note || "")}" placeholder="facoltative"></div>
    <div class="actions">${mod ? `<button class="btn" type="button" id="sp-del" style="margin-right:auto">Elimina</button>` : ""}
      <button class="btn" type="button" id="m-annulla">Annulla</button><button class="btn primary" type="button" id="sp-ok">Salva</button></div>`);
  let carico = inq ? "inquilino" : "proprietario";
  $("modal").querySelectorAll("[data-car]").forEach((b) => b.onclick = () => {
    carico = b.dataset.car;
    $("modal").querySelectorAll("[data-car]").forEach((x) => x.classList.toggle("on", x === b));
    $("sp-rimb-l").hidden = carico !== "inquilino";
  });
  $("sp-ok").onclick = async () => {
    const x = await conErrore(() => api.salva_spesa({ id: s.id, immobile: val("sp-casa"), tipo: val("sp-tipo"), data: val("sp-data"), importo: val("sp-imp"),
      descrizione: val("sp-desc"), a_carico: carico, rimborsata: $("sp-rimb").checked, contratto: s.contratto, note: val("sp-note") }));
    if (x) await dopoModifica("Spesa salvata");
  };
  if ($("sp-del")) $("sp-del").onclick = async () => { if (!window.confirm("Eliminare questa spesa?")) return; await api.elimina_spesa(s.id); await dopoModifica("Spesa eliminata"); };
}

/* =====================================================================
   CONTRATTI
   ===================================================================== */
async function renderContratti() {
  const el = await api.contratti_elenco();
  const an = await api.anagrafiche();
  const main = $("main");
  const tab = S.con.tab;
  const testa = `<div class="head"><div><div class="sub">Contratti, scadenze, inquilini, case e documenti</div><h1>Contratti</h1></div>
      <div class="azioni">${tab === "contratti" ? `<button class="btn" type="button" id="c-modello">Modello del contratto</button><button class="btn primary" type="button" id="c-nuovo">+ Nuovo contratto</button>`
        : tab === "inquilini" ? `<button class="btn primary" type="button" id="c-nuovo-inq">+ Nuovo inquilino</button>` : `<button class="btn primary" type="button" id="c-nuova-casa">+ Nuova casa</button>`}</div></div>
    <div class="seg" role="tablist" aria-label="Sezione">
      ${[["contratti", `Contratti (${el.contratti.length})`], ["inquilini", `Inquilini (${an.inquilini.length})`], ["case", `Case (${an.immobili.length})`]]
        .map(([k, t]) => `<button type="button" role="tab" data-tab="${k}" class="${tab === k ? "on" : ""}" aria-selected="${tab === k}">${t}</button>`).join("")}</div>`;
  let corpo = "";
  if (tab === "contratti") corpo = corpoContratti(el);
  else if (tab === "inquilini") corpo = corpoInquilini(an);
  else corpo = corpoCase(an);
  main.innerHTML = testa + corpo;
  main.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { S.con.tab = b.dataset.tab; render(); });
  if ($("c-nuovo")) $("c-nuovo").onclick = () => apriFormContratto(null);
  if ($("c-modello")) $("c-modello").onclick = apriModello;
  if ($("c-nuovo-inq")) $("c-nuovo-inq").onclick = () => apriInquilino({});
  if ($("c-nuova-casa")) $("c-nuova-casa").onclick = () => apriCasa({});
  main.querySelectorAll("[data-filtro]").forEach((b) => b.onclick = () => { S.con.filtro = b.dataset.filtro; render(); });
  main.querySelectorAll("[data-contr]").forEach((b) => b.onclick = () => apriContratto(b.dataset.contr));
  main.querySelectorAll("[data-inq]").forEach((tr) => tr.onclick = () => apriInquilino(an.inquilini.find((i) => i.id === tr.dataset.inq)));
  main.querySelectorAll("[data-casa]").forEach((b) => b.onclick = () => apriCasa(an.immobili.find((i) => i.id === b.dataset.casa)));
}

const ETICHETTA_SCAD = { scaduto: "rosso", disdetta: "giallo", scadenza: "giallo", istat: "grigio", registro: "grigio" };

function corpoContratti(el) {
  const f = S.con.filtro;
  const lista = el.contratti.filter((c) => f === "tutti" || (f === "attivi" ? c.attivo : !c.attivo));
  const scad = el.scadenze;
  const quando = (g) => (g < 0 ? `${-g} giorni fa` : g === 0 ? "oggi" : g === 1 ? "domani" : `tra ${g} giorni`);
  const riga = (t, v, stile = "") => `<div class="row"><span class="note">${t}</span><span style="text-align:right;${stile}">${v}</span></div>`;
  return `
    ${scad.length ? `<section class="card glass"><h2>Scadenze dei prossimi 6 mesi</h2>
      <div class="scadenze">${scad.map((s) => `<button type="button" class="scad-riga" data-contr="${esc(s.contratto)}">
        <span class="stato ${s.tra_giorni <= 30 && s.tipo !== "istat" && s.tipo !== "registro" ? "rosso" : ETICHETTA_SCAD[s.tipo]}">${dataIt(s.data)}</span>
        <span><b>${esc(s.testo)}</b><span class="note" style="display:block">${esc(s.immobile_nome)} · ${esc(s.inquilini.join(", "))} · ${quando(s.tra_giorni)}</span></span></button>`).join("")}</div>
      <div class="note">Le date sono calcolate da inizio, durata, rinnovo e preavviso del contratto: verifica sempre sul contratto firmato.</div></section>` : ""}
    ${el.contratti.length ? `<div class="seg" role="group" aria-label="Filtro">${[["attivi", "Attivi"], ["chiusi", "Chiusi"], ["tutti", "Tutti"]].map(([k, t]) => `<button type="button" data-filtro="${k}" class="${f === k ? "on" : ""}">${t}</button>`).join("")}</div>` : ""}
    ${lista.length ? `<div class="conti">${lista.map((c) => `<button type="button" class="conto-card glass" data-contr="${esc(c.id)}">
        <div class="row" style="align-items:flex-start"><h2>${esc(c.immobile_nome)}</h2>${c.attivo ? (c.scaduto ? `<span class="stato rosso">Scaduto</span>` : `<span class="stato verde">Attivo</span>`) : `<span class="stato grigio">Chiuso</span>`}</div>
        <div class="note" style="margin-top:-6px">${esc(c.inquilini.join(", "))} · ${esc(c.tipo_nome)}</div>
        <div class="conto-righe">
          ${riga("Inizio", dataIt(c.inizio))}
          ${riga("In casa da", esc(c.in_casa_da || "—"))}
          ${c.attivo ? riga(c.scaduto ? "Scaduto il" : "Prossima scadenza", c.scadenza ? dataIt(c.scadenza) : "—", c.scaduto ? "color:var(--late)" : "") : riga("Chiuso il", dataIt(c.chiuso_il))}
          ${c.attivo && c.disdetta_entro && !c.scaduto ? riga("Disdetta entro", dataIt(c.disdetta_entro)) : ""}
          ${riga("Canone", `<span class="num">${euro(c.canone)}</span>${c.spese_mensili ? ` <span class="note">+ ${euro(c.spese_mensili)} spese</span>` : ""}`)}
          ${c.deposito ? riga("Deposito cauzionale", `<span class="num">${euro(c.deposito)}</span>`) : ""}
          ${riga("Documenti", c.allegati ? `📎 ${c.allegati}` : `<span class="note">nessuno</span>`)}
        </div></button>`).join("")}</div>`
      : `<div class="empty glass" style="border-radius:20px">${el.contratti.length ? "Nessun contratto con questo filtro." : "Nessun contratto ancora. Premi <b>+ Nuovo contratto</b>: casa e inquilino si inseriscono nella stessa schermata."}</div>`}`;
}

function corpoInquilini(an) {
  if (!an.inquilini.length) return `<div class="empty glass" style="border-radius:20px">Nessun inquilino. Puoi aggiungerli anche direttamente quando crei un contratto.</div>`;
  return `<div class="panel glass"><table class="aff">
    <thead><tr><th>Nome</th><th class="nasc-tel">Contatti</th><th>Casa</th><th>In casa da</th></tr></thead>
    <tbody>${an.inquilini.map((i) => `<tr data-inq="${esc(i.id)}"><td style="font-weight:500">${esc(i.nome)}</td>
      <td class="nasc-tel note">${[i.email, i.telefono].filter(Boolean).map(esc).join(" · ") || "—"}</td>
      <td>${i.casa ? esc(i.casa) : `<span class="note">nessun contratto attivo</span>`}</td><td class="note">${esc(i.in_casa_da || "—")}</td></tr>`).join("")}</tbody></table></div>
    <div class="note">Clic su un inquilino per modificarne i dati. Codice fiscale, email e telefono stanno solo nell'archivio cifrato.</div>`;
}

function corpoCase(an) {
  if (!an.immobili.length) return `<div class="empty glass" style="border-radius:20px">Nessuna casa. Puoi aggiungerle anche direttamente quando crei un contratto.</div>`;
  return `<div class="conti">${an.immobili.map((i) => `<button type="button" class="conto-card glass" data-casa="${esc(i.id)}">
      <div class="row" style="align-items:flex-start"><h2>${esc(i.nome)}</h2>${i.contratto_attivo ? `<span class="stato verde">Affittata</span>` : `<span class="stato grigio">Libera</span>`}</div>
      <div class="note">${esc(i.indirizzo || "")}</div>
      <div class="conto-righe">
        <div class="row"><span class="note">Inquilini</span><span>${esc(i.inquilini_attuali.join(", ") || "—")}</span></div>
        <div class="row"><span class="note">Contratti registrati</span><span>${i.n_contratti}</span></div>
      </div></button>`).join("")}</div>`;
}

/* ---------- Scheda di un contratto (documenti, email, modifica) ---------- */
async function apriContratto(id) {
  const c = await api.contratto(id);
  if (!c) return;
  const s = c.riepilogo, d = c.dati;
  const riga = (t, v) => `<div class="row"><span class="note">${t}</span><span style="text-align:right">${v}</span></div>`;
  apriModal(`${testaModal(s.immobile_nome, esc(s.inquilini.join(", ")))}
    <div class="box">
      ${riga("Tipo", esc(s.tipo_nome))}
      ${riga("Inizio", dataIt(s.inizio) + ` · durata ${d.durata_mesi} mesi${d.rinnovo_mesi ? ` + rinnovo ${d.rinnovo_mesi}` : ""}`)}
      ${s.chiuso_il ? riga("Chiuso il", dataIt(s.chiuso_il)) : riga(s.scaduto ? "Scaduto il" : "Prossima scadenza", s.scadenza ? dataIt(s.scadenza) : "—")}
      ${!s.chiuso_il && s.disdetta_entro && !s.scaduto ? riga("Disdetta entro", `${dataIt(s.disdetta_entro)} <span class="note">(preavviso ${d.preavviso_mesi} mesi)</span>`) : ""}
      ${riga("In casa da", `${esc(s.in_casa_da || "—")} <span class="note">(dal ${dataIt(s.in_casa_dal)})</span>`)}
      ${riga("Canone mensile", `<span class="num">${euro(s.canone)}</span>`)}
      ${s.spese_mensili ? riga("Acconto spese mensile", `<span class="num">${euro(s.spese_mensili)}</span>`) : ""}
      ${riga("Pagamento entro il", `giorno ${s.giorno_pagamento}`)}
      ${s.deposito ? riga("Deposito cauzionale", `<span class="num">${euro(s.deposito)}</span>`) : ""}
      ${riga("Cedolare secca", s.cedolare ? "sì" : "no")}${!s.cedolare ? riga("Aggiornamento ISTAT", s.istat ? "sì" : "no") : ""}
      ${s.registrazione ? riga("Registrazione", esc(s.registrazione)) : ""}
      ${s.note ? `<div class="note" style="white-space:pre-wrap">${esc(s.note)}</div>` : ""}
    </div>
    <div class="box">
      <div class="row" style="align-items:center"><b>Documenti</b><span class="note">cifrati nell'archivio</span></div>
      ${c.allegati.length ? c.allegati.map((a) => `<div class="row" style="align-items:center">
          <span style="overflow-wrap:anywhere">📎 ${esc(a.nome)} <span class="note">${KB(a.byte)} · ${dataIt(a.aggiunto_il.slice(0, 10))}</span></span>
          <span style="display:flex;gap:6px;flex-shrink:0"><button class="btn small" type="button" data-apri="${esc(a.id)}">Apri</button>
            <button class="btn small" type="button" data-del-al="${esc(a.id)}" aria-label="Elimina ${esc(a.nome)}">Elimina</button></span></div>`).join("")
        : `<div class="note">Nessun documento. Allega il contratto firmato (PDF o foto della scansione).</div>`}
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        <button class="btn small" type="button" id="ct-allega">+ Allega PDF o scansione</button>
        <button class="btn small" type="button" id="ct-bozza">Genera bozza da modificare in Word</button>
        <button class="btn small" type="button" id="ct-email">Invia per email</button>
      </div>
    </div>
    <div class="actions" style="flex-wrap:wrap"><button class="btn" type="button" id="ct-del" style="margin-right:auto">Elimina</button>
      <button class="btn" type="button" id="ct-pag">Pagamenti</button><button class="btn primary" type="button" id="ct-mod">Modifica</button></div>`, true);
  $("ct-mod").onclick = () => apriFormContratto(id);
  $("ct-pag").onclick = () => { chiudiModal(); S.view = "affitti"; S.aff.dett = id; render(); };
  $("ct-bozza").onclick = () => scaricaBozza(id);
  $("ct-email").onclick = () => apriEmail(id);
  $("ct-allega").onclick = () => allegaFile(id);
  $("modal").querySelectorAll("[data-apri]").forEach((b) => b.onclick = () => apriAllegato(b.dataset.apri, b));
  $("modal").querySelectorAll("[data-del-al]").forEach((b) => b.onclick = async () => {
    if (!window.confirm("Eliminare questo documento? Non si potrà recuperare (se non da un backup).")) return;
    const meta = await api.allegato_elimina(b.dataset.delAl);
    if (meta) await Allegati.elimina(meta);
    toast("Documento eliminato"); await aggiornaStato(); apriContratto(id);
  });
  $("ct-del").onclick = () => {
    apriModal(`${testaModal("Eliminare il contratto?")}
      <div class="note" style="font-size:14px;color:var(--text)">Vengono eliminati il contratto, <b>tutti i suoi pagamenti registrati</b> e i documenti allegati.
        Se il contratto è solo finito, usa invece <b>Modifica → Chiuso il</b>: lo storico resta.</div>
      <div class="field"><label for="ct-conf">Scrivi ELIMINA per confermare</label><input class="input" id="ct-conf" autocomplete="off"></div>
      <div class="actions"><button class="btn" type="button" id="m-annulla">Annulla</button><button class="btn primary" type="button" id="ct-conf-ok">Elimina</button></div>`);
    $("ct-conf-ok").onclick = async () => {
      if (val("ct-conf").trim() !== "ELIMINA") { toast("Scrivi ELIMINA per confermare"); return; }
      const r = await api.elimina_contratto(id);
      for (const a of r.allegati_tolti || []) await Allegati.elimina(a);
      if (S.aff.dett === id) S.aff.dett = null;
      await dopoModifica("Contratto eliminato");
    };
  };
}

/* ---------- Nuovo / modifica contratto (casa e inquilini anche nuovi, tutto in una schermata) ---------- */
async function apriFormContratto(id) {
  const an = await api.anagrafiche();
  const TIPI = FinAffitti.TIPI;
  const x = id ? (await api.contratto(id)).dati : { tipo: "4+4", inizio: oggiIso(), durata_mesi: 48, rinnovo_mesi: 48, preavviso_mesi: 6, giorno_pagamento: 5, inquilini: [], cedolare: true };
  const scelti = new Set(x.inquilini || []);
  apriModal(`${testaModal(id ? "Modifica contratto" : "Nuovo contratto")}
    <div class="box"><b>Casa</b>
      <select class="input" id="fc-casa" aria-label="Casa">${an.immobili.map((i) => `<option value="${esc(i.id)}" ${i.id === x.immobile ? "selected" : ""}>${esc(i.nome)}</option>`).join("")}
        <option value="__nuova" ${an.immobili.length ? "" : "selected"}>+ Nuova casa…</option></select>
      <div class="form-griglia" id="fc-nuova-casa" ${an.immobili.length ? "hidden" : ""}>
        <div class="field"><label for="fc-casa-nome">Nome breve</label><input class="input" id="fc-casa-nome" placeholder="es. Via Roma 12, int. 3"></div>
        <div class="field"><label for="fc-casa-ind">Indirizzo completo</label><input class="input" id="fc-casa-ind" placeholder="Via Roma 12, 16121 Genova"></div>
      </div></div>
    <div class="box"><b>Inquilini</b>
      ${an.inquilini.length ? `<div class="chips" id="fc-inq">${an.inquilini.map((i) => `<button type="button" class="pick ${scelti.has(i.id) ? "on" : ""}" data-i="${esc(i.id)}" aria-pressed="${scelti.has(i.id)}">${esc(i.nome)}</button>`).join("")}</div>` : ""}
      <div id="fc-nuovi"></div>
      <div><button class="btn small" type="button" id="fc-add-inq">+ Nuovo inquilino</button></div></div>
    <div class="box"><b>Contratto</b>
      <div class="form-griglia">
        <div class="field"><label for="fc-tipo">Tipo</label><select class="input" id="fc-tipo">${Object.entries(TIPI).map(([k, t]) => `<option value="${k}" ${k === x.tipo ? "selected" : ""}>${esc(t.nome)}</option>`).join("")}</select></div>
        <div class="field"><label for="fc-inizio">Data di inizio</label><input class="input" id="fc-inizio" type="date" value="${esc(x.inizio || "")}"></div>
        <div class="field"><label for="fc-durata">Durata (mesi)</label><input class="input" id="fc-durata" inputmode="numeric" value="${esc(x.durata_mesi ?? "")}"></div>
        <div class="field"><label for="fc-rinnovo">Rinnovo automatico (mesi, 0 = no)</label><input class="input" id="fc-rinnovo" inputmode="numeric" value="${esc(x.rinnovo_mesi ?? 0)}"></div>
        <div class="field"><label for="fc-preavviso">Preavviso disdetta (mesi)</label><input class="input" id="fc-preavviso" inputmode="numeric" value="${esc(x.preavviso_mesi ?? 0)}"></div>
        <div class="field"><label for="fc-reg">Registrazione (numero, data)</label><input class="input" id="fc-reg" value="${esc(x.registrazione || "")}" placeholder="facoltativo"></div>
      </div></div>
    <div class="box"><b>Soldi</b>
      <div class="form-griglia">
        <div class="field"><label for="fc-canone">Canone mensile (€)</label><input class="input" id="fc-canone" inputmode="decimal" autocomplete="off" value="${esc(importoIt(x.canone))}"></div>
        <div class="field"><label for="fc-spese">Acconto spese mensile (€)</label><input class="input" id="fc-spese" inputmode="decimal" autocomplete="off" value="${esc(importoIt(x.spese_mensili))}" placeholder="0"></div>
        <div class="field"><label for="fc-giorno">Pagamento entro il giorno</label><input class="input" id="fc-giorno" inputmode="numeric" value="${esc(x.giorno_pagamento ?? 5)}"></div>
        <div class="field"><label for="fc-dep">Deposito cauzionale (€)</label><input class="input" id="fc-dep" inputmode="decimal" autocomplete="off" value="${esc(importoIt(x.deposito))}" placeholder="0"></div>
      </div>
      <label class="check"><input type="checkbox" id="fc-cedolare" ${x.cedolare ? "checked" : ""}> Cedolare secca</label>
      <label class="check" id="fc-istat-l" ${x.cedolare ? "hidden" : ""}><input type="checkbox" id="fc-istat" ${x.istat ? "checked" : ""}> Aggiornamento ISTAT annuale del canone</label></div>
    ${id ? `<div class="form-griglia"><div class="field"><label for="fc-chiuso">Chiuso il (inquilino uscito)</label><input class="input" id="fc-chiuso" type="date" value="${esc(x.chiuso_il || "")}"></div></div>` : ""}
    <div class="field"><label for="fc-note">Note</label><textarea class="input" id="fc-note" rows="3" style="min-height:80px;font-family:inherit">${esc(x.note || "")}</textarea></div>
    <div class="actions"><button class="btn" type="button" id="m-annulla">Annulla</button><button class="btn primary" type="button" id="fc-ok">Salva contratto</button></div>`, true);

  const m = $("modal");
  $("fc-casa").onchange = () => { $("fc-nuova-casa").hidden = val("fc-casa") !== "__nuova"; };
  m.querySelectorAll("#fc-inq .pick").forEach((b) => b.onclick = () => {
    const on = !b.classList.contains("on");
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
    if (on) scelti.add(b.dataset.i); else scelti.delete(b.dataset.i);
  });
  let n = 0;
  const aggiungiInq = () => {
    const k = n++;
    const div = document.createElement("div");
    div.className = "form-griglia nuovo-inq";
    div.innerHTML = `<div class="field"><label for="fn-nome${k}">Nome e cognome</label><input class="input" id="fn-nome${k}" data-k="nome"></div>
      <div class="field"><label for="fn-email${k}">Email</label><input class="input" id="fn-email${k}" data-k="email" type="email" autocomplete="off"></div>
      <div class="field"><label for="fn-tel${k}">Telefono</label><input class="input" id="fn-tel${k}" data-k="telefono" type="tel" autocomplete="off"></div>
      <div class="field"><label for="fn-cf${k}">Codice fiscale</label><input class="input" id="fn-cf${k}" data-k="codice_fiscale" autocomplete="off" style="text-transform:uppercase"></div>`;
    $("fc-nuovi").appendChild(div);
    div.querySelector("input").focus();
  };
  $("fc-add-inq").onclick = aggiungiInq;
  if (!an.inquilini.length) aggiungiInq();
  $("fc-tipo").onchange = () => {
    const t = TIPI[val("fc-tipo")];
    $("fc-durata").value = t.durata; $("fc-rinnovo").value = t.rinnovo; $("fc-preavviso").value = t.preavviso;
  };
  $("fc-cedolare").onchange = () => { $("fc-istat-l").hidden = $("fc-cedolare").checked; };
  $("fc-ok").onclick = async () => {
    const nuovi = [...m.querySelectorAll(".nuovo-inq")].map((d) => {
      const o = {}; d.querySelectorAll("input").forEach((i) => { o[i.dataset.k] = i.value; }); return o;
    }).filter((o) => o.nome.trim());
    const casa = val("fc-casa");
    const dati = {
      id, immobile: casa === "__nuova" ? "" : casa, nuova_casa: casa === "__nuova" ? { nome: val("fc-casa-nome"), indirizzo: val("fc-casa-ind") } : null,
      inquilini: [...scelti], nuovi_inquilini: nuovi, tipo: val("fc-tipo"), inizio: val("fc-inizio"),
      durata_mesi: val("fc-durata"), rinnovo_mesi: val("fc-rinnovo"), preavviso_mesi: val("fc-preavviso"), registrazione: val("fc-reg"),
      canone: val("fc-canone"), spese_mensili: val("fc-spese"), giorno_pagamento: val("fc-giorno"), deposito: val("fc-dep"),
      cedolare: $("fc-cedolare").checked, istat: $("fc-istat").checked, chiuso_il: id ? val("fc-chiuso") : null, note: val("fc-note"),
    };
    const r = await conErrore(() => api.salva_contratto(dati));
    if (!r) return;
    await aggiornaStato(); render();
    toast(id ? "Contratto aggiornato" : "Contratto salvato");
    apriContratto(r.id);
  };
}

/* ---------- Inquilino ---------- */
function apriInquilino(i) {
  const mod = Boolean(i.id);
  apriModal(`${testaModal(mod ? i.nome : "Nuovo inquilino")}
    <div class="form-griglia">
      <div class="field"><label for="iq-nome">Nome e cognome</label><input class="input" id="iq-nome" value="${esc(i.nome || "")}"></div>
      <div class="field"><label for="iq-cf">Codice fiscale</label><input class="input" id="iq-cf" value="${esc(i.codice_fiscale || "")}" autocomplete="off" style="text-transform:uppercase"></div>
      <div class="field"><label for="iq-email">Email</label><input class="input" id="iq-email" type="email" value="${esc(i.email || "")}" autocomplete="off"></div>
      <div class="field"><label for="iq-tel">Telefono</label><input class="input" id="iq-tel" type="tel" value="${esc(i.telefono || "")}" autocomplete="off"></div>
    </div>
    <div class="field"><label for="iq-ric">Come compare nei bonifici</label><input class="input" id="iq-ric" value="${esc(i.riconoscimento || "")}" placeholder="es. ROSSI MARIO, BIANCHI ANNA">
      <div class="note">Parole che compaiono nella causale dei suoi bonifici, separate da virgole (es. il nome di chi paga per lui).
        Se lasci vuoto uso nome e cognome, in tutti e due gli ordini.</div></div>
    <div class="field"><label for="iq-note">Note</label><textarea class="input" id="iq-note" rows="3" style="min-height:80px;font-family:inherit">${esc(i.note || "")}</textarea></div>
    <div class="actions">${mod ? `<button class="btn" type="button" id="iq-del" style="margin-right:auto">Elimina</button>` : ""}
      <button class="btn" type="button" id="m-annulla">Annulla</button><button class="btn primary" type="button" id="iq-ok">Salva</button></div>`);
  $("iq-ok").onclick = async () => {
    const r = await conErrore(() => api.salva_inquilino({ id: i.id, nome: val("iq-nome"), codice_fiscale: val("iq-cf"), email: val("iq-email"),
      telefono: val("iq-tel"), riconoscimento: val("iq-ric"), note: val("iq-note") }));
    if (r) await dopoModifica("Inquilino salvato");
  };
  if ($("iq-del")) $("iq-del").onclick = async () => {
    if (!window.confirm(`Eliminare ${i.nome}?`)) return;
    const r = await conErrore(() => api.elimina_inquilino(i.id));
    if (r) await dopoModifica("Inquilino eliminato");
  };
}

/* ---------- Casa ---------- */
function apriCasa(c) {
  const mod = Boolean(c.id);
  apriModal(`${testaModal(mod ? c.nome : "Nuova casa")}
    <div class="field"><label for="ca-nome">Nome breve</label><input class="input" id="ca-nome" value="${esc(c.nome || "")}" placeholder="es. Via Roma 12, int. 3"></div>
    <div class="field"><label for="ca-ind">Indirizzo completo</label><input class="input" id="ca-ind" value="${esc(c.indirizzo || "")}"></div>
    <div class="field"><label for="ca-note">Note (dati catastali, amministratore, contatori…)</label><textarea class="input" id="ca-note" rows="4" style="min-height:100px;font-family:inherit">${esc(c.note || "")}</textarea></div>
    <div class="actions">${mod ? `<button class="btn" type="button" id="ca-del" style="margin-right:auto">Elimina</button>` : ""}
      <button class="btn" type="button" id="m-annulla">Annulla</button><button class="btn primary" type="button" id="ca-ok">Salva</button></div>`);
  $("ca-ok").onclick = async () => {
    const r = await conErrore(() => api.salva_immobile({ id: c.id, nome: val("ca-nome"), indirizzo: val("ca-ind"), note: val("ca-note") }));
    if (r) await dopoModifica("Casa salvata");
  };
  if ($("ca-del")) $("ca-del").onclick = async () => {
    if (!window.confirm(`Eliminare ${c.nome} e le sue spese?`)) return;
    const r = await conErrore(() => api.elimina_immobile(c.id));
    if (r) await dopoModifica("Casa eliminata");
  };
}

/* ---------- Documenti ---------- */
function scaricaBlob(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const nomeFileSicuro = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "documento";

function allegaFile(contrattoId) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".pdf,image/*,.doc,.docx,.odt"; inp.multiple = true;
  inp.onchange = async () => {
    const files = [...inp.files];
    if (!files.length) return;
    toast("Cifratura in corso…");
    let n = 0;
    for (const f of files) {
      try {
        const meta = await Allegati.aggiungi(f);
        const r = await api.allegato_registra(contrattoId, meta);
        if (!r.ok) { await Allegati.elimina(meta); continue; }
        n++;
      } catch (e) { window.avviso("Documento non allegato", esc(e.message || String(e))); return; }
    }
    toast(n === 1 ? "Documento allegato e cifrato" : `${n} documenti allegati e cifrati`);
    await aggiornaStato(); apriContratto(contrattoId);
    if (files.length) window.avviso("Documento al sicuro", `Ora il documento è cifrato nell'archivio${n > 1 ? " (tutti)" : ""}. Se l'originale era nella cartella Download o nella galleria del telefono, <b>eliminalo da lì</b>: è in chiaro.`);
  };
  inp.click();
}

async function apriAllegato(alId, bottone) {
  const meta = await api.allegato_meta(alId);
  if (!meta) return;
  if (bottone) bottone.disabled = true;
  try {
    const blob = await Allegati.apri(meta);
    const url = URL.createObjectURL(blob);
    // PDF e immagini si aprono in una scheda (senza lasciare copie in Download), il resto si scarica
    const w = /^(application\/pdf|image\/)/.test(meta.tipo) ? window.open(url, "_blank") : null;
    if (!w) scaricaBlob(blob, meta.nome);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { window.avviso("Documento", esc(e.message || String(e))); }
  finally { if (bottone) bottone.disabled = false; }
}

/* Bozza del contratto: modello + dati → documento Word (.doc in formato HTML, si apre e si modifica con Word). */
async function creaBozza(id) {
  const b = await api.dati_bozza(id);
  if (!b) return null;
  const testo = esc(b.modello).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (t, k) => (k in b.campi ? `<b>${esc(b.campi[k]) || "____"}</b>` : t));
  const par = testo.split(/\n\s*\n/).map((p, i) => (i === 0 ? `<h1 style="text-align:center;font-size:16pt">${p.replace(/\n/g, "<br>")}</h1>` : `<p>${p.replace(/\n/g, "<br>")}</p>`)).join("\n");
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>Contratto di locazione</title>
<style>body{font-family:"Times New Roman",serif;font-size:12pt;line-height:1.5} p{margin:0 0 10pt;text-align:justify} @page{margin:2.5cm}</style></head>
<body>${par}</body></html>`;
  const nome = nomeFileSicuro(`Contratto ${b.campi.casa} ${b.campi.inizio.replace(/\//g, "-")}`) + ".doc";
  return { blob: new Blob(["﻿", html], { type: "application/msword" }), nome };
}

async function scaricaBozza(id) {
  const b = await creaBozza(id);
  if (!b) return;
  scaricaBlob(b.blob, b.nome);
  window.avviso("Bozza scaricata", `Il file <b>${esc(b.nome)}</b> è nella cartella Download: aprilo con <b>Word</b> (o LibreOffice) sul PC, completa le parti con ____ e salvalo.
    <br><br>Il modello è solo una traccia: fallo verificare (per il 3+2 serve il modello dell'accordo territoriale del Comune).
    <br><br>Dopo la firma, allega qui il PDF firmato con <b>+ Allega PDF o scansione</b> e <b>elimina il file dalla cartella Download</b>: contiene dati personali in chiaro.`);
}

/* ---------- Invio per email ---------- */
async function apriEmail(id) {
  const c = await api.contratto(id);
  if (!c) return;
  const s = c.riepilogo;
  const nomi = c.email.map((e) => e.nome.split(" ")[0]).join(" e ");
  const oggetto = `Contratto di locazione – ${s.immobile_nome}`;
  const corpo = `Gentile ${nomi || "inquilino"},\n\nin allegato il contratto di locazione dell'immobile ${s.indirizzo || s.immobile_nome}.\n\nCordiali saluti`;
  const puoCondividere = Boolean(navigator.canShare && navigator.share);
  apriModal(`${testaModal("Invia per email", esc(s.immobile_nome))}
    ${c.email.length ? `<div class="field"><label>Destinatari</label>${c.email.map((e, i) => `<label class="check"><input type="checkbox" class="em-to" data-i="${i}" checked> ${esc(e.nome)} <span class="note">${esc(e.email)}</span></label>`).join("")}</div>`
      : `<div class="box" style="border-color:rgba(247,208,138,.45)"><div class="note">Nessun inquilino di questo contratto ha l'email. Aggiungila in <b>Contratti → Inquilini</b>, oppure scegli il destinatario nel programma di posta.</div></div>`}
    <div class="field"><label for="em-doc">Documento da allegare</label><select class="input" id="em-doc">
      ${c.allegati.map((a) => `<option value="${esc(a.id)}">${esc(a.nome)}</option>`).join("")}<option value="__bozza">Bozza generata dal modello (Word)</option></select></div>
    <div class="field"><label for="em-ogg">Oggetto</label><input class="input" id="em-ogg" value="${esc(oggetto)}"></div>
    <div class="field"><label for="em-testo">Testo</label><textarea class="input" id="em-testo" rows="5" style="min-height:120px;font-family:inherit">${esc(corpo)}</textarea></div>
    <div class="box" style="border-color:rgba(247,208,138,.35)"><div class="note">L'email <b>non è cifrata</b>: il documento esce dall'archivio protetto. Mandalo solo all'inquilino e non scrivere nel testo codice fiscale o altri dati personali.
      ${puoCondividere ? "" : "Il documento viene scaricato in chiaro: allegalo alla mail e poi <b>eliminalo dalla cartella Download</b>."}</div></div>
    <div class="actions" style="flex-wrap:wrap"><button class="btn" type="button" id="m-annulla">Annulla</button>
      ${puoCondividere ? `<button class="btn" type="button" id="em-scarica">Scarica e apri la mail</button><button class="btn primary" type="button" id="em-share">Condividi (Gmail, Outlook…)</button>`
        : `<button class="btn primary" type="button" id="em-scarica">Scarica il documento e apri la mail</button>`}</div>`, true);
  const destinatari = () => [...$("modal").querySelectorAll(".em-to")].filter((x) => x.checked).map((x) => c.email[+x.dataset.i].email);
  const documento = async () => {
    const scelta = val("em-doc");
    if (scelta === "__bozza") { const b = await creaBozza(id); return new File([b.blob], b.nome, { type: "application/msword" }); }
    const meta = await api.allegato_meta(scelta);
    const blob = await Allegati.apri(meta);
    return new File([blob], meta.nome, { type: meta.tipo || "application/octet-stream" });
  };
  $("em-scarica").onclick = async () => {
    try {
      const f = await documento();
      scaricaBlob(f, f.name);
      const to = destinatari().map(encodeURIComponent).join(",");
      location.href = `mailto:${to}?subject=${encodeURIComponent(val("em-ogg"))}&body=${encodeURIComponent(val("em-testo") + "\n\n(allegato: " + f.name + ")")}`;
      chiudiModal();
      window.avviso("Ultimi due passi", `Nella mail che si è aperta <b>allega il file ${esc(f.name)}</b> dalla cartella Download e invia.<br><br>Poi <b>elimina il file dalla cartella Download</b> (e svuota il cestino): è in chiaro.`);
    } catch (e) { window.avviso("Email", esc(e.message || String(e))); }
  };
  if ($("em-share")) $("em-share").onclick = async () => {
    try {
      const f = await documento();
      const dati = { files: [f], title: val("em-ogg"), text: val("em-testo") };
      if (!navigator.canShare(dati)) { toast("Questo dispositivo non può condividere questo file: uso il download"); $("em-scarica").click(); return; }
      if (destinatari().length && navigator.clipboard) navigator.clipboard.writeText(destinatari().join(", ")).then(() => toast("Indirizzo email copiato: incollalo nel destinatario")).catch(() => {});
      await navigator.share(dati);
      chiudiModal();
    } catch (e) { if (e && e.name !== "AbortError") window.avviso("Email", esc(e.message || String(e))); }
  };
}

/* ---------- Modello del contratto ---------- */
async function apriModello() {
  const t = await api.modello_contratto();
  const campi = ["casa", "indirizzo", "inquilini", "inquilini_cf", "tipo", "inizio", "fine", "durata_mesi", "rinnovo_mesi", "preavviso_mesi",
    "canone", "canone_annuo", "spese_mensili", "deposito", "giorno_pagamento", "cedolare", "oggi"];
  apriModal(`${testaModal("Modello del contratto", "Il testo da cui si genera la bozza in Word. I campi tra {{ }} vengono riempiti con i dati del contratto.")}
    <textarea class="input" id="mo-testo" spellcheck="true" style="min-height:min(52vh,460px)">${esc(t)}</textarea>
    <div class="note">Campi disponibili: ${campi.map((c) => `<code>{{${c}}}</code>`).join(" ")}<br>
      Una riga vuota separa i paragrafi. Per le modifiche di un singolo contratto conviene generare la bozza e lavorare in Word.</div>
    <div class="actions" style="flex-wrap:wrap"><button class="btn" type="button" id="mo-reset" style="margin-right:auto">Ripristina il modello di base</button>
      <button class="btn" type="button" id="m-annulla">Annulla</button><button class="btn primary" type="button" id="mo-ok">Salva modello</button></div>`, true);
  $("mo-ok").onclick = async () => { await api.salva_modello_contratto(val("mo-testo")); chiudiModal(); toast("Modello salvato"); };
  $("mo-reset").onclick = async () => {
    if (!window.confirm("Tornare al modello di base? Le tue modifiche al modello andranno perse.")) return;
    await api.salva_modello_contratto(null); chiudiModal(); toast("Modello di base ripristinato");
  };
}
