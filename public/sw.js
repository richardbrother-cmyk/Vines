// Service worker mínimo: permite reanudar un conteo sin red.
//  - /_next/static y recursos estáticos: caché primero (solo respuestas correctas)
//  - ÚNICAMENTE la pantalla de conteo (/conteos/<id>) se guarda como respaldo sin red.
//    Dashboard, unidades, fichas y cargas (que muestran costos y saldos) NUNCA se guardan.
//  - Las llamadas a Supabase no se interceptan (la cola offline vive en IndexedDB).
//  - Al cerrar sesión la app borra esta caché (ver borrarDatosLocales).
const CACHE = "inventario-v2"; // debe coincidir con NOMBRE_CACHE en src/lib/offline.ts
const ES_CONTEO = /^\/conteos\/[0-9a-f-]{36}$/;

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
        if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
        return r;
      })),
    );
    return;
  }

  if (req.mode === "navigate" && ES_CONTEO.test(url.pathname)) {
    e.respondWith(
      fetch(req).then((r) => {
        if (r.ok && !r.redirected) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(url.pathname, copia)); }
        return r;
      }).catch(() => caches.match(url.pathname).then((hit) => hit || Response.error())),
    );
  }
});
