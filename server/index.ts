import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/core';
import { nip19 } from 'nostr-tools';
import { hexToBytes } from 'nostr-tools/utils';
import {
  unpackEventFromToken,
  validateEventKind,
  validateEventMethodTag,
  validateEventPayloadTag,
  validateEventTimestamp,
  validateEventUrlTag,
} from 'nostr-tools/nip98';
import { parseSixHundredRegistry, sixHundredNip05, SIX_HUNDRED_REGISTRY_URL } from '../src/sixhundred-registry.js';
import { maxPlausibleWave, scoreCeiling } from '../src/score-model.js';

const GAME_ID = 'neonsentinel';
const SCORE_KIND = 30762;
const GAME_TITLE = 'Neon Sentinel';
const GAME_URL = 'https://neonsentinel.com/';
const GAME_SOURCE = 'neonsentinel.com';
const GAME_IMAGE_URL = 'https://neonsentinel.com/brand/icon-512.png';
const DEFAULT_WRITE_RELAYS = [
  'wss://main.relay.gamestr.io',
  'wss://relay.trotters.cc',
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
  'wss://relay.ditto.pub',
] as const;
const WRITE_RELAYS = loadWriteRelays();
const PORT = Number(process.env.PORT ?? process.env.NEON_SENTINEL_API_PORT ?? 3190);
const HOST = process.env.HOST ?? '127.0.0.1';
const DATA_DIR = process.env.NEON_SENTINEL_DATA_DIR ?? '/var/lib/neonsentinel';
const CLAIM_LOG = process.env.NEON_SENTINEL_CLAIM_LOG ?? `${DATA_DIR}/claims.jsonl`;
const PUBLISH_ENABLED = process.env.NEON_SENTINEL_PUBLISH !== '0';
const DEFAULT_GAME_NPUB = 'npub1xuq53wm49lh820yd6sm82t5qrupfz0du0trrxzpg6y742sxyegssntwz40';
const EXPECTED_GAME_NPUB = process.env.NEON_SENTINEL_GAME_NPUB ?? DEFAULT_GAME_NPUB;
const STALE_RUN_MS = 10 * 60 * 1000;
const FUTURE_SLACK_MS = 60 * 1000;
const MAX_DURATION_MS = 6 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 96 * 1024;
const PROFILE_IMAGE_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const PROFILE_IMAGE_CACHE_SECONDS = Math.floor(PROFILE_IMAGE_CACHE_MS / 1000);
const PROFILE_IMAGE_TIMEOUT_MS = 6500;
const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024;
const PROFILE_IMAGE_CACHE_MAX_ENTRIES = 400;
// Some upstream hosts (imgur in particular) rate-limit or outright block
// requests from this box's IP regardless of the resource — every page load
// was re-attempting and re-failing the same fetch. A short negative cache
// stops that hammering without permanently blacklisting a host that might
// recover.
const PROFILE_IMAGE_FAILURE_CACHE_MS = 5 * 60 * 1000;
const MAX_PROFILE_IMAGE_REDIRECTS = 3;
const CLAIM_DEDUP_TTL_MS = STALE_RUN_MS * 3;
const RATE_LIMIT_MAX_TRACKED_IPS = 10_000;
const CLAIM_RATE_LIMIT = { limit: 6, windowMs: 60_000 };
const PROFILE_IMAGE_RATE_LIMIT = { limit: 60, windowMs: 60_000 };
const RELAY_PUBLISH_TIMEOUT_MS = 5000;
const SIXHUNDRED_URL = process.env.NEON_SENTINEL_600B_URL ?? SIX_HUNDRED_REGISTRY_URL;
const SIXHUNDRED_TTL_MS = 15 * 60 * 1000;
const SIXHUNDRED_RETRY_MS = 5 * 60 * 1000;
const SIXHUNDRED_FETCH_TIMEOUT_MS = 3000;
const DEFAULT_ALLOWED_ORIGINS = [
  'https://neonsentinel.com',
  'https://app.neonsentinel.com',
  'https://www.neonsentinel.com',
  'https://neonsentinel.playechoseven.com',
] as const;
const allowedCorsOrigins = loadAllowedCorsOrigins();

interface ClaimInput {
  game: typeof GAME_ID;
  score: number;
  wave: number;
  duration_ms: number;
  started_at: number;
  finished_at: number;
  credits: number;
  sats_claimed: number;
  run_id: string;
  rescues: number;
  known_rescues: number;
  lost: number;
  max_combo: number;
  player_name?: string;
  player_mode?: 'guest' | 'nostr';
  metrics?: unknown;
  telemetry?: unknown;
}

interface StoredClaim {
  key: string;
  pubkey: string;
  run_id: string;
  score_event_id: string;
  payout_sats: number;
  published: { ok: number; total: number };
  accepted_at: string;
  finished_at: number;
}

const gameSecret = loadGameSecret();
const expectedGamePubkey = decodeNpub(EXPECTED_GAME_NPUB);
const gamePubkey = resolveGamePubkey(gameSecret);
const claims = await loadClaims();
pruneStaleClaims();
const profileImageCache = new Map<string, { type: string; body: Buffer; expiresAt: number }>();
const profileImageFailureCache = new Map<string, number>();
const claimRateLimiter = createRateLimiter(CLAIM_RATE_LIMIT.limit, CLAIM_RATE_LIMIT.windowMs);
const profileImageRateLimiter = createRateLimiter(PROFILE_IMAGE_RATE_LIMIT.limit, PROFILE_IMAGE_RATE_LIMIT.windowMs);

createServer((req, res) => {
  void route(req, res).catch(err => {
    console.error('[api] unhandled error', err);
    sendJson(res, 500, { ok: false, error: 'internal_error' }, req);
  });
}).listen(PORT, HOST, () => {
  console.log(`[api] Neon Sentinel claim service listening on ${HOST}:${PORT}`);
  console.log(`[api] signer ${gameSecret ? `ready ${gamePubkey}` : 'not configured'}`);
  void publishGameProfile();
});

/** (Re)publish the game's kind-0 profile on boot. Kind 0 is replaceable so
 *  this is idempotent — the game account stays fresh on the relays (gamestr
 *  reads it for the listing) without a separate tool ever needing the nsec. */
async function publishGameProfile(): Promise<void> {
  if (!gameSecret || !PUBLISH_ENABLED) return;
  try {
    const profile = finalizeEvent({
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      content: JSON.stringify({
        name: GAME_TITLE,
        display_name: `${GAME_TITLE} 📡🔑`,
        about: `A radar-first Nostr rescue shooter with Defender-style waves, a seeded daily gauntlet, and 600B pressure. Hold the relay, save the keys, don't get TIME LOCKED. Scores land on gamestr as kind-30762, signed by this key. Play at ${GAME_URL}`,
        website: GAME_URL,
        picture: GAME_IMAGE_URL,
        banner: 'https://neonsentinel.com/brand/neon-sentinel-key-art-v2.png',
        bot: true,
      }),
      tags: [],
    }, gameSecret);
    const published = await publishSignedScore(profile);
    console.log(`[api] game profile (kind 0) published to ${published.ok}/${published.total} relays`);
  } catch (err) {
    console.warn('[api] game profile publish failed:', err);
  }
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }
  if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/api/claim/health')) {
    sendJson(res, 200, {
      ok: true,
      service: 'neon-sentinel-claim',
      game: GAME_ID,
      score_kind: SCORE_KIND,
      signer_configured: Boolean(gameSecret),
      publish_enabled: PUBLISH_ENABLED,
      game_pubkey: gamePubkey,
      expected_game_npub: EXPECTED_GAME_NPUB,
      expected_game_pubkey: expectedGamePubkey,
      write_relays: WRITE_RELAYS,
      claims_seen: claims.size,
      sixhundred: {
        names: sixHundredRegistry.size,
        fetched_at: sixHundredFetchedAt ? new Date(sixHundredFetchedAt).toISOString() : null,
      },
    }, req);
    return;
  }
  if (req.method === 'GET' && req.url?.startsWith('/api/profile-image')) {
    if (!profileImageRateLimiter(clientIp(req))) {
      sendJson(res, 429, { ok: false, error: 'rate_limited' }, req);
      return;
    }
    await handleProfileImage(req, res);
    return;
  }
  if (req.method !== 'POST' || !req.url?.startsWith('/api/claim')) {
    sendJson(res, 404, { ok: false, error: 'not_found' }, req);
    return;
  }
  if (!claimRateLimiter(clientIp(req))) {
    sendJson(res, 429, { ok: false, error: 'rate_limited' }, req);
    return;
  }

  let raw: string;
  try {
    raw = await readBody(req);
  } catch (err) {
    sendJson(res, err instanceof Error && err.message === 'body_too_large' ? 413 : 400, { ok: false, error: err instanceof Error ? err.message : 'invalid_body' }, req);
    return;
  }
  let body: unknown;
  try {
    body = raw.length > 0 ? JSON.parse(raw) : null;
  } catch {
    sendJson(res, 400, { ok: false, error: 'invalid_json_body' }, req);
    return;
  }

  const auth = await verifyNip98(req, body);
  if (!auth.ok) {
    sendJson(res, auth.status, { ok: false, error: auth.error }, req);
    return;
  }

  const parsed = parseClaim(body);
  if (!parsed.ok) {
    sendJson(res, parsed.status, { ok: false, error: parsed.error, detail: parsed.detail }, req);
    return;
  }

  if (!gameSecret || !gamePubkey) {
    sendJson(res, 503, {
      ok: false,
      error: 'signer_unavailable',
      detail: 'Set NEON_SENTINEL_GAME_NSEC in /etc/neonsentinel-api.env and restart neonsentinel-api.service.',
    }, req);
    return;
  }

  const claim = parsed.claim;
  const key = `${auth.pubkey}:${claim.run_id}:${claim.started_at}:${claim.finished_at}`;
  const replay = claims.get(key);
  if (replay) {
    sendJson(res, 200, {
      ok: true,
      payout_sats: replay.payout_sats,
      score_event_id: replay.score_event_id,
      status: 'accepted',
      published: replay.published,
    }, req);
    return;
  }

  const payoutSats = clampPayout(claim);
  const sixHundredHandle = await sixHundredHandleFor(auth.pubkey);
  const scoreTemplate = buildScoreEvent(claim, auth.pubkey, payoutSats, sixHundredHandle);
  const signed = finalizeEvent(scoreTemplate, gameSecret);
  const published = await publishSignedScore(signed);
  const stored: StoredClaim = {
    key,
    pubkey: auth.pubkey,
    run_id: claim.run_id,
    score_event_id: signed.id,
    payout_sats: payoutSats,
    published,
    accepted_at: new Date().toISOString(),
    finished_at: claim.finished_at,
  };
  claims.set(key, stored);
  pruneStaleClaims();
  await appendClaim(stored, claim);

  sendJson(res, 200, {
    ok: true,
    payout_sats: payoutSats,
    score_event_id: signed.id,
    status: published.ok > 0 ? 'published' : 'accepted',
    published,
  }, req);
}

async function handleProfileImage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const requestUrl = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  const rawUrl = requestUrl.searchParams.get('url');
  const imageUrl = parseProfileImageUrl(rawUrl);
  if (!imageUrl) {
    sendJson(res, 400, { ok: false, error: 'invalid_profile_image_url' }, req);
    return;
  }

  const cached = profileImageCache.get(imageUrl);
  if (cached && cached.expiresAt > Date.now()) {
    touchProfileImageCache(imageUrl, cached);
    sendProfileImage(req, res, cached.type, cached.body, true);
    return;
  }

  if (isProfileImageRecentlyFailed(imageUrl)) {
    sendJson(res, 502, { ok: false, error: 'profile_image_fetch_failed' }, req);
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROFILE_IMAGE_TIMEOUT_MS);
  try {
    let candidateUrl = imageUrl;
    let upstream: Response | null = null;
    for (let hop = 0; ; hop += 1) {
      // Resolve-then-fetch has a residual TOCTOU window (DNS could rebind between
      // this check and the fetch below); pinning the connection to the validated
      // IP would close it but isn't worth the added complexity for this proxy.
      if (!(await isUrlHostSafe(candidateUrl))) {
        recordProfileImageFailure(imageUrl);
        sendJson(res, 502, { ok: false, error: 'profile_image_fetch_failed' }, req);
        return;
      }
      const response = await fetch(candidateUrl, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8',
          'user-agent': 'NeonSentinelProfileImageProxy/1.0',
        },
      });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        if (hop >= MAX_PROFILE_IMAGE_REDIRECTS) {
          recordProfileImageFailure(imageUrl);
          sendJson(res, 502, { ok: false, error: 'profile_image_fetch_failed' }, req);
          return;
        }
        let nextUrl: string | null = null;
        try {
          nextUrl = parseProfileImageUrl(new URL(location, candidateUrl).toString());
        } catch {
          nextUrl = null;
        }
        if (!nextUrl) {
          recordProfileImageFailure(imageUrl);
          sendJson(res, 502, { ok: false, error: 'profile_image_fetch_failed' }, req);
          return;
        }
        candidateUrl = nextUrl;
        continue;
      }
      upstream = response;
      break;
    }
    if (!upstream.ok || !upstream.body) {
      recordProfileImageFailure(imageUrl);
      sendJson(res, upstream.status === 404 ? 404 : 502, { ok: false, error: 'profile_image_fetch_failed' }, req);
      return;
    }
    const type = upstream.headers.get('content-type')?.split(';')[0]?.toLowerCase() ?? '';
    if (!type.startsWith('image/')) {
      recordProfileImageFailure(imageUrl);
      sendJson(res, 415, { ok: false, error: 'profile_image_not_image' }, req);
      return;
    }
    const body = await readLimitedResponse(upstream, MAX_PROFILE_IMAGE_BYTES);
    cacheProfileImage(imageUrl, { type, body, expiresAt: Date.now() + PROFILE_IMAGE_CACHE_MS });
    sendProfileImage(req, res, type, body, false);
  } catch (err) {
    const error = err instanceof Error && err.message === 'profile_image_too_large' ? 'profile_image_too_large' : 'profile_image_unavailable';
    recordProfileImageFailure(imageUrl);
    sendJson(res, error === 'profile_image_too_large' ? 413 : 504, { ok: false, error }, req);
  } finally {
    clearTimeout(timer);
  }
}

function parseProfileImageUrl(rawUrl: string | null): string | null {
  if (!rawUrl || rawUrl.length > 2048) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost'
    || host === '127.0.0.1'
    || host === '::1'
    || host.startsWith('127.')
    || host.startsWith('10.')
    || host.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    || host.endsWith('.local')
  ) {
    return null;
  }
  return parsed.toString();
}

// --- SSRF guard: resolved-IP validation -----------------------------------
//
// parseProfileImageUrl() above only filters obvious literal hostnames. A
// hostname like "attacker-controlled-dns.example" can still resolve to a
// private, loopback, or cloud-metadata address, so every candidate URL
// (including each hop of a redirect chain) is re-checked here against the
// addresses it actually resolves to before we fetch it.

const FORBIDDEN_IPV4_CIDRS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16', // includes the 169.254.169.254 cloud metadata endpoint
  '172.16.0.0/12',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '224.0.0.0/4',
  '240.0.0.0/4',
] as const;

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

function intToIpv4(value: number): string {
  return [24, 16, 8, 0].map(shift => (value >>> shift) & 0xff).join('.');
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  if (bits <= 0) return true;
  const mask = bits >= 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function isForbiddenIPv4(ip: string): boolean {
  return FORBIDDEN_IPV4_CIDRS.some(cidr => ipv4InCidr(ip, cidr));
}

function ipv6ToBigInt(raw: string): bigint | null {
  let ip = raw.toLowerCase();
  const zonePos = ip.indexOf('%');
  if (zonePos !== -1) ip = ip.slice(0, zonePos);
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);

  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipv4ToInt(tail);
    if (v4 === null) return null;
    const high = ((v4 >>> 16) & 0xffff).toString(16);
    const low = (v4 & 0xffff).toString(16);
    ip = `${ip.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const parts = ip.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':').filter(p => p.length > 0) : [];
  const tailParts = parts.length === 2 && parts[1] ? parts[1].split(':').filter(p => p.length > 0) : [];
  let groups: string[];
  if (parts.length === 1) {
    groups = head;
  } else {
    const missing = 8 - head.length - tailParts.length;
    if (missing < 0) return null;
    groups = [...head, ...new Array(missing).fill('0'), ...tailParts];
  }
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

function isForbiddenIPv6(value: bigint): boolean {
  if (value === 0n) return true; // ::
  if (value === 1n) return true; // ::1
  const top96 = value >> 32n;
  if (top96 === 0xffffn) {
    // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded IPv4 address.
    return isForbiddenIPv4(intToIpv4(Number(value & 0xffffffffn)));
  }
  const first16 = Number((value >> 112n) & 0xffffn);
  if ((first16 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first16 & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  return false;
}

function isForbiddenAddress(address: string, family: number): boolean {
  if (family === 4) return isForbiddenIPv4(address);
  if (family === 6) {
    const value = ipv6ToBigInt(address);
    return value === null ? true : isForbiddenIPv6(value); // fail closed on unparseable input
  }
  return true;
}

async function isHostnameSafe(hostname: string): Promise<boolean> {
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  const literalFamily = isIP(bare);
  if (literalFamily) return !isForbiddenAddress(bare, literalFamily);
  try {
    const records = await dnsLookup(hostname, { all: true });
    if (records.length === 0) return false;
    return records.every(record => !isForbiddenAddress(record.address, record.family));
  } catch {
    return false;
  }
}

async function isUrlHostSafe(urlString: string): Promise<boolean> {
  try {
    return await isHostnameSafe(new URL(urlString).hostname);
  } catch {
    return false;
  }
}

// --- Profile image cache: bounded, dependency-free LRU ---------------------

function pruneExpiredProfileImages(): void {
  const now = Date.now();
  for (const [key, entry] of profileImageCache) {
    if (entry.expiresAt <= now) profileImageCache.delete(key);
  }
}

function touchProfileImageCache(key: string, entry: { type: string; body: Buffer; expiresAt: number }): void {
  profileImageCache.delete(key);
  profileImageCache.set(key, entry); // Map iteration order is insertion order; re-insert to mark as most-recently-used.
}

function isProfileImageRecentlyFailed(key: string): boolean {
  const expiresAt = profileImageFailureCache.get(key);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    profileImageFailureCache.delete(key);
    return false;
  }
  return true;
}

function recordProfileImageFailure(key: string): void {
  if (profileImageFailureCache.size >= PROFILE_IMAGE_CACHE_MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, expiresAt] of profileImageFailureCache) {
      if (expiresAt <= now) profileImageFailureCache.delete(k);
    }
  }
  while (profileImageFailureCache.size >= PROFILE_IMAGE_CACHE_MAX_ENTRIES) {
    const oldestKey = profileImageFailureCache.keys().next().value;
    if (oldestKey === undefined) break;
    profileImageFailureCache.delete(oldestKey);
  }
  profileImageFailureCache.set(key, Date.now() + PROFILE_IMAGE_FAILURE_CACHE_MS);
}

function cacheProfileImage(key: string, entry: { type: string; body: Buffer; expiresAt: number }): void {
  profileImageCache.delete(key);
  if (profileImageCache.size >= PROFILE_IMAGE_CACHE_MAX_ENTRIES) pruneExpiredProfileImages();
  while (profileImageCache.size >= PROFILE_IMAGE_CACHE_MAX_ENTRIES) {
    const oldestKey = profileImageCache.keys().next().value;
    if (oldestKey === undefined) break;
    profileImageCache.delete(oldestKey);
  }
  profileImageCache.set(key, entry);
}

async function readLimitedResponse(response: Response, maxBytes: number): Promise<Buffer> {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > maxBytes) throw new Error('profile_image_too_large');
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    const buf = Buffer.from(chunk);
    total += buf.byteLength;
    if (total > maxBytes) throw new Error('profile_image_too_large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function sendProfileImage(req: IncomingMessage, res: ServerResponse, type: string, body: Buffer, hit: boolean): void {
  res.writeHead(200, {
    ...corsHeaders(req),
    'content-type': type,
    'content-length': body.byteLength,
    'cache-control': `public, max-age=${PROFILE_IMAGE_CACHE_SECONDS}, stale-while-revalidate=${PROFILE_IMAGE_CACHE_SECONDS}`,
    'x-content-type-options': 'nosniff',
    'x-neon-sentinel-profile-cache': hit ? 'hit' : 'miss',
  });
  res.end(body);
}

async function verifyNip98(req: IncomingMessage, body: unknown): Promise<
  | { ok: true; pubkey: string }
  | { ok: false; status: 400 | 401; error: string }
> {
  const header = req.headers.authorization;
  if (!header) return { ok: false, status: 401, error: 'missing_authorization' };
  let event;
  try {
    event = await unpackEventFromToken(header);
  } catch {
    return { ok: false, status: 401, error: 'invalid_auth_payload' };
  }
  const url = reconstructUrl(req);
  if (!validateEventKind(event)) return { ok: false, status: 401, error: 'wrong_kind' };
  if (!validateEventTimestamp(event)) return { ok: false, status: 401, error: 'stale_timestamp' };
  if (!validateEventUrlTag(event, url)) return { ok: false, status: 401, error: 'url_mismatch' };
  if (!validateEventMethodTag(event, req.method ?? 'POST')) return { ok: false, status: 401, error: 'method_mismatch' };
  if (body && typeof body === 'object' && !validateEventPayloadTag(event, body)) {
    return { ok: false, status: 401, error: 'payload_mismatch' };
  }
  if (!verifyEvent(event)) return { ok: false, status: 401, error: 'invalid_signature' };
  return { ok: true, pubkey: event.pubkey };
}

function parseClaim(body: unknown): { ok: true; claim: ClaimInput } | { ok: false; status: 400 | 422; error: string; detail?: string } {
  if (!body || typeof body !== 'object') return { ok: false, status: 400, error: 'invalid_payload' };
  const value = body as Partial<ClaimInput>;
  const requiredNumbers: Array<keyof ClaimInput> = [
    'score',
    'wave',
    'duration_ms',
    'started_at',
    'finished_at',
    'credits',
    'sats_claimed',
    'rescues',
    'known_rescues',
    'lost',
    'max_combo',
  ];
  if (value.game !== GAME_ID) return { ok: false, status: 422, error: 'wrong_game' };
  if (typeof value.run_id !== 'string' || value.run_id.length < 5 || value.run_id.length > 96) {
    return { ok: false, status: 422, error: 'invalid_run_id' };
  }
  for (const key of requiredNumbers) {
    if (!Number.isInteger(value[key]) || Number(value[key]) < 0) {
      return { ok: false, status: 422, error: 'invalid_payload', detail: `${String(key)} must be a non-negative integer` };
    }
  }
  const claim = value as ClaimInput;
  const now = Date.now();
  if (claim.score <= 0) return { ok: false, status: 422, error: 'invalid_score' };
  if (claim.duration_ms <= 0 || claim.duration_ms > MAX_DURATION_MS) return { ok: false, status: 422, error: 'invalid_duration' };
  if (claim.started_at >= claim.finished_at || claim.finished_at > now + FUTURE_SLACK_MS) {
    return { ok: false, status: 422, error: 'invalid_run_clock' };
  }
  if (now - claim.finished_at > STALE_RUN_MS) return { ok: false, status: 422, error: 'stale_run' };
  const clockSkew = Math.abs(claim.duration_ms - (claim.finished_at - claim.started_at));
  if (clockSkew > 5000) return { ok: false, status: 422, error: 'duration_clock_mismatch' };
  const durationSec = claim.duration_ms / 1000;
  // Ceilings derived from the game's own scoring constants (src/score-model.ts);
  // survival is open-ended, so the wave bound comes from wall-clock time, not
  // a hand-picked maximum.
  if (claim.wave <= 0 || claim.wave > maxPlausibleWave(durationSec)) {
    return { ok: false, status: 422, error: 'invalid_wave' };
  }
  if (claim.score > scoreCeiling(claim.wave, durationSec)) {
    return { ok: false, status: 422, error: 'implausible_score' };
  }
  return { ok: true, claim };
}

// --- 600.wtf membership --------------------------------------------------
//
// The NIP-05 registry at 600.wtf doubles as the roll of the 600 billion.
// Membership is verified here, server-side, so the nip05 tag on a signed
// score event is the game key's own attestation — a client cannot forge it.

let sixHundredRegistry = new Map<string, string>();
let sixHundredFetchedAt = 0;
let sixHundredAttemptAt = 0;
let sixHundredRefresh: Promise<void> | null = null;
// Warm the roll at startup so the first claim after boot can already tag members.
void refreshSixHundredRegistry();

function refreshSixHundredRegistry(): Promise<void> {
  if (sixHundredRefresh) return sixHundredRefresh;
  sixHundredAttemptAt = Date.now();
  sixHundredRefresh = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SIXHUNDRED_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(SIXHUNDRED_URL, {
        signal: controller.signal,
        headers: { accept: 'application/json', 'user-agent': 'NeonSentinelClaimSigner/1.0' },
      });
      if (!response.ok) return;
      const parsed = parseSixHundredRegistry(await response.json());
      if (parsed.size === 0) return;
      sixHundredRegistry = parsed;
      sixHundredFetchedAt = Date.now();
    } catch {
      // 600.wtf unreachable — keep the previous roll; membership tags simply
      // reflect the last good fetch.
    } finally {
      clearTimeout(timer);
      sixHundredRefresh = null;
    }
  })();
  return sixHundredRefresh;
}

async function sixHundredHandleFor(pubkey: string): Promise<string | null> {
  const now = Date.now();
  const stale = now - sixHundredFetchedAt >= SIXHUNDRED_TTL_MS;
  if (stale && now - sixHundredAttemptAt >= SIXHUNDRED_RETRY_MS) {
    // Await only when we have nothing at all; otherwise refresh in the
    // background and answer from the last good roll to keep claims fast.
    if (sixHundredRegistry.size === 0) await refreshSixHundredRegistry();
    else void refreshSixHundredRegistry();
  }
  return sixHundredRegistry.get(pubkey.toLowerCase()) ?? null;
}

function buildScoreEvent(claim: ClaimInput, playerPubkey: string, payoutSats: number, sixHundredHandle: string | null): EventTemplate {
  const tags = [
    ['d', `${GAME_ID}:${playerPubkey}:${claim.run_id}`],
    ['game', GAME_ID],
    ['score', String(claim.score)],
    ['p', playerPubkey],
    ['sats', String(payoutSats)],
    ['state', 'final'],
    ['wave', String(claim.wave)],
    ['duration', String(Math.round(claim.duration_ms / 1000))],
    ['rescues', String(claim.rescues)],
    ['known_rescues', String(claim.known_rescues)],
    ['lost', String(claim.lost)],
    ['credits', String(claim.credits)],
    ['max_combo', String(claim.max_combo)],
    // Gamestr-wide discovery tags: other games on main.relay.gamestr.io describe
    // their scores with title/level/source/platform/image, so leaderboard
    // clients can render any game's event without game-specific knowledge.
    ['title', GAME_TITLE],
    ['level', String(claim.wave)],
    ['r', GAME_URL],
    ['source', GAME_SOURCE],
    ['platform', 'web'],
    ['image', GAME_IMAGE_URL],
    ['r', GAME_IMAGE_URL],
    ['imeta', `url ${GAME_IMAGE_URL}`, 'm image/png', `alt ${GAME_TITLE} icon`],
    ['t', 'arcade'],
    ['t', 'rescue-shooter'],
    ['t', 'nostr'],
    ['t', GAME_ID],
  ];
  const playerName = cleanPlayerName(claim.player_name);
  if (playerName) tags.push(['player', playerName], ['playerName', playerName]);
  if (claim.player_mode === 'guest' || claim.player_mode === 'nostr') tags.push(['playerMode', claim.player_mode]);
  const nip05 = sixHundredHandle ? sixHundredNip05(sixHundredHandle) : null;
  if (nip05) tags.push(['nip05', nip05], ['t', '600b']);
  return {
    kind: SCORE_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: JSON.stringify({
      game: GAME_ID,
      run_id: claim.run_id,
      player: playerPubkey,
      score: claim.score,
      wave: claim.wave,
      credits: claim.credits,
      payout_sats: payoutSats,
      playerName,
      playerMode: claim.player_mode ?? null,
      player_name: playerName,
      player_mode: claim.player_mode ?? null,
      nip05,
      metrics: claim.metrics ?? null,
    }),
    tags,
  };
}

function cleanPlayerName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim().slice(0, 32);
  return clean || null;
}

async function publishSignedScore(event: VerifiedEvent): Promise<{ ok: number; total: number }> {
  if (!PUBLISH_ENABLED) return { ok: 0, total: WRITE_RELAYS.length };
  const results = await Promise.all(WRITE_RELAYS.map(relay => publishToRelay(relay, event)));
  return { ok: results.filter(Boolean).length, total: WRITE_RELAYS.length };
}

interface RelayWebSocket {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

function publishToRelay(relay: string, event: VerifiedEvent): Promise<boolean> {
  return new Promise(resolve => {
    const WebSocketCtor = (globalThis as unknown as { WebSocket?: new (url: string) => RelayWebSocket }).WebSocket;
    if (!WebSocketCtor) {
      resolve(false);
      return;
    }
    let ws: RelayWebSocket | null = null;
    let settled = false;
    const timer = setTimeout(() => settle(false), RELAY_PUBLISH_TIMEOUT_MS);
    const settle = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws?.close(); } catch { /* ignore */ }
      resolve(ok);
    };
    try {
      ws = new WebSocketCtor(relay);
    } catch {
      clearTimeout(timer);
      resolve(false);
      return;
    }
    ws.onopen = () => {
      try { ws?.send(JSON.stringify(['EVENT', event])); } catch { settle(false); }
    };
    ws.onmessage = ev => {
      let msg: unknown;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
      if (!Array.isArray(msg) || msg[0] !== 'OK' || msg[1] !== event.id) return;
      settle(msg[2] === true);
    };
    ws.onerror = () => settle(false);
    ws.onclose = () => settle(false);
  });
}

function clampPayout(claim: ClaimInput): number {
  void claim;
  return 0;
}

async function appendClaim(stored: StoredClaim, claim: ClaimInput): Promise<void> {
  await mkdir(dirname(CLAIM_LOG), { recursive: true });
  await appendFile(CLAIM_LOG, `${JSON.stringify({ ...stored, claim })}\n`, { encoding: 'utf8' });
}

async function loadClaims(): Promise<Map<string, StoredClaim>> {
  const map = new Map<string, StoredClaim>();
  try {
    const raw = await readFile(CLAIM_LOG, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Partial<StoredClaim>;
        if (typeof parsed.key === 'string' && typeof parsed.score_event_id === 'string') {
          const acceptedAt = String(parsed.accepted_at ?? '');
          map.set(parsed.key, {
            key: parsed.key,
            pubkey: String(parsed.pubkey ?? ''),
            run_id: String(parsed.run_id ?? ''),
            score_event_id: parsed.score_event_id,
            payout_sats: Number(parsed.payout_sats ?? 0),
            published: isPublished(parsed.published) ? parsed.published : { ok: 0, total: WRITE_RELAYS.length },
            accepted_at: acceptedAt,
            // Older log lines predate finished_at; accepted_at lands close enough in
            // time to use as a pruning proxy (claims are only ever accepted shortly
            // after finished_at, since parseClaim rejects stale runs).
            finished_at: typeof parsed.finished_at === 'number' ? parsed.finished_at : Date.parse(acceptedAt) || 0,
          });
        }
      } catch {
        // Ignore malformed audit rows; future writes remain append-only.
      }
    }
  } catch {
    // The first deploy starts with no claim log.
  }
  return map;
}

function pruneStaleClaims(): void {
  const cutoff = Date.now() - CLAIM_DEDUP_TTL_MS;
  for (const [key, stored] of claims) {
    if (stored.finished_at < cutoff) claims.delete(key);
  }
}

function isPublished(value: unknown): value is { ok: number; total: number } {
  if (!value || typeof value !== 'object') return false;
  const parsed = value as { ok?: unknown; total?: unknown };
  return typeof parsed.ok === 'number' && typeof parsed.total === 'number';
}

function loadGameSecret(): Uint8Array | null {
  const raw = process.env.NEON_SENTINEL_GAME_NSEC ?? process.env.GAME_NSEC ?? '';
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return hexToBytes(trimmed);
  if (trimmed.toLowerCase().startsWith('nsec1')) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== 'nsec') throw new Error('NEON_SENTINEL_GAME_NSEC did not decode to nsec');
    return decoded.data;
  }
  throw new Error('NEON_SENTINEL_GAME_NSEC must be 64-char hex or nsec1...');
}

function resolveGamePubkey(secret: Uint8Array | null): string | null {
  if (!secret) return process.env.NEON_SENTINEL_GAME_PUBKEY?.trim() || expectedGamePubkey;
  const actual = getPublicKey(secret);
  if (expectedGamePubkey && actual !== expectedGamePubkey) {
    throw new Error(`NEON_SENTINEL_GAME_NSEC derives to ${actual}, expected ${expectedGamePubkey} (${EXPECTED_GAME_NPUB})`);
  }
  return actual;
}

function decodeNpub(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.toLowerCase().startsWith('npub1')) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== 'npub') throw new Error('NEON_SENTINEL_GAME_NPUB did not decode to npub');
    return decoded.data;
  }
  throw new Error('NEON_SENTINEL_GAME_NPUB must be 64-char hex or npub1...');
}

function reconstructUrl(req: IncomingMessage): string {
  const proto = header(req, 'x-forwarded-proto') ?? 'http';
  const host = header(req, 'x-forwarded-host') ?? header(req, 'host') ?? `${HOST}:${PORT}`;
  return `${proto}://${host}${req.url ?? '/api/claim'}`;
}

function header(req: IncomingMessage, key: string): string | undefined {
  const value = req.headers[key.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.byteLength;
    if (total > MAX_BODY_BYTES) throw new Error('body_too_large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res: ServerResponse, status: number, body: unknown, req?: IncomingMessage): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...corsHeaders(req),
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

function clientIp(req: IncomingMessage): string {
  const forwarded = header(req, 'x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

function createRateLimiter(limit: number, windowMs: number, maxTrackedIps = RATE_LIMIT_MAX_TRACKED_IPS): (ip: string) => boolean {
  const buckets = new Map<string, { tokens: number; updatedAt: number }>();
  return (ip: string): boolean => {
    const now = Date.now();
    let bucket = buckets.get(ip);
    if (bucket) {
      buckets.delete(ip); // re-insert below to mark as most-recently-used
    } else {
      if (buckets.size >= maxTrackedIps) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey !== undefined) buckets.delete(oldestKey);
      }
      bucket = { tokens: limit, updatedAt: now };
    }
    const elapsedMs = now - bucket.updatedAt;
    bucket.tokens = Math.min(limit, bucket.tokens + (elapsedMs / windowMs) * limit);
    bucket.updatedAt = now;
    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    buckets.set(ip, bucket);
    return allowed;
  };
}

function corsHeaders(req?: IncomingMessage): Record<string, string> {
  const requestOrigin = req ? header(req, 'origin') : undefined;
  const origin = requestOrigin && allowedCorsOrigins.has(requestOrigin)
    ? requestOrigin
    : DEFAULT_ALLOWED_ORIGINS[0];
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
  };
}

function loadAllowedCorsOrigins(): Set<string> {
  const configured = (process.env.NEON_SENTINEL_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

function loadWriteRelays(): string[] {
  const configured = (process.env.NEON_SENTINEL_WRITE_RELAYS ?? '')
    .split(',')
    .map(relay => relay.trim())
    .filter(Boolean);
  const relays = configured.length > 0 ? configured : [...DEFAULT_WRITE_RELAYS];
  const clean: string[] = [];
  const seen = new Set<string>();
  for (const relay of relays) {
    if (!isRelayUrl(relay) || seen.has(relay)) continue;
    seen.add(relay);
    clean.push(relay);
  }
  return clean.length > 0 ? clean : [...DEFAULT_WRITE_RELAYS];
}

function isRelayUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'wss:' || url.protocol === 'ws:';
  } catch {
    return false;
  }
}
