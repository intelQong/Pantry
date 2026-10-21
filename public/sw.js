// Pantry service worker — push notifications, and enough caching to open the
// app in a shop with no signal.
//
// The offline story is split in two. This file is only responsible for the
// *shell*: HTML, JS, CSS, fonts and icons. Data and mutations are the app's
// job (src/client/lib/cache.ts and outbox.ts), because they need the session
// cookie, conflict handling and a UI to report sync results — none of which
// belongs in a worker that also has to stay simple enough to reason about
// while handling push.
//
// No build step generates a precache manifest. Vite content-hashes every file
// under /assets/, so those URLs are immutable and cache-first is exactly right
// for them; everything else is a fixed, known path.

// Bump to retire every cached shell file, e.g. after an icon changes: icons
// are served cache-first, so without a bump installed apps keep the old one.
const VERSION = "pantry-v2";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

// The paths that have no hash in their name and so must be named explicitly.
const SHELL_URLS = [
  "/",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/icon.svg",
  "/apple-touch-icon.png",
  "/fonts/hanken-grotesk.woff2",
  "/fonts/source-serif-4.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // addAll is all-or-nothing: one 404 would reject the whole install and
      // leave the app with no offline shell at all. Each URL is added on its
      // own so a missing icon costs only that icon.
      .then((cache) => Promise.all(SHELL_URLS.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The API is never cached here. A stale list served silently from a cache is
  // worse than a failed request the app can see and handle: the app falls back
  // to its own snapshot and can then say the data is stale.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network first, so a running deploy is picked up immediately,
  // falling back to the cached shell. Mirrors the SPA fallback that
  // wrangler.jsonc already does server-side (not_found_handling).
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((cache) => cache.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/").then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Hashed build output and fonts: cache-first. The filenames change whenever
  // the contents do, so a hit is always current and never needs revalidating.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/fonts/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(ASSETS).then((cache) => cache.put(request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Everything else (icons, manifest): cached copy if there is one, network
  // otherwise.
  event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
});

self.addEventListener("push", (event) => {
  let body = "You have items to restock";
  let title = "Pantry";
  let data = {};

  if (event.data) {
    try {
      const payload = event.data.json();
      title = payload.title || title;
      body = payload.body || body;
      data = payload.data || {};
    } catch {
      body = event.data.text() || body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "pantry-restock",
      renotify: true,
      data,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus an existing window if one is open
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      // Otherwise open a new one
      return self.clients.openWindow(url);
    }),
  );
});
