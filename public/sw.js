// Service worker: lets the installed game start with no connection.
// Online, everything comes fresh from the network (so updates show at once);
// each good response is also saved, and the saved copy is used when offline.
// The game's code files have a unique name per version, so those are served
// straight from the saved copy.
const CACHE = 'stillpoint-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (url.pathname.startsWith('/assets/')) {
      const saved = await cache.match(req);
      if (saved) return saved;
    }
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const saved = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
      return saved || (req.mode === 'navigate' ? cache.match('/') : Response.error());
    }
  })());
});
