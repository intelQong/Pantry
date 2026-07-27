// Pantry service worker — push notifications only, no offline caching.
// The app needs the network to talk to the API; caching would add
// complexity with no benefit for two users on home wifi or mobile data.

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
