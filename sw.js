// Service Worker — Operaciones PS
const CACHE_NAME = 'ops-v56';
const SHELL = [
    './index.html',
    './app.js',
    './supabase-data.js',
    './supabase-shim.js',
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

    // En desarrollo local (localhost / 127.0.0.1) → siempre red, nunca cache
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
        e.respondWith(fetch(e.request));
        return;
    }

    // Supabase → NO interceptar: que el navegador la maneje nativo. Si el SW hace
    // respondWith(fetch(...)), el abort/timeout de la página no se propaga y la
    // petición queda colgada ("Conectando..." infinito). Sin respondWith = nativo.
    if (url.includes('supabase.co')) return;

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

    // Shell local (index.html, app.js) → red primero, cache como respaldo (siempre jala última versión)
    e.respondWith(
        fetch(e.request)
            .then(res => {
                if (res.ok) {
                    let clone = res.clone();
                    caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
                }
                return res;
            })
            .catch(() =>
                caches.match(e.request).then(cached => cached || caches.match('./index.html'))
            )
    );
});
