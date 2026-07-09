import {
  getMasterVolume,
  getMusicDestination,
  getMusicDuckFactor,
  getMusicVolume,
  isAudioUnlocked,
  isMuted,
} from './audio.js';

type MusicPhase = 'title' | 'playing' | 'paused' | 'gameover';
type MusicShipClass = 'interceptor' | 'guardian' | 'heavy';
type MusicPressure = 'cadet' | 'normal' | '600b';
type MusicAlbumKey = `${MusicShipClass}/${MusicPressure}`;

export interface MusicState {
  phase: MusicPhase;
  wave: number;
  intensity?: number;
  shipClass?: MusicShipClass;
  skill?: MusicPressure;
}

interface Track {
  id: string;
  src: string;
  label: string;
  hint: string;
  category: 'system' | 'combat' | 'pressure';
  wave: number | null;
  trim?: number;
  loop?: boolean;
  startAt?: number;
}

interface Loaded {
  el: HTMLAudioElement;
  src: MediaElementAudioSourceNode | null;
  gain: GainNode | null;
  failed: boolean;
  direct: boolean;
  volumeRaf: number | null;
}

export interface TrackInfo {
  id: string;
  label: string;
  hint: string;
  category: Track['category'];
  wave: number | null;
}

export interface MusicDebugSnapshot {
  currentId: string | null;
  src: string | null;
  direct: boolean | null;
  volume: number | null;
  muted: boolean | null;
  paused: boolean | null;
  readyState: number | null;
  networkState: number | null;
  errorCode: number | null;
  errorMsg: string | null;
  failedFlag: boolean | null;
  loadedCount: number;
  albumKey: string;
  albumOrder: readonly string[];
  currentAlbumIndex: number;
  playingIds: string[];
  audibleIds: string[];
}

const DEFAULT_FADE_MS = 1200;
const ALBUM_CROSSFADE_MS = 3200;
const PREVIEW_FADE_MS = 420;
const ALBUM_PREFETCH_AHEAD = 3;
const ALBUM_PREEND_FADE_SECONDS = 4.8;
const DEFAULT_ALBUM_SHIP: MusicShipClass = 'guardian';
const DEFAULT_ALBUM_PRESSURE: MusicPressure = 'normal';

const TRACKS: Record<string, Track> = {
  'neon-title': {
    id: 'neon-title',
    src: '/music/neon-title.m4a',
    label: 'NEON TITLE',
    hint: 'Attract screen',
    category: 'system',
    wave: null,
    trim: 0.9,
  },
  'relaykeep-idle': {
    id: 'relaykeep-idle',
    src: '/music/relaykeep-idle.opus',
    label: 'RELAYKEEP IDLE',
    hint: 'Relay standby',
    category: 'system',
    wave: null,
    trim: 0.84,
  },
  'sentinel-resolve': {
    id: 'sentinel-resolve',
    src: '/music/sentinel-resolve.m4a',
    label: 'SENTINEL RESOLVE',
    hint: 'Opening relay defence',
    category: 'combat',
    wave: 2,
    trim: 0.92,
  },
  'blasterz': {
    id: 'blasterz',
    src: '/music/blasterz.m4a',
    label: 'BLASTERZ',
    hint: 'Immediate firepower',
    category: 'combat',
    wave: 2,
    trim: 0.9,
  },
  'rescue-run': {
    id: 'rescue-run',
    src: '/music/rescue-run.m4a',
    label: 'RESCUE RUN',
    hint: 'Contact-save pressure',
    category: 'combat',
    wave: 3,
  },
  'laser-barrage': {
    id: 'laser-barrage',
    src: '/music/laser-barrage.m4a',
    label: 'LASER BARRAGE',
    hint: 'Fast close-range waves',
    category: 'combat',
    wave: 1,
    trim: 0.86,
  },
  'alien-swarm-rising': {
    id: 'alien-swarm-rising',
    src: '/music/alien-swarm-rising.m4a',
    label: 'ALIEN SWARM RISING',
    hint: 'Swarm escalation',
    category: 'pressure',
    wave: 4,
    trim: 0.9,
  },
  'mutant-invasion': {
    id: 'mutant-invasion',
    src: '/music/mutant-invasion.m4a',
    label: 'MUTANT INVASION',
    hint: 'Hunter pressure',
    category: 'pressure',
    wave: 5,
  },
  'wave-after-wave': {
    id: 'wave-after-wave',
    src: '/music/wave-after-wave.m4a',
    label: 'WAVE AFTER WAVE',
    hint: 'Sustained combat',
    category: 'combat',
    wave: 6,
  },
  'the-swarm': {
    id: 'the-swarm',
    src: '/music/the-swarm.m4a',
    label: 'THE SWARM',
    hint: 'Dense abductor waves',
    category: 'pressure',
    wave: 7,
  },
  'planetary-defense': {
    id: 'planetary-defense',
    src: '/music/planetary-defense.m4a',
    label: 'PLANETARY DEFENSE',
    hint: 'Radar-first control',
    category: 'combat',
    wave: 8,
  },
  'carrier-barrage': {
    id: 'carrier-barrage',
    src: '/music/carrier-barrage.m4a',
    label: 'CARRIER BARRAGE',
    hint: 'Carrier broadsides',
    category: 'pressure',
    wave: 9,
  },
  'the-siege': {
    id: 'the-siege',
    src: '/music/the-siege.m4a',
    label: 'THE SIEGE',
    hint: 'Carrier assault',
    category: 'pressure',
    wave: 10,
    trim: 0.92,
  },
  'relay-march': {
    id: 'relay-march',
    src: '/music/relay-march.m4a',
    label: 'RELAY MARCH',
    hint: 'Mid-wave march',
    category: 'combat',
    wave: 10,
  },
  'hyperspace-chase': {
    id: 'hyperspace-chase',
    src: '/music/hyperspace-chase.m4a',
    label: 'HYPERSPACE CHASE',
    hint: 'High-speed pursuit',
    category: 'pressure',
    wave: 11,
  },
  'eternal-vigilance': {
    id: 'eternal-vigilance',
    src: '/music/eternal-vigilance.m4a',
    label: 'ETERNAL VIGILANCE',
    hint: 'Late-wave focus',
    category: 'combat',
    wave: 12,
  },
  'the-descent': {
    id: 'the-descent',
    src: '/music/the-descent.m4a',
    label: 'THE DESCENT',
    hint: 'Low-altitude pressure',
    category: 'pressure',
    wave: 13,
    trim: 0.9,
  },
  'the-drift': {
    id: 'the-drift',
    src: '/music/the-drift.m4a',
    label: 'THE DRIFT',
    hint: 'Tactical reset',
    category: 'system',
    wave: null,
    trim: 0.88,
  },
  'the-fury': {
    id: 'the-fury',
    src: '/music/the-fury.m4a',
    label: 'THE FURY',
    hint: 'Boss aggression',
    category: 'pressure',
    wave: 13,
  },
  'the-tempest': {
    id: 'the-tempest',
    src: '/music/the-tempest.m4a',
    label: 'THE TEMPEST',
    hint: 'Storm waves',
    category: 'pressure',
    wave: 14,
  },
  'the-survivor': {
    id: 'the-survivor',
    src: '/music/the-survivor.m4a',
    label: 'THE SURVIVOR',
    hint: 'Relay down',
    category: 'system',
    wave: null,
    trim: 0.82,
  },
  'smart-bombz': {
    id: 'smart-bombz',
    src: '/music/smart-bombz.m4a',
    label: 'SMART BOMBZ',
    hint: 'Burst-charge pressure',
    category: 'pressure',
    wave: 15,
  },
  'phoenix-reborn': {
    id: 'phoenix-reborn',
    src: '/music/phoenix-reborn.m4a',
    label: 'PHOENIX REBORN',
    hint: 'Respawn surge',
    category: 'combat',
    wave: 16,
    trim: 0.92,
  },
  'cosmic-high-score': {
    id: 'cosmic-high-score',
    src: '/music/cosmic-high-score.m4a',
    label: 'COSMIC HIGH SCORE',
    hint: 'Score chase',
    category: 'system',
    wave: null,
    trim: 0.9,
  },
  '600b-hole': {
    id: '600b-hole',
    src: '/music/600b-hole.m4a',
    label: '$600B HOLE',
    hint: 'Late-wave chaos',
    category: 'pressure',
    wave: 17,
    trim: 0.88,
  },
};

const WAVE_TRACKS: readonly string[] = [
  'laser-barrage',
  'blasterz',
  'sentinel-resolve',
  'rescue-run',
  'alien-swarm-rising',
  'mutant-invasion',
  'wave-after-wave',
  'the-swarm',
  'planetary-defense',
  'carrier-barrage',
  'the-siege',
  'relay-march',
  'hyperspace-chase',
  'eternal-vigilance',
  'the-descent',
  'the-fury',
  'the-tempest',
  'smart-bombz',
  'phoenix-reborn',
  '600b-hole',
];

const LOADOUT_ALBUM_ORDERS: Partial<Record<MusicAlbumKey, readonly string[]>> = {
  'interceptor/cadet': [
    'relay-march',
    'rescue-run',
    'hyperspace-chase',
    'phoenix-reborn',
    'smart-bombz',
    'eternal-vigilance',
    'laser-barrage',
    'the-descent',
    'blasterz',
    'sentinel-resolve',
    'wave-after-wave',
    'planetary-defense',
    'alien-swarm-rising',
    'carrier-barrage',
    'the-tempest',
    'the-swarm',
    'mutant-invasion',
    'the-fury',
    'the-siege',
    '600b-hole',
  ],
  'guardian/cadet': [
    'rescue-run',
    'phoenix-reborn',
    'eternal-vigilance',
    'planetary-defense',
    'sentinel-resolve',
    'the-descent',
    'relay-march',
    'wave-after-wave',
    'laser-barrage',
    'smart-bombz',
    'alien-swarm-rising',
    'blasterz',
    'carrier-barrage',
    'the-swarm',
    'mutant-invasion',
    'the-siege',
    'the-tempest',
    'the-fury',
    'hyperspace-chase',
    '600b-hole',
  ],
  'heavy/cadet': [
    'planetary-defense',
    'sentinel-resolve',
    'phoenix-reborn',
    'carrier-barrage',
    'eternal-vigilance',
    'the-siege',
    'wave-after-wave',
    'rescue-run',
    'relay-march',
    'the-descent',
    'blasterz',
    'the-tempest',
    'laser-barrage',
    'smart-bombz',
    'alien-swarm-rising',
    'the-fury',
    'mutant-invasion',
    'the-swarm',
    'hyperspace-chase',
    '600b-hole',
  ],
  'interceptor/normal': [
    'hyperspace-chase',
    'smart-bombz',
    'relay-march',
    'phoenix-reborn',
    'laser-barrage',
    'the-descent',
    'blasterz',
    '600b-hole',
    'rescue-run',
    'the-tempest',
    'the-swarm',
    'eternal-vigilance',
    'mutant-invasion',
    'carrier-barrage',
    'wave-after-wave',
    'alien-swarm-rising',
    'the-fury',
    'planetary-defense',
    'the-siege',
    'sentinel-resolve',
  ],
  'heavy/normal': [
    'the-siege',
    'carrier-barrage',
    'sentinel-resolve',
    'the-tempest',
    'planetary-defense',
    '600b-hole',
    'the-fury',
    'blasterz',
    'relay-march',
    'wave-after-wave',
    'the-descent',
    'eternal-vigilance',
    'mutant-invasion',
    'phoenix-reborn',
    'alien-swarm-rising',
    'smart-bombz',
    'rescue-run',
    'the-swarm',
    'hyperspace-chase',
    'laser-barrage',
  ],
  'interceptor/600b': [
    'hyperspace-chase',
    '600b-hole',
    'smart-bombz',
    'the-tempest',
    'laser-barrage',
    'the-descent',
    'relay-march',
    'the-swarm',
    'phoenix-reborn',
    'mutant-invasion',
    'blasterz',
    'carrier-barrage',
    'rescue-run',
    'alien-swarm-rising',
    'the-fury',
    'eternal-vigilance',
    'wave-after-wave',
    'the-siege',
    'planetary-defense',
    'sentinel-resolve',
  ],
  'guardian/600b': [
    '600b-hole',
    'the-descent',
    'the-swarm',
    'carrier-barrage',
    'alien-swarm-rising',
    'the-tempest',
    'mutant-invasion',
    'smart-bombz',
    'planetary-defense',
    'phoenix-reborn',
    'the-fury',
    'relay-march',
    'rescue-run',
    'the-siege',
    'hyperspace-chase',
    'eternal-vigilance',
    'blasterz',
    'wave-after-wave',
    'sentinel-resolve',
    'laser-barrage',
  ],
  'heavy/600b': [
    'the-siege',
    '600b-hole',
    'carrier-barrage',
    'the-fury',
    'planetary-defense',
    'the-tempest',
    'sentinel-resolve',
    'the-descent',
    'the-swarm',
    'relay-march',
    'mutant-invasion',
    'phoenix-reborn',
    'alien-swarm-rising',
    'smart-bombz',
    'eternal-vigilance',
    'wave-after-wave',
    'blasterz',
    'rescue-run',
    'hyperspace-chase',
    'laser-barrage',
  ],
};

const TRACK_LIST_ORDER: readonly string[] = [
  'neon-title',
  'relaykeep-idle',
  ...WAVE_TRACKS,
  'the-drift',
  'the-survivor',
  'cosmic-high-score',
];
const TITLE_POOL: readonly string[] = ['neon-title', 'relaykeep-idle', 'the-drift', 'cosmic-high-score', 'eternal-vigilance'];
const CRITICAL_TRACKS: readonly string[] = ['neon-title', 'laser-barrage', 'blasterz', 'sentinel-resolve', 'rescue-run', 'the-survivor'];

const loaded = new Map<string, Loaded>();

// A track whose element errors must not be respun immediately: load() sits on
// the per-frame music sync path, and recreating media elements at frame rate
// hits Chrome's WebMediaPlayer cap within minutes (observed ~500k dead
// players when the server became unreachable). Failed tracks back off
// exponentially and only retry once their window reopens.
const MUSIC_RETRY_BASE_MS = 5000;
const MUSIC_RETRY_MAX_MS = 120_000;
const trackFailures = new Map<string, { count: number; retryAtMs: number }>();

function registerTrackLoadFailure(id: string): void {
  const count = (trackFailures.get(id)?.count ?? 0) + 1;
  const delay = Math.min(MUSIC_RETRY_MAX_MS, MUSIC_RETRY_BASE_MS * 2 ** (count - 1));
  trackFailures.set(id, { count, retryAtMs: poolNow() + delay });
}

function trackRetryAtMs(id: string): number {
  return trackFailures.get(id)?.retryAtMs ?? 0;
}

let currentId: string | null = null;
let lastAppliedKey = '';
let lastPhase: MusicPhase | null = null;
let titleVisits = 0;
let currentTitleTrack = TITLE_POOL[0]!;
let currentAlbumIndex = 0;
let currentAlbumId: string | null = null;
let currentAlbumKey = albumKey(DEFAULT_ALBUM_SHIP, DEFAULT_ALBUM_PRESSURE);
let currentAlbumOrder: readonly string[] = WAVE_TRACKS;
const nextAlbumStartIndexes = new Map<string, number>();
let nextAlbumStartIndex = 0;
let manualPreviewId: string | null = null;
let lastVerifyMs = 0;
let currentIntensity = 0;

function urlFlag(name: string): string | null {
  try { return new URLSearchParams(window.location.search).get(name); }
  catch { return null; }
}

function mobileMusicRuntimeActive(): boolean {
  const ua = navigator.userAgent;
  const iosLike = /iP(hone|ad|od)/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  const coarsePointer = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return iosLike || (/Android|Mobile/i.test(ua) && coarsePointer);
}

function directMusicOutputActive(): boolean {
  if (urlFlag('webaudioMusic') === '1') return false;
  if (urlFlag('directMusic') === '1') return true;
  return mobileMusicRuntimeActive();
}

let trustedMediaGestureSeen = false;
function markTrustedMediaGesture(event: Event): void {
  if (!event.isTrusted) return;
  trustedMediaGestureSeen = true;
  retryCurrentTrackFromGesture();
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', markTrustedMediaGesture, true);
  window.addEventListener('pointerup', markTrustedMediaGesture, true);
  window.addEventListener('click', markTrustedMediaGesture, true);
  window.addEventListener('touchend', markTrustedMediaGesture, true);
  window.addEventListener('keydown', markTrustedMediaGesture, true);
  window.addEventListener('keyup', markTrustedMediaGesture, true);
}

function mediaPlaybackGestureReady(): boolean {
  return trustedMediaGestureSeen || isAudioUnlocked();
}

const musicLogAt = new Map<string, number>();
function logMusic(message: string): void {
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  const last = musicLogAt.get(message) ?? -Infinity;
  if (now - last < 2000) return;
  if (musicLogAt.size > 64) musicLogAt.clear();
  musicLogAt.set(message, now);
  console.warn('[music]', message);
  try { window.dispatchEvent(new CustomEvent('neonsentinel:music-diag', { detail: { message } })); } catch { /* diagnostics only */ }
}

function directTargetVolume(trim = 1): number {
  if (isMuted()) return 0;
  return clamp(getMasterVolume() * getMusicVolume() * getMusicDuckFactor() * trim, 0, 1);
}

function setDirectVolume(entry: Loaded, volume: number): void {
  if (entry.volumeRaf !== null) {
    cancelAnimationFrame(entry.volumeRaf);
    entry.volumeRaf = null;
  }
  const clamped = clamp(volume, 0, 1);
  try { entry.el.volume = clamped; } catch { /* ignore */ }
  if (mobileMusicRuntimeActive()) {
    try { entry.el.muted = clamped <= 0.001; } catch { /* ignore */ }
  }
}

function rampDirectVolume(entry: Loaded, target: number, ms: number): void {
  if (entry.volumeRaf !== null) {
    cancelAnimationFrame(entry.volumeRaf);
    entry.volumeRaf = null;
  }
  if (mobileMusicRuntimeActive()) {
    setDirectVolume(entry, target);
    return;
  }
  const start = entry.el.volume;
  const clampedTarget = clamp(target, 0, 1);
  if (ms <= 0 || Math.abs(start - clampedTarget) < 0.001) {
    setDirectVolume(entry, clampedTarget);
    return;
  }
  const startMs = performance.now();
  const tick = (now: number): void => {
    const t = Math.min(1, (now - startMs) / ms);
    try { entry.el.volume = start + (clampedTarget - start) * t; } catch { /* ignore */ }
    if (t < 1) entry.volumeRaf = requestAnimationFrame(tick);
    else entry.volumeRaf = null;
  };
  entry.volumeRaf = requestAnimationFrame(tick);
}

function trackUrlFor(track: Track): string {
  if (mobileMusicRuntimeActive()) return track.src.replace(/\.opus$/, '.m4a');
  return track.src;
}

function mobileTitleTrackUsable(id: string): boolean {
  const track = TRACKS[id];
  if (!track) return false;
  return !mobileMusicRuntimeActive() || !trackUrlFor(track).endsWith('.opus');
}

function playableTitlePool(): readonly string[] {
  if (!mobileMusicRuntimeActive()) return TITLE_POOL;
  const filtered = TITLE_POOL.filter(mobileTitleTrackUsable);
  return filtered.length > 0 ? filtered : TITLE_POOL;
}

const POOL_SIZE = 3;
interface PoolSlot {
  entry: Loaded;
  boundId: string | null;
  lastBoundMs: number;
}
let pool: PoolSlot[] | null = null;
let poolUnlocked = false;

function musicPoolActive(): boolean {
  if (urlFlag('webaudioMusic') === '1') return false;
  if (urlFlag('musicPool') === '0') return false;
  return mobileMusicRuntimeActive() || urlFlag('directMusic') === '1';
}

function poolNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

function buildPoolElement(): PoolSlot {
  const el = new Audio();
  el.volume = 0;
  const entry: Loaded = { el, src: null, gain: null, failed: false, direct: true, volumeRaf: null };
  const slot: PoolSlot = { entry, boundId: null, lastBoundMs: 0 };

  el.addEventListener('error', () => {
    const id = slot.boundId;
    if (!id) return;
    const code = el.error?.code;
    const msg = el.error?.message;
    entry.failed = true;
    registerTrackLoadFailure(id);
    logMusic(`pool load failed: ${id} code${code ?? '?'} ${msg ?? ''}`.trim());
    try {
      window.dispatchEvent(new CustomEvent('neonsentinel:music-load-failed', {
        detail: { id, src: TRACKS[id]?.src, code, msg },
      }));
    } catch { /* diagnostics only */ }
  });

  el.addEventListener('canplay', () => {
    if (slot.boundId) trackFailures.delete(slot.boundId);
  });

  el.addEventListener('loadedmetadata', () => {
    const track = slot.boundId ? TRACKS[slot.boundId] : undefined;
    if (!track || !track.startAt || track.startAt <= 0) return;
    if (el.currentTime < track.startAt) {
      try { el.currentTime = track.startAt; } catch { /* ignore */ }
    }
  });

  el.addEventListener('timeupdate', () => {
    const track = slot.boundId ? TRACKS[slot.boundId] : undefined;
    if (!track || !isTrackLooping(track) || !track.startAt || track.startAt <= 0) return;
    if (el.duration > 0 && el.currentTime >= el.duration - 0.1) {
      try { el.currentTime = track.startAt ?? 0; } catch { /* ignore */ }
    }
  });

  el.addEventListener('ended', () => {
    const id = slot.boundId;
    const track = id ? TRACKS[id] : undefined;
    if (id && track && track.category !== 'system') advanceAlbumTrack(id);
  });

  return slot;
}

function ensurePool(): PoolSlot[] {
  if (!pool) {
    pool = [];
    for (let i = 0; i < POOL_SIZE; i += 1) pool.push(buildPoolElement());
  }
  return pool;
}

function slotStillBoundTo(entry: Loaded, id: string): boolean {
  return !!pool && pool.some(slot => slot.entry === entry && slot.boundId === id);
}

function acquireSlot(id: string): Loaded {
  const slots = ensurePool();
  const existing = slots.find(slot => slot.boundId === id);
  if (existing) {
    existing.lastBoundMs = poolNow();
    existing.entry.failed = false;
    loaded.set(id, existing.entry);
    return existing.entry;
  }

  const free = slots.filter(slot => (slot.boundId === null || !loaded.has(slot.boundId)) && slot.entry.el.paused);
  const candidates = free.length > 0 ? free : slots.filter(slot => slot.boundId !== currentId);
  const slot = (candidates.length > 0 ? candidates : slots).reduce((a, b) => (a.lastBoundMs <= b.lastBoundMs ? a : b));
  if (slot.boundId && slot.boundId !== id) loaded.delete(slot.boundId);
  slot.boundId = id;
  slot.lastBoundMs = poolNow();
  slot.entry.failed = false;
  try { slot.entry.el.src = trackUrlFor(TRACKS[id]); } catch { /* ignore */ }
  loaded.set(id, slot.entry);
  return slot.entry;
}

function unlockPool(): void {
  if (poolUnlocked) return;
  const slots = ensurePool();
  const id = currentId ?? currentTitleTrack;
  const url = id && TRACKS[id] ? trackUrlFor(TRACKS[id]) : null;
  poolUnlocked = true;
  for (const slot of slots) {
    const el = slot.entry.el;
    try { el.muted = true; } catch { /* ignore */ }
    if (url && !el.currentSrc) {
      try { el.src = url; } catch { /* ignore */ }
    }
    let promise: Promise<void> | undefined;
    try { promise = el.play(); } catch { /* ignore */ }
    const settle = (): void => {
      // Only the current track may keep sounding after the warm-up: iOS
      // ignores el.volume, so any other slot left unmuted and playing is a
      // second audible track.
      const isCurrent = slot.boundId !== null && slot.boundId === (currentId ?? currentTitleTrack);
      try { el.muted = !isCurrent; } catch { /* ignore */ }
      if (!isCurrent) {
        try { el.pause(); } catch { /* ignore */ }
      }
    };
    if (promise && typeof promise.then === 'function') {
      promise.then(settle, () => {
        poolUnlocked = false;
        settle();
      });
    }
    else settle();
  }
}

const prefetchedTracks = new Set<string>();
function prefetchTrack(id: string | undefined): void {
  if (!id || prefetchedTracks.has(id)) return;
  const track = TRACKS[id];
  if (!track || (mobileMusicRuntimeActive() && trackUrlFor(track).endsWith('.opus'))) return;
  prefetchedTracks.add(id);
  try {
    void fetch(trackUrlFor(track), { mode: 'same-origin', credentials: 'omit' })
      .then(response => (response.ok ? response.blob() : null))
      .catch(() => { prefetchedTracks.delete(id); });
  } catch {
    prefetchedTracks.delete(id);
  }
}

function rampEntryTo(entry: Loaded, targetTrim: number, ms: number): void {
  if (entry.gain) {
    rampGainTo(entry.gain, targetTrim, ms);
  } else {
    rampDirectVolume(entry, directTargetVolume(targetTrim), ms);
  }
}

function entryOutputLevel(entry: Loaded): number {
  if (entry.el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return 0;
  if (entry.direct) return entry.el.volume;
  return entry.gain?.gain.value ?? 0;
}

function pauseAfterFade(id: string, entry: Loaded, ms: number): void {
  window.setTimeout(() => {
    if (musicPoolActive()) {
      if (!slotStillBoundTo(entry, id) || currentId === id) return;
      try { entry.el.pause(); } catch { /* ignore */ }
      setDirectVolume(entry, 0);
      const slot = pool?.find(candidate => candidate.entry === entry);
      if (slot) slot.boundId = null;
      loaded.delete(id);
      return;
    }
    if (currentId !== id) {
      try { entry.el.pause(); } catch { /* ignore */ }
      if (entry.direct) setDirectVolume(entry, 0);
    }
  }, mobileMusicRuntimeActive() && entry.direct ? 0 : ms + 60);
}

function refreshDirectVolumes(): void {
  if (!directMusicOutputActive()) return;
  for (const [id, entry] of loaded) {
    if (!entry.direct || entry.volumeRaf !== null) continue;
    const isCurrent = id === currentId;
    const trim = isCurrent ? (TRACKS[id] ? trackGainTrim(TRACKS[id]) : 1) : 0;
    try { entry.el.volume = directTargetVolume(trim); } catch { /* ignore */ }
    if (!isCurrent && !entry.el.paused) {
      try { entry.el.pause(); } catch { /* ignore */ }
    }
  }
  enforceSinglePoolVoice();
}

/**
 * iOS ignores el.volume, so a pool element that slips out of the `loaded` map
 * while still playing becomes a second audible track that nothing above can
 * reach. Sweep the slots themselves: anything that is not the current track
 * gets muted and paused, whatever race left it running.
 */
function enforceSinglePoolVoice(): void {
  if (!pool || !musicPoolActive()) return;
  for (const slot of pool) {
    const isCurrent = slot.boundId !== null && slot.boundId === currentId;
    if (isCurrent) continue;
    if (!slot.entry.el.paused && slot.entry.el.readyState > 0) {
      logMusic(`pool voice enforced: silenced ${slot.boundId ?? 'unbound slot'}`);
      try { slot.entry.el.pause(); } catch { /* ignore */ }
    }
    setDirectVolume(slot.entry, 0);
  }
}

export function musicSetTrackForState(state: MusicState): void {
  if (!isAudioUnlocked()) return;
  if (directMusicOutputActive()) refreshDirectVolumes();
  const previousPhase = lastPhase;
  if (state.phase === 'paused') {
    if (previousPhase !== 'paused') musicSetPaused(true);
    lastPhase = state.phase;
    applyMusicIntensity(0);
    return;
  }
  if (previousPhase === 'paused') musicSetPaused(false);
  if (previousPhase !== null && previousPhase !== state.phase && !(previousPhase === 'paused' && state.phase === 'playing')) manualPreviewId = null;
  if (previousPhase !== 'title' && state.phase === 'title') pickTitleTrack();
  if (state.phase === 'playing') syncAlbumOrderToState(state);
  if (previousPhase !== 'playing' && previousPhase !== 'paused' && state.phase === 'playing') startAlbumForWave(state.wave, state);
  if ((previousPhase === 'playing' || previousPhase === 'paused') && state.phase !== 'playing') currentAlbumId = null;
  lastPhase = state.phase;
  applyMusicIntensity(state.phase === 'playing' ? state.intensity ?? 0 : 0);

  verifyCurrentTrack();

  const manualId = manualPreviewId && TRACKS[manualPreviewId] ? manualPreviewId : null;
  const pressureBucket = state.phase === 'playing' && currentIntensity > 0.82 ? 'pressure' : 'normal';
  const key = state.phase === 'playing'
    ? `playing|${currentAlbumKey}|${manualId ?? currentAlbumId ?? 'album'}|${pressureBucket}`
    : `${state.phase}|${state.wave}|${manualId ?? currentTitleTrack}`;
  const id = manualId ?? trackForState(state);
  if (key === lastAppliedKey && currentMusicPlayable(id)) return;
  lastAppliedKey = key;
  crossfadeTo(id, transitionFadeMs(id));
}

export function preloadCriticalTracks(): void {
  if (!isAudioUnlocked()) return;
  if (musicPoolActive()) return;
  for (const id of CRITICAL_TRACKS) preloadTrack(id);
}

export function preloadTrack(id: string): void {
  const track = TRACKS[id];
  if (!track) return;
  if (musicPoolActive()) {
    prefetchTrack(id);
    return;
  }
  try {
    load(track);
  } catch {
    // Lazy music should never block the game.
  }
}

export function musicWarmUpAll(skipId?: string): void {
  if (!isAudioUnlocked()) return;
  if (musicPoolActive()) {
    unlockPool();
    return;
  }
  for (const id of CRITICAL_TRACKS) {
    if (id === skipId) continue;
    const track = TRACKS[id];
    if (!track) continue;
    try {
      const entry = load(track);
      entry.el.muted = true;
      const promise = entry.el.play();
      const cleanup = (): void => {
        if (currentId === id) {
          entry.el.muted = false;
          return;
        }
        try { entry.el.pause(); } catch { /* ignore */ }
        try { entry.el.currentTime = track.startAt ?? 0; } catch { /* ignore */ }
        entry.el.muted = false;
      };
      if (promise && typeof promise.then === 'function') promise.then(cleanup, cleanup);
      else cleanup();
    } catch {
      // Ignore individual browser unlock failures.
    }
  }
}

export function musicResetElements(): void {
  if (musicPoolActive() && pool) {
    for (const slot of pool) {
      const entry = slot.entry;
      try { entry.el.pause(); } catch { /* ignore */ }
      if (entry.volumeRaf !== null) {
        try { cancelAnimationFrame(entry.volumeRaf); } catch { /* ignore */ }
        entry.volumeRaf = null;
      }
      try { entry.el.muted = false; } catch { /* ignore */ }
      setDirectVolume(entry, 0);
      slot.boundId = null;
      entry.failed = false;
    }
    loaded.clear();
    currentId = null;
    lastAppliedKey = '';
    return;
  }
  for (const entry of loaded.values()) {
    try { entry.el.pause(); } catch { /* ignore */ }
    if (entry.volumeRaf !== null) {
      try { cancelAnimationFrame(entry.volumeRaf); } catch { /* ignore */ }
    }
    try { entry.src?.disconnect(); } catch { /* ignore */ }
    try { entry.gain?.disconnect(); } catch { /* ignore */ }
  }
  loaded.clear();
  currentId = null;
  lastAppliedKey = '';
}

export function musicForceRefresh(): void {
  lastAppliedKey = '';
}

export function musicPreviewPlay(id: string): void {
  if (!TRACKS[id] || !isAudioUnlocked()) return;
  if (TRACKS[id]?.category !== 'system') {
    const order = currentAlbumOrder.length > 0 ? currentAlbumOrder : WAVE_TRACKS;
    const index = order.indexOf(id);
    if (index >= 0) {
      currentAlbumIndex = index;
      currentAlbumId = id;
      setNextAlbumStartIndex((index + 1) % order.length);
      lastAppliedKey = '';
      preloadAlbumWindow();
    }
  }
  manualPreviewId = id;
  let ctx: AudioContext | null = null;
  if (!directMusicOutputActive()) {
    const dest = getMusicDestination();
    ctx = dest.context as AudioContext;
    if (ctx.state !== 'running' && ctx.state !== 'closed') {
      void ctx.resume().catch(() => undefined);
    }
  }
  crossfadeTo(id, PREVIEW_FADE_MS);
  const entry = loaded.get(id);
  if (entry) {
    const trim = TRACKS[id] ? trackGainTrim(TRACKS[id]) : 1;
    if (entry.gain && ctx) {
      entry.gain.gain.cancelScheduledValues(ctx.currentTime);
      entry.gain.gain.value = trim;
    } else if (entry.direct) {
      setDirectVolume(entry, directTargetVolume(trim));
    }
  }
}

export function musicStop(fadeMs = DEFAULT_FADE_MS): void {
  manualPreviewId = null;
  lastAppliedKey = '';
  crossfadeTo(null, fadeMs);
}

export function musicSetPaused(paused: boolean): void {
  if (paused) {
    for (const entry of loaded.values()) {
      try { entry.el.pause(); } catch { /* ignore */ }
      try { entry.el.muted = true; } catch { /* ignore */ }
      if (entry.direct) setDirectVolume(entry, 0);
    }
    return;
  }
  for (const entry of loaded.values()) {
    try { entry.el.muted = false; } catch { /* ignore */ }
  }
  if (currentId) {
    const entry = loaded.get(currentId);
    if (entry && !entry.failed) {
      void entry.el.play().catch(() => undefined);
    }
  }
  refreshDirectVolumes();
}

export function musicSetMuted(muted: boolean): void {
  for (const entry of loaded.values()) {
    try { entry.el.muted = muted; } catch { /* ignore */ }
  }
  refreshDirectVolumes();
}

export function currentTrackId(): string | null {
  return currentId;
}

export function listTracks(): readonly TrackInfo[] {
  return TRACK_LIST_ORDER.map(id => TRACKS[id]).filter(Boolean).map(({ id, label, hint, category, wave }) => ({ id, label, hint, category, wave }));
}

export function getMusicDebugSnapshot(): MusicDebugSnapshot {
  const entry = currentId ? loaded.get(currentId) : null;
  const playingIds: string[] = [];
  const audibleIds: string[] = [];
  for (const [id, candidate] of loaded) {
    if (!candidate.el.paused) playingIds.push(id);
    if (!candidate.el.paused && !candidate.el.muted && entryOutputLevel(candidate) > 0.02) audibleIds.push(id);
  }
  return {
    currentId,
    src: entry ? entry.el.currentSrc || null : null,
    direct: entry ? entry.direct : null,
    volume: entry ? entry.el.volume : null,
    muted: entry ? entry.el.muted : null,
    paused: entry ? entry.el.paused : null,
    readyState: entry ? entry.el.readyState : null,
    networkState: entry ? entry.el.networkState : null,
    errorCode: entry ? entry.el.error?.code ?? null : null,
    errorMsg: entry ? entry.el.error?.message ?? null : null,
    failedFlag: entry ? entry.failed : null,
    loadedCount: loaded.size,
    albumKey: currentAlbumKey,
    albumOrder: [...currentAlbumOrder],
    currentAlbumIndex,
    playingIds,
    audibleIds,
  };
}

function trackForState(state: MusicState): string | null {
  if (state.phase === 'title') return currentTitleTrack;
  if (state.phase === 'gameover') return 'the-survivor';
  if (state.phase === 'paused') return currentId;
  if (!currentAlbumId) startAlbumForWave(state.wave, state);
  return currentAlbumId ?? 'sentinel-resolve';
}

function startAlbumForWave(wave: number, state?: MusicState): void {
  if (state) syncAlbumOrderToState(state);
  const order = currentAlbumOrder.length > 0 ? currentAlbumOrder : WAVE_TRACKS;
  currentAlbumIndex = wave <= 1
    ? nextAlbumStartIndex
    : Math.max(0, Math.floor(wave - 1)) % order.length;
  currentAlbumId = order[currentAlbumIndex] ?? 'sentinel-resolve';
  setNextAlbumStartIndex((currentAlbumIndex + 1) % order.length);
  preloadAlbumWindow();
  lastAppliedKey = '';
}

function advanceAlbumTrack(fromId: string): void {
  if (lastPhase !== 'playing' || currentId !== fromId) return;
  const order = currentAlbumOrder.length > 0 ? currentAlbumOrder : WAVE_TRACKS;
  const fromIndex = order.indexOf(fromId);
  currentAlbumIndex = ((fromIndex >= 0 ? fromIndex : currentAlbumIndex) + 1) % order.length;
  currentAlbumId = order[currentAlbumIndex] ?? 'sentinel-resolve';
  setNextAlbumStartIndex((currentAlbumIndex + 1) % order.length);
  preloadAlbumWindow();
  lastAppliedKey = '';
  crossfadeTo(currentAlbumId, ALBUM_CROSSFADE_MS);
}

function preloadAlbumWindow(): void {
  if (!isAudioUnlocked()) return;
  const order = currentAlbumOrder.length > 0 ? currentAlbumOrder : WAVE_TRACKS;
  for (let offset = 0; offset <= ALBUM_PREFETCH_AHEAD; offset += 1) {
    const id = order[(currentAlbumIndex + offset) % order.length];
    if (!id) continue;
    const track = TRACKS[id];
    if (!track) continue;
    if (musicPoolActive()) {
      if (offset > 0) prefetchTrack(id);
    }
    else try { load(track); } catch { /* individual tracks are best-effort */ }
  }
}

function pickTitleTrack(): void {
  const pool = playableTitlePool();
  currentTitleTrack = pool[titleVisits % pool.length] ?? 'neon-title';
  titleVisits += 1;
}

function syncAlbumOrderToState(state: MusicState): void {
  const ship = musicShipClass(state.shipClass);
  const pressure = musicPressure(state.skill);
  const key = albumKey(ship, pressure);
  if (key === currentAlbumKey) return;
  nextAlbumStartIndexes.set(currentAlbumKey, nextAlbumStartIndex);
  currentAlbumKey = key;
  currentAlbumOrder = albumOrderFor(ship, pressure);
  nextAlbumStartIndex = nextAlbumStartIndexes.get(currentAlbumKey) ?? 0;
  if (currentAlbumId) {
    const index = currentAlbumOrder.indexOf(currentAlbumId);
    if (index >= 0) {
      currentAlbumIndex = index;
      setNextAlbumStartIndex((index + 1) % currentAlbumOrder.length);
    } else {
      currentAlbumId = null;
    }
  }
  lastAppliedKey = '';
}

function albumOrderFor(ship: MusicShipClass, pressure: MusicPressure): readonly string[] {
  if (ship === DEFAULT_ALBUM_SHIP && pressure === DEFAULT_ALBUM_PRESSURE) return WAVE_TRACKS;
  return validAlbumOrder(LOADOUT_ALBUM_ORDERS[albumKey(ship, pressure)]);
}

function validAlbumOrder(order: readonly string[] | undefined): readonly string[] {
  if (!order || order.length !== WAVE_TRACKS.length) return WAVE_TRACKS;
  const unique = new Set(order);
  if (unique.size !== WAVE_TRACKS.length) return WAVE_TRACKS;
  for (const id of WAVE_TRACKS) {
    if (!unique.has(id) || !TRACKS[id]) return WAVE_TRACKS;
  }
  return order;
}

function musicShipClass(value: MusicState['shipClass']): MusicShipClass {
  return value === 'interceptor' || value === 'heavy' || value === 'guardian' ? value : DEFAULT_ALBUM_SHIP;
}

function musicPressure(value: MusicState['skill']): MusicPressure {
  return value === 'cadet' || value === '600b' || value === 'normal' ? value : DEFAULT_ALBUM_PRESSURE;
}

function albumKey(ship: MusicShipClass, pressure: MusicPressure): MusicAlbumKey {
  return `${ship}/${pressure}`;
}

function setNextAlbumStartIndex(index: number): void {
  nextAlbumStartIndex = index;
  nextAlbumStartIndexes.set(currentAlbumKey, index);
}

function transitionFadeMs(nextId: string | null): number {
  if (!nextId || !currentId) return DEFAULT_FADE_MS;
  if (nextId === 'the-survivor') return 700;
  const next = TRACKS[nextId];
  const current = TRACKS[currentId];
  if (next && current && next.category !== 'system' && current.category !== 'system') return ALBUM_CROSSFADE_MS;
  return DEFAULT_FADE_MS;
}

function crossfadeTo(id: string | null, fadeMs = DEFAULT_FADE_MS): void {
  if (id === currentId && currentMusicPlayable(id)) return;
  if (currentId) {
    const previousId = currentId;
    const previous = loaded.get(previousId);
    if (previous) {
      rampEntryTo(previous, 0, fadeMs);
      pauseAfterFade(previousId, previous, fadeMs);
    }
  }
  currentId = id;
  if (!id) return;

  const track = TRACKS[id];
  if (!track) {
    currentId = null;
    return;
  }
  const entry = load(track);
  if (entry.failed) {
    currentId = null;
    lastAppliedKey = '';
    return;
  }
  if (track.category !== 'system') preloadAlbumWindow();
  if (!entry.direct) {
    const ctx = getMusicDestination().context as AudioContext;
    if (ctx.state !== 'running' && ctx.state !== 'closed') {
      try { void ctx.resume().catch(() => undefined); } catch { /* ignore */ }
    }
  } else {
    setDirectVolume(entry, 0);
    try { entry.el.preload = 'auto'; } catch { /* ignore */ }
    if (entry.el.readyState === 0) {
      try { entry.el.load(); } catch { /* ignore */ }
    }
  }
  const trim = trackGainTrim(track);
  prepareTrackForPlayback(track, entry);
  const attemptPlay = (attempts: number): void => {
    if (currentId !== id) return;
    let retryScheduled = false;
    const retry = (): void => {
      if (retryScheduled || currentId !== id || entry.failed || attempts >= 4) return;
      retryScheduled = true;
      window.setTimeout(() => attemptPlay(attempts + 1), 250);
    };
    try {
      void entry.el.play().catch((error: unknown) => {
        logMusic(`play rejected: ${id}: ${(error as Error)?.name ?? String(error)}`);
        retry();
      });
    } catch (error) {
      logMusic(`play threw: ${id}: ${(error as Error)?.name ?? String(error)}`);
      retry();
    }
    window.setTimeout(() => {
      if (currentId !== id) return;
      if ((entry.el.paused || entry.el.readyState <= HTMLMediaElement.HAVE_METADATA) && !entry.failed && attempts < 4) retry();
      else if (entry.el.paused && !entry.failed) logMusic(`stuck paused: ${id} readyState=${entry.el.readyState} direct=${entry.direct}`);
    }, 250);
  };
  rampEntryTo(entry, trim, fadeMs);
  if (mediaPlaybackGestureReady()) attemptPlay(0);
}

function retryCurrentTrackFromGesture(): void {
  if (!isAudioUnlocked() || !currentId) return;
  const track = TRACKS[currentId];
  const entry = loaded.get(currentId);
  if (!track || !entry || entry.failed) return;
  if (musicPoolActive() && !poolUnlocked) unlockPool();
  prepareTrackForPlayback(track, entry);
  rampEntryTo(entry, trackGainTrim(track), 0);
  try {
    void entry.el.play().catch((error: unknown) => {
      logMusic(`gesture play rejected: ${currentId}: ${(error as Error)?.name ?? String(error)}`);
    });
  } catch (error) {
    logMusic(`gesture play threw: ${currentId}: ${(error as Error)?.name ?? String(error)}`);
  }
}

function prepareTrackForPlayback(track: Track, entry: Loaded): void {
  entry.el.muted = false;
  entry.el.loop = isTrackLooping(track);
  if (isTrackLooping(track)) {
    if (track.startAt && track.startAt > 0 && (entry.el.paused || entry.el.ended || entry.el.currentTime < track.startAt)) {
      try { entry.el.currentTime = track.startAt; } catch { /* ignore */ }
    }
    return;
  }
  const nearEnd = Number.isFinite(entry.el.duration) && entry.el.duration > 0 && entry.el.currentTime >= entry.el.duration - 0.25;
  if (!entry.el.paused && !entry.el.ended && !nearEnd) return;
  try { entry.el.currentTime = track.startAt ?? 0; } catch { /* ignore */ }
}

function applyMusicIntensity(value: number): void {
  const next = clamp(value, 0, 1);
  if (Math.abs(next - currentIntensity) < 0.025) return;
  currentIntensity = next;
  if (!currentId) return;
  const track = TRACKS[currentId];
  const entry = loaded.get(currentId);
  if (!track || !entry || entry.failed) return;
  try { entry.el.playbackRate = 1 + currentIntensity * 0.035; } catch { /* ignore */ }
  rampEntryTo(entry, trackGainTrim(track), 220);
}

function trackGainTrim(track: Track): number {
  const trim = track.trim ?? 1;
  if (track.category === 'system') return trim;
  return trim * (0.76 + currentIntensity * (track.category === 'pressure' ? 0.34 : 0.26));
}

function load(track: Track): Loaded {
  const cached = loaded.get(track.id);
  if (cached && !cached.failed) return cached;
  if (cached?.failed) {
    // Hold the failed entry until the retry window opens; callers already
    // treat failed entries as unplayable and move on.
    if (poolNow() < trackRetryAtMs(track.id)) return cached;
    try { cached.el.pause(); } catch { /* ignore */ }
    if (cached.volumeRaf !== null) {
      try { cancelAnimationFrame(cached.volumeRaf); } catch { /* ignore */ }
    }
    try { cached.src?.disconnect(); } catch { /* ignore */ }
    try { cached.gain?.disconnect(); } catch { /* ignore */ }
    loaded.delete(track.id);
  }
  if (musicPoolActive()) return acquireSlot(track.id);
  const el = new Audio();
  el.loop = isTrackLooping(track);
  el.preload = mediaPlaybackGestureReady() ? 'auto' : 'none';
  el.src = trackUrlFor(track);
  const direct = directMusicOutputActive();
  let src: MediaElementAudioSourceNode | null = null;
  let gain: GainNode | null = null;
  if (direct) {
    el.volume = 0;
  } else {
    const dest = getMusicDestination();
    const ctx = dest.context as AudioContext;
    src = ctx.createMediaElementSource(el);
    gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain);
    gain.connect(dest);
  }
  const entry: Loaded = { el, src, gain, failed: false, direct, volumeRaf: null };

  el.addEventListener('error', () => {
    entry.failed = true;
    registerTrackLoadFailure(track.id);
    const code = el.error?.code;
    const msg = el.error?.message;
    console.warn('[music] load failed', { id: track.id, src: track.src, code, msg });
    try {
      window.dispatchEvent(new CustomEvent('neonsentinel:music-load-failed', {
        detail: { id: track.id, src: track.src, code, msg },
      }));
    } catch {
      // Diagnostics are optional.
    }
  });

  el.addEventListener('canplay', () => {
    trackFailures.delete(track.id);
  });

  el.addEventListener('ended', () => {
    if (track.category !== 'system') advanceAlbumTrack(track.id);
  });

  if (track.startAt && track.startAt > 0) {
    const target = track.startAt;
    el.addEventListener('loadedmetadata', () => {
      if (el.currentTime < target) {
        try { el.currentTime = target; } catch { /* ignore */ }
      }
    });
    if (isTrackLooping(track)) {
      el.addEventListener('timeupdate', () => {
        if (el.duration > 0 && el.currentTime >= el.duration - 0.1) {
          try { el.currentTime = target; } catch { /* ignore */ }
        }
      });
    }
  }

  loaded.set(track.id, entry);
  return entry;
}

function verifyCurrentTrack(): void {
  const now = performance.now();
  if (now - lastVerifyMs < 1000 || !currentId) return;
  lastVerifyMs = now;
  const entry = loaded.get(currentId);
  if (!entry || entry.failed) {
    lastAppliedKey = '';
    if (lastPhase === 'playing') advanceAlbumTrack(currentId);
    else currentId = null;
    return;
  }
  const track = TRACKS[currentId];
  if (!entry.direct) {
    const ctx = getMusicDestination().context as AudioContext;
    if (ctx.state !== 'running' && ctx.state !== 'closed') {
      try { void ctx.resume().catch(() => undefined); } catch { /* ignore */ }
    }
  } else {
    refreshDirectVolumes();
  }
  if (entry.el.paused) {
    if (entry.el.ended && lastPhase === 'playing') {
      advanceAlbumTrack(currentId);
      return;
    }
    try { void entry.el.play().catch(() => undefined); } catch { /* ignore */ }
  } else if (entry.el.readyState <= 1) {
    try { entry.el.load(); } catch { /* ignore */ }
    try { void entry.el.play().catch(() => undefined); } catch { /* ignore */ }
  } else if (lastPhase === 'playing' && track && track.category !== 'system' && Number.isFinite(entry.el.duration) && entry.el.duration > 12) {
    const remaining = entry.el.duration - entry.el.currentTime;
    if (remaining > 0 && remaining < ALBUM_PREEND_FADE_SECONDS) advanceAlbumTrack(currentId);
  }
}

function currentMusicPlayable(expectedId: string | null): boolean {
  if (!expectedId || currentId !== expectedId) return false;
  const entry = loaded.get(expectedId);
  return Boolean(entry && !entry.failed);
}

function isTrackLooping(track: Track): boolean {
  return track.loop ?? track.category === 'system';
}

function rampGainTo(gain: GainNode, target: number, ms: number): void {
  const ctx = gain.context;
  const t = ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(Math.max(0, target), t + Math.max(0, ms) / 1000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
