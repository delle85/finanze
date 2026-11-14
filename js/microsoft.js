/* Finanze personali – accesso con l'account Microsoft personale (OAuth 2.0, codice + PKCE).
   Scritto a mano invece di usare MSAL: poche righe, nessuna libreria esterna.

   - Il codice arriva nel frammento (#code=...), quindi non passa mai dal server che ospita la pagina.
   - I token restano in sessionStorage (solo questa scheda, cancellati alla chiusura).
   - Nessun segreto: l'app è registrata come "applicazione a pagina singola" (SPA).
   - Permessi: Files.ReadWrite (+ offline_access per rinnovare il token, openid/profile per il nome utente). */
(function (G) {
"use strict";
const CLIENT_ID = "2255c691-7f94-436f-a867-03e05a6f4217";
const AUTORITA = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const SCOPE_BASE = "openid profile offline_access Files.ReadWrite";
const SCOPE_ESTESO = "openid profile offline_access Files.ReadWrite Files.ReadWrite.All";
const K_TOKEN = "fin_ms_token", K_PKCE = "fin_ms_pkce", K_UTENTE = "fin_ms_utente", K_ESTESO = "fin_ms_esteso";

class NonCollegato extends Error {}

const b64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const casuale = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const leggi = (st, k) => { try { return JSON.parse(st.getItem(k) || "null"); } catch (e) { return null; } };
const scrivi = (st, k, v) => { try { v === null ? st.removeItem(k) : st.setItem(k, JSON.stringify(v)); } catch (e) { /* */ } };

/* Indirizzo di ritorno: la pagina stessa, senza "index.html" (deve coincidere con quello registrato). */
const ritornoUri = () => location.origin + location.pathname.replace(/index\.html$/, "");
const scope = () => (leggi(localStorage, K_ESTESO) ? SCOPE_ESTESO : SCOPE_BASE);

/* Va alla pagina di accesso Microsoft. dopo: azione da riprendere al ritorno (stringa).
   silenzioso: prompt=none (rientra subito se l'utente è già collegato a Microsoft in questo browser). */
async function accedi({ dopo = "", silenzioso = false, esteso = false } = {}) {
  if (esteso) scrivi(localStorage, K_ESTESO, true);
  const verificatore = casuale(48);
  const sfida = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verificatore))));
  const stato = casuale(24);
  scrivi(sessionStorage, K_PKCE, { verificatore, stato, dopo, silenzioso });
  const p = new URLSearchParams({
    client_id: CLIENT_ID, response_type: "code", redirect_uri: ritornoUri(), response_mode: "fragment",
    scope: scope(), code_challenge: sfida, code_challenge_method: "S256", state: stato,
  });
  const utente = leggi(localStorage, K_UTENTE);
  if (utente && utente.email) p.set("login_hint", utente.email);
  if (silenzioso) p.set("prompt", "none");
  else if (!utente) p.set("prompt", "select_account");
  location.assign(`${AUTORITA}/authorize?${p}`);
  return new Promise(() => {});                       // la pagina sta cambiando
}

async function chiediToken(parametri) {
  const r = await fetch(`${AUTORITA}/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: scope(), ...parametri }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new NonCollegato(j.error_description || j.error || `Errore ${r.status}`); e.codice = j.error; throw e; }
  return j;
}

function salvaToken(j) {
  const vecchio = leggi(sessionStorage, K_TOKEN) || {};
  const t = { accesso: j.access_token, scade: Date.now() + (j.expires_in || 3600) * 1000, rinnovo: j.refresh_token || vecchio.rinnovo };
  scrivi(sessionStorage, K_TOKEN, t);
  if (j.id_token) {
    try {
      const pl = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(j.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
      scrivi(localStorage, K_UTENTE, { email: pl.preferred_username || pl.email || "", nome: pl.name || "" });
    } catch (e) { /* */ }
  }
  return t;
}

/* Da chiamare all'avvio: se la pagina torna dalla pagina di accesso, scambia il codice con il token.
   -> null (niente da fare) | {ok:true, dopo} | {ok:false, dopo, serveAccesso:bool, errore} */
async function gestisciRitorno() {
  if (!location.hash || !/[#&](code|error)=/.test(location.hash)) return null;
  const q = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, "", location.pathname + location.search);   // toglie il codice dall'indirizzo
  const pkce = leggi(sessionStorage, K_PKCE);
  scrivi(sessionStorage, K_PKCE, null);
  if (!pkce || q.get("state") !== pkce.stato) return { ok: false, dopo: "", errore: "Risposta di accesso non valida: riprova." };
  if (q.get("error")) {
    const err = q.get("error");
    return { ok: false, dopo: pkce.dopo, silenzioso: pkce.silenzioso,
      serveAccesso: ["login_required", "interaction_required", "consent_required", "account_selection_required"].includes(err),
      errore: q.get("error_description") || err };
  }
  try {
    salvaToken(await chiediToken({ grant_type: "authorization_code", code: q.get("code"), redirect_uri: ritornoUri(), code_verifier: pkce.verificatore }));
    return { ok: true, dopo: pkce.dopo };
  } catch (e) {
    return { ok: false, dopo: pkce.dopo, errore: e.message };
  }
}

/* Token valido per Graph; lo rinnova se sta per scadere. NonCollegato se serve un nuovo accesso. */
let rinnovoInCorso = null;
async function token() {
  const t = leggi(sessionStorage, K_TOKEN);
  if (t && t.accesso && t.scade - Date.now() > 120000) return t.accesso;
  if (!t || !t.rinnovo) throw new NonCollegato("Accesso a Microsoft necessario.");
  if (!rinnovoInCorso) {
    rinnovoInCorso = chiediToken({ grant_type: "refresh_token", refresh_token: t.rinnovo })
      .then((j) => salvaToken(j).accesso)
      .catch((e) => { scrivi(sessionStorage, K_TOKEN, null); throw new NonCollegato(e.message); })
      .finally(() => { rinnovoInCorso = null; });
  }
  return rinnovoInCorso;
}

const collegato = () => { const t = leggi(sessionStorage, K_TOKEN); return Boolean(t && (t.accesso || t.rinnovo)); };
const utente = () => leggi(localStorage, K_UTENTE);
function esci() { scrivi(sessionStorage, K_TOKEN, null); scrivi(localStorage, K_UTENTE, null); scrivi(localStorage, K_ESTESO, null); }
const scopeEsteso = () => Boolean(leggi(localStorage, K_ESTESO));

G.Microsoft = { CLIENT_ID, NonCollegato, accedi, gestisciRitorno, token, collegato, utente, esci, scopeEsteso, ritornoUri };
})(globalThis);
