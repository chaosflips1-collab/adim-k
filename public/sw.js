// Service Worker: uygulama kabuğunu (app shell) önbelleğe alır ki PWA gerçekten
// offline/zayıf bağlantıda açılabilsin. Önceki sürüm hiçbir şeyi cache'lemiyordu
// (sadece ağ isteğini deniyor, başarısız olursa boş bir cache.match'e düşüyordu -
// hiçbir zaman gerçekten dolu bir cache olmadığı için bu her zaman başarısız olurdu).
//
// Strateji:
// - App shell (HTML/JSON/SVG - CSS ve JS gömülü olduğu için ayrı dosya yok):
//   stale-while-revalidate. Önce cache'ten hemen döndürülür (hızlı açılış +
//   offline çalışma), arka planda ağdan taze kopya çekilip cache güncellenir.
// - API istekleri (/api/v2/...): HİÇ cache'lenmez - puan/adım gibi veriler bayat
//   önbellekten asla servis edilmemeli, her zaman ağa gider.
// - Cache sürümü (CACHE_NAME) değiştirildiğinde eski cache activate sırasında
//   silinir, böylece bir sonraki deploy'da kullanıcılar eski app shell'de
//   takılı kalmaz.

const CACHE_VERSION = 'v1';
const CACHE_NAME = `adimkasasi-shell-${CACHE_VERSION}`;
const APP_SHELL = [
    '/index.html',
    '/dashboard.html',
    '/manifest.json',
    '/assets/icon.svg',
    '/assets/google-icon.svg'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .catch(() => {}) // Bir dosya offline ilk kurulumda çekilemezse install'ı düşürme.
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) =>
            Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // API istekleri: her zaman ağa git, hiçbir zaman cache'ten servis etme.
    if (url.pathname.startsWith('/api/')) return;
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
            const cached = await cache.match(event.request);
            const networkFetch = fetch(event.request)
                .then((response) => {
                    if (response && response.ok) cache.put(event.request, response.clone());
                    return response;
                })
                .catch(() => cached);
            return cached || networkFetch;
        })
    );
});
