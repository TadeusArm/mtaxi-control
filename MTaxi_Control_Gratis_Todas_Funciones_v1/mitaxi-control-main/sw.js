// MiTaxi Control - service worker.
// Sólo cachea el "app shell" (HTML/CSS/JS/iconos/fuentes).
// Nunca toca /api/ ni las peticiones que no sean GET: la sincronización
// y el almacenamiento (localStorage) siguen funcionando igual que antes.
const VERSION = "v10-free-all-features";
const SHELL_CACHE = `mitaxi-shell-${VERSION}`;
const RUNTIME_CACHE = `mitaxi-runtime-${VERSION}`;
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/auth.js",
  "/calc.js",
  "/vendor/jspdf.es.min.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon.svg",
  "/icons/favicon-32.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      // Individual para que un fallo puntual no aborte la instalación entera.
      await Promise.all(
        SHELL_ASSETS.map(async (url) => {
          try {
            const response = await fetch(new Request(url, { cache: "reload" }));
            if (response && response.ok) await cache.put(url, response);
          } catch {}
        })
      );
      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

function isApiRequest(url) {
  return url.pathname.startsWith("/api/") || url.pathname.startsWith("/.netlify/");
}

// Red primero, caché como respaldo: la app siempre estrena la última versión
// cuando hay cobertura, y sigue abriendo sin conexión.
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = await cache.match("/index.html") || await cache.match("/");
      if (shell) return shell;
    }
    throw error;
  }
}

// Caché primero + revalidación en segundo plano para estáticos y fuentes.
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === "opaque")) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  if (cached) return cached;
  const response = await network;
  if (response) return response;
  throw new Error("offline");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // La sincronización y las funciones de Netlify van siempre a la red.
  if (isApiRequest(url)) return;

  if (url.origin === self.location.origin) {
    if (request.mode === "navigate") {
      event.respondWith(networkFirst(request, SHELL_CACHE));
      return;
    }
    // El CSS/JS va a red primero para que nunca se sirva una versión
    // desparejada de los cálculos respecto al HTML.
    if (["style", "script", "manifest"].includes(request.destination)) {
      event.respondWith(networkFirst(request, SHELL_CACHE));
      return;
    }
    if (["image", "font"].includes(request.destination)) {
      event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    }
    return;
  }

  // Tipografías de Google usadas por el diseño actual.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
  }
});
