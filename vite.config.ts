import { randomBytes } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';

// Build stamp baked into the bundle and published as /version.json so the
// running app can detect a newer deploy and offer a one-tap reload.
const BUILD_ID = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

function versionStamp(): Plugin {
  return {
    name: 'neon-sentinel-version-stamp',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ build: BUILD_ID })}\n` });
    },
  };
}

const DEV_PROFILE_IMAGE_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const DEV_PROFILE_IMAGE_CACHE_SECONDS = Math.floor(DEV_PROFILE_IMAGE_CACHE_MS / 1000);
const DEV_PROFILE_IMAGE_TIMEOUT_MS = 6500;
const DEV_MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024;
const DEV_MAX_PROFILE_IMAGE_REDIRECTS = 3;

function devProfileImageProxy(): Plugin {
  const cache = new Map<string, { type: string; body: Buffer; expiresAt: number }>();
  return {
    name: 'neon-sentinel-profile-image-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/api/profile-image', async (req, res) => {
        if (req.method !== 'GET') {
          sendDevJson(res, 405, { ok: false, error: 'method_not_allowed' });
          return;
        }
        const originalUrl = (req as typeof req & { originalUrl?: string }).originalUrl ?? req.url ?? '/api/profile-image';
        const requestUrl = new URL(originalUrl, 'http://localhost');
        const imageUrl = parseDevProfileImageUrl(requestUrl.searchParams.get('url'));
        if (!imageUrl) {
          sendDevJson(res, 400, { ok: false, error: 'invalid_profile_image_url' });
          return;
        }
        const cached = cache.get(imageUrl);
        if (cached && cached.expiresAt > Date.now()) {
          sendDevProfileImage(res, cached.type, cached.body, true);
          return;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DEV_PROFILE_IMAGE_TIMEOUT_MS);
        try {
          let candidateUrl = imageUrl;
          let upstream: Response | null = null;
          for (let hop = 0; ; hop += 1) {
            const response = await fetch(candidateUrl, {
              signal: controller.signal,
              redirect: 'manual',
              headers: {
                accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8',
                'user-agent': 'NeonSentinelDevProfileImageProxy/1.0',
              },
            });
            const location = response.headers.get('location');
            if (response.status >= 300 && response.status < 400 && location) {
              if (hop >= DEV_MAX_PROFILE_IMAGE_REDIRECTS) {
                sendDevJson(res, 502, { ok: false, error: 'profile_image_fetch_failed' });
                return;
              }
              let nextUrl: string | null = null;
              try {
                nextUrl = parseDevProfileImageUrl(new URL(location, candidateUrl).toString());
              } catch {
                nextUrl = null;
              }
              if (!nextUrl) {
                sendDevJson(res, 502, { ok: false, error: 'profile_image_fetch_failed' });
                return;
              }
              candidateUrl = nextUrl;
              continue;
            }
            upstream = response;
            break;
          }
          if (!upstream.ok) {
            sendDevJson(res, upstream.status === 404 ? 404 : 502, { ok: false, error: 'profile_image_fetch_failed' });
            return;
          }
          const type = upstream.headers.get('content-type')?.split(';')[0]?.toLowerCase() ?? '';
          if (!type.startsWith('image/')) {
            sendDevJson(res, 415, { ok: false, error: 'profile_image_not_image' });
            return;
          }
          const length = Number(upstream.headers.get('content-length') ?? 0);
          if (Number.isFinite(length) && length > DEV_MAX_PROFILE_IMAGE_BYTES) {
            sendDevJson(res, 413, { ok: false, error: 'profile_image_too_large' });
            return;
          }
          const body = Buffer.from(await upstream.arrayBuffer());
          if (body.byteLength > DEV_MAX_PROFILE_IMAGE_BYTES) {
            sendDevJson(res, 413, { ok: false, error: 'profile_image_too_large' });
            return;
          }
          cache.set(imageUrl, { type, body, expiresAt: Date.now() + DEV_PROFILE_IMAGE_CACHE_MS });
          sendDevProfileImage(res, type, body, false);
        } catch {
          sendDevJson(res, 504, { ok: false, error: 'profile_image_unavailable' });
        } finally {
          clearTimeout(timer);
        }
      });
    },
  };
}

function parseDevProfileImageUrl(rawUrl: string | null): string | null {
  if (!rawUrl || rawUrl.length > 2048) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (isForbiddenDevHost(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

// Dev-only SSRF guard. This is a lighter, string/regex-based version of the
// resolved-IP validation in server/index.ts — good enough to stop obvious
// requests at internal or cloud-metadata addresses during local playtesting,
// but it does not resolve DNS, so it is not a substitute for the production
// check.
const DEV_FORBIDDEN_HOSTNAME_LITERALS = new Set(['localhost', '0.0.0.0', '127.0.0.1', '::1', '::']);

function isForbiddenDevHost(rawHost: string): boolean {
  const host = (rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost).toLowerCase();
  if (DEV_FORBIDDEN_HOSTNAME_LITERALS.has(host) || host.endsWith('.local')) return true;
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
    const octets = host.split('.').map(Number);
    if (octets.some(n => n > 255)) return true; // malformed — reject closed
    const [a, b] = octets;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10/8
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10
    if (a === 127) return true; // 127/8
    if (a === 169 && b === 254) return true; // 169.254/16 (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15
    if (a >= 224) return true; // 224/4 multicast, 240/4 reserved
    return false;
  }
  if (host.includes(':')) {
    if (host.startsWith('::ffff:')) {
      const embedded = host.slice('::ffff:'.length);
      return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(embedded) ? isForbiddenDevHost(embedded) : true;
    }
    if (host.startsWith('fc') || host.startsWith('fd')) return true; // fc00::/7 unique local
    if (/^fe[89ab]/.test(host)) return true; // fe80::/10 link-local
  }
  return false;
}

function devClaimStub(): Plugin {
  return {
    name: 'neon-sentinel-claim-dev-stub',
    configureServer(server) {
      server.middlewares.use('/api/claim', async (req, res, next) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'access-control-allow-methods': 'POST,OPTIONS',
            'access-control-allow-headers': 'authorization,content-type',
          });
          res.end();
          return;
        }
        if (req.method !== 'POST') {
          next();
          return;
        }
        // Dev stub only: no NIP-98 verification and no real Nostr signing
        // authority. It exists purely so local playtesting can exercise the
        // claim UI flow (src/scoring.ts#submitScoreClaim) without a running
        // production claim service. score_event_id is random hex, not a real
        // signed event id.
        for await (const _chunk of req) {
          // Drain the request body so the client's fetch() completes.
        }
        sendDevJson(res, 200, {
          ok: true,
          payout_sats: 0,
          score_event_id: randomBytes(32).toString('hex'),
          status: 'accepted',
          published: { ok: 0, total: 0 },
        });
      });
    },
  };
}

function sendDevJson(res: Parameters<Parameters<Plugin['configureServer']>[0]['middlewares']['use']>[1], status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
    'cache-control': 'no-store',
  });
  res.end(json);
}

function sendDevProfileImage(
  res: Parameters<Parameters<Plugin['configureServer']>[0]['middlewares']['use']>[1],
  type: string,
  body: Buffer,
  hit: boolean,
): void {
  res.writeHead(200, {
    'content-type': type,
    'content-length': body.byteLength,
    'cache-control': `public, max-age=${DEV_PROFILE_IMAGE_CACHE_SECONDS}, stale-while-revalidate=${DEV_PROFILE_IMAGE_CACHE_SECONDS}`,
    'x-content-type-options': 'nosniff',
    'x-neon-sentinel-profile-cache': hit ? 'hit' : 'miss',
  });
  res.end(body);
}

export default defineConfig({
  plugins: [devProfileImageProxy(), devClaimStub(), versionStamp()],
  define: {
    __NEON_BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  server: {
    port: 5190,
    host: true,
  },
  build: {
    target: 'es2020',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
