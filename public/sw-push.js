/* ═══════════════════════════════════════ */
/*   SERVICE WORKER — Push Notifications   */
/*   v0.1.15 — preview-fix                 */
/* ═══════════════════════════════════════ */

const CACHE_VERSION = "tao-sentinel-v0.1.15";

// ── Clear ALL old caches on activate ──
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_VERSION)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Skip waiting — take control immediately ──
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// ── Push handling ──
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "Tao Sentinel", body: event.data.text() };
  }

  const title = data.title || "Tao Sentinel";
  const options = {
    body: data.body || "",
    icon: "/pwa-192x192.png",
    badge: "/pwa-192x192.png",
    tag: data.tag || "tao-sentinel",
    renotify: true,
    vibrate: [200, 100, 200],
    data: {
      url: data.url || "/alerts",
    },
    actions: [
      { action: "view", title: "Voir" },
      { action: "dismiss", title: "OK" },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") return;

  const url = event.notification.data?.url || "/alerts";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
