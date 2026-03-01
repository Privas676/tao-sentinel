/* ═══════════════════════════════════════ */
/*   SERVICE WORKER — Push Notifications   */
/*   Handles incoming push events and      */
/*   notification click navigation         */
/* ═══════════════════════════════════════ */

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
      // Focus existing window if available
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open new window
      return clients.openWindow(url);
    })
  );
});
