// Service Worker — Operaciones PS
const CACHE_NAME = 'ops-v1';
const SHELL = [
    './index.html',
    './app.js',
    './manifest.json',
    './icon.svg'
];

// Instalación: cachear la shell de la app
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL))
    );
    self.skipWaiting();
});

// Activación: limpiar caches viejos
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: estrategia mixta
self.addEventListener('fetch', e => {
    let url = e.request.url;

    // Llamadas a GAS → siempre red (nunca cachear respuestas del servidor)
    if (url.includes('script.google.com') || url.includes('googleapis.com')) {
        e.respondWith(fetch(e.request).catch(() =>
            new Response(JSON.stringify({ error: 'Sin conexión' }), {
                headers: { 'Content-Type': 'application/json' }
            })
        ));
        return;
    }

    // CDN externos (Tailwind, Font Awesome) → red primero, cache como respaldo
    if (url.includes('cdn.tailwindcss.com') || url.includes('cdnjs.cloudflare.com')) {
        e.respondWith(
            fetch(e.request)
                .then(res => {
                    let clone = res.clone();
                    caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
                    return res;
                })
                .catch(() => caches.match(e.request))
        );
        return;
    }

    // Shell local (index.html, app.js) → cache primero, red como respaldo
    e.respondWith(
        caches.match(e.request).then(cached => {
            if (cached) return cached;
            return fetch(e.request).then(res => {
                if (res.ok) {
                    let clone = res.clone();
                    caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
                }
                return res;
            });
        }).catch(() =>
            // Offline y sin cache: mostrar index como fallback
            caches.match('./index.html')
        )
    );
});
