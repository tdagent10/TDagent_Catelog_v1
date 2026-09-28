/* TDagent service worker: installable + offline-tolerant catalog.
 *
 * Strategy (conservative — never caches mutations):
 * - POST/non-GET: never intercepted (server actions pass straight through).
 * - /_next/static/*: cache-first (content-hashed, immutable).
 * - Supabase product photos: cache-first (immutable uploads, each ≤200KB).
 * - Everything else same-origin (pages, RSC payloads): network-first with
 *   cache fallback, so previously visited screens open offline.
 * - Cross-origin (fonts, etc.): pass through untouched.
 */

const VERSION = "tdagent-v5";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
const IMAGE_CACHE = `${VERSION}-images`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.add("/"))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isPhoto =
    url.hostname.endsWith("supabase.co") &&
    url.pathname.startsWith("/storage/v1/object/");
  if (!sameOrigin && !isPhoto) return;

  // Immutable build assets.
  if (sameOrigin && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Product photos: cache-first.
  if (isPhoto) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Pages (documents + RSC payloads): network-first, cache fallback.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(PAGE_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(request)
          .then((hit) => hit ?? caches.match("/"))
          .then((fallback) => {
            if (fallback) return fallback;
            throw new Error("offline");
          }),
      ),
  );
});
