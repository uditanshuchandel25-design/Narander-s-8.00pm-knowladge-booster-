const CACHE_NAME = "bm-daily-intel-v13";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/bm-logo-192.png",
  "./icons/bm-logo.png",
  "./icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first with clean offline cache keys so fresh 8PM data never gets stuck behind stale cache
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isDataJson = url.pathname.includes("/data/") && url.pathname.endsWith(".json");
  const cacheKey = isDataJson ? new Request(url.origin + url.pathname) : request;

  event.respondWith(
    fetch(request, { cache: "no-store" })
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, clone));
        }
        return response;
      })
      .catch(() => caches.match(cacheKey))
  );
});
