// Service worker: keeps the app shell available offline so Lantern reopens instantly.
// API calls always go to the network. Thumbnails are cached (their URLs are versioned).
const SHELL = 'lantern-shell-v1';
const THUMBS = 'lantern-thumbs-v1';
const CORE = ['/', '/index.html', '/css/app.css', '/js/app.js', '/js/lib/dom.js', '/js/lib/api.js', '/js/lib/state.js', '/js/lib/icons.js', '/js/lib/thumbs.js', '/js/ui/overlays.js', '/js/views/characters.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, THUMBS].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/img/thumb/')) {
    e.respondWith(caches.open(THUMBS).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  if (url.pathname.startsWith('/img/')) return;
  // App shell: network first (fresh code after updates), cache fallback when offline.
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))));
});
