// Neon Sentinel service worker: persistent device caching for the fixed
// soundtrack and the slow-changing 600B avatar set. The app shell itself is
// NOT cached — deploys stay instant — this worker only owns /music/* and the
// same-origin profile-image proxy.
const MUSIC_CACHE = 'neonsentinel-music-v1';
const AVATAR_CACHE = 'neonsentinel-avatars-v1';
const KNOWN_CACHES = [MUSIC_CACHE, AVATAR_CACHE];
const AVATAR_CACHE_MAX_ENTRIES = 150;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('neonsentinel-') && !KNOWN_CACHES.includes(name))
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/music/')) {
    event.respondWith(serveMusic(request, url));
    return;
  }
  if (url.pathname === '/api/profile-image') {
    event.respondWith(serveAvatar(request));
  }
});

/**
 * Cache-first music. iOS <audio> issues Range requests, and a cached full
 * response must be sliced into a 206 by hand — the Cache API will not do it.
 */
async function serveMusic(request, url) {
  const cache = await caches.open(MUSIC_CACHE);
  const key = url.pathname;
  let cached = await cache.match(key);
  if (!cached) {
    let full;
    try {
      // Fetch the whole file regardless of the requested range so the cached
      // copy can answer every future range without another network trip.
      full = await fetch(key, { credentials: 'omit' });
    } catch {
      return fetch(request);
    }
    if (!full.ok || full.status === 206) return full;
    await cache.put(key, full.clone());
    cached = full;
  }
  const range = request.headers.get('range');
  if (!range) return cached;
  const blob = await cached.blob();
  const match = /bytes=(\d+)-(\d+)?/.exec(range);
  const start = match ? Number(match[1]) : 0;
  const end = match && match[2] ? Math.min(Number(match[2]), blob.size - 1) : blob.size - 1;
  if (start >= blob.size) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${blob.size}` },
    });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': blob.type || 'audio/mp4',
      'Content-Range': `bytes ${start}-${end}/${blob.size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

/** Cache-first avatars: they change once in a blue moon; network only fills gaps. */
async function serveAvatar(request) {
  const cache = await caches.open(AVATAR_CACHE);
  const cached = await cache.match(request.url);
  if (cached) return cached;
  let response;
  try {
    response = await fetch(request);
  } catch {
    return Response.error();
  }
  if (response.ok) {
    await cache.put(request.url, response.clone());
    void trimAvatarCache(cache);
  }
  return response;
}

async function trimAvatarCache(cache) {
  try {
    const keys = await cache.keys();
    // Cache keys come back in insertion order; dropping from the front keeps
    // the most recently stored avatars.
    for (let i = 0; i < keys.length - AVATAR_CACHE_MAX_ENTRIES; i += 1) {
      await cache.delete(keys[i]);
    }
  } catch { /* trimming is best effort */ }
}
