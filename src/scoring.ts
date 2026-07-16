import { getReadRelays, getWriteRelays } from './relays.js';

export const GAME_ID = 'neonsentinel';
export const SCORE_KIND = 30762;
export const GAME_TITLE = 'Neon Sentinel';
export const GAME_URL = 'https://neonsentinel.com/';
export const GAME_SOURCE = 'neonsentinel.com';
export const GAME_IMAGE_URL = 'https://neonsentinel.com/brand/icon-512.png';

const LOCAL_SCORES_KEY = 'neonsentinel:local-scores:v1';
const LAST_CLAIM_KEY = 'neonsentinel:last-claim:v1';
const MAX_LOCAL_SCORES = 10;
const CLAIM_API = '/api/claim';
const NIP98_KIND = 27235;
const SIGN_TIMEOUT_MS = 30_000;
const CLAIM_MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 800;

export interface RelaykeepRunSummary {
  runId: string;
  playerName?: string;
  playerMode?: 'guest' | 'nostr';
  score: number;
  wave: number;
  sats: number;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  rescues: number;
  knownRescues: number;
  lost: number;
  maxCombo: number;
  metrics?: ScoreRunMetrics;
}

export interface ScoreWaveMetric {
  wave: number;
  seconds: number;
  cleared: boolean;
}

export interface ScoreRunMetrics {
  deaths: number;
  damageEvents: number;
  shotHitRate: number;
  shotsFired: number;
  shotsHit: number;
  rescueAverageSeconds: number | null;
  rescueSlowestSeconds: number | null;
  lowCampSeconds: number;
  lowCampRatio: number;
  contactsLifted: number;
  contactsDropped: number;
  contactsForged: number;
  topDamageSource: string;
  waveDurations: ScoreWaveMetric[];
}

export interface LocalScoreEntry extends RelaykeepRunSummary {
  at: string;
}

export interface ClaimInput {
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
  metrics?: ScoreRunMetrics;
  telemetry: {
    scoring_kind: typeof SCORE_KIND;
    sentinel_variant: 'nostr';
    write_relays: readonly string[];
    profile_read_relays: readonly string[];
  };
}

export interface NostrEventDraft {
  kind: typeof SCORE_KIND;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface SignedNostrEvent extends NostrEventDraft {
  id: string;
  pubkey: string;
  sig: string;
}

export interface PublishResult {
  relay: string;
  ok: boolean;
  message: string;
}

export interface ScoreClaimSession {
  pubkey: string;
  signer: {
    signEvent(event: Record<string, unknown>): Promise<unknown>;
  };
}

export type ClaimResult =
  | {
      ok: true;
      payout_sats: number;
      score_event_id: string;
      status: 'credited' | 'published' | 'accepted';
      published?: { ok: number; total: number };
    }
  | {
      ok: false;
      error: string;
      detail?: string;
      status?: number;
    };

export function buildScoreTags(summary: RelaykeepRunSummary, playerPubkey: string): string[][] {
  const tags = [
    ['d', `${GAME_ID}:${playerPubkey}:${summary.runId}`],
    ['game', GAME_ID],
    ['score', String(summary.score)],
    ['p', playerPubkey],
    ['sats', '0'],
    ['state', 'final'],
    ['wave', String(summary.wave)],
    ['duration', String(Math.round(summary.durationMs / 1000))],
    ['rescues', String(summary.rescues)],
    ['known_rescues', String(summary.knownRescues)],
    ['lost', String(summary.lost)],
    ['credits', String(summary.sats)],
    ['max_combo', String(summary.maxCombo)],
    // Gamestr-wide discovery tags: other games on main.relay.gamestr.io describe
    // their scores with title/level/source/platform/image, so leaderboard
    // clients can render any game's event without game-specific knowledge.
    ['title', GAME_TITLE],
    ['level', String(summary.wave)],
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
  if (summary.playerName) tags.push(['player', summary.playerName], ['playerName', summary.playerName]);
  if (summary.playerMode) tags.push(['playerMode', summary.playerMode]);
  if (summary.metrics) {
    tags.push(
      ['deaths', String(summary.metrics.deaths)],
      ['hit_rate', String(Math.round(summary.metrics.shotHitRate * 1000))],
      ['low_camp', String(Math.round(summary.metrics.lowCampSeconds))],
      ['drops', String(summary.metrics.contactsDropped)],
    );
  }
  return tags;
}

export function buildScoreEvent(summary: RelaykeepRunSummary, playerPubkey: string): NostrEventDraft {
  return {
    kind: SCORE_KIND,
    created_at: Math.floor(summary.finishedAt / 1000),
    tags: buildScoreTags(summary, playerPubkey),
    content: JSON.stringify(buildClaimInput(summary)),
  };
}

export function buildClaimInput(summary: RelaykeepRunSummary): ClaimInput {
  return {
    game: GAME_ID,
    score: summary.score,
    wave: summary.wave,
    duration_ms: summary.durationMs,
    started_at: summary.startedAt,
    finished_at: summary.finishedAt,
    credits: summary.sats,
    sats_claimed: 0,
    run_id: summary.runId,
    rescues: summary.rescues,
    known_rescues: summary.knownRescues,
    lost: summary.lost,
    max_combo: summary.maxCombo,
    ...(summary.playerName ? { player_name: summary.playerName } : {}),
    ...(summary.playerMode ? { player_mode: summary.playerMode } : {}),
    metrics: summary.metrics,
    telemetry: {
      scoring_kind: SCORE_KIND,
      sentinel_variant: 'nostr',
      write_relays: getWriteRelays(),
      profile_read_relays: getReadRelays(),
    },
  };
}

export async function submitScoreClaim(
  session: ScoreClaimSession,
  summary: RelaykeepRunSummary,
): Promise<ClaimResult> {
  const url = `${location.origin}${CLAIM_API}`;
  const bodyJson = JSON.stringify(buildClaimInput(summary));
  const payloadHash = await sha256Hex(bodyJson);
  const authTemplate = {
    kind: NIP98_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags: [
      ['u', url],
      ['method', 'POST'],
      ['payload', payloadHash],
    ],
  };

  let signedAuth: unknown;
  try {
    signedAuth = await Promise.race([
      session.signer.signEvent(authTemplate),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error('signer-timeout')), SIGN_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    return { ok: false, error: 'sign_failed', detail: err instanceof Error ? err.message : String(err) };
  }

  const outcome = await fetchClaimWithRetry(bodyJson, `Nostr ${utf8Base64(JSON.stringify(signedAuth))}`);
  if (!outcome.ok) {
    return { ok: false, error: 'network_error', detail: outcome.error instanceof Error ? outcome.error.message : String(outcome.error) };
  }
  const res = outcome.res;

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: 'bad_response', detail: `HTTP ${res.status}`, status: res.status };
  }
  if (typeof data !== 'object' || data === null) {
    return { ok: false, error: 'bad_response', status: res.status };
  }
  const result = data as Record<string, unknown>;
  if (result.ok === true && typeof result.score_event_id === 'string') {
    return {
      ok: true,
      payout_sats: typeof result.payout_sats === 'number' ? result.payout_sats : 0,
      score_event_id: result.score_event_id,
      status: result.status === 'published' || result.status === 'accepted' ? result.status : 'credited',
      published: parsePublishedResult(result.published),
    };
  }
  return {
    ok: false,
    error: typeof result.error === 'string' ? result.error : `http_${res.status}`,
    detail: typeof result.detail === 'string' ? result.detail : undefined,
    status: res.status,
  };
}

type ClaimFetchOutcome = { ok: true; res: Response } | { ok: false; error: unknown };

async function fetchClaimWithRetry(bodyJson: string, authHeader: string): Promise<ClaimFetchOutcome> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CLAIM_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(CLAIM_API, {
        method: 'POST',
        headers: {
          authorization: authHeader,
          'content-type': 'application/json',
        },
        body: bodyJson,
      });
      if (res.status >= 500 && attempt < CLAIM_MAX_ATTEMPTS) {
        await delay(RETRY_DELAY_MS);
        continue;
      }
      return { ok: true, res };
    } catch (err) {
      lastError = err;
      if (attempt < CLAIM_MAX_ATTEMPTS) {
        await delay(RETRY_DELAY_MS);
      }
    }
  }
  return { ok: false, error: lastError };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => { window.setTimeout(resolve, ms); });
}

export function parsePublishedResult(value: unknown): { ok: number; total: number } | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const published = value as Record<string, unknown>;
  if (typeof published.ok !== 'number' || typeof published.total !== 'number') return undefined;
  return { ok: published.ok, total: published.total };
}

export async function publishSignedScore(
  event: SignedNostrEvent,
  relays: readonly string[] = getWriteRelays(),
  timeoutMs = 4200,
): Promise<PublishResult[]> {
  if (typeof WebSocket === 'undefined') return [];
  return Promise.all(relays.map(relay => publishToRelay(relay, event, timeoutMs)));
}

export function finaliseLocalRun(summary: RelaykeepRunSummary): LocalScoreEntry[] {
  const entry: LocalScoreEntry = {
    ...summary,
    at: new Date(summary.finishedAt).toISOString(),
  };
  const scores = getLocalScores();
  scores.push(entry);
  scores.sort((a, b) => b.score - a.score);
  const trimmed = scores.slice(0, MAX_LOCAL_SCORES);
  try {
    localStorage.setItem(LOCAL_SCORES_KEY, JSON.stringify(trimmed));
    localStorage.setItem(LAST_CLAIM_KEY, JSON.stringify(buildClaimInput(summary)));
  } catch {
    // localStorage unavailable; the signed claim path will still work later.
  }
  return trimmed;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function utf8Base64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

interface RelayAttemptResult extends PublishResult {
  /** true when the failure was a socket/timeout problem, not an explicit relay response. */
  retryable: boolean;
}

async function publishToRelay(relay: string, event: SignedNostrEvent, timeoutMs: number): Promise<PublishResult> {
  const first = await attemptPublishToRelay(relay, event, timeoutMs);
  if (first.ok || !first.retryable) return { relay: first.relay, ok: first.ok, message: first.message };
  await delay(RETRY_DELAY_MS);
  const second = await attemptPublishToRelay(relay, event, timeoutMs);
  return { relay: second.relay, ok: second.ok, message: second.message };
}

function attemptPublishToRelay(relay: string, event: SignedNostrEvent, timeoutMs: number): Promise<RelayAttemptResult> {
  return new Promise(resolve => {
    let ws: WebSocket;
    let settled = false;
    const settle = (ok: boolean, message: string, retryable: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      resolve({ relay, ok, message, retryable });
    };

    const timer = window.setTimeout(() => settle(false, 'timeout', true), timeoutMs);
    try {
      ws = new WebSocket(relay);
    } catch (err) {
      clearTimeout(timer);
      resolve({ relay, ok: false, message: err instanceof Error ? err.message : 'open failed', retryable: true });
      return;
    }

    ws.onopen = () => {
      try { ws.send(JSON.stringify(['EVENT', event])); } catch { settle(false, 'send failed', true); }
    };
    ws.onmessage = ev => {
      let msg: unknown;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
      if (!Array.isArray(msg) || msg[0] !== 'OK' || msg[1] !== event.id) return;
      // An explicit OK/false is the relay's own verdict (e.g. rejected, rate-limited) — not a socket failure.
      settle(Boolean(msg[2]), typeof msg[3] === 'string' ? msg[3] : '', false);
    };
    ws.onerror = () => settle(false, 'relay error', true);
    ws.onclose = () => {
      if (!settled) settle(false, 'closed', true);
    };
  });
}

export function getLocalScores(): LocalScoreEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_SCORES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLocalScoreEntry);
  } catch {
    return [];
  }
}

export function isLocalScoreEntry(value: unknown): value is LocalScoreEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<LocalScoreEntry>;
  return typeof entry.runId === 'string'
    && typeof entry.score === 'number'
    && typeof entry.wave === 'number'
    && typeof entry.sats === 'number'
    && typeof entry.at === 'string';
}
