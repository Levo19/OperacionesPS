// Service Worker — Operaciones PS
const CACHE_NAME = 'ops-v103';
const SHELL = [
    './index.html',
    './app.js',
    './supabase-data.js',
    './supabase-shim.js',
    './comprobante-share.js',
    './logo.png',
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

    // Solo GET es cacheable. HEAD/POST/etc → red nativa (Cache.put revienta con HEAD).
    if (e.request.method !== 'GET') return;

    // En desarrollo local (localhost / 127.0.0.1) → siempre red, nunca cache
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
        e.respondWith(fetch(e.request));
        return;
    }

    // Supabase → NO interceptar: que el navegador la maneje nativo. Si el SW hace
    // respondWith(fetch(...)), el abort/timeout de la página no se propaga y la
    // petición queda colgada ("Conectando..." infinito). Sin respondWith = nativo.
    if (url.includes('supabase.co')) return;

    // Llamadas a APIs externas → siempre red (nunca cachear respuestas del servidor)
    if (url.includes('googleapis.com')) {
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
                    if (e.request.method === "GET") caches.open(CACHE_NAME).then(c => c.put(e.request, clone)).catch(() => {});
                    return res;
                })
                .catch(() => caches.match(e.request))
        );
        return;
    }

    // Shell local (index.html, app.js) → red primero CON TIMEOUT de 4s, cache como respaldo.
    // Sin el timeout, al reabrir la PWA en iPhone con la red "despertando" el fetch del
    // index.html podía colgarse → pantalla en blanco/congelada. Ahora: 4s y arranca del
    // caché (y la red fresca actualiza el caché para la próxima).
    e.respondWith((async () => {
        const network = fetch(e.request).then(res => {
            if (res.ok) {
                const clone = res.clone();
                if (e.request.method === "GET") caches.open(CACHE_NAME).then(c => c.put(e.request, clone)).catch(() => {});
            }
            return res;
        });
        const timeout = new Promise(resolve => setTimeout(() => resolve(null), 4000));
        const winner = await Promise.race([network, timeout.then(() => null)]).catch(() => null);
        if (winner) return winner;
        const cached = await caches.match(e.request) || await caches.match('./index.html');
        if (cached) { network.catch(() => {}); return cached; }   // red sigue en 2º plano actualizando caché
        return network.catch(() => new Response('Sin conexión', { status: 503 }));
    })());
});
