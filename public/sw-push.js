/* ═══════════════════════════════════════ */
/*   SERVICE WORKER — Push Notifications   */
/*   v0.3.1 — sentinel-core                */
/* ═══════════════════════════════════════ */

const CACHE_VERSION = "tao-sentinel-v0.3.1";

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
  console.log("[SW-Push] push event received", event.data ? "with data" : "empty");

  if (!event.data) {
    // Empty push — show a generic notification
    event.waitUntil(
      self.registration.showNotification("TAO Sentinel", {
        body: "Nouvelle alerte disponible",
        icon: "/pwa-192x192.png",
        badge: "/pwa-192x192.png",
        tag: "tao-sentinel-generic",
      })
    );
    return;
  }

  let data;
  try {
    data = event.data.json();
    console.log("[SW-Push] parsed payload:", JSON.stringify(data));
  } catch (e) {
    console.warn("[SW-Push] Failed to parse JSON, using text:", e);
    data = { title: "TAO Sentinel", body: event.data.text() };
  }

  const title = data.title || "TAO Sentinel";
  const options = {
    body: data.body || "",
    icon: "/pwa-192x192.png",
    badge: "/pwa-192x192.png",
    tag: data.tag || "tao-sentinel",
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200],
    silent: false,
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
