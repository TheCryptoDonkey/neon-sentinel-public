import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildClaimInput,
  buildScoreTags,
  finaliseLocalRun,
  GAME_ID,
  getLocalScores,
  isLocalScoreEntry,
  parsePublishedResult,
  SCORE_KIND,
  type RelaykeepRunSummary,
} from './scoring.js';
import { getReadRelays, getWriteRelays } from './relays.js';
import { createMemoryStorage } from './test-support/memory-storage.js';

// Must match the private LOCAL_SCORES_KEY constant in scoring.ts — there is no
// exported symbol for it, so the storage key is duplicated here deliberately.
const LOCAL_SCORES_KEY = 'neonsentinel:local-scores:v1';
const MAX_LOCAL_SCORES = 10;

function makeSummary(overrides: Partial<RelaykeepRunSummary> = {}): RelaykeepRunSummary {
  return {
    runId: 'run-1',
    score: 4200,
    wave: 7,
    sats: 350,
    startedAt: 1_000,
    finishedAt: 61_000,
    durationMs: 60_000,
    rescues: 3,
    knownRescues: 2,
    lost: 1,
    maxCombo: 12,
    ...overrides,
  };
}

beforeEach(() => {
  globalThis.localStorage = createMemoryStorage();
});

describe('buildScoreTags', () => {
  it('builds the base tag set from a run summary', () => {
    const tags = buildScoreTags(makeSummary(), 'pubkey123');
    expect(tags).toEqual([
      ['d', `${GAME_ID}:pubkey123:run-1`],
      ['game', GAME_ID],
      ['score', '4200'],
      ['p', 'pubkey123'],
      ['sats', '0'],
      ['state', 'final'],
      ['wave', '7'],
      ['duration', '60'],
      ['rescues', '3'],
      ['known_rescues', '2'],
      ['lost', '1'],
      ['credits', '350'],
      ['max_combo', '12'],
      ['title', 'Neon Sentinel'],
      ['level', '7'],
      ['r', 'https://neonsentinel.com/'],
      ['source', 'neonsentinel.com'],
      ['platform', 'web'],
      ['image', 'https://neonsentinel.com/brand/icon-512.png'],
      ['r', 'https://neonsentinel.com/brand/icon-512.png'],
      ['imeta', 'url https://neonsentinel.com/brand/icon-512.png', 'm image/png', 'alt Neon Sentinel icon'],
      ['t', 'arcade'],
      ['t', 'rescue-shooter'],
      ['t', 'nostr'],
      ['t', GAME_ID],
    ]);
  });

  it('always emits a placeholder "sats" tag of 0, distinct from the "credits" tag', () => {
    const tags = buildScoreTags(makeSummary({ sats: 9999 }), 'pubkey123');
    expect(tags).toContainEqual(['sats', '0']);
    expect(tags).toContainEqual(['credits', '9999']);
  });

  it('appends optional player and metrics tags only when present', () => {
    const withOptional = buildScoreTags(
      makeSummary({
        playerName: 'Neo',
        playerMode: 'nostr',
        metrics: {
          deaths: 2,
          damageEvents: 5,
          shotHitRate: 0.6667,
          shotsFired: 30,
          shotsHit: 20,
          rescueAverageSeconds: 4.2,
          rescueSlowestSeconds: 9.1,
          lowCampSeconds: 12.6,
          lowCampRatio: 0.2,
          contactsLifted: 4,
          contactsDropped: 1,
          contactsForged: 0,
          topDamageSource: 'drone',
          waveDurations: [],
        },
      }),
      'pubkey123',
    );
    expect(withOptional).toContainEqual(['player', 'Neo']);
    expect(withOptional).toContainEqual(['playerName', 'Neo']);
    expect(withOptional).toContainEqual(['playerMode', 'nostr']);
    expect(withOptional).toContainEqual(['deaths', '2']);
    expect(withOptional).toContainEqual(['hit_rate', '667']);
    expect(withOptional).toContainEqual(['low_camp', '13']);
    expect(withOptional).toContainEqual(['drops', '1']);

    const withoutOptional = buildScoreTags(makeSummary(), 'pubkey123');
    expect(withoutOptional.some(([key]) => key === 'player')).toBe(false);
    expect(withoutOptional.some(([key]) => key === 'playerName')).toBe(false);
    expect(withoutOptional.some(([key]) => key === 'deaths')).toBe(false);
  });
});

describe('buildClaimInput', () => {
  it('maps a run summary onto the claim payload shape', () => {
    const claim = buildClaimInput(makeSummary());
    expect(claim).toMatchObject({
      game: GAME_ID,
      score: 4200,
      wave: 7,
      duration_ms: 60_000,
      started_at: 1_000,
      finished_at: 61_000,
      credits: 350,
      sats_claimed: 0,
      run_id: 'run-1',
      rescues: 3,
      known_rescues: 2,
      lost: 1,
      max_combo: 12,
    });
    expect(claim.telemetry.scoring_kind).toBe(SCORE_KIND);
    expect(claim.telemetry.sentinel_variant).toBe('nostr');
    expect(claim.telemetry.write_relays).toEqual(getWriteRelays());
    expect(claim.telemetry.profile_read_relays).toEqual(getReadRelays());
  });

  it('omits player_name/player_mode keys entirely when absent, but always includes metrics', () => {
    const claim = buildClaimInput(makeSummary());
    expect('player_name' in claim).toBe(false);
    expect('player_mode' in claim).toBe(false);
    expect('metrics' in claim).toBe(true);
    expect(claim.metrics).toBeUndefined();

    const withPlayer = buildClaimInput(makeSummary({ playerName: 'Neo', playerMode: 'guest' }));
    expect(withPlayer.player_name).toBe('Neo');
    expect(withPlayer.player_mode).toBe('guest');
  });
});

describe('isLocalScoreEntry', () => {
  it('accepts a well-formed entry', () => {
    const entry = { ...makeSummary(), at: new Date().toISOString() };
    expect(isLocalScoreEntry(entry)).toBe(true);
  });

  it.each([
    ['null', null],
    ['a number', 42],
    ['an array', []],
    ['missing at', { ...makeSummary() }],
    ['non-string runId', { ...makeSummary(), runId: 7, at: 'x' }],
    ['non-number score', { ...makeSummary(), score: '4200', at: 'x' }],
    ['non-number wave', { ...makeSummary(), wave: '7', at: 'x' }],
    ['non-number sats', { ...makeSummary(), sats: '350', at: 'x' }],
    ['non-string at', { ...makeSummary(), at: 12345 }],
  ])('rejects malformed variant: %s', (_label, value) => {
    expect(isLocalScoreEntry(value)).toBe(false);
  });
});

describe('parsePublishedResult', () => {
  it('parses a valid published summary', () => {
    expect(parsePublishedResult({ ok: 2, total: 5 })).toEqual({ ok: 2, total: 5 });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['missing total', { ok: 2 }],
    ['non-number ok', { ok: '2', total: 5 }],
    ['a string', 'ok'],
  ])('returns undefined for malformed variant: %s', (_label, value) => {
    expect(parsePublishedResult(value)).toBeUndefined();
  });
});

describe('getLocalScores', () => {
  it('returns an empty array when nothing is stored', () => {
    expect(getLocalScores()).toEqual([]);
  });

  it('returns an empty array when the stored JSON is corrupt', () => {
    localStorage.setItem(LOCAL_SCORES_KEY, '{not valid json');
    expect(getLocalScores()).toEqual([]);
  });

  it('returns an empty array when the stored JSON is not an array', () => {
    localStorage.setItem(LOCAL_SCORES_KEY, JSON.stringify({ oops: true }));
    expect(getLocalScores()).toEqual([]);
  });

  it('filters out malformed entries while keeping valid ones', () => {
    const valid = { ...makeSummary(), at: new Date(1000).toISOString() };
    const invalid = { ...makeSummary(), runId: 42, at: 'x' };
    localStorage.setItem(LOCAL_SCORES_KEY, JSON.stringify([valid, invalid]));
    expect(getLocalScores()).toEqual([valid]);
  });
});

describe('finaliseLocalRun round-trip', () => {
  it('persists a run and returns it via getLocalScores, sorted by score descending', () => {
    finaliseLocalRun(makeSummary({ runId: 'low', score: 100 }));
    finaliseLocalRun(makeSummary({ runId: 'high', score: 9000 }));
    const scores = getLocalScores();
    expect(scores.map(entry => entry.runId)).toEqual(['high', 'low']);
  });

  it('trims stored runs to the maximum local score count', () => {
    for (let i = 0; i < MAX_LOCAL_SCORES + 2; i++) {
      finaliseLocalRun(makeSummary({ runId: `run-${i}`, score: i }));
    }
    expect(getLocalScores()).toHaveLength(MAX_LOCAL_SCORES);
  });
});
