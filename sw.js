/* Toon It! Service Worker v1.0 — PWA Phase 1 */
const CACHE_NAME = 'toonit-v1';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/myvideos.html',
  '/gallery.html',
  '/manifest.json',
  '/offline.html',
  '/privacy.html',
  '/terms.html'
];

/* ── Install: pre-cache app shell ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate: clean old caches ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch: network-first for API/dynamic, cache-first for shell ── */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET, cross-origin API calls, Supabase, Stripe, Cloudinary video
  if (event.request.method !== 'GET') return;
  if (url.origin !== location.origin &&
      !url.hostname.includes('fonts.googleapis.com') &&
      !url.hostname.includes('fonts.gstatic.com')) return;

  // For HTML pages: network-first with cache fallback
  if (event.request.mode === 'navigate' ||
      event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request)
          .then(cached => cached || caches.match('/offline.html')))
    );
    return;
  }

  // For static assets (fonts, CSS in future): cache-first
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }))
  );
});

/* ── Push notification handler (ready for Phase 2 Capacitor) ── */
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  const title = data.title || 'Toon It!';
  const options = {
    body: data.body || 'Your magical transformation is ready! ✨',
    icon: '/assets/icons/toonit-icon-192.png',
    badge: '/assets/icons/toonit-icon-96.png',
    data: data.url || '/',
    actions: [
      { action: 'open', title: 'View Now ✨' },
      { action: 'dismiss', title: 'Later' }
    ]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/* ── Notification click handler ── */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes('toonit.ai') && 'focus' in client) return client.focus();
      }
      return clients.openWindow(event.notification.data || '/');
    })
  );
});
