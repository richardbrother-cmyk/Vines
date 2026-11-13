// Service worker mínimo: permite abrir la app y reanudar un conteo sin red.
//  - /_next/static y recursos estáticos: cache primero
//  - navegaciones: red primero, con la última copia como respaldo
//  - rutas de datos de Supabase NO se interceptan (la cola offline vive en IndexedDB)
const VERSION = "v1";
const CACHE = `inventario-${VERSION}`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || /\.(svg|png|webmanifest|woff2?)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((r) => {
        const copia = r.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); return r;
      })),
    );
    return;
  }

  if (req.mode === "navigate" || req.headers.get("RSC")) {
    e.respondWith(
      fetch(req).then((r) => {
        if (r.ok && !r.redirected) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
        return r;
      }).catch(() => caches.match(req).then((hit) => hit || Response.error())),
    );
  }
});
