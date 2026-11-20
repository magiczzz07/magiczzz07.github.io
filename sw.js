const CACHE_NAME = "magicz-pwa-v3";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/site.webmanifest",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/assets/css/magicz-ota.css",
  "/assets/js/morphicons.bundle.js",
  "/assets/js/ipa-parser.js",
  "/assets/js/magicz-ota.js",
  "/assets/brand/magicz-mark.svg",
  "/assets/brand/magicz-wordmark.webp",
  "/assets/brand/magicz-emblem.webp",
  "/assets/brand/magicz-hero-bg.webp"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Luon goi mang cho du lieu dong va API may chu
  if (url.origin !== self.location.origin || url.pathname.startsWith("/data/")) {
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
