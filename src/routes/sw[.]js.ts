import { createFileRoute } from "@tanstack/react-router";

/**
 * Offline reading. The reader is server-rendered, so caching a chapter page's
 * HTML is enough to read it again without a connection; assets and novel
 * requests are cached as they are used.
 */
const SERVICE_WORKER = `
const CACHE = "novel-reader-v1";
const ASSET = /\\.(?:js|css|woff2?|png|jpe?g|svg|webp|avif)$/i;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const isNovel = url.pathname.startsWith("/novels/");
  const isAsset = ASSET.test(url.pathname);
  if (!isNovel && !isAsset) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (isAsset && !isNovel) {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }
      try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      } catch (error) {
        const hit = await cache.match(request);
        if (hit) return hit;
        if (request.mode === "navigate")
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>Offline</title><p>This chapter has not been saved for offline reading.</p>',
            { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
          );
        throw error;
      }
    })(),
  );
});
`;

export const Route = createFileRoute("/sw.js")({
  server: {
    handlers: {
      GET: () =>
        new Response(SERVICE_WORKER, {
          headers: {
            "content-type": "application/javascript; charset=utf-8",
            "cache-control": "public, max-age=0, must-revalidate",
            "service-worker-allowed": "/",
          },
        }),
    },
  },
});
