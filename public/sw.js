const CACHE_NAME = "gymflow-cache-v1";
const OFFLINE_URL = "/offline.html";

// Assets to cache immediately on install
const PRECACHE_ASSETS = [
  "/",
  "/favicon.ico",
  "/icon.jpg",
  OFFLINE_URL
];

self.addEventListener("install", (event) => {
  (event as InstallEvent).waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  (self as any).skipWaiting();
});

self.addEventListener("activate", (event) => {
  (event as ExtendableEvent).waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  (self as any).clients.claim();
});

self.addEventListener("fetch", (event: any) => {
  // Only handle GET requests and local requests
  if (event.request.method !== "GET" || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Exclude API routes and hot-reloading/development endpoints
  if (event.request.url.includes("/api/") || event.request.url.includes("/_next/")) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // If successful, clone response and cache it
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // If network request fails, look in cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // If fallback page matches navigation request, serve offline page
          if (event.request.mode === "navigate") {
            return caches.match(OFFLINE_URL);
          }
          return Promise.reject("no-match");
        });
      })
  );
});
