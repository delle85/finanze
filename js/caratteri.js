/* Finanze personali – dimensione dei caratteri.

   Tutti i testi del foglio di stile sono in rem (multipli della dimensione di base): cambiando solo la
   base, titoli, testi e note crescono nella stessa proporzione e la gerarchia resta quella di sempre.
   Anche le larghezze che contengono testo (menu, colonne, schede) sono in rem, quindi crescono con i
   caratteri: le griglie passano da sole a meno colonne invece di schiacciare il testo.
   La scelta vale solo per questo dispositivo (localStorage, non è un dato riservato) e si applica
   prima di disegnare la pagina, già nella schermata di sblocco. Caricato nel <head>. */
(function (G) {
"use strict";
const CHIAVE = "finanze-caratteri";
const SCELTE = [
  { p: 90, nome: "Piccoli" },
  { p: 100, nome: "Normali" },
  { p: 115, nome: "Grandi" },
  { p: 130, nome: "Molto grandi" },
  { p: 150, nome: "Enormi" },
];
const valido = (p) => SCELTE.some((s) => s.p === p);

function applica(p) {
  const r = document.documentElement;
  r.style.fontSize = `${16 * p / 100}px`;   // 100% = 16px come prima (non la base del browser)
  if (p >= 130) r.dataset.caratteri = String(p); else delete r.dataset.caratteri;
}

let attuale = 100;
try { const v = +localStorage.getItem(CHIAVE); if (valido(v)) attuale = v; } catch (e) { /* storage non disponibile */ }
applica(attuale);

G.Caratteri = {
  SCELTE,
  valore: () => attuale,
  imposta(p) {
    if (!valido(p)) return;
    attuale = p;
    try { if (p === 100) localStorage.removeItem(CHIAVE); else localStorage.setItem(CHIAVE, String(p)); } catch (e) { /* resta per questa sessione */ }
    applica(p);
  },
};
})(window);
