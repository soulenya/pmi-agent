/* Little Gerry service worker: Web Push only. No caching — the app is
   online-only by decision, and a cached shell would outlive its build. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Little Gerry", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Little Gerry";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || "/waiting?tab=notifications" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/today", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const same = list.find((c) => c.url.startsWith(self.location.origin));
      if (same) {
        same.focus();
        return same.navigate ? same.navigate(target) : undefined;
      }
      return self.clients.openWindow(target);
    }),
  );
});
