const CACHE_NAME = "anmika-pwa-20260628-sound-action-once-a";
const TILE_CACHE_NAME = "anmika-tile-assets-v7";
const APP_SHELL = [
  "/",
  "/index.html",
  "/online-debug/index.html",
  "/replay.html",
  "/styles.css?v=20260628-sound-action-once-a",
  "/runtime/app.js?v=20260628-sound-action-once-a",
  "/runtime/online-debug.js?v=20260628-sound-action-once-a",
  "/runtime/pwa.js?v=20260628-sound-action-once-a",
  "/runtime/supabase-public-config.js",
  "/manifest.json",
  "/public/icons/anmika-icon.svg",
  "/sounds/pon.wav",
  "/sounds/kan.wav",
  "/sounds/ron.wav",
  "/sounds/tsumo.wav",
  "/sounds/riichi.wav",
  "/sounds/fever-riichi.wav",
  "/sounds/baiba.wav",
  "/sounds/pochi-tsumo-red.wav",
  "/sounds/pochi-tsumo-blue.wav",
  "/sounds/dapai.m4a",
  "/sounds/discard.m4a",
  "/sounds/discard.mp3",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => null));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME && key !== TILE_CACHE_NAME).map((key) => caches.delete(key))))
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

  if (url.pathname.startsWith("/tiles/") || url.pathname.startsWith("/sounds/")) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => cached || fetch(request).then((response) => {
          if (response.ok) cache.put(request, response.clone()).catch(() => null);
          return response;
        }))
      )
    );
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
