/**
 * The canvas' offline shell.
 *
 * Without this, "the page disappeared" is literal: `GET /` is assembled by the
 * MCP process on every load, so when that session ends the URL answers nothing
 * and the browser shows its own error page. The board was never the problem —
 * `board.json` is fine — so the fix is to stop making the *page* depend on the
 * process that served it.
 *
 * Cached: the HTML shell and the static canvas assets, which are content-hashed
 * and only change with a build. Not cached: every `/api/` response and the
 * WebSocket. Serving a stale board to a client that thinks it is current is
 * worse than showing nothing, and the board itself already has a local copy in
 * IndexedDB (`board-cache.ts`) — that is the layer allowed to answer "what was
 * the board", not the HTTP cache.
 *
 * Kept deliberately small: no background sync, no push, no navigation fallback
 * beyond the one page this app has.
 */

/*
 * Worker-scope types, declared locally.
 *
 * This file is compiled by `tsc` alongside the DOM app and then re-bundled by
 * esbuild for the worker scope. The program's lib is DOM, which does not
 * declare `ServiceWorkerGlobalScope` or `FetchEvent`, and pulling in the
 * WebWorker lib globally would change types for every other module. Only the
 * handful of members used here are declared, so the file type-checks without
 * touching the shared program.
 */
type WorkerEvent = { waitUntil(promise: Promise<unknown>): void };
type FetchWorkerEvent = WorkerEvent & { request: Request };
interface ServiceWorkerScope {
  location: Location;
  addEventListener(type: "install" | "activate", listener: (event: WorkerEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchWorkerEvent & { respondWith(response: Promise<Response>): void }) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
}
const worker = self as unknown as ServiceWorkerScope;

const CACHE = "doodle-shell-v1";
/**
 * Everything the app cannot boot without.
 *
 * `/` alone was not enough: the page boots by loading `excalidraw-app.js`, and
 * that script is what paints the canvas and registers the cache. A cached shell
 * that cannot load its own script leaves a frame with an empty `#excalidrawRoot`
 * — precisely the blank page this worker exists to prevent.
 *
 * The hashed asset names are not known statically, so the precache reads the
 * entry script's own imports at install time: the shell HTML is fetched, its
 * `<script src>` and `<link href>` are parsed, and those two URLs are added
 * alongside it. Anything deeper (chunks, fonts) is picked up by the runtime
 * cache the first time it is requested.
 */
const SHELL = ["/"];

const assetUrlsFor = (html: string): string[] => {
  const urls: string[] = [];
  for (const match of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) urls.push(match[1]);
  for (const match of html.matchAll(/<link[^>]*\shref="([^"]+)"/g)) urls.push(match[1]);
  return urls.filter((url) => url.startsWith("/"));
};

/**
 * Follow the entry script's static imports to collect its chunk graph.
 *
 * The bundle is split into ~76 chunks and the entry imports a dozen of them
 * directly; those chunks import others. Precaching only the entry leaves the
 * page hanging on a missing dependency, which is the same blank screen by a
 * different route. This walks `from "./x.js"` edges breadth-first, bounded, and
 * tolerates any fetch failure — a partial precache is still better than none,
 * and the runtime cache fills the rest on the first online load.
 */
const CHUNK_EDGE = /from\s*"\.\/([^"]+\.js)"/g;
async function precacheChunks(cache: Cache, entryUrl: string): Promise<void> {
  const queue = [entryUrl];
  const seen = new Set<string>([entryUrl]);
  const MAX = 120;
  while (queue.length > 0 && seen.size < MAX) {
    const url = queue.shift()!;
    let text: string;
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      text = await response.clone().text();
      await cache.put(url, response);
    } catch {
      continue;
    }
    const base = url.slice(0, url.lastIndexOf("/") + 1);
    for (const match of text.matchAll(CHUNK_EDGE)) {
      const next = `${base}${match[1]}`;
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
}

worker.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then(async (cache) => {
        await cache.addAll(SHELL);
        /*
         * Parse the shell for the entry script and stylesheet.
         *
         * A failure here must not abort the install: the runtime cache in the
         * fetch handler is the fallback, and a worker that fails to install
         * leaves the page with no offline story at all.
         */
        const shell = await cache.match("/");
        if (!shell) return;
        const html = await shell.text();
        const assets = assetUrlsFor(html);
        await Promise.all(assets.map((url) => cache.add(url).catch(() => {})));
        const entry = assets.find((url) => url.endsWith(".js"));
        if (entry) await precacheChunks(cache, entry);
      })
      .then(() => worker.skipWaiting())
      .catch(() => {
        // A failed precache must not brick the app; runtime caching still applies.
      }),
  );
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => worker.clients.claim()),
  );
});

const isAsset = (url: URL): boolean => url.pathname.startsWith("/excalidraw/");
const isApi = (url: URL): boolean => url.pathname.startsWith("/api/") || url.pathname === "/ws";

worker.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== worker.location.origin) return;
  if (isApi(url)) return; // Never: the board is not an HTTP-cacheable resource.

  if (request.mode === "navigate" || url.pathname === "/") {
    /*
     * Network first, cache second.
     *
     * The shell embeds a per-process token and asset version, so a live server
     * always has the correct page. Only when there is no server does the cached
     * shell answer — that is exactly the "session ended" case.
     */
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put("/", copy)).catch(() => {});
          }
          return response;
        })
        .catch(async () => (await caches.match("/")) ?? Response.error()),
    );
    return;
  }

  if (isAsset(url)) {
    // Assets are content-hashed: cache first, and let a miss fill the cache.
    event.respondWith(
      caches.match(request).then((hit) => hit ?? fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      }).catch(() => Response.error())),
    );
  }
});
