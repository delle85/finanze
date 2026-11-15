/* Service worker: rende l'app installabile e utilizzabile anche senza rete.
   Mette in cache SOLO i file dell'app (mai i dati, che stanno cifrati in IndexedDB).
   Ad ogni modifica dei file aumentare VERSIONE. */
const VERSIONE = "finanze-v12";
const FILE = [
  "./", "index.html", "manifest.webmanifest", "css/stile.css", "css/web.css",
  "lib/xlsx.full.min.js", "js/core.js", "js/caratteri.js", "js/affitti.js", "js/api.js", "js/allegati.js", "js/affitti-ui.js", "js/immobili-ui.js", "js/cassaforte.js", "js/impronta.js", "js/unione.js",
  "js/microsoft.js", "js/nuvola.js", "js/ui.js", "js/porta.js",
  "icone/icona-64.png", "icone/icona-256.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSIONE).then((c) => c.addAll(FILE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((k) => Promise.all(k.filter((x) => x !== VERSIONE).map((x) => caches.delete(x))))
    .then(() => self.clients.claim()));
});

/* Prima la rete (così gli aggiornamenti arrivano subito), poi la cache se offline.
   Solo i file dell'app elencati sopra: tutto il resto (altri file, OneDrive nella fase 2)
   passa senza toccarlo e non finisce mai in cache. */
const BASE = new URL("./", self.location).href;
const IN_CACHE = new Set(FILE.map((f) => new URL(f, BASE).href));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url); url.search = ""; url.hash = "";
  if (req.method !== "GET" || !IN_CACHE.has(url.href)) return;
  e.respondWith(
    fetch(req, { cache: "no-cache" }).then((r) => {
      if (r.ok) { const copia = r.clone(); caches.open(VERSIONE).then((c) => c.put(req, copia)); }
      return r;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
