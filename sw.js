/* ПУСТОШЬ — офлайн-обёртка: игра открывается без сети */
const C = 'pustosh-v1';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(['./'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // API и релей — мимо кэша
  e.respondWith(
    caches.match('./').then(hit => {
      const net = fetch(e.request).then(r => {
        if (r && r.ok) caches.open(C).then(c2 => c2.put('./', r.clone()));
        return r;
      }).catch(() => hit);
      return hit || net; // мгновенно из кэша, свежак подтянется к следующему запуску
    })
  );
});
