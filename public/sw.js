// Cache-first shell so the game opens instantly and works with no connection.
// Bump CACHE on every release or browsers will serve the old build forever.
const CACHE = "blockpuzzle-v23";

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // The leaderboard API always comes from the network: a cached board or health check would be stale.
  if (new URL(e.request.url).pathname.startsWith("/api/")) return;
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit ??
      fetch(e.request).then((res) => {
        // Cache same-origin successes so hashed JS/CSS from the build land in the shell too.
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          void caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match("/index.html"))
    )
  );
});
