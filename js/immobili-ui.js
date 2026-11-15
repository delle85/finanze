"use strict";
/* Finanze personali – Immobili (schede delle case), Insoluti, Assicurazioni e Scadenze (calendario).
   Usa le funzioni di ui.js e affitti-ui.js (apriModal, testaModal, conErrore, dopoModifica, bannerInsoluti, …).
   Tutti i testi scritti dall'utente passano da esc() prima di finire nella pagina. */

S.imm = { dett: null, tab: "panoramica", filtro: "tutte", anno: "" };
S.cal = { mese: "", sel: "", filtro: "tutto" };

const ICONA_CASA = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>`;
const ICONA_SCUDO = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
const quandoTesto = (g) => (g < 0 ? `${-g} giorni fa` : g === 0 ? "oggi" : g === 1 ? "domani" : `tra ${g} giorni`);
const giorniDa = (iso) => Math.round((Date.parse(iso + "T12:00:00") - Date.parse(oggiIso() + "T12:00:00")) / 86400000);
const piuGiorniIso = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/* =====================================================================
   IMMOBILI
   ===================================================================== */
function statoCasa(c) {
  if (c.insoluto > 0) return { cls: "moroso", pill: `<span class="pill-col">${c.stato === "sfitta" ? `<span class="stato giallo">Sfitta</span>` : ""}<span class="stato rosso">Da incassare</span></span>` };
  if (c.stato === "sfitta") return { cls: "sfitta", pill: `<span class="stato giallo">Sfitta</span>` };
  if (c.in_scadenza) return { cls: "scadenza", pill: `<span class="stato giallo">Contratto in scadenza</span>` };
  return { cls: "ok", pill: `<span class="stato verde">Affittata</span>` };
}
function rigaAssicurazione(c) {
  if (!c.assicurazioni.length) return `<div class="cc-assic manca">${ICONA_SCUDO}<span>Nessuna polizza registrata</span></div>`;
  if (!c.assicurata) return `<div class="cc-assic scaduta">${ICONA_SCUDO}<span>Polizza scaduta</span></div>`;
  return `<div class="cc-assic ${c.assic_in_scadenza ? "inscad" : "ok"}">${ICONA_SCUDO}<span>${c.assic_in_scadenza ? "Polizza in scadenza" : "Assicurata"} · scade il ${dataIt(c.assic_prossima)}</span></div>`;
}

function casaCard(c) {
  const st = statoCasa(c), k = c.contratto;
  const riga = (t, v, stile = "") => `<div class="row"><span class="note">${t}</span><span style="text-align:right;${stile}">${v}</span></div>`;
  return `<button type="button" class="casa-card glass st-${st.cls}" data-casa="${esc(c.id)}" title="Apri ${esc(c.nome)}">
    <div class="cc-top"><span class="cc-icona">${ICONA_CASA}</span>
      <span class="cc-nome"><h2>${esc(c.nome)}</h2><span class="note">${esc([c.tipologia_nome, c.superficie ? c.superficie + " m²" : ""].filter(Boolean).join(" · ") || c.indirizzo || "")}</span></span>
      ${st.pill}</div>
    ${k ? `<div class="cc-main"><div><div class="sub">Totale al mese</div><div class="v">${euro(k.dovuto)}</div></div>
        ${c.insoluto > 0 ? `<div style="text-align:right"><div class="sub">Da incassare</div><div class="v" style="color:var(--late)">${euro(c.insoluto)}</div></div>` : ""}</div>
      <div class="conto-righe">
        ${riga("Titolare", esc(k.titolare))}
        ${riga("In casa", personeTesto(k), k.n_minori ? "color:var(--warn)" : "")}
        ${riga(k.scaduto ? "Contratto scaduto il" : "Scadenza contratto", k.scadenza ? dataIt(k.scadenza) : "—", k.scaduto ? "color:var(--late)" : c.in_scadenza ? "color:var(--warn)" : "")}
      </div>`
    : `<div class="cc-main"><div><div class="sub">Sfitta</div><div class="v" style="font-size:20px">${c.giorni_sfitta !== null ? `da ${c.giorni_sfitta} giorni` : "mai affittata"}</div></div></div>
      <div class="conto-righe">
        ${c.sfitta_dal ? riga("Libera dal", dataIt(c.sfitta_dal)) : ""}
        ${riga("Canone richiesto", c.canone_richiesto ? `<span class="num">${euro(c.canone_richiesto)}</span>` : `<span class="note">—</span>`)}
        ${c.insoluto > 0 ? riga("Ancora da incassare", `<span class="num">${euro(c.insoluto)}</span>`, "color:var(--late)") : ""}
      </div>`}
    ${rigaAssicurazione(c)}
    <div class="cc-piede"><span>Netto ${esc(String(S.imm.anno))}: <b class="num" style="color:${c.netto_anno < 0 ? "var(--out)" : "var(--in)"}">${euro(c.netto_anno)}</b></span>
      <span>${[c.n_documenti ? `📎 ${c.n_documenti}` : "", c.prossima ? `${esc(c.prossima.titolo)} ${quandoTesto(giorniDa(c.prossima.data))}` : ""].filter(Boolean).join(" · ")}</span></div>
  </button>`;
}

async function renderImmobili() {
  if (S.imm.dett) return renderImmobileDettaglio();
  const r = await api.immobili_elenco(S.imm.anno);
  S.imm.anno = r.anno;
  const main = $("main");
  if (!r.n) {
    main.innerHTML = `<div class="head"><div><div class="sub">Le tue case, affittate e sfitte</div><h1>Immobili</h1></div></div>
      <div class="card glass" style="max-width:640px"><h2>Aggiungi le tue case</h2>
        <div class="note" style="font-size:14px;color:var(--text)">Ogni casa diventa una scheda: vedi subito se è affittata o sfitta, chi ci vive, quanto rende,
          le spese, l'assicurazione e i documenti (APE, planimetria, visura). Puoi aggiungere anche case sfitte.</div>
        <div><button class="btn primary" type="button" id="im-prima">+ Aggiungi la prima casa</button></div></div>`;
    $("im-prima").onclick = () => apriCasa({}, (id) => { S.imm.dett = id; render(); });
    return;
  }
  const f = S.imm.filtro;
  const lista = r.case.filter((c) => f === "tutte" || (f === "affittate" ? c.stato === "affittata" : c.stato === "sfitta"));
  main.innerHTML = `
    <div class="head"><div><div class="sub">Le tue case, affittate e sfitte</div><h1>Immobili</h1></div>
      <div class="azioni"><button class="btn primary" type="button" id="im-nuova">+ Nuova casa</button></div></div>
    ${bannerInsoluti()}
    <div class="kpis">
      <div class="kpi glass"><div class="sub">Case</div><div class="v">${r.n}</div><div class="note">${r.affittate} affittate · ${r.sfitte} sfitte</div></div>
      <div class="kpi glass"><div class="sub">Occupazione</div><div class="v">${r.occupazione}%</div><div class="bar" style="margin-top:8px"><div style="width:${r.occupazione}%"></div></div></div>
      <div class="kpi glass"><div class="sub">Canoni al mese</div><div class="v" style="color:var(--in)">${euro(r.canoni_mensili)}</div><div class="note">dei contratti attivi</div></div>
      <div class="kpi glass"><div class="sub">Netto ${esc(r.anno)}</div><div class="v" style="color:${r.netto_anno < 0 ? "var(--out)" : "var(--in)"}">${euro(r.netto_anno)}</div><div class="note">incassato ${euro(r.incassato_anno)} − spese ${euro(r.spese_anno)}</div></div>
    </div>
    <div class="seg" role="group" aria-label="Filtro">${[["tutte", `Tutte (${r.n})`], ["affittate", `Affittate (${r.affittate})`], ["sfitte", `Sfitte (${r.sfitte})`]]
      .map(([k, t]) => `<button type="button" data-filtro="${k}" class="${f === k ? "on" : ""}">${t}</button>`).join("")}</div>
    ${lista.length ? `<div class="case-griglia">${lista.map(casaCard).join("")}</div>` : `<div class="empty glass" style="border-radius:20px">Nessuna casa con questo filtro.</div>`}
    ${r.senza_assicurazione ? `<div class="note">${r.senza_assicurazione} ${r.senza_assicurazione === 1 ? "casa non ha" : "case non hanno"} una polizza attiva registrata: aggiungila in <b>Assicurazioni</b> o nella scheda della casa.</div>` : ""}`;
  collegaBanner(main);
  $("im-nuova").onclick = () => apriCasa({}, (id) => { S.imm.dett = id; S.imm.tab = "panoramica"; render(); });
  main.querySelectorAll("[data-filtro]").forEach((b) => b.onclick = () => { S.imm.filtro = b.dataset.filtro; render(); });
  main.querySelectorAll("[data-casa]").forEach((b) => b.onclick = () => { S.imm.dett = b.dataset.casa; S.imm.tab = "panoramica"; render(); });
}

const COLORE_EVENTO = { rata: "e-rata", contratto: "e-contratto", disdetta: "e-disdetta", registro: "e-fisco", istat: "e-fisco", assicurazione: "e-assic", premio: "e-assic", promemoria: "e-prom" };
const NOME_EVENTO = { rata: "Affitto", contratto: "Contratto", disdetta: "Disdetta", registro: "Registro", istat: "ISTAT", assicurazione: "Polizza", premio: "Premio", promemoria: "Promemoria" };

function listaEventi(ev, conCasa = true) {
  if (!ev.length) return `<div class="note" style="padding:6px 0">Nessuna scadenza.</div>`;
  return `<div class="ev-lista">${ev.map((e, i) => `<button type="button" class="ev-riga st-${e.stato}" data-ev="${i}">
    <span class="ev-data num">${dataIt(e.data)}</span>
    <span class="ev-tipo ${COLORE_EVENTO[e.tipo]}">${NOME_EVENTO[e.tipo]}</span>
    <span class="ev-testo"><b>${esc(e.titolo)}</b><span class="note">${[conCasa ? e.immobile_nome : "", e.chi].filter(Boolean).map(esc).join(" · ")}${e.stato === "fatto" ? " · ✓ fatto" : e.stato === "scaduto" ? " · non fatto" : ` · ${quandoTesto(giorniDa(e.data))}`}</span></span>
    ${e.importo ? `<span class="num ev-imp">${euro(e.tipo === "rata" && e.stato !== "fatto" ? e.residuo || e.importo : e.importo)}</span>` : ""}
  </button>`).join("")}</div>`;
}
function collegaEventi(root, ev, dopo) {
  root.querySelectorAll("[data-ev]").forEach((b) => b.onclick = () => apriEvento(ev[+b.dataset.ev], dopo));
}
async function apriEvento(e, dopo) {
  if (e.tipo === "rata") return apriPagamento({ contratto: e.contratto, mese: e.mese, importo: e.residuo || e.importo });
  if (e.promemoria) return apriPromemoria(e.promemoria, e.data);
  if (e.assicurazione) return apriPolizza({ id: e.assicurazione }, dopo);
  if (e.contratto) return apriContratto(e.contratto);
}

async function renderImmobileDettaglio() {
  const d = await api.immobile_dettaglio(S.imm.dett, S.imm.anno);
  if (!d) { S.imm.dett = null; return render(); }
  const main = $("main"), st = statoCasa(d), k = d.contratto, tab = S.imm.tab;
  const riga = (t, v, stile = "") => `<div class="row"><span class="note">${t}</span><span style="text-align:right;${stile}">${v}</span></div>`;
  const tabs = [["panoramica", "Panoramica"], ["contratti", `Contratti (${d.contratti.length})`], ["spese", `Spese (${d.spese.length})`],
    ["assicurazioni", `Assicurazioni (${d.assicurazioni.length})`], ["documenti", `Documenti (${d.allegati.length})`], ["scheda", "Dati della casa"]];
  let corpo = "";
  if (tab === "contratti") {
    corpo = d.contratti.length ? `<div class="conti">${d.contratti.map((c) => `<button type="button" class="conto-card glass" data-contr="${esc(c.id)}">
        <div class="row" style="align-items:flex-start"><h2>${esc(c.titolare)}</h2>${c.arretrati > 0 ? `<span class="stato rosso">Non saldato</span>` : c.attivo ? `<span class="stato verde">In corso</span>` : `<span class="stato grigio">Chiuso</span>`}</div>
        <div class="note" style="margin-top:-6px">${esc(c.tipo_nome)} · ${personeTesto(c)}</div>
        <div class="conto-righe">${riga("Dal", dataIt(c.inizio))}${riga(c.chiuso_il ? "Al" : "Scadenza", dataIt(c.chiuso_il || c.scadenza))}${riga("Totale mensile", `<span class="num">${euro(c.dovuto)}</span>`)}
          ${c.arretrati > 0 ? riga("Da incassare", `<span class="num">${euro(c.arretrati)}</span>`, "color:var(--late)") : ""}</div></button>`).join("")}</div>`
      : `<div class="empty glass" style="border-radius:20px">Nessun contratto su questa casa.</div>`;
    corpo += `<div><button class="btn" type="button" id="id-nuovo-c">+ Nuovo contratto su questa casa</button></div>`;
  } else if (tab === "spese") {
    corpo = `<section class="panel glass pannello"><div class="pannello-testa"><h2>Spese della casa</h2><button class="btn small" type="button" id="id-spesa2">+ Spesa</button></div>
      ${d.spese.length ? tabellaSpese(d.spese, false) : `<div class="empty" style="padding:24px">Nessuna spesa registrata: condominio, amministrazione, riparazioni, IMU, assicurazione…</div>`}</section>`;
  } else if (tab === "assicurazioni") {
    corpo = `${d.assicurazioni.length ? `<div class="conti">${d.assicurazioni.map(polizzaCard).join("")}</div>` : `<div class="empty glass" style="border-radius:20px">Nessuna polizza registrata per questa casa.</div>`}
      <div><button class="btn" type="button" id="id-polizza">+ Nuova polizza per questa casa</button></div>`;
  } else if (tab === "documenti") {
    corpo = `<section class="card glass"><div class="row" style="align-items:center"><h2>Documenti</h2><span class="note">cifrati nell'archivio</span></div>
      ${righeAllegati(d.allegati, true)}
      <div class="note">Della casa: APE, planimetria, visura catastale, certificazioni impianti, verbali di consegna. I documenti dei contratti si allegano dal contratto.</div>
      <div><button class="btn small" type="button" id="id-allega">+ Allega documento della casa</button></div></section>`;
  } else if (tab === "scheda") {
    corpo = `<section class="card glass"><div class="conto-righe">
      ${riga("Nome", esc(d.nome))}${riga("Indirizzo", esc(d.indirizzo || "—"))}${riga("Tipologia", esc(d.tipologia_nome || "—"))}
      ${riga("Superficie", d.superficie ? `${d.superficie} m²` : "—")}${riga("Dati catastali", esc(d.catasto || "—"))}
      ${riga("Amministratore", esc(d.amministratore || "—"))}${riga("Canone richiesto se sfitta", d.canone_richiesto ? euro(d.canone_richiesto) : "—")}</div>
      ${d.note ? `<div class="note" style="white-space:pre-wrap">${esc(d.note)}</div>` : ""}
      <div><button class="btn" type="button" id="id-mod2">Modifica i dati</button></div></section>`;
  } else {
    const persone = k ? `<div class="box"><div class="row" style="align-items:center"><b>Chi vive nella casa</b><span class="note">${personeTesto(k)}</span></div>
        ${riga("Titolare del contratto", esc(k.titolare))}${k.cointestatari.length ? riga("Cointestatari", esc(k.cointestatari.join(", "))) : ""}${righeOccupanti(k)}</div>` : "";
    corpo = `<div class="due-colonne">
      <section class="card glass">${k ? `<div class="row" style="align-items:center"><h2>Contratto in corso</h2><button class="btn small" type="button" data-contr="${esc(k.id)}">Apri</button></div>
          ${persone}
          <div class="conto-righe">${riga("Tipo", esc(k.tipo_nome))}${riga("Regime", esc(k.regime_nome))}
            ${riga("Totale mensile", `<span class="num">${euro(k.dovuto)}</span>`)}${k.spese_mensili || k.quota_amministrazione ? riga("", `<span class="note">${totaleTesto(k)}</span>`) : ""}
            ${riga("In casa da", esc(k.in_casa_da || "—"))}
            ${riga(k.scaduto ? "Scaduto il" : "Scadenza", k.scadenza ? dataIt(k.scadenza) : "—", k.scaduto ? "color:var(--late)" : "")}
            ${k.disdetta_entro && !k.scaduto ? riga("Disdetta entro", dataIt(k.disdetta_entro)) : ""}</div>
          <div><button class="btn small" type="button" id="id-pagamenti">Pagamenti mese per mese</button></div>`
        : `<h2>La casa è sfitta</h2><div class="note" style="font-size:14px;color:var(--text)">${d.giorni_sfitta !== null ? `Libera dal ${dataIt(d.sfitta_dal)} (${d.giorni_sfitta} giorni).` : "Non è mai stata affittata."}
            ${d.canone_richiesto ? ` Canone richiesto: <b>${euro(d.canone_richiesto)}</b>.` : ""}</div>
          <div><button class="btn primary" type="button" id="id-nuovo-c">+ Crea il contratto</button></div>`}</section>
      <section class="card glass"><h2>Prossime scadenze</h2>${listaEventi(d.eventi, false)}</section>
    </div>
    <section class="panel glass pannello"><div class="pannello-testa"><h2>Anno per anno</h2></div>
      <table class="aff"><thead><tr><th>Anno</th><th style="text-align:right">Incassato</th><th style="text-align:right">Spese</th><th style="text-align:right">Netto</th></tr></thead>
      <tbody>${d.anni.map((a) => `<tr><td>${esc(a.anno)}</td><td class="num" style="color:var(--in)">${euro(a.incassato)}</td><td class="num" style="color:var(--out)">${euro(a.spese)}</td>
        <td class="num" style="font-weight:600">${euro(a.netto)}</td></tr>`).join("")}</tbody></table>
      <div class="note" style="padding:0 22px">Spese a tuo carico (quelle dell'inquilino da rimborsare non contano). Le tasse sul reddito non sono incluse.</div></section>`;
  }
  main.innerHTML = `
    <div class="head"><div><button class="btn small" type="button" id="id-indietro">← Immobili</button>
      <h1 style="margin-top:10px">${esc(d.nome)}</h1><div class="sub">${esc([d.indirizzo, d.tipologia_nome, d.superficie ? d.superficie + " m²" : ""].filter(Boolean).join(" · "))}</div></div>
      <div class="azioni"><button class="btn" type="button" id="id-mod">Modifica casa</button><button class="btn" type="button" id="id-spesa">+ Spesa</button>
        ${k ? `<button class="btn primary" type="button" id="id-pag">+ Registra pagamento</button>` : `<button class="btn primary" type="button" id="id-nuovo-c2">+ Nuovo contratto</button>`}</div></div>
    ${d.insoluto > 0 ? `<button type="button" class="banner-insoluti" data-vai="insoluti"><span class="bi-icona" aria-hidden="true">!</span>
      <span><b>Da incassare su questa casa: ${euro(d.insoluto)}</b><span class="note" style="display:block;color:inherit;opacity:.85">Apri Insoluti per il dettaglio e il sollecito</span></span><span class="bi-freccia" aria-hidden="true">→</span></button>` : ""}
    <div class="kpis">
      <div class="kpi glass"><div class="sub">Stato</div><div style="margin-top:8px">${st.pill}</div><div class="note" style="margin-top:6px">${k ? `da ${esc(k.in_casa_da || "—")}` : d.giorni_sfitta !== null ? `sfitta da ${d.giorni_sfitta} giorni` : "mai affittata"}</div></div>
      <div class="kpi glass"><div class="sub">Incassato ${esc(d.anno)}</div><div class="v" style="color:var(--in)">${euro(d.incassato_anno)}</div></div>
      <div class="kpi glass"><div class="sub">Spese ${esc(d.anno)}</div><div class="v" style="color:var(--out)">${euro(d.spese_anno)}</div></div>
      <div class="kpi glass"><div class="sub">Netto ${esc(d.anno)}</div><div class="v">${euro(d.netto_anno)}</div></div>
    </div>
    ${rigaAssicurazione(d)}
    <div class="seg schede-casa" role="tablist" aria-label="Sezioni della casa">${tabs.map(([t, n]) => `<button type="button" role="tab" data-itab="${t}" class="${tab === t ? "on" : ""}" aria-selected="${tab === t}">${n}</button>`).join("")}</div>
    ${corpo}`;
  collegaBanner(main);
  const nuovoContratto = () => apriFormContratto(null, { immobile: d.id });
  $("id-indietro").onclick = () => { S.imm.dett = null; render(); };
  $("id-mod").onclick = () => apriCasa(d);
  if ($("id-mod2")) $("id-mod2").onclick = () => apriCasa(d);
  $("id-spesa").onclick = () => apriSpesa({ immobile: d.id });
  if ($("id-spesa2")) $("id-spesa2").onclick = () => apriSpesa({ immobile: d.id });
  if ($("id-pag")) $("id-pag").onclick = () => apriPagamento({ contratto: k.id });
  if ($("id-pagamenti")) $("id-pagamenti").onclick = () => { S.view = "affitti"; S.aff.dett = k.id; render(); };
  for (const b of ["id-nuovo-c", "id-nuovo-c2"]) if ($(b)) $(b).onclick = nuovoContratto;
  if ($("id-polizza")) $("id-polizza").onclick = () => apriPolizza({ immobile: d.id }, () => render());
  if ($("id-allega")) $("id-allega").onclick = () => allegaFile({ immobile: d.id }, () => render());
  main.querySelectorAll("[data-itab]").forEach((b) => b.onclick = () => { S.imm.tab = b.dataset.itab; render(); });
  main.querySelectorAll("[data-contr]").forEach((b) => b.onclick = () => apriContratto(b.dataset.contr));
  main.querySelectorAll("[data-ass]").forEach((b) => b.onclick = () => apriPolizza({ id: b.dataset.ass }, () => render()));
  main.querySelectorAll("[data-spesa]").forEach((tr) => tr.onclick = () => apriSpesa(d.spese.find((x) => x.id === tr.dataset.spesa)));
  collegaAllegati(main, () => render());
  collegaEventi(main, d.eventi, () => render());
}

/* =====================================================================
   INSOLUTI
   ===================================================================== */
const LIVELLI = { critico: ["rosso", "Critico"], grave: ["rosso", "Grave"], lieve: ["giallo", "Da sollecitare"], rimborsi: ["giallo", "Spese da rimborsare"] };

const chipMese = (m) => `<span class="ins-mese ${m.giorni > 20 ? "grave" : ""}" title="Scaduta da ${m.giorni} giorni">
  <b>${esc(meseIt(m.mese))}</b> <span class="num">${euro(m.residuo)}</span>${m.pagato > 0 ? ` <span class="note">(pagato ${euro(m.pagato)} di ${euro(m.dovuto)})</span>` : ""} <span class="note">· ${m.giorni} gg</span></span>`;

function insCard(x) {
  const [col, nome] = LIVELLI[x.livello];
  return `<article class="ins-card glass liv-${x.livello}">
    <div class="ins-testa"><div><h2>${esc(x.immobile_nome)}</h2><div class="note">${esc(x.titolare)}${x.titolare_telefono ? ` · ${esc(x.titolare_telefono)}` : ""}${x.attivo ? "" : " · contratto chiuso"}</div></div>
      <span class="stato ${col}">${nome}</span></div>
    <div class="ins-corpo">
      <div class="ins-importo"><div class="sub">Da incassare</div><div class="v num">${euro(x.totale_dovuto)}</div>
        <div class="note">${x.arretrati > 0 ? `${x.mesi_arretrati} ${x.mesi_arretrati === 1 ? "rata" : "rate"} · ritardo fino a ${x.max_giorni_ritardo} giorni` : "solo spese da rimborsare"}</div></div>
      <div class="ins-mesi">${x.mesi_insoluti.slice(0, 6).map(chipMese).join("")}
        ${x.mesi_insoluti.length > 6 ? `<details class="ins-altri"><summary>altri ${x.mesi_insoluti.length - 6} mesi</summary><div class="ins-mesi">${x.mesi_insoluti.slice(6).map(chipMese).join("")}</div></details>` : ""}
        ${x.spese_aperte.map((s) => `<span class="ins-mese spesa"><b>${esc(s.descrizione)}</b> <span class="num">${euro(s.importo)}</span> <span class="note">· spesa da rimborsare</span></span>`).join("")}</div>
    </div>
    <div class="note">Ultimo pagamento: ${x.ultimo_pagamento ? dataIt(x.ultimo_pagamento) : "nessuno registrato"}${!x.attivo && x.deposito ? ` · deposito cauzionale ${euro(x.deposito)}: valuta se compensarlo` : ""}</div>
    <div class="ins-azioni"><button class="btn small" type="button" data-sit="${esc(x.id)}">Situazione</button>
      <button class="btn small" type="button" data-soll="${esc(x.id)}">Prepara sollecito</button>
      ${x.arretrati > 0 ? `<button class="btn small primary" type="button" data-paga="${esc(x.id)}">Registra pagamento</button>` : `<button class="btn small primary" type="button" data-rimb="${esc(x.id)}">Segna rimborsate</button>`}</div>
  </article>`;
}

async function renderInsoluti() {
  const r = await api.insoluti();
  const main = $("main");
  const testa = `<div class="head"><div><div class="sub">Contratti non saldati fino in fondo, dal più grave</div><h1>Insoluti</h1></div></div>`;
  if (!r.elenco.length) {
    main.innerHTML = `${testa}<div class="card glass tutto-ok"><div class="ok-icona" aria-hidden="true">✓</div><div><h2>Tutto incassato</h2>
      <div class="note" style="font-size:14px">Nessun contratto ha rate scadute non pagate (anche in parte) né spese da farsi rimborsare.</div></div></div>`;
    return;
  }
  main.innerHTML = `${testa}
    <div class="kpis">
      <div class="kpi glass kpi-allarme"><div class="sub">Da incassare</div><div class="v">${euro(r.totale)}</div><div class="note">${r.elenco.length} ${r.elenco.length === 1 ? "contratto" : "contratti"}</div></div>
      <div class="kpi glass"><div class="sub">Rate non pagate</div><div class="v" style="color:var(--late)">${euro(r.arretrati)}</div><div class="note">${r.n_contratti} ${r.n_contratti === 1 ? "contratto" : "contratti"} in ritardo</div></div>
      <div class="kpi glass"><div class="sub">Oltre 20 giorni</div><div class="v" style="color:${r.oltre_20 ? "var(--late)" : "var(--text)"}">${r.oltre_20}</div><div class="note">contratti</div></div>
      <div class="kpi glass"><div class="sub">Spese da rimborsare</div><div class="v" style="color:var(--warn)">${euro(r.rimborsi)}</div><div class="note">a carico degli inquilini</div></div>
    </div>
    <div class="ins-lista">${r.elenco.map(insCard).join("")}</div>
    <div class="note">Gravità: <b>critico</b> = oltre 60 giorni, 3 o più rate, o contratto chiuso con debiti; <b>grave</b> = oltre 20 giorni o 2 rate; <b>da sollecitare</b> = una rata da poco.
      Per la legge (art. 5 L. 392/1978) il mancato pagamento di una rata oltre 20 giorni dalla scadenza può giustificare lo sfratto per morosità: prima di agire sentite un legale o un'associazione di proprietari.</div>`;
  const per = (id) => r.elenco.find((x) => x.id === id);
  main.querySelectorAll("[data-sit]").forEach((b) => b.onclick = () => { S.view = "affitti"; S.aff.dett = b.dataset.sit; render(); });
  main.querySelectorAll("[data-paga]").forEach((b) => b.onclick = () => { const x = per(b.dataset.paga), m = x.mesi_insoluti[0]; apriPagamento({ contratto: x.id, mese: m.mese, importo: x.arretrati }); });
  main.querySelectorAll("[data-soll]").forEach((b) => b.onclick = () => apriSollecito(per(b.dataset.soll)));
  main.querySelectorAll("[data-rimb]").forEach((b) => b.onclick = async () => {
    const x = per(b.dataset.rimb);
    if (!window.confirm(`Segnare come rimborsate le ${x.spese_aperte.length} spese di ${x.titolare}?`)) return;
    for (const s of x.spese_aperte) await api.salva_spesa({ ...s, rimborsata: true });
    await dopoModifica("Spese segnate come rimborsate");
  });
}

function apriSollecito(x) {
  const righe = x.mesi_insoluti.map((m) => `- ${meseIt(m.mese)}: ${euro(m.residuo)}${m.pagato > 0 ? ` (versati ${euro(m.pagato)} su ${euro(m.dovuto)})` : ""}`);
  for (const s of x.spese_aperte) righe.push(`- ${s.descrizione}: ${euro(s.importo)} (spesa a suo carico da rimborsare)`);
  const testo = `Gentile ${x.titolare},\n\nle scrivo per l'immobile di ${x.indirizzo || x.immobile_nome}: dai miei conti risultano ancora da saldare\n\n${righe.join("\n")}\n\nTotale: ${euro(x.totale_dovuto)}.\n\nLe chiedo di provvedere al pagamento entro 7 giorni. Se ha già pagato, mi mandi per favore la ricevuta del bonifico così verifico.\n\nCordiali saluti`;
  const tel = String(x.titolare_telefono || "").replace(/[^\d+]/g, "").replace(/^00/, "+");
  const telWa = tel ? (tel.startsWith("+") ? tel.slice(1) : tel.length === 10 && tel.startsWith("3") ? "39" + tel : tel) : "";
  apriModal(`${testaModal("Sollecito di pagamento", `${esc(x.immobile_nome)} · ${esc(x.titolare)}`)}
    <div class="field"><label for="so-testo">Testo (puoi modificarlo)</label><textarea class="input" id="so-testo" rows="12" style="min-height:240px;font-family:inherit">${esc(testo)}</textarea></div>
    <div class="box" style="border-color:rgba(247,208,138,.35)"><div class="note">Email e messaggi <b>non sono cifrati</b>: il testo esce dall'archivio protetto. Non aggiungere codice fiscale o altri dati personali.
      Per un sollecito formale (messa in mora) usa raccomandata A/R o PEC.</div></div>
    <div class="actions" style="flex-wrap:wrap"><button class="btn" type="button" id="m-annulla">Annulla</button>
      <button class="btn" type="button" id="so-copia">Copia testo</button>
      ${telWa ? `<button class="btn" type="button" id="so-wa">WhatsApp</button>` : ""}
      <button class="btn primary" type="button" id="so-mail">${x.titolare_email ? "Apri la mail" : "Apri la mail (senza destinatario)"}</button></div>`, true);
  $("so-copia").onclick = () => navigator.clipboard.writeText(val("so-testo")).then(() => toast("Testo copiato")).catch(() => toast("Copia non riuscita: seleziona il testo a mano"));
  $("so-mail").onclick = () => {
    location.href = `mailto:${encodeURIComponent(x.titolare_email || "")}?subject=${encodeURIComponent("Sollecito pagamento affitto – " + x.immobile_nome)}&body=${encodeURIComponent(val("so-testo"))}`;
    chiudiModal();
  };
  if ($("so-wa")) $("so-wa").onclick = () => { window.open(`https://wa.me/${encodeURIComponent(telWa)}?text=${encodeURIComponent(val("so-testo"))}`, "_blank"); chiudiModal(); };
}

/* =====================================================================
   ASSICURAZIONI
   ===================================================================== */
function polizzaCard(a) {
  const riga = (t, v, stile = "") => `<div class="row"><span class="note">${t}</span><span style="text-align:right;${stile}">${v}</span></div>`;
  const pill = a.disdetta_il ? `<span class="stato grigio">Disdetta</span>` : a.stato === "scaduta" ? `<span class="stato rosso">Scaduta</span>` : a.stato === "in_scadenza" ? `<span class="stato giallo">In scadenza</span>` : `<span class="stato verde">Attiva</span>`;
  const FR = { 1: "annuale", 2: "semestrale", 4: "trimestrale", 12: "mensile" };
  return `<button type="button" class="conto-card glass" data-ass="${esc(a.id)}">
    <div class="row" style="align-items:flex-start"><h2>${esc(a.tipo_nome)}</h2>${pill}</div>
    <div class="note" style="margin-top:-6px">${esc(a.compagnia)}${a.numero ? ` · n. ${esc(a.numero)}` : ""}</div>
    <div class="conto-righe">
      ${riga("Casa", a.immobile_nome ? esc(a.immobile_nome) : `<span class="note">tutte / generale</span>`)}
      ${riga("Contraente", esc(a.contraente_nome))}
      ${riga("Premio annuo", `<span class="num">${euro(a.premio || 0)}</span>${a.frazionamento > 1 ? ` <span class="note">(${FR[a.frazionamento]} ${euro(a.rata)})</span>` : ""}`)}
      ${riga(a.stato === "scaduta" ? "Scaduta il" : "Scadenza", a.scadenza ? `${dataIt(a.scadenza)}${a.stato !== "scaduta" ? ` <span class="note">${quandoTesto(a.tra_giorni)}</span>` : ""}` : "—", a.stato === "scaduta" ? "color:var(--late)" : a.stato === "in_scadenza" ? "color:var(--warn)" : "")}
      ${a.disdetta_entro && a.stato !== "scaduta" ? (a.disdetta_entro < oggiIso() ? riga("Termine disdetta", `passato (${dataIt(a.disdetta_entro)}): si rinnova`, "color:var(--muted)") : riga("Disdetta entro", dataIt(a.disdetta_entro), giorniDa(a.disdetta_entro) <= 30 ? "color:var(--warn)" : "")) : ""}
      ${a.prossima_rata && a.stato !== "scaduta" ? riga("Prossimo pagamento", dataIt(a.prossima_rata)) : ""}
      ${a.massimale ? riga("Massimale", esc(a.massimale)) : ""}
      ${riga("Documenti", a.allegati ? `📎 ${a.allegati}` : `<span class="note">nessuno</span>`)}
    </div></button>`;
}

async function renderAssicurazioni() {
  const r = await api.assicurazioni_elenco();
  const main = $("main");
  main.innerHTML = `
    <div class="head"><div><div class="sub">Polizze delle case: scadenze, premi, disdette</div><h1>Assicurazioni</h1></div>
      <div class="azioni"><button class="btn primary" type="button" id="as-nuova">+ Nuova polizza</button></div></div>
    ${bannerInsoluti()}
    <div class="kpis">
      <div class="kpi glass"><div class="sub">Polizze attive</div><div class="v">${r.attive}</div><div class="note">${r.elenco.length - r.attive} scadute o disdette</div></div>
      <div class="kpi glass"><div class="sub">In scadenza</div><div class="v" style="color:${r.in_scadenza ? "var(--warn)" : "var(--text)"}">${r.in_scadenza}</div><div class="note">entro 30 giorni (o disdetta)</div></div>
      <div class="kpi glass"><div class="sub">Premi annui</div><div class="v" style="color:var(--out)">${euro(r.premi_annui)}</div><div class="note">a tuo carico</div></div>
      <div class="kpi glass"><div class="sub">Case scoperte</div><div class="v" style="color:${r.scoperte.length ? "var(--warn)" : "var(--in)"}">${r.scoperte.length}</div><div class="note">senza polizza attiva</div></div>
    </div>
    ${r.scoperte.length ? `<section class="card glass" style="border-color:rgba(247,208,138,.35)"><h2>Case senza polizza attiva</h2>
      <div class="chips">${r.scoperte.map((c) => `<button type="button" class="pick" data-scop="${esc(c.id)}">+ ${esc(c.nome)}</button>`).join("")}</div>
      <div class="note">Se la casa è coperta dalla polizza del condominio (globale fabbricati), registrala con contraente «Condominio».</div></section>` : ""}
    ${r.elenco.length ? `<div class="conti">${r.elenco.map(polizzaCard).join("")}</div>`
      : `<div class="empty glass" style="border-radius:20px">Nessuna polizza. Registra incendio e scoppio, RC, globale fabbricati del condominio, tutela del canone…
         L'app ti avvisa prima della scadenza e del termine per la disdetta, e allega il PDF della polizza cifrato.</div>`}`;
  collegaBanner(main);
  $("as-nuova").onclick = () => apriPolizza({}, () => render());
  main.querySelectorAll("[data-ass]").forEach((b) => b.onclick = () => apriPolizza({ id: b.dataset.ass }, () => render()));
  main.querySelectorAll("[data-scop]").forEach((b) => b.onclick = () => apriPolizza({ immobile: b.dataset.scop }, () => render()));
}

/* a: {id} per modificare, oppure valori iniziali (es. {immobile}). dopo(): cosa ridisegnare. */
async function apriPolizza(a, dopo = () => render()) {
  const T = api.affitti_tipi(), an = await api.anagrafiche();
  let x = a, allegati = [], mod = false;
  if (a.id) { const r = await api.assicurazione(a.id); if (!r) return; x = r.dati; allegati = r.allegati; mod = true; }
  const FR = [[1, "Annuale"], [2, "Semestrale"], [4, "Trimestrale"], [12, "Mensile"]];
  apriModal(`${testaModal(mod ? `${T.assicurazioni[x.tipo] || "Polizza"} · ${x.compagnia}` : "Nuova polizza")}
    <div class="form-griglia">
      <div class="field"><label for="po-casa">Casa</label><select class="input" id="po-casa"><option value="">Tutte / generale</option>${an.immobili.map((i) => `<option value="${esc(i.id)}" ${i.id === x.immobile ? "selected" : ""}>${esc(i.nome)}</option>`).join("")}</select></div>
      <div class="field"><label for="po-tipo">Tipo di copertura</label><select class="input" id="po-tipo">${Object.entries(T.assicurazioni).map(([k, t]) => `<option value="${k}" ${k === (x.tipo || "incendio") ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
      <div class="field"><label for="po-comp">Compagnia</label><input class="input" id="po-comp" value="${esc(x.compagnia || "")}"></div>
      <div class="field"><label for="po-num">Numero polizza</label><input class="input" id="po-num" value="${esc(x.numero || "")}" autocomplete="off"></div>
      <div class="field"><label for="po-contr">Contraente (chi paga)</label><select class="input" id="po-contr">${Object.entries(T.contraenti).map(([k, t]) => `<option value="${k}" ${k === (x.contraente || "proprietario") ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
      <div class="field"><label for="po-premio">Premio annuo (€)</label><input class="input" id="po-premio" inputmode="decimal" value="${esc(importoIt(x.premio))}"></div>
      <div class="field"><label for="po-fraz">Pagamento</label><select class="input" id="po-fraz">${FR.map(([k, t]) => `<option value="${k}" ${k === (+x.frazionamento || 1) ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div class="field"><label for="po-dec">Decorrenza (inizio copertura)</label><input class="input" id="po-dec" type="date" value="${esc(x.decorrenza || "")}"></div>
      <div class="field"><label for="po-dur">Durata (mesi)</label><input class="input" id="po-dur" inputmode="numeric" value="${esc(x.durata_mesi || 12)}"></div>
      <div class="field"><label for="po-pre">Preavviso disdetta (giorni)</label><input class="input" id="po-pre" inputmode="numeric" value="${esc(x.preavviso_giorni ?? 30)}"></div>
      <div class="field"><label for="po-mass">Massimale</label><input class="input" id="po-mass" value="${esc(x.massimale || "")}" placeholder="es. 500.000 €"></div>
      <div class="field"><label for="po-ag">Agente / contatti sinistri</label><input class="input" id="po-ag" value="${esc(x.agente || "")}"></div>
    </div>
    <label class="check"><input type="checkbox" id="po-tacito" ${x.tacito_rinnovo !== false ? "checked" : ""}> Tacito rinnovo (si rinnova da sola se non la disdici)</label>
    <div class="form-griglia"><div class="field"><label for="po-disd">Disdetta inviata il</label><input class="input" id="po-disd" type="date" value="${esc(x.disdetta_il || "")}"></div></div>
    <div class="field"><label for="po-note">Note (garanzie, franchigie…)</label><textarea class="input" id="po-note" rows="3" style="min-height:70px;font-family:inherit">${esc(x.note || "")}</textarea></div>
    ${mod ? `<div class="box"><div class="row" style="align-items:center"><b>Documenti</b><span class="note">cifrati nell'archivio</span></div>${righeAllegati(allegati)}
      <div><button class="btn small" type="button" id="po-allega">+ Allega la polizza (PDF)</button></div></div>` : ""}
    <div class="actions">${mod ? `<button class="btn" type="button" id="po-del" style="margin-right:auto">Elimina</button>` : ""}
      <button class="btn" type="button" id="m-annulla">Annulla</button><button class="btn primary" type="button" id="po-ok">Salva polizza</button></div>`, true);
  $("po-ok").onclick = async () => {
    const r = await conErrore(() => api.salva_assicurazione({ id: mod ? x.id : undefined, immobile: val("po-casa"), tipo: val("po-tipo"), compagnia: val("po-comp"),
      numero: val("po-num"), contraente: val("po-contr"), premio: val("po-premio"), frazionamento: val("po-fraz"), decorrenza: val("po-dec"),
      durata_mesi: val("po-dur"), preavviso_giorni: val("po-pre"), massimale: val("po-mass"), agente: val("po-ag"), tacito_rinnovo: $("po-tacito").checked,
      disdetta_il: val("po-disd"), note: val("po-note") }));
    if (!r) return;
    chiudiModal(); toast("Polizza salvata"); await aggiornaStato(); dopo();
    if (!mod) apriPolizza({ id: r.id }, dopo);
  };
  if ($("po-allega")) $("po-allega").onclick = () => allegaFile({ assicurazione: x.id }, () => { dopo(); apriPolizza({ id: x.id }, dopo); });
  collegaAllegati($("modal"), () => apriPolizza({ id: x.id }, dopo));
  if ($("po-del")) $("po-del").onclick = async () => {
    if (!window.confirm("Eliminare questa polizza e i suoi documenti?")) return;
    const r = await api.elimina_assicurazione(x.id);
    for (const al of r.allegati_tolti || []) await Allegati.elimina(al);
    chiudiModal(); toast("Polizza eliminata"); await aggiornaStato(); dopo();
  };
}

/* =====================================================================
   SCADENZE: calendario del mese + scadenziario
   ===================================================================== */
const FILTRI_CAL = { tutto: null, affitti: ["rata"], contratti: ["contratto", "disdetta", "registro", "istat"], assicurazioni: ["assicurazione", "premio"], promemoria: ["promemoria"] };
function filtraEventi(ev) {
  const f = FILTRI_CAL[S.cal.filtro];
  if (!f) return ev;
  return ev.filter((e) => f.includes(e.tipo) && !(S.cal.filtro === "contratti" && e.tipo === "disdetta" && e.assicurazione))
    .concat(S.cal.filtro === "assicurazioni" ? ev.filter((e) => e.tipo === "disdetta" && e.assicurazione) : [])
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}

async function renderScadenze() {
  const oggi = oggiIso();
  if (!/^\d{4}-\d{2}$/.test(S.cal.mese)) S.cal.mese = oggi.slice(0, 7);
  const [y, m] = S.cal.mese.split("-").map(Number);
  const primo = new Date(y, m - 1, 1), ultimo = new Date(y, m, 0);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const inizioGriglia = new Date(primo); inizioGriglia.setDate(1 - ((primo.getDay() + 6) % 7));
  const fineGriglia = new Date(ultimo); fineGriglia.setDate(ultimo.getDate() + (6 - ((ultimo.getDay() + 6) % 7)));
  const evMese = filtraEventi(await api.calendario(iso(inizioGriglia), iso(fineGriglia)));
  const prossimi = filtraEventi(await api.calendario(oggi, piuGiorniIso(oggi, 90)));
  const scaduti = filtraEventi(await api.calendario(piuGiorniIso(oggi, -365), piuGiorniIso(oggi, -1))).filter((e) => e.stato === "scaduto");
  const arretrati = scaduti.filter((e) => e.tipo !== "rata");          // gli affitti non pagati stanno in Insoluti
  const rateNonPagate = scaduti.filter((e) => e.tipo === "rata");
  const perGiorno = new Map();
  for (const e of evMese) { if (!perGiorno.has(e.data)) perGiorno.set(e.data, []); perGiorno.get(e.data).push(e); }
  const celle = [];
  for (let d = new Date(inizioGriglia); d <= fineGriglia; d.setDate(d.getDate() + 1)) celle.push(iso(d));
  const sel = S.cal.sel && perGiorno.has(S.cal.sel) ? S.cal.sel : "";
  const evSel = sel ? perGiorno.get(sel) : [];
  const nomeMese = `${MESI[m - 1]} ${y}`;
  const main = $("main");
  main.innerHTML = `
    <div class="head"><div><div class="sub">Calendario e scadenziario: affitti, contratti, tasse, assicurazioni, promemoria</div><h1>Scadenze</h1></div>
      <div class="azioni"><button class="btn primary" type="button" id="sc-prom">+ Promemoria</button></div></div>

    <div class="seg" role="group" aria-label="Mostra">${[["tutto", "Tutto"], ["affitti", "Affitti"], ["contratti", "Contratti e fisco"], ["assicurazioni", "Assicurazioni"], ["promemoria", "Promemoria"]]
      .map(([k, t]) => `<button type="button" data-cf="${k}" class="${S.cal.filtro === k ? "on" : ""}">${t}</button>`).join("")}</div>
    ${arretrati.length ? `<section class="card glass card-allarme"><h2>Da fare, già scaduto (${arretrati.length})</h2>${listaEventi(arretrati)}</section>` : ""}
    ${rateNonPagate.length && S.cal.filtro !== "promemoria" ? `<button type="button" class="banner-insoluti" data-vai="insoluti" style="background:rgba(255,90,90,.08);box-shadow:none">
      <span class="bi-icona" aria-hidden="true">!</span><span><b>${rateNonPagate.length} ${rateNonPagate.length === 1 ? "affitto scaduto non pagato" : "affitti scaduti non pagati"}</b>
      <span class="note" style="display:block;color:inherit;opacity:.85">Sono segnati in rosso nel calendario; il dettaglio è in Insoluti</span></span><span class="bi-freccia" aria-hidden="true">→</span></button>` : ""}
    <div class="cal-layout">
      <section class="card glass cal-card">
        <div class="cal-testa"><button class="icon-btn" type="button" id="sc-prec" aria-label="Mese precedente">‹</button>
          <h2 style="text-transform:capitalize">${esc(nomeMese)}</h2>
          <button class="icon-btn" type="button" id="sc-succ" aria-label="Mese successivo">›</button>
          <button class="btn small" type="button" id="sc-oggi" style="margin-left:auto">Oggi</button></div>
        <div class="cal-griglia" role="grid" aria-label="${esc(nomeMese)}">
          ${["lun", "mar", "mer", "gio", "ven", "sab", "dom"].map((g) => `<div class="cal-gs">${g}</div>`).join("")}
          ${celle.map((g) => {
            const ev = perGiorno.get(g) || [];
            const cls = ["cal-g", g.slice(0, 7) !== S.cal.mese ? "fuori" : "", g === oggi ? "oggi" : "", g === sel ? "sel" : "", ev.some((e) => e.stato === "scaduto") ? "allarme" : ""].filter(Boolean).join(" ");
            return `<button type="button" class="${cls}" data-g="${g}" ${ev.length ? "" : "tabindex=\"-1\""} aria-label="${+g.slice(8)} ${esc(MESI[+g.slice(5, 7) - 1])}: ${ev.length} scadenze">
              <span class="cal-n">${+g.slice(8)}</span>
              <span class="cal-ev">${ev.slice(0, 3).map((e) => `<i class="${COLORE_EVENTO[e.tipo]} st-${e.stato}" title="${esc(e.titolo)}">${esc(NOME_EVENTO[e.tipo])}</i>`).join("")}${ev.length > 3 ? `<i class="altro">+${ev.length - 3}</i>` : ""}</span></button>`;
          }).join("")}
        </div>
        <div class="legend g-legenda" style="padding:0">${[["e-rata", "Affitti"], ["e-contratto", "Contratti"], ["e-disdetta", "Disdette"], ["e-fisco", "Registro / ISTAT"], ["e-assic", "Assicurazioni"], ["e-prom", "Promemoria"]]
          .map(([c, t]) => `<span><i class="cal-pallino ${c}"></i>${t}</span>`).join("")}</div>
      </section>
      <section class="card glass">${sel ? `<div class="row" style="align-items:center"><h2>${dataIt(sel)}</h2><button class="btn small" type="button" id="sc-chiudi-g">Prossimi 90 giorni</button></div>${listaEventi(evSel)}`
        : `<h2>Prossimi 90 giorni</h2>${listaEventi(prossimi)}`}</section>
    </div>
    <div class="note">Le date di contratti e tasse sono calcolate dai dati inseriti: verifica sempre sui documenti. Clic su una scadenza per aprirla (un affitto apre la registrazione del pagamento).</div>`;
  collegaBanner(main);
  const vai = (n) => { const d = new Date(y, m - 1 + n, 1); S.cal.mese = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; S.cal.sel = ""; render(); };
  $("sc-prec").onclick = () => vai(-1); $("sc-succ").onclick = () => vai(1);
  $("sc-oggi").onclick = () => { S.cal.mese = oggi.slice(0, 7); S.cal.sel = perGiorno.has(oggi) ? oggi : ""; render(); };
  $("sc-prom").onclick = () => apriPromemoria(null, sel || oggi);
  if ($("sc-chiudi-g")) $("sc-chiudi-g").onclick = () => { S.cal.sel = ""; render(); };
  main.querySelectorAll("[data-cf]").forEach((b) => b.onclick = () => { S.cal.filtro = b.dataset.cf; render(); });
  main.querySelectorAll("[data-g]").forEach((b) => b.onclick = () => {
    if (!perGiorno.has(b.dataset.g)) return apriPromemoria(null, b.dataset.g);
    S.cal.sel = b.dataset.g; render();
  });
  // le liste sono tre: ognuna ha i suoi indici
  const sezioni = main.querySelectorAll(".ev-lista");
  const liste = [];
  if (arretrati.length) liste.push(arretrati);
  liste.push(sel ? evSel : prossimi);
  sezioni.forEach((s, i) => collegaEventi(s, liste[i] || [], () => render()));
}

/* ---------- Promemoria (anche ricorrenti) ---------- */
async function apriPromemoria(id, data) {
  const an = await api.anagrafiche();
  let p = { data: data || oggiIso(), ripeti: "no" };
  if (id) {
    const ev = (await api.calendario(data, data)).find((e) => e.promemoria === id);
    p = ev ? { id, data: null, titolo: ev.titolo, immobile: ev.immobile, ripeti: ev.ripeti, note: ev.note, occorrenza: data, fatto: ev.stato === "fatto" } : p;
  }
  const mod = Boolean(p.id);
  apriModal(`${testaModal(mod ? p.titolo : "Nuovo promemoria", mod && p.ripeti !== "no" ? `Ricorrente · scadenza del ${dataIt(p.occorrenza)}` : "")}
    ${mod ? `<label class="check" style="font-size:15px"><input type="checkbox" id="pr-fatto" ${p.fatto ? "checked" : ""}> Fatto${p.ripeti !== "no" ? ` (scadenza del ${dataIt(p.occorrenza)})` : ""}</label>` : ""}
    <div class="field"><label for="pr-tit">Cosa</label><input class="input" id="pr-tit" value="${esc(p.titolo || "")}" placeholder="es. Lettura contatori, Revisione caldaia, Rata IMU, Conguaglio spese"></div>
    <div class="form-griglia">
      ${mod ? "" : `<div class="field"><label for="pr-data">Data</label><input class="input" id="pr-data" type="date" value="${esc(p.data)}"></div>`}
      <div class="field"><label for="pr-rip">Si ripete</label><select class="input" id="pr-rip">${[["no", "No"], ["mese", "Ogni mese"], ["anno", "Ogni anno"]].map(([k, t]) => `<option value="${k}" ${k === p.ripeti ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div class="field"><label for="pr-casa">Casa</label><select class="input" id="pr-casa"><option value="">—</option>${an.immobili.map((i) => `<option value="${esc(i.id)}" ${i.id === p.immobile ? "selected" : ""}>${esc(i.nome)}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label for="pr-note">Note</label><input class="input" id="pr-note" value="${esc(p.note || "")}" placeholder="facoltative"></div>
    <div class="actions">${mod ? `<button class="btn" type="button" id="pr-del" style="margin-right:auto">Elimina</button>` : ""}
      <button class="btn" type="button" id="m-annulla">Annulla</button><button class="btn primary" type="button" id="pr-ok">Salva</button></div>`);
  $("pr-ok").onclick = async () => {
    if (mod) {
      const orig = await trovaPromemoria(id);
      const r = await conErrore(() => api.salva_promemoria({ id, data: orig, titolo: val("pr-tit"), immobile: val("pr-casa"), ripeti: val("pr-rip"), note: val("pr-note") }));
      if (!r) return;
      await api.promemoria_fatto(id, p.occorrenza, $("pr-fatto").checked);
      return dopoModifica("Promemoria salvato");
    }
    const r = await conErrore(() => api.salva_promemoria({ data: val("pr-data"), titolo: val("pr-tit"), immobile: val("pr-casa"), ripeti: val("pr-rip"), note: val("pr-note") }));
    if (r) await dopoModifica("Promemoria salvato");
  };
  if ($("pr-del")) $("pr-del").onclick = async () => {
    if (!window.confirm(p.ripeti !== "no" ? "Eliminare il promemoria e tutte le sue ripetizioni?" : "Eliminare il promemoria?")) return;
    await api.elimina_promemoria(id); await dopoModifica("Promemoria eliminato");
  };
}
async function trovaPromemoria(id) { const p = await api.promemoria_dati(id); return p ? p.data : oggiIso(); }
