import { verifyEvent } from 'nostr-tools/pure';
import { getWriteRelays } from './relays.js';
import { GAME_ID, SCORE_KIND, getLocalScores } from './scoring.js';

// The game's authoritative signing key (hex pubkey for
// npub1xuq53wm49lh820yd6sm82t5qrupfz0du0trrxzpg6y742sxyegssntwz40).
// Score events on the leaderboard must be authored by this key — the claim
// server signs them after its plausibility checks, so a self-published
// client event can never appear here.
export const GAME_PUBKEY = '370148bb752fee753c8dd436752e801f02913dbc7ac6330828d13d5540c4ca21';

const FETCH_TIMEOUT_MS = 4200;
const FETCH_LIMIT = 400;
const CACHE_TTL_MS = 4 * 60 * 1000;
const CACHE_KEY = 'neonsentinel:leaderboard:v1';
const MAX_ENTRIES = 100;
const RELAY_COOLDOWN_KEY = 'neonsentinel:leaderboard:relay-cooldowns:v1';
const RELAY_FAILURE_COOLDOWN_MS = 2 * 60 * 1000;
// Game-over forces a fresh fetch (twice - immediate, then again once the
// just-published score has had time to land) so the rival board reflects
// the run that just ended. A player chaining instant retries can trigger
// several of those bypasses a minute, opening a fresh socket to every write
// relay each time - exactly the pattern main.relay.gamestr.io's per-IP connection
// limit rejects with "too many connections from your IP". A forced fetch is
// only honoured this often; more frequent calls fall back to the normal
// cache like an unforced one.
const MIN_FORCE_INTERVAL_MS = 20_000;

export interface LeaderboardEntry {
  playerPubkey: string;
  playerName: string;
  score: number;
  wave: number;
  rescues: number;
  at: number;
  /** UTC YYYYMMDD stamp when the run was a daily gauntlet, else null. */
  daily: string | null;
}

export type LeaderboardSource = 'relays' | 'cache' | 'local';

export interface LeaderboardSnapshot {
  entries: LeaderboardEntry[];
  /** Today's daily-gauntlet board (best per player, already sig-checked). */
  daily: LeaderboardEntry[];
  source: LeaderboardSource;
  fetchedAt: number;
}

/** UTC day stamp used to mark and filter daily-gauntlet runs. */
export function dailyBoardStamp(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

interface ScoreEventShape {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  sig: string;
}

let memoryCache: LeaderboardSnapshot | null = null;
let inFlight: Promise<LeaderboardSnapshot> | null = null;
let lastForcedFetchAt = 0;

function readRelayCooldowns(now = Date.now()): Record<string, number> {
  try {
    const raw = localStorage.getItem(RELAY_COOLDOWN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [relay, until] of Object.entries(parsed)) {
      if (typeof until === 'number' && Number.isFinite(until) && until > now) out[relay] = until;
    }
    if (Object.keys(out).length !== Object.keys(parsed).length) writeRelayCooldowns(out);
    return out;
  } catch {
    return {};
  }
}

function writeRelayCooldowns(next: Record<string, number>): void {
  try {
    if (Object.keys(next).length === 0) localStorage.removeItem(RELAY_COOLDOWN_KEY);
    else localStorage.setItem(RELAY_COOLDOWN_KEY, JSON.stringify(next));
  } catch {
    // Storage may be blocked; the current fetch still falls back gracefully.
  }
}

export function isRelayCoolingDown(relay: string, now = Date.now()): boolean {
  return (readRelayCooldowns(now)[relay] ?? 0) > now;
}

export function recordRelayFetchFailure(relay: string, now = Date.now(), cooldownMs = RELAY_FAILURE_COOLDOWN_MS): void {
  const next = readRelayCooldowns(now);
  next[relay] = Math.max(next[relay] ?? 0, now + cooldownMs);
  writeRelayCooldowns(next);
}

function relaysForLeaderboardFetch(now = Date.now()): string[] {
  const cooldowns = readRelayCooldowns(now);
  return getWriteRelays().filter(relay => (cooldowns[relay] ?? 0) <= now);
}

function isScoreEvent(value: unknown): value is ScoreEventShape {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === 'string' &&
    typeof event.pubkey === 'string' &&
    event.kind === SCORE_KIND &&
    typeof event.created_at === 'number' &&
    Array.isArray(event.tags) &&
    typeof event.sig === 'string'
  );
}

function tagValue(tags: string[][], name: string): string | null {
  for (const tag of tags) {
    if (tag[0] === name && typeof tag[1] === 'string') return tag[1];
  }
  return null;
}

export function parseScoreEvent(event: ScoreEventShape): LeaderboardEntry | null {
  if (event.pubkey !== GAME_PUBKEY) return null;
  if (tagValue(event.tags, 'game') !== GAME_ID) return null;
  if (tagValue(event.tags, 'state') !== 'final') return null;
  const playerPubkey = tagValue(event.tags, 'p');
  const score = Number(tagValue(event.tags, 'score'));
  if (!playerPubkey || !Number.isFinite(score) || score < 0) return null;
  const wave = Number(tagValue(event.tags, 'wave'));
  const rescues = Number(tagValue(event.tags, 'rescues'));
  const rawName = tagValue(event.tags, 'playerName') ?? '';
  // Daily-gauntlet runs mark themselves in the run_id segment of the d tag
  // (`neonsentinel:<pubkey>:daily-YYYYMMDD-…`), signed by the game key.
  const dTag = tagValue(event.tags, 'd') ?? '';
  const runId = dTag.split(':')[2] ?? '';
  const dailyMatch = /^daily-(\d{8})-/.exec(runId);
  return {
    playerPubkey,
    playerName: sanitiseName(rawName) || `${playerPubkey.slice(0, 8)}…`,
    score: Math.floor(score),
    wave: Number.isFinite(wave) ? Math.max(0, Math.floor(wave)) : 0,
    rescues: Number.isFinite(rescues) ? Math.max(0, Math.floor(rescues)) : 0,
    at: event.created_at * 1000,
    daily: dailyMatch ? dailyMatch[1]! : null,
  };
}

export function sanitiseName(name: string): string {
  // Score events are public relay data; strip control and zero-width
  // characters and keep names to a display-safe length.
  return name.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, '').trim().slice(0, 18);
}

// All-time table keeps each player's best run only.
export function bestPerPlayer(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  const best = new Map<string, LeaderboardEntry>();
  for (const entry of entries) {
    const prev = best.get(entry.playerPubkey);
    if (!prev || entry.score > prev.score || (entry.score === prev.score && entry.at < prev.at)) {
      best.set(entry.playerPubkey, entry);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.at - b.at).slice(0, MAX_ENTRIES);
}

export function rankForScore(entries: readonly LeaderboardEntry[], score: number): number {
  let rank = 1;
  for (const entry of entries) {
    if (entry.score > score) rank += 1;
  }
  return rank;
}

function localFallback(): LeaderboardSnapshot {
  const entries = getLocalScores().map(entry => ({
    playerPubkey: 'local',
    playerName: sanitiseName(entry.playerName ?? 'You') || 'You',
    score: entry.score,
    wave: entry.wave,
    rescues: entry.rescues,
    at: Date.parse(entry.at) || 0,
    daily: null,
  })).sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);
  return { entries, daily: [], source: 'local', fetchedAt: Date.now() };
}

function readStoredCache(): LeaderboardSnapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LeaderboardSnapshot>;
    if (!Array.isArray(parsed.entries) || typeof parsed.fetchedAt !== 'number') return null;
    const validEntry = (entry: unknown): entry is LeaderboardEntry => {
      const candidate = entry as LeaderboardEntry | null;
      return Boolean(candidate) &&
        typeof candidate!.playerPubkey === 'string' &&
        typeof candidate!.playerName === 'string' &&
        typeof candidate!.score === 'number' &&
        typeof candidate!.wave === 'number';
    };
    const entries = parsed.entries.filter(validEntry).map(entry => ({ ...entry, daily: entry.daily ?? null }));
    // A cached daily board only counts while it is still the same UTC day.
    const stamp = dailyBoardStamp();
    const daily = (Array.isArray(parsed.daily) ? parsed.daily.filter(validEntry) : [])
      .map(entry => ({ ...entry, daily: entry.daily ?? null }))
      .filter(entry => entry.daily === stamp);
    return { entries, daily, source: 'cache', fetchedAt: parsed.fetchedAt };
  } catch {
    return null;
  }
}

function writeStoredCache(snapshot: LeaderboardSnapshot): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ entries: snapshot.entries, daily: snapshot.daily, fetchedAt: snapshot.fetchedAt }));
  } catch {
    // Storage may be blocked; the in-memory cache still applies.
  }
}

export function getCachedLeaderboard(): LeaderboardSnapshot | null {
  return memoryCache ?? readStoredCache();
}

export async function fetchLeaderboard(force = false): Promise<LeaderboardSnapshot> {
  const now = Date.now();
  const effectiveForce = force && now - lastForcedFetchAt >= MIN_FORCE_INTERVAL_MS;
  if (!effectiveForce && memoryCache && now - memoryCache.fetchedAt < CACHE_TTL_MS) return memoryCache;
  if (inFlight) return inFlight;
  if (effectiveForce) lastForcedFetchAt = now;
  inFlight = fetchFromRelays()
    .then(snapshot => {
      if (snapshot.entries.length > 0) {
        memoryCache = snapshot;
        writeStoredCache(snapshot);
        return snapshot;
      }
      return memoryCache ?? readStoredCache() ?? localFallback();
    })
    .catch(() => memoryCache ?? readStoredCache() ?? localFallback())
    .finally(() => { inFlight = null; });
  return inFlight;
}

function fetchFromRelays(): Promise<LeaderboardSnapshot> {
  // Scores are read back from the same relay set they are published to -
  // that includes main.relay.gamestr.io (the Gamestr leaderboard relay) and the
  // project relay, so the board matches what Gamestr itself sees.
  const relays = relaysForLeaderboardFetch();
  if (relays.length === 0) return Promise.resolve({ entries: [], daily: [], source: 'relays', fetchedAt: Date.now() });
  return new Promise(resolve => {
    const sockets: WebSocket[] = [];
    const finishedRelays = new Set<string>();
    const seen = new Map<string, ScoreEventShape>();
    let settled = false;

    const settle = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      for (const ws of sockets) {
        try { ws.close(); } catch { /* already closed */ }
      }
      const parsed: LeaderboardEntry[] = [];
      const eventFor = new Map<LeaderboardEntry, ScoreEventShape>();
      for (const event of seen.values()) {
        const entry = parseScoreEvent(event);
        if (!entry) continue;
        parsed.push(entry);
        eventFor.set(entry, event);
      }
      // Signature-check only the rows that can actually be shown; a relay
      // returning forged game-key events is the threat here.
      const verified = (entry: LeaderboardEntry): boolean => {
        const event = eventFor.get(entry);
        if (!event) return false;
        try { return verifyEvent(event as Parameters<typeof verifyEvent>[0]); } catch { return false; }
      };
      const entries = bestPerPlayer(parsed).filter(verified);
      const stamp = dailyBoardStamp();
      const daily = bestPerPlayer(parsed.filter(entry => entry.daily === stamp)).filter(verified);
      resolve({ entries, daily, source: 'relays', fetchedAt: Date.now() });
    };

    const markDone = (relay: string): void => {
      finishedRelays.add(relay);
      if (finishedRelays.size >= relays.length) settle();
    };

    const timer = window.setTimeout(settle, FETCH_TIMEOUT_MS);

    for (const relay of relays) {
      let ws: WebSocket;
      try {
        ws = new WebSocket(relay);
      } catch {
        recordRelayFetchFailure(relay);
        markDone(relay);
        continue;
      }
      sockets.push(ws);
      const subId = `ns-board-${Math.random().toString(36).slice(2, 9)}`;
      let relayFinished = false;

      const finishRelay = (): void => {
        if (relayFinished) return;
        relayFinished = true;
        markDone(relay);
      };

      ws.onopen = () => {
        try {
          ws.send(JSON.stringify(['REQ', subId, { kinds: [SCORE_KIND], authors: [GAME_PUBKEY], limit: FETCH_LIMIT }]));
        } catch {
          recordRelayFetchFailure(relay);
          finishRelay();
        }
      };

      ws.onmessage = ev => {
        let msg: unknown;
        try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
        if (!Array.isArray(msg)) return;
        if (msg[0] === 'EVENT' && msg[1] === subId && isScoreEvent(msg[2])) {
          const event = msg[2];
          if (!seen.has(event.id)) seen.set(event.id, event);
        } else if (msg[0] === 'EOSE' && msg[1] === subId) {
          finishRelay();
        }
      };

      ws.onerror = () => {
        recordRelayFetchFailure(relay);
        finishRelay();
      };
      ws.onclose = () => {
        if (!relayFinished && !settled) {
          recordRelayFetchFailure(relay);
          finishRelay();
        }
      };
    }
  });
}
