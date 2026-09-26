// Service Worker: caches this app's own static files so it works offline once loaded.
// It never touches cross-origin requests. The cache version and the precache list below are
// filled in at build time (see scripts/vite-sw-plugin.mjs). A new version installs in the background and takes over once every tab
// using the old one is closed, so a running page never loses its lazy-loaded chunks.
const CACHE = 'hitorigoto-__VERSION__'
const ASSETS = __ASSETS__

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('hitorigoto-') && k !== CACHE).map(k => caches.delete(k)))),
  )
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(
      hit => hit ?? (request.mode === 'navigate' ? caches.match('/index.html') : undefined) ?? fetch(request),
    ),
  )
})
