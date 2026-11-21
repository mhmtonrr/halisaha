// Halısaha: web push service worker. Sadece bildirim gösterir ve tıklamada ilgili sayfayı açar (önbellek yok).

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Halısaha";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      // Aynı etiketli bildirim cihazda birbirinin yerine geçer (ör. aynı gruptan sohbet mesajları tek kalır)
      tag: typeof data.tag === "string" ? data.tag : undefined,
      icon: "/icon.svg",
      badge: "/icon.svg",
      // Aynı etiketli bildirim yer değiştirirken de ses/titreşimle uyar (yoksa sessizce değişir ve fark edilmez)
      renotify: typeof data.tag === "string" && data.tag.length > 0,
      vibrate: [200, 100, 200],
      data: { url: typeof data.url === "string" ? data.url : "/" },
    }),
  );
});

// Tıklayınca: sadece aynı sitenin yolları açılır (dışarıdan gelen bir adres açılmaz)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let target = new URL("/", self.location.origin);
  try {
    const u = new URL(event.notification.data?.url || "/", self.location.origin);
    if (u.origin === self.location.origin) target = u;
  } catch {
    // geçersiz adres: ana sayfa
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          if ("navigate" in client) client.navigate(target.href);
          return client.focus();
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
