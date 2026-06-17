const CACHE_NAME = "anmika-pwa-20260618-one-global-seat-a";
const APP_SHELL = [
  "/",
  "/index.html",
  "/online-debug/index.html",
  "/replay.html",
  "/styles.css?v=20260618-riichi-discard-round-a",
  "/runtime/app.js?v=20260618-riichi-discard-round-a",
  "/runtime/online-debug.js?v=20260618-one-global-seat-a",
  "/runtime/pwa.js?v=20260618-auto-refresh-a",
  "/runtime/supabase-public-config.js",
  "/manifest.json",
  "/public/icons/anmika-icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => null));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/socket.io/") || url.pathname.startsWith("/api/") || url.pathname === "/health") return;

  if (request.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname === "/online-debug") {
    event.respondWith(fetch(request).catch(() => caches.match(request).then((cached) => cached || caches.match("/online-debug/index.html"))));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => null);
      return response;
    }))
  );
});
