export {};

import {
  getAudioContextState,
  getAudioDebugSnapshot,
  getMasterVolume,
  getMusicAnalyser,
  getMusicVolume,
  getSfxVolume,
  isAudioUnlocked,
  isMuted,
  playAudio,
  playVoiceClip,
  preloadVoiceClip,
  resumePlayback,
  setMasterVolume,
  setMusicVolume,
  setMuted,
  setSfxVolume,
  suspendPlayback,
  unlockAudio,
  updateAudio,
} from './audio.js';
import { applyPostFx } from './postfx.js';
import { cleanGuestName, createGuestSession, getGuestRecord, isGuestSession, renameGuest, restoreGuestSession } from './guest.js';
import { fetchFollowerPubkeys, fetchFollowPubkeys, fetchProfiles, getCachedProfile, profileDisplayName, profilePictureCandidates, type NostrProfile } from './profiles.js';
import {
  buildScoreEvent,
  finaliseLocalRun,
  GAME_ID,
  getLocalScores,
  publishSignedScore,
  submitScoreClaim,
  type ClaimResult,
  type RelaykeepRunSummary,
  type ScoreRunMetrics,
  type SignedNostrEvent,
} from './scoring.js';
import { consumeArcadeHandoff } from './arcade-handoff.js';
import { getTuning, getTuningReadout } from './tuning.js';
import type { MeshFrame } from './mesh-overlay.js';
import { drawEnemySprite, drawShipSprite } from './sprite-art.js';
import {
  CAKE_PICKUP_URLS,
  draw600bMedallion,
  drawCultBeacon,
  drawFourTwentyBeacon,
  drawNetBeacon,
  drawScooterBeacon,
  drawShieldBeacon,
  drawTimeLockBeacon,
  ROSE_PICKUP_URL,
  WHOLE_CAKE_PICKUP_URL,
} from './pickup-icons.js';
import { getReducedEffects, getTheme, getVisualTier, setVisualTier, setupVisualSettings } from './visual-settings.js';
import { getValueForValueConfig, getValueForValueQrCanvas } from './value-for-value.js';
import { fetchLeaderboard, getCachedLeaderboard, rankForScore, type LeaderboardEntry, type LeaderboardSnapshot } from './leaderboard.js';
import { isSixHundredMember, loadSixHundredRegistry, sixHundredHandle, sixHundredNip05 } from './sixhundred.js';
import {
  currentTrackId,
  getMusicDebugSnapshot,
  listTracks,
  musicForceRefresh,
  musicPreviewPlay,
  musicResetElements,
  musicSetMuted,
  musicSetPaused,
  musicSetTrackForState,
  musicStop,
  musicWarmUpAll,
  preloadCriticalTracks,
} from './music.js';

interface SignetSession {
  pubkey: string;
  method?: string;
  displayName?: string;
  signer: {
    signEvent(event: Record<string, unknown>): Promise<SignedNostrEvent>;
    close?(): Promise<void>;
  };
}

interface SignetApi {
  restoreSession?(opts?: Record<string, unknown>): Promise<SignetSession | null>;
  login?(opts: Record<string, unknown>): Promise<SignetSession | null>;
  logout?(session?: SignetSession): Promise<void>;
}

declare global {
  interface Window {
    Signet?: SignetApi;
    neonSentinelClaimLastScore?: () => Promise<ScoreSubmitResult | null>;
    neonSentinelFeelReport?: FeelReport;
    neonSentinelScoreStatus?: string;
    neonSentinelVisualAssets?: VisualAssetReadiness;
    neonSentinelDebugFrame?: () => ReturnType<typeof makeDebugFrame>;
    neonSentinelFxLabFire?: (key: FxLabKey) => void;
    neonSentinelTrace?: PlaytestTrace;
    neonSentinelTraceSummary?: ReturnType<typeof playtestTraceSummary>;
    relaykeepClaimLastScore?: () => Promise<ScoreSubmitResult | null>;
    relaykeepFeelReport?: FeelReport;
    relaykeepSignLastScore?: () => Promise<ScoreSubmitResult | null>;
    relaykeepScoreStatus?: string;
    relaykeepTrace?: PlaytestTrace;
    relaykeepTraceSummary?: ReturnType<typeof playtestTraceSummary>;
  }
}

type Phase = 'title' | 'playing' | 'paused' | 'gameover';
type Relation = 'follow' | 'mutual' | 'high-wot';
type SignalStatus = 'ground' | 'carried' | 'falling' | 'returning' | 'lost' | 'saved';
type ContactThreatLabel = 'SAFE' | 'TARGET' | 'LOCK' | 'LIFT' | 'FALL' | 'RETURN' | 'LOST' | 'SAVED';
type EnemyType = 'abductor' | 'forgery' | 'jammer' | 'hunter' | 'carrier' | 'spammer' | 'sybil' | 'troll';
type ShipClass = 'interceptor' | 'guardian' | 'heavy';
type Skill = 'cadet' | 'normal' | '600b';
type PlayerMode = 'guest' | 'nostr';
type KillSource = 'shot' | 'burst' | 'collision';
type EnemyShotKind = 'dart' | 'jam' | 'barrage' | 'spam';
type RescueMode = 'catch' | 'snatch';
type BeaconKind = 'rose' | 'cake-piece' | 'whole-cake' | '600b' | 'life' | 'shield' | 'relay' | 'charge' | 'zap' | 'net' | 'cult' | 'fourtwenty' | 'scooter' | 'multi' | 'timelock';
type TitleValueField = 'value-lightning' | 'value-onchain' | 'value-silent' | 'value-geyser' | 'value-kofi';
type ValueLinkId = 'lightning' | 'onchain' | 'silent' | 'geyser' | 'kofi';
// The three methods that carry their own QR + copyable address (as opposed
// to Geyser/Ko-fi, which just open a browser tab).
type SupportQrMethod = 'lightning' | 'onchain' | 'silent';
type TitlePaymentAction = 'copy' | 'close';
type TitleMenuField = 'ship' | 'pressure' | 'guest' | 'login' | 'logout' | 'start' | 'daily' | TitleValueField;
type TitleMenuAction =
  | 'ship-card'
  | 'ship-prev'
  | 'ship-next'
  | 'pressure-card'
  | 'pressure-prev'
  | 'pressure-next'
  | 'guest'
  | 'login'
  | 'logout'
  | 'start'
  | 'daily'
  | TitleValueField;
type PauseMenuChoice = 'resume' | 'quit';
type ScoreSubmitResult = { kind: 'claim'; result: ClaimResult } | { kind: 'client-event'; event: SignedNostrEvent };
type MeshOverlayModule = typeof import('./mesh-overlay.js');
type VisualAssetKey = 'backdrop' | 'brand';

interface VisualAssetReadiness {
  backdrop: boolean;
  brand: boolean;
  ready: boolean;
}

interface PlaytestWaveDuration {
  wave: number;
  seconds: number;
  cleared: boolean;
}

interface FeelReport {
  grade: string;
  summary: string;
  lines: string[];
  flags: string[];
  metrics: {
    hitRate: number;
    averageRescueSeconds: number | null;
    lowCampRatio: number;
    waveAverageSeconds: number | null;
    deaths: number;
    contactsLost: number;
  };
}

interface Signal {
  id: number;
  name: string;
  pubkey: string;
  profile: NostrProfile | null;
  relation: Relation;
  rank: number;
  homeX: number;
  x: number;
  y: number;
  vy: number;
  status: SignalStatus;
  carriedBy: number | null;
  liftedAt: number;
  flash: number;
  px?: number;
  py?: number;
}

interface ContactThreat {
  label: ContactThreatLabel;
  enemy: Enemy | null;
  capture: number;
  approach: number;
  urgency: number;
  targeted: boolean;
  locking: boolean;
  colour: string;
}

interface RelayColumnState {
  active: boolean;
  highValue: boolean;
  intensity: number;
  colour: string;
  contactCount: number;
}

interface Enemy {
  id: number;
  type: EnemyType;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetId: number | null;
  carryId: number | null;
  captureCharge: number;
  shotCooldown: number;
  muzzle: number;
  phase: number;
  age: number;
  intent: number;
  rescueGrace: number;
  face: -1 | 1;
  turnCue: number;
  alive: boolean;
  forgedName?: string;
  forgedPicture?: string;
  forgedMember?: boolean;
  trollFeedCount?: number;
  px?: number;
  py?: number;
}

interface ShipSpec {
  id: ShipClass;
  label: string;
  accelX: number;
  reverseX: number;
  maxX: number;
  accelY: number;
  maxY: number;
  fireInterval: number;
  burstCap: number;
  laserDamage: number;
  carrierDamage: number;
}

interface SkillSpec {
  id: Skill;
  label: string;
  spawnScale: number;
  enemySpeed: number;
  /** Seconds on the clock at run start — time, not lives, is the fail timer. */
  startTime: number;
  bossEvery: number;
  liftLockScale: number;
  carrySpeedScale: number;
  rescueWindowScale: number;
}

interface Laser {
  x: number;
  y: number;
  dir: -1 | 1;
  ttl: number;
  length: number;
  heat: number;
  impact: boolean;
  impactX: number;
  impactY: number;
  px?: number;
  py?: number;
}

interface EnemyShot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
  age: number;
  kind: EnemyShotKind;
  nearMissed: boolean;
  armTime?: number;
  source?: string;
  px?: number;
  py?: number;
}

interface Beacon {
  x: number;
  y: number;
  ttl: number;
  age: number;
  value: number;
  kind: BeaconKind;
  spriteIndex: number;
  px?: number;
  py?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
  age: number;
  size: number;
  colour: string;
  kind: 'spark' | 'ring' | 'shockwave' | 'flash' | 'text' | 'core' | 'debris' | 'chunk' | 'beam' | 'starflare' | 'fireball';
  text?: string;
  rot?: number;
  spin?: number;
  length?: number;
  width?: number;
  px?: number;
  py?: number;
  /** Extra per-particle gravity (px/s^2); embers fall, motes float when negative. */
  grav?: number;
  /** Arcade sparkle: blink the particle on/off near a phase derived from rot. */
  twinkle?: boolean;
  /** Fireball hue ramp, hottest first; the draw snaps between entries as it ages. */
  ramp?: readonly string[];
  /** Score-text pop-in: start oversized and settle to normal within ~0.2s. */
  punch?: boolean;
}

interface Star {
  x: number;
  y: number;
  depth: number;
  phase: number;
}

interface VisibleCanvasRect {
  x: number;
  y: number;
  w: number;
  h: number;
  centerX: number;
  centerY: number;
  portrait: boolean;
  cropped: boolean;
  /** Device safe-area insets (notch / home indicator) in canvas units. */
  safeTop: number;
  safeBottom: number;
}

interface RadarArea {
  x: number;
  y: number;
  w: number;
  h: number;
  compact: boolean;
  viewW: number;
}

interface TitleMenuButton {
  action: TitleMenuAction;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shortcut?: string;
  ship?: ShipClass;
  skill?: Skill;
}

interface TitleMenuLayout {
  shipCard: TitleMenuButton;
  shipPrev: TitleMenuButton;
  shipNext: TitleMenuButton;
  pressureCard: TitleMenuButton;
  pressurePrev: TitleMenuButton;
  pressureNext: TitleMenuButton;
  guestButton: TitleMenuButton;
  loginButton: TitleMenuButton;
  logoutButton: TitleMenuButton | null;
  startButton: TitleMenuButton;
  dailyButton: TitleMenuButton;
  authDock: { x: number; y: number; w: number; h: number };
  identityChip: { x: number; y: number; w: number; h: number } | null;
  valueButtons: TitleMenuButton[];
  shipLabelY: number;
  pressureLabelY: number;
  valuePanel: { x: number; y: number; w: number; h: number };
  hintY: number;
}


interface PauseMenuButton {
  action: PauseMenuChoice;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ValueMethodButton {
  id: ValueLinkId;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TitlePaymentButton {
  action: TitlePaymentAction;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RosterEntry {
  name: string;
  relation: Relation;
  rank: number;
  pubkey: string;
}

type NostrRosterSource = 'follower' | 'followed';

interface NostrRosterCandidate {
  pubkey: string;
  source: NostrRosterSource;
  order: number;
}

interface GameState {
  phase: Phase;
  seed: number;
  runId: string;
  startedAt: number;
  finishedAt: number;
  scoreRecorded: boolean;
  playerMode: PlayerMode;
  playerName: string;
  playerPubkey: string | null;
  score: number;
  sats: number;
  wave: number;
  /** Seconds left on the run clock — reaching zero is TIME LOCKED (game over). */
  timeLeft: number;
  /** 0..1 HUD punch for the TIME readout; spikes on a gain/loss, decays fast. */
  timePop: number;
  /** Whether the current timePop was a gain (green) or a loss (red). */
  timePopGain: boolean;
  rescued: number;
  lost: number;
  combo: number;
  maxCombo: number;
  comboUntil: number;
  /** Highest combo the announcer has called this chain; re-arms on reset. */
  comboCalled: number;
  /** Next score threshold that banks an extend (extra ship). */
  nextExtendAt: number;
  /** Lives lost during the current wave — a perfect wave arms a burst cell. */
  waveLivesLost: number;
  /** Contacts forged during the current wave. */
  waveContactsLost: number;
  /** Shared-seed daily challenge run. */
  daily: boolean;
  /** Attract-mode demo run: bot input, nothing published or recorded. */
  demo: boolean;
  burstCharges: number;
  shipClass: ShipClass;
  skill: Skill;
  ship: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    dir: -1 | 1;
    cooldown: number;
    invuln: number;
    shieldHits: number;
    heat: number;
    turnCue: number;
    px?: number;
    py?: number;
  };
  signals: Signal[];
  enemies: Enemy[];
  lasers: Laser[];
  enemyShots: EnemyShot[];
  beacons: Beacon[];
  particles: Particle[];
  spawnLeft: number;
  nextSpawn: number;
  waveClear: number;
  waveTimer: number;
  waveGrace: number;
  scoreSurge: number;
  /** 0..1 HUD score-punch: spikes when a big chunk of points lands, decays fast. */
  scorePop: number;
  /** Seconds of 4:20 chill left: enemies and their shots run at half speed. */
  chill: number;
  /** Seconds of TIME LOCKED freeze left: the ship is held in place and can't
   * fire; aliens keep abducting but can't shoot or crash into the ship. */
  timeLock: number;
  /** Seconds of fanout left: the laser fires three parallel beams. */
  fanout: number;
  /** Karen's don't-feed-the-donkey scold has played this run. */
  trollScolded: boolean;
  /** "Donkey's gone rogue!" spawn alert has played this run. */
  trollSpotted: boolean;
  /** Elapsed-time stamp of the last troll spawn — gates a minimum gap so a
   * second troll can't land right on top of (or moments after) the first. */
  lastTrollSpawnAt: number;
  rescueNet: number;
  lowCamp: number;
  lowAltitudeWarning: number;
  groundFlakCooldown: number;
  nextBaiter: number;
  threatPulse: number;
  damageCue: number;
  jamCue: number;
  shake: number;
  hitstop: number;
  flash: number;
  shipDestroyed: boolean;
  message: string;
  messageUntil: number;
  trace: PlaytestTrace;
}

interface PlaytestTrace {
  elapsed: number;
  currentWaveStartedAt: number;
  waveDurations: PlaytestWaveDuration[];
  shotsFired: number;
  shotsHit: number;
  shotsGrazed: number;
  burstUses: number;
  livesLost: number;
  damageEvents: number;
  contactsLifted: number;
  contactsSaved: number;
  contactsForged: number;
  contactsDropped: number;
  beaconsSpawned: number;
  beaconsCollected: number;
  nearGroundSeconds: number;
  lowCampSeconds: number;
  heatPeak: number;
  laserLengthMin: number;
  turnEvents: number;
  rescueResponseCount: number;
  rescueResponseTotal: number;
  rescueResponseFastest: number;
  rescueResponseSlowest: number;
  kills: Record<EnemyType, number>;
  damageBy: Record<string, number>;
}

const canvasEl = document.getElementById('game');
if (!(canvasEl instanceof HTMLCanvasElement)) throw new Error('Missing #game canvas');
const canvas = canvasEl;
const maybeCtx = canvas.getContext('2d', { alpha: false });
if (!maybeCtx) throw new Error('2D canvas unavailable');
const ctx = maybeCtx;
const scoreActions = document.getElementById('score-actions');
const scorePublishButton = document.getElementById('score-publish');
const scoreActionStatus = document.getElementById('score-action-status');
const valueSupportLink = document.getElementById('value-support');
const geyserSupportLink = document.getElementById('geyser-support');
const kofiSupportLink = document.getElementById('kofi-support');

const BACKDROP_URL = '/backgrounds/generated/neon-sentinel-nasa-frontier.webp';
const BRAND_KEY_ART_URL = '/brand/neon-sentinel-key-art-v2.webp';
// Support thank-you stickers: 600.wtf members get the rose fren, everyone
// else gets the crypto donkey giving a THANKZ! thumbs up.
const VALUE_THANK_YOU_URL = '/memes/600b-thank-you-small.png';
const VALUE_THANK_YOU_DONKEY_URL = '/memes/donkey-thankz-small.png';
const visualAssets: VisualAssetReadiness = { backdrop: false, brand: false, ready: false };
window.neonSentinelVisualAssets = visualAssets;

const backdrop = prepareVisualAsset(new Image(), BACKDROP_URL, 'backdrop');
const brandKeyArt = prepareVisualAsset(new Image(), BRAND_KEY_ART_URL, 'brand');
const valueThankYouImage = loadPickupSprite(VALUE_THANK_YOU_URL);
const valueThankYouDonkeyImage = loadPickupSprite(VALUE_THANK_YOU_DONKEY_URL);

const ROSE_PICKUP = loadPickupSprite(ROSE_PICKUP_URL);
const CAKE_PICKUPS = CAKE_PICKUP_URLS.map(loadPickupSprite);
const WHOLE_CAKE_PICKUP = loadPickupSprite(WHOLE_CAKE_PICKUP_URL);

function prepareVisualAsset(image: HTMLImageElement, src: string, key: VisualAssetKey): HTMLImageElement {
  image.decoding = 'async';
  image.loading = 'eager';
  image.setAttribute('fetchpriority', 'high');
  const markReady = () => {
    visualAssets[key] = true;
    visualAssets.ready = visualAssets.backdrop;
  };
  image.onload = () => {
    if (typeof image.decode === 'function') {
      image.decode().catch(() => undefined).finally(markReady);
      return;
    }
    markReady();
  };
  image.onerror = () => {
    visualAssets[key] = false;
    visualAssets.ready = visualAssets.backdrop;
  };
  image.src = src;
  if (image.complete && image.naturalWidth > 0) markReady();
  return image;
}

function loadPickupSprite(src: string): HTMLImageElement {
  const image = new Image();
  image.decoding = 'async';
  image.loading = 'eager';
  image.src = src;
  return image;
}

const VIEW_W = 1280;
const VIEW_H = 720;
const WORLD_W = 6144;
const RADAR_Y = 50;
const RADAR_H = 92;
const PLAY_TOP = RADAR_Y + RADAR_H + 18;
const GROUND_BASE = 646;
const STEP = 1 / 60;
const MAX_DT = 0.05;
const MAX_RENDER_DPR = 1;
// Support modal panel heights (shared by draw, centring, and hit-testing).
const VALUE_PANEL_H_PORTRAIT = 372;
const VALUE_PANEL_H_DESKTOP = 336;
const MAX_PARTICLES = 760;
const PARTICLE_PRESSURE_LOAD = 0.68;
const PARTICLE_CRITICAL_LOAD = 0.86;

// One extend banks every EXTEND_STEP points: an extra ship, or a burst cell
// when the rack is already full. The near-miss maths drives one-more-go.
const EXTEND_STEP = 50_000;
const COAST_DRAG_X = 2.05;
const THRUST_DRAG_X = 0.54;
const DRAG_Y = 16.4;
const LASER_TTL = 0.064;
const LASER_LENGTH = 990;
const PLAYER_VISUAL_SCALE = 2.45;
const HI_DPI_SPRITE_ACTORS: boolean = true;
const CAPTURE_LOCK_TIME = 1.32;
const FIRST_WAVE_RAMP_SECONDS = 4.1;
const WAVE_OPENING_SECONDS = 3.8;
const BOSS_OPENING_SECONDS = 10;
const EARLY_WAVE_SPAWN_BASE = [0, 5.7, 6.6, 7.6, 8.6, 9.8, 10.8] as const;
const EARLY_WAVE_INITIAL_SPAWN = [0, 0.72, 1.05, 1.22, 1.34, 1.26, 1.18] as const;
const EARLY_WAVE_GRACE = [0, 1.65, 2.1, 2.3, 2.48, 2.3, 2.18] as const;
const EARLY_WAVE_BAITER = [0, 20.5, 18.5, 17.2, 16.2, 15.4, 14.8] as const;
const RELAY_COLUMN_SPACING = 512;
const RELAY_COLUMN_HALF = RELAY_COLUMN_SPACING / 2;
const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
const FONT_DISPLAY = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const BRAND_NAME = 'NEON SENTINEL';
const SIGNET_APP_NAME = 'Neon Sentinel';
const TAGLINE = 'HOLD THE RELAY. SAVE THE KEYS.';
const VALUE_FOR_VALUE = getValueForValueConfig();

const keys = new Set<string>();
const pressedOnce = new Set<string>();
const stars: Star[] = [];
const touch = { x: 0, y: 0, fire: false };
const TOUCH_STICK_DEADZONE = 0.075;
const TOUCH_STICK_RESPONSE = 1.06;
// Gamepad: left stick / dpad move, A or R2 holds fire, B/X/bumpers pop a
// burst, Start pauses in play and acts as the start key on menus. Polled
// per-frame — the Gamepad API has no events for buttons.
const gamepadInput = { x: 0, y: 0, fire: false, connected: false };
const gamepadHeld = new Set<number>();
const GAMEPAD_DEADZONE = 0.18;

function gamepadButtonPressed(pad: Gamepad, index: number): boolean {
  const button = pad.buttons[index];
  return Boolean(button && (button.pressed || button.value > 0.55));
}

function pollGamepads(): void {
  const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
  let pad: Gamepad | null = null;
  for (const candidate of pads) {
    if (candidate?.connected) {
      pad = candidate;
      break;
    }
  }
  gamepadInput.connected = pad !== null;
  if (!pad) {
    gamepadInput.x = 0;
    gamepadInput.y = 0;
    gamepadInput.fire = false;
    gamepadHeld.clear();
    return;
  }
  const shape = (value: number): number => {
    const magnitude = Math.abs(value);
    if (magnitude <= GAMEPAD_DEADZONE) return 0;
    return Math.sign(value) * (magnitude - GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE);
  };
  const dpadX = (gamepadButtonPressed(pad, 15) ? 1 : 0) - (gamepadButtonPressed(pad, 14) ? 1 : 0);
  const dpadY = (gamepadButtonPressed(pad, 13) ? 1 : 0) - (gamepadButtonPressed(pad, 12) ? 1 : 0);
  gamepadInput.x = clamp(shape(pad.axes[0] ?? 0) + dpadX, -1, 1);
  gamepadInput.y = clamp(shape(pad.axes[1] ?? 0) + dpadY, -1, 1);
  gamepadInput.fire = gamepadButtonPressed(pad, 0) || gamepadButtonPressed(pad, 7);
  if (Math.abs(gamepadInput.x) > 0.3 || Math.abs(gamepadInput.y) > 0.3 || gamepadInput.fire) {
    markPlayerActivity();
  }
  const edge = (index: number, action: () => void): void => {
    const down = gamepadButtonPressed(pad, index);
    const held = gamepadHeld.has(index);
    if (down && !held) {
      gamepadHeld.add(index);
      markPlayerActivity();
      if (attractMode) {
        exitAttractRun();
        return;
      }
      action();
    } else if (!down && held) {
      gamepadHeld.delete(index);
    }
  };
  // Start: pause/resume in play, start key everywhere else.
  edge(9, () => {
    if (state.phase === 'playing' && !state.shipDestroyed) pauseRun();
    else if (state.phase === 'paused') resumeRun();
    else pressedOnce.add('Enter');
  });
  // B / X / bumpers: burst in play, confirm on menus.
  for (const burstButton of [1, 2, 4, 5]) {
    edge(burstButton, () => {
      if (state.phase === 'playing') pressedOnce.add('KeyX');
      else pressedOnce.add('Enter');
    });
  }
  // A doubles as menu confirm when not flying.
  edge(0, () => {
    if (state.phase !== 'playing') pressedOnce.add('Enter');
  });
}
let musicGesturePrimed = false;
let refreshAudioPanel: (() => void) | null = null;
let refreshMusicPanel: (() => void) | null = null;
let lastRunSummary: RelaykeepRunSummary | null = null;
// Previous frame's score, for the HUD score-punch delta. Re-synced at run start
// so a ?score seed doesn't fire a giant pop on the first frame.
let hudScoreRef = 0;
// True when the just-finished run beat the stored local best — drives the
// game-over NEW PERSONAL BEST banner and its one-time fanfare.
let lastRunNewBest = false;
let lastFeelReport: FeelReport | null = null;
let scoreStatus = 'LOCAL SCORE · NO PAYOUT';

const SHIPS: readonly ShipSpec[] = [
  { id: 'interceptor', label: 'INTERCEPTOR', accelX: 10000, reverseX: 26200, maxX: 1025, accelY: 6900, maxY: 430, fireInterval: 0.052, burstCap: 2, laserDamage: 1, carrierDamage: 1.34 },
  { id: 'guardian', label: 'GUARDIAN', accelX: 9200, reverseX: 24000, maxX: 945, accelY: 6500, maxY: 406, fireInterval: 0.058, burstCap: 3, laserDamage: 1.22, carrierDamage: 1.44 },
  { id: 'heavy', label: 'HEAVY', accelX: 8200, reverseX: 21800, maxX: 860, accelY: 5800, maxY: 370, fireInterval: 0.071, burstCap: 4, laserDamage: 2, carrierDamage: 1.56 },
];

const SKILLS: readonly SkillSpec[] = [
  { id: 'cadet', label: 'CADET', spawnScale: 0.54, enemySpeed: 0.68, startTime: 110, bossEvery: 7, liftLockScale: 0.9, carrySpeedScale: 0.76, rescueWindowScale: 1.28 },
  { id: 'normal', label: 'NORMAL', spawnScale: 0.7, enemySpeed: 0.8, startTime: 90, bossEvery: 6, liftLockScale: 0.78, carrySpeedScale: 0.92, rescueWindowScale: 1.08 },
  { id: '600b', label: '600B', spawnScale: 1.3, enemySpeed: 1.05, startTime: 75, bossEvery: 4, liftLockScale: 0.6, carrySpeedScale: 1.15, rescueWindowScale: 0.92 },
];

// The run ends when the clock hits zero, not when lives run out. Time is the
// resource: it drains in real time, a hit costs seconds, and playing well
// (rescues, wave holds, carriers, extends, TIME pickups) buys it back.
const MAX_TIME = 120;
const TIME_PICKUP_SECONDS = 14;
/** How long the TIME LOCKED trap pickup freezes the ship, in seconds. */
const TIME_LOCK_FREEZE = 2.1;
const HIT_TIME_BASE = 6;

let selectedShip: ShipClass = 'heavy';
let selectedSkill: Skill = '600b';
let titleMenuField: TitleMenuField = 'start';
let pauseMenuChoice: PauseMenuChoice = 'resume';

const roster = [
  { name: 'TheCryptoDonkey', relation: 'high-wot', rank: 98, pubkey: 'da19f1cd34beca44be74da4b306d9d1dd86b6343cef94ce22c49c6f59816e5bd' },
  { name: 'dni', relation: 'high-wot', rank: 94, pubkey: '1c94c0b44577edf41509d473a92d9f7b6bc04e3ae07f705e709c2999b1d3e074' },
  { name: 'nind', relation: 'mutual', rank: 88, pubkey: 'cb33c1d6d3381b3117059cc292b5a8cc868a01ddf84f0c630318042a7b58454a' },
  { name: 'michael1011', relation: 'mutual', rank: 86, pubkey: '3dcc157a0304ec26ea131a0f4e576e2da67ff5c66980949c55bd7f0bb1b5efa1' },
  { name: 'sat', relation: 'high-wot', rank: 90, pubkey: '67aa1421e1d47146e4a91212a12c63752da7279202e0d6393fdfd05b2db4226f' },
  { name: 'flx', relation: 'mutual', rank: 80, pubkey: '872b60fdd8ec73ce1323d9798057384fb9836500d9b7201594c71ae3fce2b680' },
  { name: 'shillie', relation: 'mutual', rank: 82, pubkey: '547d0c9e272e5b379a386812722b56661e46688e7f738191f77473aad969a354' },
  { name: 'arbadacarba', relation: 'mutual', rank: 78, pubkey: '9a83779e75080556c656d4d418d02a4d7edbe288a2f9e6dd2b48799ec935184c' },
  { name: 'benarc', relation: 'high-wot', rank: 89, pubkey: 'e9e4276490374a0daf7759fd5f475deff6ffb9b0fc5fa98c902b5f4b2fe3bba2' },
  { name: 'tobo', relation: 'mutual', rank: 76, pubkey: '1cf75683d02b4ec0aa4d2127ff45d335fe2ef5a884b5794775d608bace006a16' },
  { name: 'BlackCoffee', relation: 'mutual', rank: 77, pubkey: '683211bd155c7b764e4b99ba263a151d81209be7a566a2bb1971dc1bbd3b715e' },
  { name: 'derPeter21', relation: 'follow', rank: 67, pubkey: '4de885d84269127f1473baff1e0627ff614684bcefd8d370e4fafc8407f7d6e2' },
  { name: 'janine', relation: 'follow', rank: 66, pubkey: '72cc166031dc1d8649f6b5db462b61ca32b0ee7a195a14d2ab0e1841a3c986d7' },
  { name: 'r0cks1', relation: 'follow', rank: 64, pubkey: '9ee709a6724dbc3062ed12f89cbc5320e8056c43d8034cb3be200ef9a1a62658' },
  { name: 'lightrider', relation: 'follow', rank: 63, pubkey: '02947b1c59e66d5637faa15aa8adec4f86cb121f7265166a180244bcdd7abc22' },
  { name: 'prophet', relation: 'follow', rank: 61, pubkey: 'd3df7b474995b774bfd3e89b2553fb6fbc5e42e63f8218aa4ab9886aa391b1d7' },
] satisfies readonly RosterEntry[];

const CONTACT_COUNT = roster.length;

// Guest runs defend the well-known roster: real 600.wtf members whose kind-0
// avatars personalise the frontier even before anyone signs in with Nostr.
let activeContactRoster: readonly RosterEntry[] = roster;
const QUERY = new URLSearchParams(location.search);
// 600000000000 is the default loadout: 600B pressure in the HEAVY ship.
// Keep ?mode=600000000000 as an explicit/backward-compatible entrypoint.
if (QUERY.get('mode') === '600000000000') {
  selectedSkill = '600b';
  selectedShip = 'heavy';
}

// --- Daily gauntlet -------------------------------------------------------
//
// One shared seeded run per UTC day: everyone flies the same ship, pressure,
// and spawn schedule. All gameplay randomness flows through rand(); daily
// runs swap the source for a seeded generator, reseeded at each wave start so
// framerate drift cannot compound across a whole run.
let randSource: () => number = Math.random;
// Armed on the title screen; the next run launches as the daily gauntlet.
let dailyArmed = QUERY.has('daily');

function rand(): number {
  return randSource();
}

function dailyStamp(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function dailySeed(stamp = dailyStamp()): number {
  // Small string hash (FNV-ish) over the date stamp — stable across engines.
  let hash = 0x811c9dc5;
  for (let i = 0; i < stamp.length; i += 1) {
    hash ^= stamp.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function seedDailyWave(wave: number): void {
  randSource = mulberry32((dailySeed() ^ Math.imul(wave, 0x85ebca6b)) >>> 0);
}

// --- Attract mode ---------------------------------------------------------
//
// Leave the title idle and the cabinet starts playing itself: a bot flies a
// demo run with a flashing PRESS ANY KEY banner. Nothing is recorded or
// published; any input snaps back to the title.
const ATTRACT_DELAY_MS = QUERY.has('attract') ? 2600 : 26_000;
const ATTRACT_RUN_SECONDS = 52;
let attractMode = false;
let titleIdleAt = performance.now();
const attractBot = { x: 0, y: 0, fire: false };
// Sticky crawl direction: holds its last value while the target sits under
// the ship (dx near zero) instead of re-deriving Math.sign(dx) every tick,
// which flips sign on floating-point noise and jitters the ship in place.
// A distance-only deadzone isn't enough on its own: the ship's own crawl
// motion swings dx back past any fixed margin within a couple of frames
// (it's moving TOWARD the threshold it just crossed), so it kept
// re-flipping every tick and never made progress — a self-resonant
// oscillation, worst with an enemy directly overhead/below. The time lock
// below breaks that regardless of amplitude: at most one flip per cooldown.
let attractCrawlDir: 1 | -1 = 1;
let attractCrawlLockedUntil = 0;
// Separate lock for the bot's final commanded direction (see its use below) —
// distinct from attractCrawlDir, which only decides which side to crawl
// toward while in-lane; this one guards ship.dir itself against jitter from
// ANY targeting branch, not just the crawl one.
let attractFacingDir: 1 | -1 = 1;
let attractFacingLockedUntil = 0;

function markPlayerActivity(): void {
  titleIdleAt = performance.now();
}

// The demo pilot: catch falling contacts first, otherwise close to laser
// range on the nearest threat and hold fire when roughly bore-aligned. Not a
// good player — a watchable one. Deaths are part of the show.
function updateAttractBot(): void {
  const ship = state.ship;
  const floor = terrainY(ship.x) - 58;
  let targetX: number | null = null;
  let targetY: number | null = null;
  let fire = false;

  const falling = state.signals.find(s => s.status === 'falling');
  let nearest: Enemy | null = null;
  let nearestDist = Number.POSITIVE_INFINITY;
  let threatsNearby = 0;
  for (const e of state.enemies) {
    if (!e.alive) continue;
    const d = distWrapped(e.x, e.y, ship.x, ship.y);
    if (d < 520) threatsNearby += 1;
    if (d < nearestDist) {
      nearestDist = d;
      nearest = e;
    }
  }

  if (falling) {
    targetX = falling.x;
    targetY = falling.y + 8;
  } else if (nearest) {
    const dx = wrapDelta(nearest.x, ship.x);
    const dy = nearest.y - ship.y;
    // Crawl when close so the ship keeps facing its prey instead of
    // reversing (lasers fire along ship.dir) — but only when the target is
    // actually roughly in firing lane (matches the `fire` gate below). An
    // enemy well above/below isn't an imminent same-lane threat, and crawling
    // sideways toward it was a wide, symmetric deadzone re-deriving
    // attractCrawlDir from Math.sign(dx) every time |dx| ticked past 12 —
    // the ship's OWN crawl motion swings dx back past that threshold every
    // couple of frames (own-motion feedback), so it flipped direction over
    // and over and never made progress, trapped oscillating in place.
    // Fix: (1) only crawl in-lane, chase (targetX = nearest.x) otherwise, and
    // (2) require a wide swing to the OTHER side before flipping (a Schmitt
    // trigger, not a symmetric deadzone) so the ship's own motion can't
    // re-trigger a flip on its own.
    const sameLane = Math.abs(dy) < 70;
    if (sameLane) {
      const nextDir = dx > 0 ? 1 : -1;
      if (nextDir !== attractCrawlDir && Math.abs(dx) > 40 && state.trace.elapsed >= attractCrawlLockedUntil) {
        attractCrawlDir = nextDir;
        attractCrawlLockedUntil = state.trace.elapsed + 0.6;
      }
      targetX = Math.abs(dx) < 240 ? wrapX(ship.x + attractCrawlDir * 60) : nearest.x;
    } else {
      targetX = nearest.x;
    }
    targetY = nearest.y + Math.sin(state.trace.elapsed * 1.7) * 26;
    fire = Math.abs(dy) < 70 && Math.abs(dx) < tunedLaserLength() * 0.92;
  } else {
    // Patrol: sweep the frontier with a lazy sine so the camera keeps moving.
    targetX = wrapX(ship.x + (Math.sin(state.trace.elapsed * 0.35) > 0 ? 520 : -520));
    targetY = 320 + Math.sin(state.trace.elapsed * 0.9) * 90;
  }

  const dx = wrapDelta(targetX, ship.x);
  // attractBot.x feeds ship.dir directly in updateShip (desiredDir = sign of
  // this value) with no deadzone of its own — a real player's discrete key
  // presses never jitter near zero, but the bot's continuous dx can, worst
  // when the target sits at almost exactly the ship's own x (an enemy
  // directly overhead/underneath already puts dx near zero, and outside the
  // in-lane crawl branch above there's nothing damping that at all). Lock
  // the SIGN the same way attractCrawlDir is locked above so ship.dir can't
  // flip every frame with zero net progress; keep the raw magnitude for
  // thrust so speed still responds normally.
  if (Math.abs(dx) > 40 && state.trace.elapsed >= attractFacingLockedUntil) {
    const desired = dx > 0 ? 1 : -1;
    if (desired !== attractFacingDir) {
      attractFacingDir = desired;
      attractFacingLockedUntil = state.trace.elapsed + 0.6;
    }
  }
  attractBot.x = clamp(Math.abs(dx) / 180, 0, 1) * attractFacingDir;
  attractBot.y = clamp(((targetY ?? 320) - ship.y) / 130, -1, 1);
  attractBot.fire = fire;

  // Terrain and ceiling discipline beats aim.
  if (ship.y > floor - 92) attractBot.y = Math.min(attractBot.y, -0.65);
  if (ship.y < PLAY_TOP + 88) attractBot.y = Math.max(attractBot.y, 0.35);
  // Pop an earned burst when the screen gets crowded — great demo theatre.
  if (state.burstCharges > 0 && threatsNearby >= 5) smartBurst();
}
const DEBUG_TUNING = QUERY.has('debug');
const START_WAVE = parseStartWave();
const START_WOUNDED = QUERY.has('wounded');
const DIRECT_CLIENT_SCORE = QUERY.has('directScore');
const DEBUG_EXPLOSION = QUERY.has('explode');
const DEBUG_FXLAB = QUERY.has('fxlab');
type FxLabKey = 'shoot' | 'pickup' | 'pickup-big' | 'pickup-rose' | 'pickup-cult' | 'pickup-420' | 'pickup-scooter' | 'pickup-600b' | 'pickup-multi' | 'pickup-timelock' | 'troll-feed' | 'troll-feed-2' | 'troll-feed-3' | 'kill-hunter' | 'kill-carrier';
const DEBUG_GAMEOVER = QUERY.has('gameover');
const DEBUG_AUTO_SUPPORT = QUERY.has('support');
const DEBUG_COMBAT = QUERY.has('combat');
const DEBUG_MUSIC = QUERY.has('musicDebug');

let activePlayerSession: SignetSession | null = null;
let activePlayerProfile: NostrProfile | null = null;
let activeRosterOffset = 0;
let titleStartInFlight = false;
let titleStatus = guestTitleStatus();
let titleValueStatus = '';
let titlePaymentModalOpen = false;
let titlePaymentAction: TitlePaymentAction = 'copy';
// Which QR the title payment modal and game-over support panel show.
let titlePaymentMethod: SupportQrMethod = 'lightning';
let scoreSupportMethod: SupportQrMethod = 'lightning';
let titleStartProgress = 0;
let titleStartDisplayProgress = 0;
let titleStartStartedAt = 0;
let titleStartDisplayUpdatedAt = 0;
let titleStartFinalStartedAt = 0;
let titleStartFinalFrom = 0;
let state = makeState();
let cameraX = state.ship.x;
let lastT = performance.now();
let acc = 0;
// Fraction of a sim step elapsed at render time; drives motion interpolation
// so 90/120Hz displays get smooth movement from the fixed 60Hz simulation.
let renderAlpha = 1;
// First-wave control tuition: shown until the player has both moved and
// fired (and at least a few seconds have passed), then faded out.
let hintMoved = false;
let hintFired = false;
let hintDoneAt = -1;
// What landed the killing blow, for the death callout and game-over screen.
let lastDeathSource = '';
// Rival chase: the leaderboard becomes a ladder of real people to pass
// mid-run. The HUD shows the next score to beat; crossing it celebrates and
// advances to the next rung. Your own best sits on the ladder too.
interface RivalRung {
  name: string;
  score: number;
  own: boolean;
}
let rivalLadder: RivalRung[] = [];
let rivalCursor = 0;

function buildRivalLadder(): void {
  const identity = activePlayerIdentity();
  const snapshot = getCachedLeaderboard();
  // Daily runs chase today's gauntlet board; ordinary runs chase all-time.
  const entries = (state.daily ? snapshot?.daily : snapshot?.entries) ?? [];
  const rungs: RivalRung[] = entries
    .filter(entry => entry.score > 0 && (!identity.pubkey || entry.playerPubkey !== identity.pubkey))
    .map(entry => ({ name: entry.playerName, score: entry.score, own: false }));
  const boardBest = identity.pubkey
    ? entries.find(entry => entry.playerPubkey === identity.pubkey)?.score ?? 0
    : 0;
  const localBest = state.daily ? 0 : getLocalScores().reduce((best, entry) => Math.max(best, entry.score), 0);
  const ownBest = Math.max(boardBest, localBest);
  if (ownBest > 0) rungs.push({ name: 'YOUR BEST', score: ownBest, own: true });
  rungs.sort((a, b) => a.score - b.score);
  rivalLadder = rungs;
  rivalCursor = rungs.filter(rung => state.score > rung.score).length;
}

function updateRivalChase(): void {
  if (state.demo || rivalLadder.length === 0) return;
  let passed: RivalRung | null = null;
  while (rivalCursor < rivalLadder.length && state.score > rivalLadder[rivalCursor]!.score) {
    passed = rivalLadder[rivalCursor]!;
    rivalCursor += 1;
  }
  if (!passed) return;
  if (passed.own) {
    // Beating your own record is the whole reason to press retry — give it the
    // full hero treatment (freeze-frame, gold star flare, confetti, fanfare)
    // instead of the plain "passed a rival" ping.
    state.message = 'NEW PERSONAL BEST';
    state.messageUntil = 2.2;
    state.flash = Math.max(state.flash, 0.44);
    spawnText(state.ship.x, state.ship.y - 88, 'NEW PERSONAL BEST', '#ffd84a', undefined, 2.0);
    spawnStarFlare(state.ship.x, state.ship.y, '#ffd84a', 116, 0.36, 2.6);
    spawnSparkleBurst(state.ship.x, state.ship.y, ['#ffd84a', '#fff5d8', '#5effdb'], 28, 250);
    spawnRing(state.ship.x, state.ship.y, '#ffd84a', 138);
    spawnShockwave(state.ship.x, state.ship.y, '#ffd84a', 150, 0.36);
    addHitstop(0.075);
    playAudio('overtake', 1.3);
    playAudio('oneUp', 1.25);
    playAudio('musicSurge', 0.72);
    return;
  }
  const label = `PASSED ${passed.name.toUpperCase()}`;
  state.message = label;
  state.messageUntil = 1.7;
  state.flash = Math.max(state.flash, 0.24);
  spawnText(state.ship.x, state.ship.y - 84, label, '#ffd84a', undefined, 1.5);
  playAudio('overtake', 1.25);
}

function nextRivalRung(): RivalRung | null {
  return rivalLadder[rivalCursor] ?? null;
}

// Game-over leaderboard snapshot and the support overlay toggle.
let gameOverBoard: LeaderboardSnapshot | null = null;
let gameOverSupportOpen = false;
let supportNudgeLine: string | null = null;
// Feedback from the last support action, drawn inside the modal itself —
// scoreStatus sits behind the modal dim where nobody sees it.
let supportActionStatus: string | null = null;
// Game over runs as staged screens: the value-for-value ask first, then the
// arcade name entry for guests, then the score table. The claim publish for a
// guest run is deferred until the name commits so the score carries it.
type GameOverStage = 'support' | 'name' | 'score';
let gameOverStage: GameOverStage = 'score';
let gameOverNamePending = false;
let nameEntryValue = '';
let meshAttempted = false;
let meshModule: MeshOverlayModule | null = null;
let meshLoading: Promise<MeshOverlayModule> | null = null;
let scoreSubmitInFlight = false;
let scorePublished = false;
let valueThanksVisible = false;

interface ProfileImageEntry {
  image: CanvasImageSource | null;
  loaded: boolean;
  failed: boolean;
  candidates: string[];
  index: number;
  expiresAt: number;
}

const PROFILE_IMAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PROFILE_IMAGE_FAILURE_RETRY_MS = 45 * 1000;
const PROFILE_IMAGE_LOAD_LIMIT = 6;
const PROFILE_IMAGE_SPRITE_SIZE = 128;
const PROFILE_IMAGE_CACHE_NAME = 'neonsentinel:profile-images:v1';
const PROFILE_IMAGE_CACHED_AT = 'x-neon-sentinel-client-cached-at';
const VECTOR_PROFILE_AVATAR_RADIUS_SCALE = 0.96;
const profileImageCache = new Map<string, ProfileImageEntry>();
const pendingProfileImageLoads: ProfileImageEntry[] = [];
let activeProfileImageLoads = 0;

function emitParticle(particle: Particle, priority = false): void {
  if (state.particles.length < MAX_PARTICLES) {
    state.particles.push(particle);
    return;
  }
  if (!priority) return;
  const dropIndex = state.particles.findIndex(p => p.kind === 'spark' || p.kind === 'beam' || p.kind === 'chunk');
  if (dropIndex >= 0) state.particles.splice(dropIndex, 1);
  else state.particles.shift();
  state.particles.push(particle);
}

function particleLoad(): number {
  return clamp(state.particles.length / MAX_PARTICLES, 0, 1);
}

function particleSpawnScale(kind: 'burst' | 'detail' | 'trail'): number {
  const load = particleLoad();
  if (load < 0.58) return 1;
  const floor = kind === 'trail' ? 0.42 : kind === 'burst' ? 0.54 : 0.62;
  return clamp(1 - (load - 0.58) * 1.18, floor, 1);
}

function particleSpawnCount(requested: number, kind: 'burst' | 'detail' | 'trail' = 'detail'): number {
  const headroom = MAX_PARTICLES - state.particles.length;
  if (headroom <= 0) return 0;
  const target = Math.max(1, Math.round(requested * particleSpawnScale(kind)));
  if (headroom >= target) return target;
  return Math.max(1, Math.floor(headroom * 0.58));
}

for (let i = 0; i < 160; i += 1) {
  stars.push({
    x: rand() * WORLD_W,
    y: rand() * VIEW_H,
    depth: rand(),
    phase: rand() * Math.PI * 2,
  });
}

function makeState(seed = Date.now() >>> 0): GameState {
  const skill = skillSpec(selectedSkill);
  const identity = activePlayerIdentity();
  return {
    phase: 'title',
    seed,
    // runId stays on true Math.random even in daily mode: a seeded suffix
    // would collide the replaceable d-tag across attempts and eat best runs.
    runId: `run-${seed.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: 0,
    finishedAt: 0,
    scoreRecorded: false,
    playerMode: identity.mode,
    playerName: identity.name,
    playerPubkey: identity.pubkey,
    score: 0,
    sats: 0,
    wave: 0,
    timeLeft: skill.startTime,
    timePop: 0,
    timePopGain: false,
    rescued: 0,
    lost: 0,
    combo: 0,
    maxCombo: 0,
    comboUntil: 0,
    comboCalled: 0,
    nextExtendAt: EXTEND_STEP,
    waveLivesLost: 0,
    waveContactsLost: 0,
    daily: false,
    demo: false,
    burstCharges: 1,
    shipClass: selectedShip,
    skill: selectedSkill,
    ship: {
      x: WORLD_W / 2,
      y: 346,
      vx: 0,
      vy: 0,
      dir: 1,
      cooldown: 0,
      invuln: 0,
      shieldHits: 0,
      heat: 0,
      turnCue: 0,
    },
    signals: makeSignals(seed),
    enemies: [],
    lasers: [],
    enemyShots: [],
    beacons: [],
    particles: [],
    spawnLeft: 0,
    nextSpawn: 0,
    waveClear: 0,
    waveTimer: 0,
    waveGrace: 0,
    scoreSurge: 0,
    scorePop: 0,
    chill: 0,
    timeLock: 0,
    fanout: 0,
    trollScolded: false,
    trollSpotted: false,
    lastTrollSpawnAt: -Infinity,
    rescueNet: 0,
    lowCamp: 0,
    lowAltitudeWarning: 0,
    groundFlakCooldown: 0,
    nextBaiter: 18,
    threatPulse: 0,
    damageCue: 0,
    jamCue: 0,
    shake: 0,
    hitstop: 0,
    flash: 0,
    shipDestroyed: false,
    message: BRAND_NAME,
    messageUntil: Number.POSITIVE_INFINITY,
    trace: makePlaytestTrace(),
  };
}

function makeSignals(seed: number): Signal[] {
  const rng = mulberry32(seed ^ 0x7a11ce);
  const contacts = normalisedActiveRoster();
  return contacts.map((entry, i) => {
    const x = wrapX(((i + 0.5) / contacts.length) * WORLD_W + (rng() - 0.5) * 90);
    return {
      id: i + 1,
      name: entry.name,
      pubkey: entry.pubkey,
      // Guest runs use the well-known roster, so their kind-0 avatars apply
      // in every mode; signalAvatarPicture gates display policy per skill.
      profile: getCachedProfile(entry.pubkey),
      relation: entry.relation,
      rank: entry.rank,
      homeX: x,
      x,
      y: terrainY(x) - 22,
      vy: 0,
      status: 'ground',
      carriedBy: null,
      liftedAt: 0,
      flash: 0,
    };
  });
}

function activePlayerIdentity(): { mode: PlayerMode; name: string; pubkey: string | null } {
  if (activePlayerSession && !isGuestSession(activePlayerSession)) {
    const profile = activePlayerProfile ?? getCachedProfile(activePlayerSession.pubkey);
    const fallback = activePlayerSession.displayName?.trim() || `npub ${activePlayerSession.pubkey.slice(0, 6)}`;
    return {
      mode: 'nostr',
      name: profileDisplayName(profile, fallback),
      pubkey: activePlayerSession.pubkey,
    };
  }
  if (activePlayerSession && isGuestSession(activePlayerSession)) {
    return {
      mode: 'guest',
      name: activePlayerSession.displayName?.trim() || getGuestRecord()?.name || 'Guest',
      pubkey: activePlayerSession.pubkey,
    };
  }
  return {
    mode: 'guest',
    name: getGuestRecord()?.name ?? 'Guest',
    pubkey: null,
  };
}

function activeNostrSession(): SignetSession | null {
  return activePlayerSession && !isGuestSession(activePlayerSession) ? activePlayerSession : null;
}

function normalisedActiveRoster(): readonly RosterEntry[] {
  // 600B pressure defends the roll of the 600 billion themselves, whoever is
  // signed in — that keeps every contact a verified member with an avatar.
  // Other tiers use the player's own follower roster when one is loaded.
  const base = selectedSkill === '600b' || activeContactRoster.length < CONTACT_COUNT
    ? roster
    : activeContactRoster;
  return rosterWindow(base, activeRosterOffset);
}

function rosterWindow(base: readonly RosterEntry[], offset: number): readonly RosterEntry[] {
  if (base.length <= CONTACT_COUNT) return base.slice(0, CONTACT_COUNT);
  return Array.from({ length: CONTACT_COUNT }, (_, index) => base[wrapIndex(offset + index, base.length)]!);
}

function guestTitleStatus(): string {
  const guest = getGuestRecord();
  return guest ? `GUEST READY · ${guest.name.toUpperCase()}` : 'GUEST READY · QUICK PLAY';
}

function titleReadyStatus(): string {
  return activeNostrSession() ? 'NOSTR SIGNED IN · LOGIN PLAYS FOLLOWERS' : guestTitleStatus();
}

function beginTitleLaunch(field: TitleMenuField, status: string): void {
  titleStartInFlight = true;
  titleMenuField = field;
  titleStartStartedAt = performance.now();
  titleStartDisplayUpdatedAt = titleStartStartedAt;
  titleStartProgress = 0;
  titleStartDisplayProgress = 0;
  titleStartFinalStartedAt = 0;
  titleStartFinalFrom = 0;
  titleStatus = status;
}

function setTitleLaunchProgress(progress: number): void {
  titleStartProgress = clamp(Math.max(titleStartProgress, progress), 0, 1);
}

async function completeTitleLaunch(): Promise<void> {
  const elapsed = Math.max(0, performance.now() - titleStartStartedAt);
  const remaining = Math.max(0, 520 - elapsed);
  if (remaining > 0) await delay(remaining);
  titleStartFinalFrom = clamp(titleStartDisplayProgress, 0, 0.86);
  titleStartFinalStartedAt = performance.now();
  setTitleLaunchProgress(1);
  await delay(190);
}

function resetTitleLaunchProgress(): void {
  titleStartProgress = 0;
  titleStartDisplayProgress = 0;
  titleStartStartedAt = 0;
  titleStartDisplayUpdatedAt = 0;
  titleStartFinalStartedAt = 0;
  titleStartFinalFrom = 0;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function makePlaytestTrace(): PlaytestTrace {
  return {
    elapsed: 0,
    currentWaveStartedAt: 0,
    waveDurations: [],
    shotsFired: 0,
    shotsHit: 0,
    shotsGrazed: 0,
    burstUses: 0,
    livesLost: 0,
    damageEvents: 0,
    contactsLifted: 0,
    contactsSaved: 0,
    contactsForged: 0,
    contactsDropped: 0,
    beaconsSpawned: 0,
    beaconsCollected: 0,
    nearGroundSeconds: 0,
    lowCampSeconds: 0,
    heatPeak: 0,
    laserLengthMin: tunedLaserLength(),
    turnEvents: 0,
    rescueResponseCount: 0,
    rescueResponseTotal: 0,
    rescueResponseFastest: Number.POSITIVE_INFINITY,
    rescueResponseSlowest: 0,
    kills: { abductor: 0, forgery: 0, jammer: 0, hunter: 0, carrier: 0, spammer: 0, sybil: 0, troll: 0 },
    damageBy: {},
  };
}

function parseStartWave(): number {
  if (QUERY.has('boss')) return skillSpec(selectedSkill).bossEvery;
  const raw = Number(QUERY.get('wave'));
  if (!Number.isFinite(raw)) return 1;
  return Math.max(1, Math.min(30, Math.floor(raw)));
}

function startRun(wave = START_WAVE): void {
  randSource = Math.random;
  state = makeState(dailyArmed ? dailySeed() : Date.now() >>> 0);
  if (dailyArmed) {
    // The daily gauntlet is one shared field: same seed, same ship, same
    // pressure for everyone. The runId prefix marks the score event's d-tag
    // so the board can filter the day without any server changes.
    state.daily = true;
    state.skill = 'normal';
    state.shipClass = 'interceptor';
    state.timeLeft = skillSpec('normal').startTime;
    state.runId = `daily-${dailyStamp()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  state.phase = 'playing';
  state.startedAt = Date.now();
  // ?score=N seeds the run's score — for verifying extends and rival-chase
  // crossings without grinding 50k points first.
  const debugScore = Number(QUERY.get('score'));
  if (Number.isFinite(debugScore) && debugScore > 0) {
    state.score = Math.floor(debugScore);
    state.nextExtendAt = (Math.floor(state.score / EXTEND_STEP) + 1) * EXTEND_STEP;
  }
  pauseMenuChoice = 'resume';
  hintMoved = false;
  hintFired = false;
  hintDoneAt = -1;
  hudScoreRef = state.score;
  lastRunNewBest = false;
  lastDeathSource = '';
  gameOverSupportOpen = false;
  gameOverStage = 'score';
  gameOverNamePending = false;
  pressedOnce.clear();
  lastRunSummary = null;
  lastFeelReport = null;
  scoreSubmitInFlight = false;
  scorePublished = false;
  valueThanksVisible = false;
  supportNudgeLine = null;
  setScoreStatus('LOCAL SCORE · NO PAYOUT');
  cameraX = state.ship.x;
  publishPlaytestTrace();
  buildRivalLadder();
  // Refresh the board in the background so the ladder reflects fresh scores;
  // keep whatever the player has already passed as passed.
  if (!state.demo) {
    const runId = state.runId;
    void fetchLeaderboard().then(() => {
      if (state.phase === 'playing' && state.runId === runId) buildRivalLadder();
    });
  }
  startWave(wave);
  primeSignalProfiles();
  // Warm the gratitude cast so the first clutch save speaks instantly.
  for (const line of RESCUE_THANKS_LINES) preloadVoiceClip(line.url);
  syncScoreActions();
}

function startAttractRun(): void {
  attractMode = true;
  randSource = Math.random;
  state = makeState(Date.now() >>> 0);
  state.demo = true;
  state.phase = 'playing';
  state.startedAt = Date.now();
  state.playerName = 'DEMO PILOT';
  // Suppress the wave-1 tuition overlay; the bot needs no teaching.
  hintMoved = true;
  hintFired = true;
  cameraX = state.ship.x;
  resetActiveInput();
  // Open mid-pressure so spectators see combat, not an empty frontier.
  startWave(3);
  syncScoreActions();
}

function exitAttractRun(): void {
  if (!attractMode) return;
  attractMode = false;
  randSource = Math.random;
  state = makeState(Date.now() >>> 0);
  cameraX = state.ship.x;
  acc = 0;
  titleMenuField = 'start';
  resetActiveInput();
  markPlayerActivity();
  titleStatus = titleReadyStatus();
  musicSetPaused(false);
  musicForceRefresh();
  // A soft tick as the cabinet hands back to the title — after the player's
  // first gesture this also confirms the sound is on.
  playAudio('lock', 0.5);
  syncScoreActions();
}

async function startGuestRunFromTitle(): Promise<void> {
  if (titleStartInFlight) return;
  beginTitleLaunch('start', 'GUEST MODE · PREPARING LOCAL SIGNER');
  try {
    let session = await restoreGuestSession();
    setTitleLaunchProgress(0.4);
    if (!session) {
      session = await createGuestSession(getGuestRecord()?.name ?? 'Guest');
    }
    setTitleLaunchProgress(0.72);
    activePlayerSession = session;
    activePlayerProfile = null;
    activeContactRoster = roster;
    activeRosterOffset = 0;
    titleStatus = `GUEST READY · ${(session.displayName ?? 'Guest').toUpperCase()}`;
    await completeTitleLaunch();
    startRun();
  } catch (err) {
    titleStatus = err instanceof Error ? `GUEST ERROR · ${err.message.slice(0, 28)}` : 'GUEST ERROR';
  } finally {
    titleStartInFlight = false;
    if (state.phase === 'title') resetTitleLaunchProgress();
  }
}

async function startNostrRunFromTitle(): Promise<void> {
  if (titleStartInFlight) return;
  beginTitleLaunch('login', activeNostrSession() ? 'NOSTR CONNECTED · LOADING FOLLOWERS' : 'LOGIN · OPENING SIGNET');
  try {
    const session = activeNostrSession() ?? await loginWithSignet();
    if (!session) {
      titleStatus = 'LOGIN CANCELLED · GUEST STILL AVAILABLE';
      return;
    }
    activePlayerSession = session;
    activePlayerProfile = getCachedProfile(session.pubkey);
    setTitleLaunchProgress(0.42);
    titleStatus = 'NOSTR CONNECTED · LOADING FOLLOWERS';
    const [entries] = await Promise.all([
      buildNostrRoster(session.pubkey),
      loadActivePlayerProfile(session.pubkey),
    ]);
    activeContactRoster = entries;
    activeRosterOffset = 0;
    setTitleLaunchProgress(0.82);
    const memberHandle = sixHundredHandle(session.pubkey);
    if (memberHandle) applySixHundredMemberPerk();
    titleStatus = memberHandle
      ? `600B VERIFIED · ${sixHundredNip05(memberHandle).toUpperCase()}`
      : activeContactRoster === roster
        ? 'NOSTR READY · USING FALLBACK SIGNALS'
        : 'NOSTR READY · WOT CONTACTS IN PLAY';
    await completeTitleLaunch();
    startRun();
  } catch (err) {
    titleStatus = err instanceof Error ? `LOGIN ERROR · ${err.message.slice(0, 28)}` : 'LOGIN ERROR';
  } finally {
    titleStartInFlight = false;
    if (state.phase === 'title') resetTitleLaunchProgress();
  }
}

async function loginWithSignet(): Promise<SignetSession | null> {
  const signet = window.Signet;
  if (!signet?.login) throw new Error('Signet unavailable');
  const session = await signet.login({
    appName: SIGNET_APP_NAME,
    relayUrl: 'wss://relay.trotters.cc',
    theme: 'dark',
  });
  return isUsableSignetSession(session) ? session : null;
}

async function buildNostrRoster(pubkey: string): Promise<readonly RosterEntry[]> {
  const rosterTarget = CONTACT_COUNT * 4;
  const [followers, follows] = await Promise.all([
    fetchFollowerPubkeys(pubkey, { limit: rosterTarget, timeoutMs: 3000 }),
    fetchFollowPubkeys(pubkey, { limit: rosterTarget, timeoutMs: 3000 }),
  ]);
  const candidates = mergeNostrRosterCandidates(pubkey, followers, follows);
  if (candidates.length === 0) return roster;
  const profiles = await fetchProfiles(candidates.map(candidate => candidate.pubkey), { refreshMissingPictures: true, timeoutMs: 2800 });
  const selected = candidates
    .map(candidate => {
      const profile = profiles.get(candidate.pubkey) ?? getCachedProfile(candidate.pubkey);
      const hasPicture = profilePictureCandidates(profile?.picture).length > 0;
      return { candidate, hasPicture };
    })
    .sort((a, b) => {
      const imageDelta = Number(b.hasPicture) - Number(a.hasPicture);
      if (imageDelta !== 0) return imageDelta;
      const sourceDelta = nostrRosterSourceWeight(a.candidate.source) - nostrRosterSourceWeight(b.candidate.source);
      if (sourceDelta !== 0) return sourceDelta;
      return a.candidate.order - b.candidate.order;
    })
    .map(item => item.candidate);
  const entries = selected.map((candidate, index): RosterEntry => {
    const profile = profiles.get(candidate.pubkey) ?? getCachedProfile(candidate.pubkey);
    const fallback = `npub ${candidate.pubkey.slice(0, 6)}`;
    return {
      name: profileDisplayName(profile, fallback),
      relation: rosterRelationForNostrCandidate(candidate.source, index),
      rank: Math.max(52, 96 - index * 2 - (candidate.source === 'followed' ? 4 : 0)),
      pubkey: candidate.pubkey,
    };
  });
  return fillNostrRoster(entries);
}

function mergeNostrRosterCandidates(
  pubkey: string,
  followers: readonly string[],
  follows: readonly string[],
): NostrRosterCandidate[] {
  const self = pubkey.toLowerCase();
  const seen = new Set<string>([self]);
  const out: NostrRosterCandidate[] = [];

  const add = (items: readonly string[], source: NostrRosterSource): void => {
    for (const item of items) {
      const clean = item.toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(clean) || seen.has(clean)) continue;
      seen.add(clean);
      out.push({ pubkey: clean, source, order: out.length });
    }
  };

  add(followers, 'follower');
  add(follows, 'followed');
  return out;
}

function fillNostrRoster(entries: readonly RosterEntry[]): readonly RosterEntry[] {
  if (entries.length >= CONTACT_COUNT) return entries;
  const seen = new Set(entries.map(entry => entry.pubkey));
  const filled = [...entries];
  for (const entry of roster) {
    if (seen.has(entry.pubkey)) continue;
    seen.add(entry.pubkey);
    filled.push(entry);
    if (filled.length >= CONTACT_COUNT) return filled;
  }
  return filled;
}

function nostrRosterSourceWeight(source: NostrRosterSource): number {
  return source === 'follower' ? 0 : 1;
}

function rosterRelationForNostrCandidate(source: NostrRosterSource, index: number): Relation {
  if (source === 'follower') return index < 4 ? 'high-wot' : index < 10 ? 'mutual' : 'follow';
  return index < 6 ? 'mutual' : 'follow';
}

async function loadActivePlayerProfile(pubkey: string): Promise<void> {
  const cached = getCachedProfile(pubkey);
  if (cached) {
    activePlayerProfile = cached;
    ensureProfileImageEntry(cached.picture);
  }
  try {
    const profiles = await fetchProfiles([pubkey], { refreshMissingPictures: true, timeoutMs: 3200 });
    const profile = profiles.get(pubkey) ?? getCachedProfile(pubkey);
    if (!profile) return;
    activePlayerProfile = profile;
    ensureProfileImageEntry(profile.picture);
  } catch {
    /* Profile data is decorative; keep the signed-in session even if relays fail. */
  }
}

async function restoreNostrTitleSession(): Promise<void> {
  if (activePlayerSession || titleStartInFlight) return;
  try {
    const arcadeSession = await consumeArcadeHandoff(GAME_ID);
    const signet = window.Signet;
    const session = arcadeSession ?? (signet?.restoreSession
      ? await signet.restoreSession({ reconnectBunker: false })
      : null);
    if (!isUsableSignetSession(session)) return;
    activePlayerSession = session;
    activePlayerProfile = getCachedProfile(session.pubkey);
    const memberHandle = sixHundredHandle(session.pubkey);
    if (memberHandle) applySixHundredMemberPerk();
    titleStatus = memberHandle
      ? `600B MEMBER · ${sixHundredNip05(memberHandle).toUpperCase()}`
      : 'NOSTR SIGNED IN · LOGIN PLAYS FOLLOWERS';
    await loadActivePlayerProfile(session.pubkey);
  } catch {
    /* Signet restore is opportunistic on the title screen. */
  }
}

// Members of the 600 billion default to the 600B pressure tier — a nudge,
// not a lock: any tier they have already picked (or pick later) wins.
function applySixHundredMemberPerk(): void {
  if (selectedSkill === 'normal') selectedSkill = '600b';
}

async function logoutFromTitle(): Promise<void> {
  if (titleStartInFlight) return;
  titleStartInFlight = true;
  titleMenuField = 'logout';
  titleStatus = 'LOGGING OUT';
  const session = activePlayerSession;
  try {
    if (window.Signet?.logout) await window.Signet.logout(session ?? undefined);
    else await session?.signer.close?.();
  } catch {
    try { await session?.signer.close?.(); } catch { /* ignore */ }
  } finally {
    activePlayerSession = null;
    activePlayerProfile = null;
    activeContactRoster = roster;
    activeRosterOffset = 0;
    state = makeState(Date.now() >>> 0);
    cameraX = state.ship.x;
    acc = 0;
    titleMenuField = 'start';
    titleStatus = guestTitleStatus();
    resetActiveInput();
    syncScoreActions();
    titleStartInFlight = false;
  }
}

function isUsableSignetSession(session: SignetSession | null | undefined): session is SignetSession {
  return !!session?.signer && typeof session.signer.signEvent === 'function';
}

function resetActiveInput(): void {
  keys.clear();
  pressedOnce.clear();
  touch.x = 0;
  touch.y = 0;
  touch.fire = false;
}

function pauseRun(): void {
  if (state.phase !== 'playing' || state.shipDestroyed) return;
  state.phase = 'paused';
  pauseMenuChoice = 'resume';
  resetActiveInput();
  musicSetPaused(true);
  updateAudio({ playing: false, speed: 0, thrust: 0, capture: 0, danger: 0, heat: 0 });
  playAudio('lock', 0.48);
  syncScoreActions();
}

function resumeRun(): void {
  if (state.phase !== 'paused') return;
  state.phase = 'playing';
  resetActiveInput();
  musicSetPaused(false);
  musicForceRefresh();
  playAudio('lock', 0.5);
  syncScoreActions();
}

function quitPausedRunToTitle(): void {
  if (state.phase !== 'paused') return;
  if (!state.daily) {
    selectedShip = state.shipClass;
    selectedSkill = state.skill;
  }
  randSource = Math.random;
  state = makeState(Date.now() >>> 0);
  cameraX = state.ship.x;
  acc = 0;
  pauseMenuChoice = 'resume';
  titleMenuField = 'start';
  resetActiveInput();
  lastRunSummary = null;
  lastFeelReport = null;
  scoreSubmitInFlight = false;
  scorePublished = false;
  valueThanksVisible = false;
  supportNudgeLine = null;
  musicSetPaused(false);
  musicForceRefresh();
  titleStatus = titleReadyStatus();
  setScoreStatus('LOCAL SCORE · NO PAYOUT');
  publishPlaytestTrace(false);
  syncScoreActions();
}

function retryRunFromGameOver(): void {
  if (state.phase !== 'gameover') return;
  if (!state.daily) {
    // Daily runs force ship/pressure; don't let a retry overwrite the
    // player's own title selections with the gauntlet loadout.
    selectedShip = state.shipClass;
    selectedSkill = state.skill;
  }
  valueThanksVisible = false;
  playAudio('lock', 0.6);
  startRun();
}

function returnGameOverToTitle(): void {
  if (state.phase !== 'gameover') return;
  gameOverSupportOpen = false;
  gameOverStage = 'score';
  gameOverNamePending = false;
  if (!state.daily) {
    selectedShip = state.shipClass;
    selectedSkill = state.skill;
  }
  randSource = Math.random;
  state = makeState(Date.now() >>> 0);
  cameraX = state.ship.x;
  acc = 0;
  pauseMenuChoice = 'resume';
  titleMenuField = 'start';
  resetActiveInput();
  valueThanksVisible = false;
  titleStatus = titleReadyStatus();
  musicSetPaused(false);
  musicForceRefresh();
  setScoreStatus('LOCAL SCORE · NO PAYOUT');
  publishPlaytestTrace(false);
  syncScoreActions();
}

function startWave(wave: number): void {
  // Reseed per wave so every player's wave N opens from an identical RNG
  // state — framerate-dependent drift within a wave cannot compound.
  if (state.daily) seedDailyWave(wave);
  const skill = skillSpec();
  const ship = shipSpec();
  const bossWave = isBossWave(wave);
  const pacing = wavePacingProfile(wave, bossWave, skill);
  state.wave = wave;
  state.spawnLeft = pacing.spawnLeft;
  state.nextSpawn = pacing.initialSpawn;
  state.waveClear = 0;
  state.waveTimer = 0;
  state.waveGrace = pacing.waveGrace;
  state.lowCamp = 0;
  state.lowAltitudeWarning = 0;
  state.groundFlakCooldown = 0;
  state.threatPulse = 0;
  state.nextBaiter = pacing.nextBaiter;
  state.waveLivesLost = 0;
  state.waveContactsLost = 0;
  state.trace.currentWaveStartedAt = state.trace.elapsed;
  state.message = bossWave ? `BOSS WAVE ${wave}` : `WAVE ${wave}`;
  state.messageUntil = 1.35;
  if (wave % 3 === 1) state.burstCharges = Math.min(ship.burstCap, state.burstCharges + 1);
  if (state.phase === 'playing') {
    playAudio(bossWave ? 'burst' : 'wave', bossWave ? 1.25 : 0.8);
    playAudio('musicSurge', bossWave ? 1.1 : 0.62);
  }
  for (const s of state.signals) {
    if (s.status === 'saved') {
      s.status = 'ground';
      s.x = s.homeX;
      s.y = terrainY(s.x) - 22;
      s.vy = 0;
      s.carriedBy = null;
      s.liftedAt = 0;
    }
  }
  rotateSignalRosterForWave(wave);
  if (bossWave) spawnCarrier();
  seedOpeningThreats(wave);
}

function rotateSignalRosterForWave(wave: number): void {
  if (state.playerMode !== 'nostr') return;
  if (wave <= 1 || wave % 3 !== 1) return;
  if (activeContactRoster.length <= CONTACT_COUNT) return;
  activeRosterOffset = wrapIndex(activeRosterOffset + CONTACT_COUNT, activeContactRoster.length);
  const nextRoster = normalisedActiveRoster();
  let changed = false;
  for (let i = 0; i < state.signals.length && i < nextRoster.length; i += 1) {
    const signal = state.signals[i]!;
    if (signal.status === 'carried' || signal.status === 'falling' || signal.status === 'lost') continue;
    const entry = nextRoster[i]!;
    if (signal.pubkey === entry.pubkey) continue;
    applyRosterEntryToSignal(signal, entry);
    changed = true;
  }
  if (changed) {
    preloadProfileImages(state.signals);
    primeSignalProfiles();
  }
}

function applyRosterEntryToSignal(signal: Signal, entry: RosterEntry): void {
  signal.name = entry.name;
  signal.pubkey = entry.pubkey;
  signal.profile = getCachedProfile(entry.pubkey);
  signal.relation = entry.relation;
  signal.rank = entry.rank;
  signal.flash = Math.max(signal.flash, 0.32);
}

function wavePacingProfile(wave: number, bossWave: boolean, skill: SkillSpec): {
  spawnLeft: number;
  initialSpawn: number;
  waveGrace: number;
  nextBaiter: number;
} {
  const earlyBase = EARLY_WAVE_SPAWN_BASE[wave];
  const spawnBase = earlyBase ?? lateWaveSpawnBase(wave, bossWave);
  const bossSpawnTrim = bossWave ? 0.86 : 1;
  const sixHundredB = skill.id === '600b';
  const sixHundredBWaveBonus = sixHundredB && !bossWave && wave >= 3 ? 1 : 0;
  const spawnLeft = Math.max(1, Math.round(spawnBase * skill.spawnScale * bossSpawnTrim + sixHundredBWaveBonus));
  const earlyInitial = EARLY_WAVE_INITIAL_SPAWN[wave];
  const initialBase = bossWave ? 2.65 : earlyInitial ?? 1.18;
  const initialSpawn = sixHundredB
    ? Math.max(wave === 1 ? 0.62 : 0.78, initialBase * (bossWave ? 0.9 : 0.84))
    : initialBase;
  const earlyGrace = EARLY_WAVE_GRACE[wave];
  const waveGraceBase = earlyGrace ?? (bossWave ? 3.7 : 2.35);
  const waveGrace = sixHundredB
    ? Math.max(wave === 1 ? 1.35 : 1.55, waveGraceBase * (bossWave ? 0.92 : 0.86))
    : waveGraceBase;
  const earlyBaiter = EARLY_WAVE_BAITER[wave];
  const baiterBase = (earlyBaiter ?? Math.max(12.8, 18.8 - wave * 0.34)) + (bossWave ? 4 : 0);
  const nextBaiter = sixHundredB ? Math.max(10.2, baiterBase - (wave <= 2 ? 0.7 : 1.25)) : baiterBase;
  return { spawnLeft, initialSpawn, waveGrace, nextBaiter };
}

function lateWaveSpawnBase(wave: number, bossWave: boolean): number {
  const ramp = Math.max(0, wave - 6);
  const plateau = 10.8 + Math.min(7.8, ramp * 0.82);
  const marathonEase = wave > 18 ? Math.min(1.4, (wave - 18) * 0.07) : 0;
  return Math.max(8.5, plateau - marathonEase - (bossWave ? 0.8 : 0));
}

function seedDebugCombatScene(): void {
  state.wave = Math.max(state.wave, 4);
  state.waveTimer = 18;
  state.waveGrace = 30;
  state.spawnLeft = 0;
  state.nextSpawn = 99;
  state.nextBaiter = 99;
  state.lowCamp = 0;
  state.enemies = [];
  state.enemyShots = [];
  state.lasers = [];
  state.particles = [];
  state.ship.x = WORLD_W / 2;
  state.ship.y = PLAY_TOP + 285;
  state.ship.vx = 360;
  state.ship.vy = -30;
  state.ship.dir = 1;
  state.ship.heat = 0.22;
  state.ship.cooldown = 0;
  cameraX = state.ship.x;

  const addEnemy = (type: Exclude<EnemyType, 'carrier'>, dx: number, dy: number, vx: number, vy: number): Enemy => {
    spawnEnemy(undefined, type);
    const e = state.enemies[state.enemies.length - 1]!;
    e.x = wrapX(state.ship.x + dx);
    e.y = clamp(state.ship.y + dy, PLAY_TOP + 48, terrainY(e.x) - 70);
    e.vx = vx;
    e.vy = vy;
    e.face = vx >= 0 ? 1 : -1;
    e.turnCue = 0.62;
    e.shotCooldown = 0;
    e.muzzle = 1.15;
    e.age = 2.5;
    return e;
  };

  const hunter = addEnemy('hunter', 470, -42, -180, 18);
  const jammer = addEnemy('jammer', -410, -92, 150, 32);
  const abductor = addEnemy('abductor', 230, 178, -105, -24);
  abductor.captureCharge = 0.06;
  const spammer = addEnemy('spammer', -235, -168, 120, 8);
  const sybil = addEnemy('sybil', 560, 66, -90, -12);
  const sybilShard = addEnemy('sybil', 505, 148, -160, 20);
  sybilShard.hp = 1;
  sybilShard.maxHp = 1;
  const troll = addEnemy('troll', 680, -120, -120, 10);
  troll.phase = 0.6; // mid-feed so the combat scene shows the FEEDING tell
  troll.intent = 0.9;
  // Hold fire in ?combat to see the triple beam. Seeded long so staged
  // screenshot sessions don't outlive it between captures.
  state.fanout = 30;
  const forgery = addEnemy('forgery', -560, 30, 150, -8);
  const donor = state.signals.find(s => profilePictureCandidates(signalAvatarPicture(s)).length > 0) ?? state.signals[0];
  if (donor) {
    forgery.forgedName = savedCalloutName(donor);
    forgery.forgedPicture = signalAvatarPicture(donor);
    forgery.forgedMember = isSixHundredMember(donor.pubkey);
    if (forgery.forgedMember) {
      forgery.hp = 3;
      forgery.maxHp = 3;
    }
  }
  fireEnemyShot(hunter, 'dart');
  fireEnemyShot(jammer, 'jam');
  fireEnemyShot(abductor, 'dart');
  dropSpamMine(spammer);
  sybil.intent = 0.5;

  spawnCarrier();
  const carrier = state.enemies.find(e => e.type === 'carrier');
  if (carrier) {
    carrier.x = wrapX(state.ship.x - 660);
    carrier.y = PLAY_TOP + 135;
    carrier.vx = 100;
    carrier.vy = 16;
    carrier.face = 1;
    carrier.turnCue = 0.5;
    carrier.muzzle = 1.25;
    carrier.hp = Math.max(1, Math.floor(carrier.maxHp * 0.42));
    fireCarrierBarrage(carrier);
    carrier.captureCharge = 99;
  }

  state.lasers.push({
    x: wrapX(state.ship.x + state.ship.dir * 45),
    y: state.ship.y,
    dir: state.ship.dir,
    ttl: LASER_TTL,
    length: tunedLaserLength() * 0.9,
    heat: state.ship.heat,
    impact: false,
    impactX: wrapX(state.ship.x + state.ship.dir * tunedLaserLength() * 0.9),
    impactY: state.ship.y,
  });
  state.beacons.push({
    x: wrapX(state.ship.x + 260),
    y: state.ship.y - 48,
    ttl: 60,
    age: 0,
    value: 2,
    kind: 'cake-piece',
    spriteIndex: 2,
  });
  state.beacons.push({
    x: wrapX(state.ship.x - 300),
    y: state.ship.y - 96,
    ttl: 60,
    age: 0,
    value: 2,
    kind: 'zap',
    spriteIndex: 0,
  });
  state.beacons.push({
    x: wrapX(state.ship.x + 96),
    y: state.ship.y - 196,
    ttl: 60,
    age: 0,
    value: 2,
    kind: 'net',
    spriteIndex: 0,
  });
  state.beacons.push({
    x: wrapX(state.ship.x - 180),
    y: state.ship.y - 150,
    ttl: 60,
    age: 0,
    value: 2,
    kind: 'rose',
    spriteIndex: 0,
  });
  state.beacons.push({
    x: wrapX(state.ship.x + 420),
    y: state.ship.y - 120,
    ttl: 60,
    age: 0,
    value: 3,
    kind: '600b',
    spriteIndex: 0,
  });
  state.beacons.push({
    x: wrapX(state.ship.x - 420),
    y: state.ship.y - 60,
    ttl: 60,
    age: 0,
    value: 2,
    kind: 'shield',
    spriteIndex: 0,
  });
  state.beacons.push({
    x: wrapX(state.ship.x + 560),
    y: state.ship.y - 170,
    ttl: 60,
    age: 0,
    value: 2,
    kind: 'cult',
    spriteIndex: 0,
  });
  state.beacons.push({
    x: wrapX(state.ship.x + 230),
    y: state.ship.y - 235,
    ttl: 60,
    age: 0,
    value: 2,
    kind: 'fourtwenty',
    spriteIndex: 0,
  });
  state.beacons.push({
    x: wrapX(state.ship.x - 300),
    y: state.ship.y - 250,
    ttl: 60,
    age: 0,
    value: 2,
    kind: 'scooter',
    spriteIndex: 0,
  });
  state.beacons.push({
    x: wrapX(state.ship.x - 120),
    y: state.ship.y - 240,
    ttl: 60,
    age: 0,
    value: 3,
    kind: 'whole-cake',
    spriteIndex: 0,
  });
  state.beacons.push({
    x: wrapX(state.ship.x - 480),
    y: state.ship.y - 190,
    ttl: 60,
    age: 0,
    value: 2,
    kind: 'multi',
    spriteIndex: 0,
  });
  state.beacons.push({
    x: wrapX(state.ship.x + 360),
    y: state.ship.y - 250,
    ttl: 60,
    age: 0,
    value: 2,
    kind: 'timelock',
    spriteIndex: 0,
  });
  spawnDetailedExplosion(wrapX(state.ship.x + 530), state.ship.y - 18, ['#ff8a3a', '#ffd84a', '#fff5d8', '#5effdb'], 0.82, -80, 24);
  state.message = 'COMBAT VISUAL TEST';
  state.messageUntil = 1.2;
  state.threatPulse = 0.72;
}

// ?fxlab: fires one arcade effect at a time, cycling through the sequence
// below, for a deterministic look/listen pass. Classic lost the FX audit
// (2026-07-03) so this no longer compares it side by side with arcade.
// Calling window.neonSentinelFxLabFire(key) stops the auto-cycle for
// deterministic captures.
const FX_LAB_SEQUENCE: ReadonlyArray<{ key: FxLabKey; label: string }> = [
  { key: 'shoot', label: 'PLAYER SHOT' },
  { key: 'pickup', label: 'SATS PICKUP' },
  { key: 'pickup-big', label: '1UP PICKUP' },
  { key: 'pickup-rose', label: 'ROSE PICKUP (600B)' },
  { key: 'pickup-cult', label: 'CULT PICKUP (600B)' },
  { key: 'pickup-420', label: '4:20 PICKUP' },
  { key: 'pickup-scooter', label: 'DNI SCOOTER (600B)' },
  { key: 'pickup-600b', label: '600B MEDALLION BARK' },
  { key: 'pickup-multi', label: 'FANOUT PICKUP' },
  { key: 'pickup-timelock', label: 'TIME LOCKED TRAP' },
  { key: 'troll-feed', label: 'TROLL FEED (DONKEY)' },
  { key: 'troll-feed-2', label: 'TROLL FEED (2ND WARNING)' },
  { key: 'troll-feed-3', label: 'TROLL FEED (3RD+ WARNING)' },
  { key: 'kill-hunter', label: 'HUNTER KILL' },
  { key: 'kill-carrier', label: 'CARRIER KILL' },
];
let fxLabIndex = -1;
let fxLabTimer = 0.9;
let fxLabAuto = true;
// The cue drives the highlight box around the station while its sound plays.
// The auto-cycle holds until the browser lets audio start (first key/click),
// so the lab never silently cycles through mute captures.
let fxLabCue: { ttl: number } | null = null;
// Cycles through the medallion's bark pool each time the station fires, so a
// deterministic capture session hears all four instead of one random pick.
let fxLabSixHundredBIndex = 0;
// The shoot station fires a short held-fire burst rather than a single pew,
// because the whole point of the arcade shot is how it reads at fire rate.
let fxLabShotBurst: { left: number; timer: number } | null = null;

function fxLabStationY(x: number): number {
  return Math.min(PLAY_TOP + 250, terrainY(x) - 170);
}

function fxLabStationX(): number {
  return wrapX(state.ship.x);
}

function fxLabFireSide(key: FxLabKey): void {
  const idx = FX_LAB_SEQUENCE.findIndex(s => s.key === key);
  if (idx >= 0) fxLabIndex = idx;
  const x = fxLabStationX();
  const y = fxLabStationY(x);
  if (key === 'shoot') {
    fxLabShotBurst = { left: 4, timer: 0 };
    spawnText(x, y - 46, 'ARCADE SHOT', '#ffd84a');
  } else if (key === 'pickup') {
    spawnPickupFx(x, y, '#ffd84a', false);
    spawnText(x, y - 46, '+600', '#ffd84a');
    playAudio('pickupArcade', 1.6);
  } else if (key === 'pickup-big') {
    spawnPickupFx(x, y, '#8cffb4', true);
    spawnText(x, y - 46, '1UP', '#8cffb4');
    playAudio('oneUp', 1.4);
  } else if (key === 'pickup-rose') {
    spawnPickupFx(x, y, '#ff4d8d', false);
    playAudio('pickupShield', 1.6);
    playVoiceClip(ROSE_VOICE_URL, 1.15);
    spawnVoiceLine(x, y - 46, 'WANT ROSE, FREN?', '#ff4d8d');
  } else if (key === 'pickup-cult') {
    spawnPickupFx(x, y, '#c58bff', false);
    playAudio('pickupCult', 1.4);
    playVoiceClip(CULT_VOICE_URL, 1.15);
    spawnVoiceLine(x, y - 46, 'WE ARE NOT A CULT!', '#c58bff');
  } else if (key === 'pickup-420') {
    spawnPickupFx(x, y, '#8cff5a', false);
    playAudio('pickupFourTwenty', 1.5);
    playVoiceClip(FOURTWENTY_VOICE_URL, 1.15);
    spawnVoiceLine(x, y - 46, "IT'S 4:20 SOMEWHERE", '#8cff5a');
  } else if (key === 'pickup-scooter') {
    spawnPickupFx(x, y, '#7dcfff', false);
    // The lab always demos the accident outcome — it's the one with the voice.
    playAudio('pickupScooter', 1.5);
    playVoiceClip(SCOOTER_ACCIDENT_VOICE_URL, 1.15);
    spawnVoiceLine(x, y - 46, 'GET WELL SOON, DNI', '#7dcfff');
  } else if (key === 'pickup-600b') {
    spawnPickupFx(x, y, '#ffd84a', false);
    const line = SIX_HUNDRED_B_VOICE_LINES[fxLabSixHundredBIndex % SIX_HUNDRED_B_VOICE_LINES.length]!;
    fxLabSixHundredBIndex += 1;
    playAudio('pickupJackpot', 1.6);
    playVoiceClip(line.url, 1.15);
    spawnVoiceLine(x, y - 46, line.caption, '#ffd84a');
  } else if (key === 'pickup-multi') {
    spawnPickupFx(x, y, '#ffb03a', false);
    spawnText(x, y - 46, 'FANOUT x3', '#ffb03a');
    playAudio('pickupMulti', 1.5);
  } else if (key === 'pickup-timelock') {
    spawnPickupFx(x, y, '#ff4d5e', false);
    spawnShockwave(x, y, '#ff4d5e', 96, 0.26);
    playAudio('pickupTimeLock', 1.5);
    playVoiceClip(TIMELOCK_VOICE_URL, 1.15);
    spawnVoiceLine(x, y - 46, 'TIME LOCKED!', '#ff4d5e');
  } else if (key === 'troll-feed') {
    spawnBurst(x, y, enemyColour('troll'), 8, 90);
    playAudio('trollFeed', 1.1);
    playVoiceClip(TROLL_FEED_VOICE_URL, 1.15);
    spawnVoiceLine(x, y - 46, "DON'T FEED THE DONKEY!", '#96ff3c');
  } else if (key === 'troll-feed-2') {
    spawnBurst(x, y, enemyColour('troll'), 8, 90);
    playAudio('trollFeed', 1.1);
    playVoiceClip(TROLL_FEED_VOICE_URL_2, 1.15);
    spawnVoiceLine(x, y - 46, "I SAID, DON'T FEED IT!", '#96ff3c');
  } else if (key === 'troll-feed-3') {
    spawnBurst(x, y, enemyColour('troll'), 8, 90);
    playAudio('trollFeed', 1.1);
    playVoiceClip(TROLL_FEED_VOICE_URL_3, 1.15);
    spawnVoiceLine(x, y - 46, 'NO MORE DONKEY FOR YOU!', '#96ff3c');
  } else if (key === 'kill-hunter') {
    spawnEnemyKillFx(x, y, 120, -30, 'hunter');
    spawnText(x, y - 24, '+760', enemyColour('hunter'));
    playAudio('enemyBoomArcade', 1.08);
  } else {
    spawnEnemyKillFx(x, y, 40, 0, 'carrier');
    spawnText(x, y - 24, '+5200', '#ffd84a');
    playAudio('boomArcade', 1.45);
  }
  fxLabCue = { ttl: 1.35 };
}

// One demo shot for the shoot station: a real beam pushed into state.lasers
// (so both render tiers draw it exactly as in-game), muzzle flash and shot
// audio, and an impact pop on the burst's final round.
function fxLabFireShot(index: number, impact: boolean): void {
  const dir = 1;
  const x = fxLabStationX();
  const y = fxLabStationY(x);
  const heat = index * 0.16;
  const length = 210;
  const impactX = wrapX(x + dir * (10 + length));
  state.lasers.push({
    x: wrapX(x + dir * 10),
    y,
    dir,
    ttl: LASER_TTL,
    length,
    heat,
    impact,
    impactX,
    impactY: y,
  });
  spawnPlayerMuzzleFlashAt(wrapX(x + dir * 12), y, dir, heat);
  playAudio('laserArcade', impact ? 1.2 : 0.85, index % 2 === 0 ? 1 : 1.06);
  if (impact) playAudio('laserThump', 1);
  if (impact) {
    spawnExplosionFlash(impactX, y, '#5effdb', 44, 0.1);
    spawnShockwave(impactX, y, '#5effdb', 34, 0.14);
  }
}

function fxLabFire(key: FxLabKey): void {
  if (key === 'pickup-rose') preloadVoiceClip(ROSE_VOICE_URL);
  if (key === 'pickup-cult') preloadVoiceClip(CULT_VOICE_URL);
  if (key === 'pickup-420') preloadVoiceClip(FOURTWENTY_VOICE_URL);
  if (key === 'pickup-scooter') preloadVoiceClip(SCOOTER_ACCIDENT_VOICE_URL);
  if (key === 'pickup-timelock') preloadVoiceClip(TIMELOCK_VOICE_URL);
  if (key === 'pickup-600b') for (const line of SIX_HUNDRED_B_VOICE_LINES) preloadVoiceClip(line.url);
  if (key === 'troll-feed') preloadVoiceClip(TROLL_FEED_VOICE_URL);
  if (key === 'troll-feed-2') preloadVoiceClip(TROLL_FEED_VOICE_URL_2);
  if (key === 'troll-feed-3') preloadVoiceClip(TROLL_FEED_VOICE_URL_3);
  fxLabFireSide(key);
}

function updateFxLab(dt: number): void {
  state.enemies.length = 0;
  state.enemyShots.length = 0;
  state.beacons.length = 0;
  state.spawnLeft = 0;
  state.ship.invuln = Math.max(state.ship.invuln, 1.2);
  if (fxLabCue) {
    fxLabCue.ttl -= dt;
    if (fxLabCue.ttl <= 0) fxLabCue = null;
  }
  if (fxLabShotBurst) {
    fxLabShotBurst.timer -= dt;
    if (fxLabShotBurst.timer <= 0) {
      fxLabShotBurst.left -= 1;
      fxLabFireShot(3 - fxLabShotBurst.left, fxLabShotBurst.left === 0);
      fxLabShotBurst.timer = 0.13;
      if (fxLabShotBurst.left <= 0) fxLabShotBurst = null;
    }
  }
  if (!fxLabAuto || !isAudioUnlocked()) return;
  fxLabTimer -= dt;
  if (fxLabTimer <= 0) {
    fxLabTimer = 2.2;
    const next = FX_LAB_SEQUENCE[(fxLabIndex + 1) % FX_LAB_SEQUENCE.length]!;
    fxLabFire(next.key);
  }
}

function drawFxLabOverlay(): void {
  const active = FX_LAB_SEQUENCE[Math.max(0, fxLabIndex)] ?? FX_LAB_SEQUENCE[0]!;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.shadowColor = '#04101c';
  ctx.shadowBlur = 8;
  ctx.font = `900 20px ${FONT_MONO}`;
  ctx.fillStyle = '#fff5d8';
  ctx.fillText(`FX LAB — ${active.label}`, VIEW_W / 2, PLAY_TOP + 46);
  if (!isAudioUnlocked()) {
    ctx.fillStyle = '#ffd84a';
    ctx.font = `900 16px ${FONT_MONO}`;
    ctx.fillText('PRESS ANY KEY TO ENABLE SOUND — THE LAB STARTS WITH AUDIO ON', VIEW_W / 2, PLAY_TOP + 84);
  } else if (isMuted() || getSfxVolume() <= 0) {
    ctx.fillStyle = '#ff4d5e';
    ctx.font = `900 16px ${FONT_MONO}`;
    ctx.fillText('SFX MUTED — PRESS M OR RAISE SFX IN THE AUDIO PANEL', VIEW_W / 2, PLAY_TOP + 84);
  }
  if (fxLabCue) {
    const cueWorldX = fxLabStationX();
    const cx = screenX(cueWorldX);
    const cy = fxLabStationY(cueWorldX) - 10;
    const pulse = 0.55 + 0.45 * Math.min(1, fxLabCue.ttl / 1.35);
    ctx.strokeStyle = `rgba(255,216,74,${pulse.toFixed(3)})`;
    ctx.lineWidth = 3;
    ctx.strokeRect(cx - 200, cy - 150, 400, 300);
    ctx.fillStyle = '#ffd84a';
    ctx.font = `900 14px ${FONT_MONO}`;
    ctx.fillText('♪ PLAYING', cx, cy + 172);
  }
  ctx.restore();
}

// Hitstop: a micro freeze-frame on impactful hits — the sim holds for a few
// milliseconds while the screen keeps shaking, so a kill lands with real
// weight instead of vanishing in a frame. Capped tight so the game never feels
// laggy; suppressed for the attract bot, the FX lab, and reduced-effects users.
const MAX_HITSTOP = 0.11;

function addHitstop(seconds: number): void {
  if (seconds <= 0 || state.demo || DEBUG_FXLAB || getReducedEffects()) return;
  state.hitstop = Math.min(MAX_HITSTOP, Math.max(state.hitstop, seconds));
}

function loop(now: number): void {
  const rawMs = now - lastT;
  const dt = Math.min(MAX_DT, rawMs / 1000);
  lastT = now;
  sampleFramePerf(rawMs);
  pollGamepads();
  // Freeze-frame: hold the simulation but keep painting (the shake oscillation
  // still advances with `now`, so the frozen frame visibly punches). Skipping
  // the accumulator entirely means the sim resumes cleanly with no catch-up
  // fast-forward, and no rand()/update calls run — daily determinism intact.
  if (state.hitstop > 0 && state.phase === 'playing') {
    state.hitstop = Math.max(0, state.hitstop - dt);
    render(now / 1000);
    requestAnimationFrame(loop);
    return;
  }
  acc += dt;
  while (acc >= STEP) {
    captureInterpolationSnapshot();
    update(STEP);
    acc -= STEP;
  }
  syncMusicToState();
  renderAlpha = clamp(acc / STEP, 0, 1);
  render(now / 1000);
  requestAnimationFrame(loop);
}

// Adaptive render quality: demote quickly when sustained frame time misses
// ~52fps, promote cautiously after a long healthy stretch. Coarse-pointer or
// low-core devices start on the low tier rather than waiting for a stutter.
const QUALITY_SLOW_MS = 19;
const QUALITY_FAST_MS = 17;
const COARSE_POINTER = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
let frameEmaMs = 16.7;
let slowStreakMs = 0;
let fastStreakMs = 0;
let qualityDemotions = 0;
let renderQualityLow = COARSE_POINTER || (navigator.hardwareConcurrency ?? 8) <= 4;

function sampleFramePerf(rawMs: number): void {
  if (!Number.isFinite(rawMs) || rawMs <= 0 || rawMs > 250) return;
  frameEmaMs += (rawMs - frameEmaMs) * 0.08;
  if (!renderQualityLow && frameEmaMs > QUALITY_SLOW_MS) {
    slowStreakMs += rawMs;
    if (slowStreakMs > 1600) {
      renderQualityLow = true;
      qualityDemotions += 1;
      slowStreakMs = 0;
      fastStreakMs = 0;
    }
  } else {
    slowStreakMs = Math.max(0, slowStreakMs - rawMs * 0.5);
  }
  if (renderQualityLow && qualityDemotions < 2 && frameEmaMs < QUALITY_FAST_MS) {
    fastStreakMs += rawMs;
    if (fastStreakMs > 10_000) {
      renderQualityLow = false;
      fastStreakMs = 0;
    }
  } else if (renderQualityLow) {
    fastStreakMs = 0;
  }
}

// Motion interpolation between fixed sim steps. Before each step every moving
// entity snapshots its position into px/py; at render time positions are
// swapped to the interpolated point and restored afterwards, so no draw call
// needs to know interpolation exists. X interpolates across the world wrap.
interface InterpolableEntity {
  x: number;
  y: number;
  px?: number;
  py?: number;
}

let prevCameraX = 0;
let interpCameraSaved = 0;
let interpActive = false;
let interpCount = 0;
const interpRefs: InterpolableEntity[] = [];
const interpSavedX: number[] = [];
const interpSavedY: number[] = [];

function snapshotEntity(e: InterpolableEntity): void {
  e.px = e.x;
  e.py = e.y;
}

function captureInterpolationSnapshot(): void {
  prevCameraX = cameraX;
  snapshotEntity(state.ship);
  for (const e of state.enemies) snapshotEntity(e);
  for (const e of state.enemyShots) snapshotEntity(e);
  for (const e of state.lasers) snapshotEntity(e);
  for (const e of state.signals) snapshotEntity(e);
  for (const e of state.beacons) snapshotEntity(e);
  for (const e of state.particles) snapshotEntity(e);
}

function interpSwap(e: InterpolableEntity, alpha: number): void {
  const px = e.px;
  const py = e.py;
  if (px === undefined || py === undefined) return;
  const nx = wrapX(px + wrapDelta(e.x, px) * alpha);
  const ny = py + (e.y - py) * alpha;
  if (interpCount < interpRefs.length) {
    interpRefs[interpCount] = e;
    interpSavedX[interpCount] = e.x;
    interpSavedY[interpCount] = e.y;
  } else {
    interpRefs.push(e);
    interpSavedX.push(e.x);
    interpSavedY.push(e.y);
  }
  interpCount += 1;
  e.x = nx;
  e.y = ny;
}

function beginInterpolatedRender(alpha: number): void {
  interpActive = false;
  if (alpha >= 0.999) return;
  interpCount = 0;
  interpSwap(state.ship, alpha);
  for (const e of state.enemies) interpSwap(e, alpha);
  for (const e of state.enemyShots) interpSwap(e, alpha);
  for (const e of state.lasers) interpSwap(e, alpha);
  for (const e of state.signals) interpSwap(e, alpha);
  for (const e of state.beacons) interpSwap(e, alpha);
  for (const e of state.particles) interpSwap(e, alpha);
  interpCameraSaved = cameraX;
  cameraX = lerpWrap(prevCameraX, cameraX, alpha);
  interpActive = true;
}

function endInterpolatedRender(): void {
  if (!interpActive) return;
  for (let i = 0; i < interpCount; i += 1) {
    const e = interpRefs[i]!;
    e.x = interpSavedX[i]!;
    e.y = interpSavedY[i]!;
  }
  interpCount = 0;
  cameraX = interpCameraSaved;
  interpActive = false;
}

function syncMusicToState(): void {
  if (DEBUG_FXLAB) {
    // The lab is for judging SFX A/B by ear; keep the soundtrack out of it.
    musicStop(120);
    refreshMusicPanel?.();
    return;
  }
  musicSetTrackForState({
    phase: state.phase,
    wave: state.wave,
    intensity: waveMusicIntensity(),
    shipClass: state.shipClass,
    skill: state.skill,
  });
  refreshMusicPanel?.();
}

function waveMusicIntensity(): number {
  if (state.phase !== 'playing') return 0;
  const enemies = state.enemies.filter(e => e.alive && e.type !== 'carrier').length;
  const carrier = activeCarrier();
  const urgent = mostUrgentSignal();
  const urgency = urgent ? signalUrgency(urgent) : 0;
  const shots = state.enemyShots.length;
  const lowCamp = clamp(state.lowCamp / 2.4, 0, 1);
  const waveLift = clamp((state.wave - 1) / 10, 0, 0.28);
  const boss = carrier ? 0.28 + clamp(1 - carrier.hp / Math.max(1, carrier.maxHp), 0, 1) * 0.18 : 0;
  return clamp(enemies * 0.055 + shots * 0.035 + urgency * 0.09 + lowCamp * 0.12 + waveLift + boss, 0, 1);
}

function update(dt: number): void {
  if (state.phase === 'paused') {
    updateAudio({ playing: false, speed: 0, thrust: 0, capture: 0, danger: 0, heat: 0 });
    return;
  }

  if (state.phase !== 'playing') {
    if (state.phase === 'gameover') {
      updateGameOverEffects(dt);
      if (gameOverStage === 'score' && (consume('KeyS') || consume('KeyP'))) void claimAndPublishLastScore();
      // Brief input guard so a panic tap at the moment of death does not
      // instantly relaunch a run before the player has seen their score.
      if (Date.now() - state.finishedAt < 900) {
        consumeStart();
        consume('Escape');
        consume('KeyQ');
        consume('Backspace');
        consume('KeyV');
        consume('KeyR');
      } else if (gameOverStage === 'name') {
        // Typing is handled by the capture-phase keydown listener; swallow
        // anything buffered so nothing leaks into retry or menu actions.
        consumeStart();
        consume('Escape');
        consume('KeyQ');
        consume('Backspace');
        consume('KeyV');
        consume('KeyR');
      } else if (consume('KeyR')) {
        // Instant restart: one key from corpse to cockpit, skipping the
        // ceremony. Nostr claims already published in the background; a guest
        // bypassing name entry keeps the score local, same as SKIP.
        retryRunFromGameOver();
      } else if (gameOverStage === 'support') {
        if (consumeStart() || consume('Escape') || consume('KeyV') || consume('KeyQ') || consume('Backspace')) {
          advanceGameOverSupport();
        }
      } else if (gameOverSupportOpen) {
        if (consumeStart() || consume('Escape') || consume('KeyV') || consume('KeyQ') || consume('Backspace')) {
          gameOverSupportOpen = false;
        }
      } else if (consume('KeyV')) {
        openGameOverSupport();
      } else if (consumeStart()) {
        retryRunFromGameOver();
      } else if (consume('Escape') || consume('KeyQ') || consume('Backspace')) {
        returnGameOverToTitle();
      }
    } else if (state.phase === 'title') {
      if (consumeStart()) void startGuestRunFromTitle();
      else if (!titleStartInFlight && !titlePaymentModalOpen && performance.now() - titleIdleAt > ATTRACT_DELAY_MS) {
        startAttractRun();
      }
    } else if (consumeStart()) startRun();
    updateAudio({ playing: false, speed: 0, thrust: 0, capture: 0, danger: 0, heat: 0 });
    return;
  }

  // Demo runs are strictly bounded: exit on timeout, and never linger on a
  // game-over screen (scheduleGameOverAfterExplosion exits directly too).
  if (state.demo && state.trace.elapsed > ATTRACT_RUN_SECONDS) {
    exitAttractRun();
    return;
  }

  const simDt = dt * getTuning().pace * viewportPaceMultiplier();
  if (state.shipDestroyed) {
    updateGameOverEffects(simDt);
    updateAudio({ playing: false, speed: 0, thrust: 0, capture: 0, danger: 1, heat: 1 });
    return;
  }
  state.messageUntil -= simDt;
  state.shake = Math.max(0, state.shake - simDt * 2.4);
  state.flash = Math.max(0, state.flash - simDt * 3.4);
  state.threatPulse = Math.max(0, state.threatPulse - simDt * 2.8);
  state.damageCue = Math.max(0, state.damageCue - simDt * 2.6);
  state.jamCue = Math.max(0, state.jamCue - simDt * 2.4);
  state.lowAltitudeWarning = Math.max(0, state.lowAltitudeWarning - simDt * 1.85);
  state.trace.elapsed += simDt;
  state.trace.heatPeak = Math.max(state.trace.heatPeak, state.ship.heat);
  // The run clock: time is the resource. It drains in real time and reaching
  // zero is TIME LOCKED — the run's only self-inflicted end. (Hitstop already
  // freezes the whole sim, so the clock naturally pauses on impact frames.)
  state.timePop = Math.max(0, state.timePop - simDt * 3);
  state.timeLeft = Math.max(0, state.timeLeft - simDt);
  if (state.timeLeft <= 0) {
    killShip('time-lock');
    return;
  }
  if (state.comboUntil > 0) {
    state.comboUntil -= simDt;
    if (state.comboUntil <= 0) {
      state.combo = 0;
      state.comboCalled = 0;
    }
  }
  maybeAwardExtend();
  updateRivalChase();
  state.waveGrace = Math.max(0, state.waveGrace - simDt);
  state.scoreSurge = Math.max(0, state.scoreSurge - simDt);
  // Score-punch: when a meaningful chunk of points lands (a rescue, a carrier,
  // a milestone), pulse the SCORE readout so the number itself reacts. Driven
  // by the frame-to-frame delta so it catches every score site for free.
  state.scorePop = Math.max(0, state.scorePop - simDt * 3.2);
  const scoreDelta = state.score - hudScoreRef;
  hudScoreRef = state.score;
  if (scoreDelta > 300) {
    state.scorePop = Math.min(1, Math.max(state.scorePop, 0.34 + Math.min(0.62, Math.log10(scoreDelta / 300) * 0.55)));
  }
  state.chill = Math.max(0, state.chill - simDt);
  state.timeLock = Math.max(0, state.timeLock - simDt);
  if (state.timeLock > 0 && rand() < simDt * 7) {
    spawnRing(state.ship.x, state.ship.y, '#ff4d5e', 44 + rand() * 26);
  }
  state.fanout = Math.max(0, state.fanout - simDt);
  state.rescueNet = Math.max(0, state.rescueNet - simDt);
  if (state.rescueNet > 0 && rand() < simDt * 6) {
    spawnRing(state.ship.x, state.ship.y, '#8cffb4', 52 + rand() * 22);
  }

  if (state.wave === 1 && !(hintMoved && hintFired)) {
    if (
      keys.has('ArrowLeft') || keys.has('ArrowRight') || keys.has('ArrowUp') || keys.has('ArrowDown') ||
      keys.has('KeyA') || keys.has('KeyD') || keys.has('KeyW') || keys.has('KeyS') ||
      Math.abs(touch.x) > 0.2 || Math.abs(touch.y) > 0.2 ||
      Math.abs(gamepadInput.x) > 0.2 || Math.abs(gamepadInput.y) > 0.2
    ) hintMoved = true;
    if (keys.has('Space') || keys.has('KeyJ') || touch.fire || gamepadInput.fire) hintFired = true;
  }
  updateShip(simDt);
  if (!DEBUG_FXLAB) updatePressure(simDt);
  updateLasers(simDt);
  const chillScale = state.chill > 0 ? 0.55 : 1;
  updateEnemies(simDt * chillScale);
  updateEnemyShots(simDt * chillScale);
  updateSignals(simDt);
  updateBeacons(simDt);
  updateParticles(simDt);
  if (DEBUG_FXLAB) {
    updateFxLab(simDt);
  } else {
    maybeSpawnEnemy(simDt);
    maybeAdvanceWave(simDt);
  }
  updateArcadeAudio();
}

function updateGameOverEffects(dt: number): void {
  state.shake = Math.max(0, state.shake - dt * 1.35);
  state.flash = Math.max(0, state.flash - dt * 1.55);
  state.damageCue = Math.max(0, state.damageCue - dt * 1.4);
  state.jamCue = Math.max(0, state.jamCue - dt * 1.4);
  state.lowAltitudeWarning = Math.max(0, state.lowAltitudeWarning - dt * 1.2);
  updateParticles(dt);
}

function updateShip(dt: number): void {
  const ship = state.ship;
  if (state.timeLock > 0) {
    // TIME LOCKED: the ship is frozen solid — no input, no thrust, no fire.
    // Timers still tick so the lock never extends any other cooldown.
    ship.vx = 0;
    ship.vy = 0;
    ship.cooldown = Math.max(0, ship.cooldown - dt);
    ship.invuln = Math.max(0, ship.invuln - dt);
    ship.turnCue = Math.max(0, ship.turnCue - dt * 4.6);
    ship.heat = Math.max(0, ship.heat - dt * 1.82);
    return;
  }
  const spec = shipSpec(state.shipClass);
  const tuning = getTuning();
  const viewport = visibleCanvasRect();
  const feel = shipViewportFeel(viewport);
  if (state.demo) updateAttractBot();
  const firing = state.demo ? attractBot.fire : keys.has('Space') || keys.has('KeyJ') || touch.fire || gamepadInput.fire;
  const hx = state.demo ? attractBot.x : axis('ArrowRight', 'KeyD') - axis('ArrowLeft', 'KeyA') + touch.x * feel.touchMul + gamepadInput.x;
  const hy = state.demo ? attractBot.y : axis('ArrowDown', 'KeyS') - axis('ArrowUp', 'KeyW') + touch.y * (feel.touchMul + 0.04) + gamepadInput.y;
  const nx = clamp(hx, -1, 1);
  const ny = clamp(hy, -1, 1) * (Math.abs(hx) > 0.72 && Math.abs(hy) > 0.04 ? 0.92 : 1);

  const thrustingX = Math.abs(nx) > 0.04;
  if (thrustingX) {
    const desiredDir: -1 | 1 = nx >= 0 ? 1 : -1;
    const directionFlip = desiredDir !== ship.dir;
    const reversing = Math.sign(nx) !== Math.sign(ship.vx) && Math.abs(ship.vx) > 45;
    if (directionFlip) {
      const load = clamp(Math.abs(ship.vx) / Math.max(1, spec.maxX), 0.22, 1);
      state.trace.turnEvents += 1;
      ship.turnCue = Math.max(ship.turnCue, 0.42 + load * 0.58);
      state.shake = Math.max(state.shake, 0.035 + load * 0.035);
      spawnTrail(ship.x - ship.dir * 18, ship.y, '#5effdb', load > 0.55 ? 3 : 2);
    }
    ship.dir = desiredDir;
    ship.vx += nx * (reversing ? spec.reverseX * tuning.shipReverse : spec.accelX * tuning.shipAccel) * dt;
    if (reversing) {
      const reverseLoad = clamp(Math.abs(ship.vx) / Math.max(1, spec.maxX), 0, 1);
      const reverseBrake = (6.3 + reverseLoad * 7.1) * feel.reverseBrake;
      ship.vx *= Math.exp(-reverseBrake * dt);
      ship.vx += nx * spec.accelX * tuning.shipAccel * (0.24 + reverseLoad * 0.2) * dt;
      ship.vy *= Math.exp(-(0.32 + reverseLoad * 0.34) * dt);
    }
  }
  if (Math.abs(ny) > 0.04) {
    const yReverse = Math.sign(ny) !== Math.sign(ship.vy) && Math.abs(ship.vy) > 34;
    ship.vy += ny * spec.accelY * tuning.shipAccel * feel.yAccel * (yReverse ? 1.18 : 1) * dt;
  }

  ship.vx *= Math.exp(-(thrustingX ? THRUST_DRAG_X : COAST_DRAG_X) * tuning.shipDrag * feel.xDrag * dt);
  ship.vy *= Math.exp(-DRAG_Y * tuning.shipDrag * feel.yDrag * dt);
  ship.vx = clamp(ship.vx, -spec.maxX * feel.maxX, spec.maxX * feel.maxX);
  ship.vy = clamp(ship.vy, -spec.maxY * feel.maxY, spec.maxY * feel.maxY);

  ship.x = wrapX(ship.x + ship.vx * dt);
  const floor = terrainY(ship.x) - 58;
  const nextY = ship.y + ship.vy * dt;
  if (nextY < PLAY_TOP + 34) {
    ship.y = PLAY_TOP + 34;
    ship.vy = Math.abs(ship.vy) * 0.12;
  } else if (nextY > floor) {
    ship.y = floor;
    ship.vy = -Math.abs(ship.vy) * 0.08;
    ship.vx *= 0.98;
  } else {
    ship.y = nextY;
  }

  ship.cooldown = Math.max(0, ship.cooldown - dt);
  ship.invuln = Math.max(0, ship.invuln - dt);
  ship.turnCue = Math.max(0, ship.turnCue - dt * 4.6);
  ship.heat = Math.max(0, ship.heat - dt * (firing ? 0.46 : 1.82));

  if (firing && ship.cooldown <= 0) fireLaser();
  if (!state.demo && (consume('KeyX') || consume('KeyK') || consume('ShiftLeft') || consume('ShiftRight'))) smartBurst();

  const lookAhead = clamp(ship.vx * feel.lookAhead, -feel.maxLookAhead, feel.maxLookAhead);
  cameraX = lerpWrap(cameraX, wrapX(ship.x + lookAhead), 1 - Math.pow(feel.cameraLag, dt));
}

function updatePressure(dt: number): void {
  state.waveTimer += dt;
  const ship = state.ship;
  const floor = terrainY(ship.x) - 58;
  const nearFloor = floor - ship.y < 48;
  const firing = state.demo ? attractBot.fire : keys.has('Space') || keys.has('KeyJ') || touch.fire || gamepadInput.fire;
  const grinding = nearFloor && firing && Math.abs(ship.vx) < shipSpec(state.shipClass).maxX * 0.5;
  const activePressure = activePressureEnemyCount();
  const pressureCap = pressureEnemySoftCap();
  if (nearFloor) state.trace.nearGroundSeconds += dt;
  if (grinding) state.trace.lowCampSeconds += dt;
  state.lowCamp = grinding ? state.lowCamp + dt : Math.max(0, state.lowCamp - dt * 1.65);
  state.groundFlakCooldown = Math.max(0, state.groundFlakCooldown - dt);
  const camp = state.lowCamp;
  const skimFiring = state.waveGrace <= 0 && firing && floor - ship.y < 40;
  const flakEnabled = groundFlakEnabled();
  if (skimFiring && flakEnabled) state.lowAltitudeWarning = Math.max(state.lowAltitudeWarning, camp > 0.45 ? 1 : 0.58);

  if (camp > 4.2 && activePressure < pressureCap && state.enemies.filter(e => e.alive && e.type === 'jammer').length < 2) {
    state.lowCamp = 0.65;
    spawnPressureJammer('RADAR JAM');
  } else if (camp > 2.8 && activePressure < pressureCap && state.enemies.filter(e => e.alive && e.type === 'hunter').length < 3) {
    state.lowCamp = 0.35;
    spawnPressureHunter('LOW TRACE');
  }

  if (flakEnabled && skimFiring && camp > 0.62 && state.groundFlakCooldown <= 0) {
    state.groundFlakCooldown = Math.max(1.18, 1.82 - clamp(camp, 0, 2.4) * 0.16);
    spawnGroundFlak(camp);
  }

  if (state.waveTimer > state.nextBaiter && activePressure > 0) {
    state.nextBaiter += nextBaiterDelay();
    if (activePressure >= pressureCap) return;
    spawnPressureHunter('BAITER TRACE');
  }
}

function groundFlakEnabled(): boolean {
  return state.skill === '600b';
}

function activePressureEnemyCount(): number {
  return state.enemies.filter(e => e.alive && e.type !== 'carrier').length;
}

function pressureEnemySoftCap(): number {
  const base = state.skill === 'cadet' ? 4 : state.skill === 'normal' ? 5 : state.wave === 1 ? 6 : 7;
  const waveLift = Math.min(3, Math.floor(Math.max(0, state.wave - 1) / 5));
  return base + waveLift + (activeCarrier() ? 1 : 0);
}

function nextBaiterDelay(): number {
  const skillRoom = state.skill === 'cadet' ? 2.8 : state.skill === 'normal' ? 1.6 : -0.2;
  const waveTrim = Math.min(2.6, state.wave * 0.18);
  return Math.max(state.skill === '600b' ? 6.8 : 7.4, 11.6 - waveTrim + skillRoom + waveOpeningCalm() * 1.6);
}

function updateArcadeAudio(): void {
  const spec = shipSpec(state.shipClass);
  const speed = Math.hypot(state.ship.vx, state.ship.vy);
  const thrust = Math.min(1, Math.abs(state.ship.vx) / Math.max(1, spec.maxX) + Math.abs(state.ship.vy) / Math.max(1, spec.maxY) * 0.45);
  let capture = 0;
  for (const e of state.enemies) {
    if (!e.alive) continue;
    if (e.type !== 'abductor') continue;
    capture = Math.max(capture, e.captureCharge / Math.max(0.1, tunedCaptureLockTime()));
  }
  updateAudio({
    playing: state.phase === 'playing',
    speed,
    thrust,
    capture: clamp(capture, 0, 1),
    danger: state.timeLeft < 12 ? 1 : 0.45 + Math.min(0.55, state.lost / CONTACT_COUNT),
    heat: state.ship.heat,
  });
}

// Fanout beam lanes: the centre line plus two offsets. Side lanes sit wider
// than any non-carrier hit radius so only genuinely separate targets (or a
// fat carrier) catch more than one beam.
const CENTRE_LANE: readonly number[] = [0];
const FANOUT_LANES: readonly number[] = [0, -34, 34];
const FANOUT_DURATION = 8;

function fireLaser(): void {
  const ship = state.ship;
  const nextHeat = clamp(ship.heat + 0.082, 0, 1);
  const laserLength = heatedLaserLength(nextHeat);
  ship.cooldown = shipSpec(state.shipClass).fireInterval * (1 + nextHeat * 0.18);
  ship.heat = nextHeat;
  state.trace.shotsFired += 1;
  state.trace.heatPeak = Math.max(state.trace.heatPeak, nextHeat);
  state.trace.laserLengthMin = Math.min(state.trace.laserLengthMin, laserLength);
  // Each lane scans its own line and skips enemies an earlier lane already
  // hit this trigger, so fanout triples coverage, not single-target damage.
  const lanes = state.fanout > 0 ? FANOUT_LANES : CENTRE_LANE;
  const hitIds = new Set<number>();
  let anyHit = false;
  for (const lane of lanes) {
    const centre = lane === 0;
    const beamLength = centre ? laserLength : laserLength * 0.88;
    const beamY = ship.y + lane;
    let best: Enemy | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestDx = 0;
    for (const e of state.enemies) {
      if (!e.alive || hitIds.has(e.id)) continue;
      const dx = wrapDelta(e.x, ship.x) * ship.dir;
      const dy = Math.abs(e.y - beamY);
      if (dx <= 24 || dx >= beamLength || dy >= laserHitRadius(e)) continue;
      const score = dx - laserPriority(e);
      if (score < bestScore) {
        best = e;
        bestScore = score;
        bestDx = dx;
      }
    }
    const hitLength = best ? clamp(bestDx - 4, 86, beamLength) : beamLength;
    const impactX = best ? best.x : wrapX(ship.x + ship.dir * beamLength);
    const impactY = best ? best.y : beamY;
    state.lasers.push({
      x: wrapX(ship.x + ship.dir * 45),
      y: beamY,
      dir: ship.dir,
      ttl: LASER_TTL * (1 - nextHeat * 0.16),
      length: hitLength,
      heat: nextHeat,
      impact: Boolean(best),
      impactX,
      impactY,
    });
    if (best) {
      hitIds.add(best.id);
      anyHit = true;
      spawnLaserImpact(best, nextHeat);
      hitEnemy(best, laserDamage(best), false);
    } else if (centre && maybeGrazeLaser(ship.x, beamY, ship.dir, beamLength)) {
      state.trace.shotsGrazed += 1;
    }
  }
  if (anyHit) state.trace.shotsHit += 1;
  state.shake = Math.max(state.shake, anyHit ? 0.075 : 0.045);
  spawnTrail(ship.x - ship.dir * 24, ship.y, '#ffd84a', 2);
  spawnPlayerMuzzleFlash(nextHeat);
  // Alternate the pitch a touch so held fire reads as a cadence, not a
  // drone; fanout fire leans a little heavier and switches to a detuned
  // triple-voice pew so the triple-beam actually sounds different, not
  // just louder.
  const weight = state.fanout > 0 ? 1.18 : 1;
  const shotTone = state.fanout > 0 ? 'laserArcadeFanout' : 'laserArcade';
  playAudio(shotTone, (anyHit ? 1.2 : 0.85) * weight, state.trace.shotsFired % 2 === 0 ? 1 : 1.06);
  if (anyHit) playAudio('laserThump', 1);
}

// The firing moment in the vector tier used to be two trail sparks; give it a
// proper cabinet muzzle flash. Counts and ttls stay tiny because this runs at
// full fire rate (~14-19/sec held) — at most a few flashes are alive at once.
function spawnPlayerMuzzleFlash(heat: number): void {
  const ship = state.ship;
  spawnPlayerMuzzleFlashAt(wrapX(ship.x + ship.dir * 48), ship.y, ship.dir, heat);
}

function spawnPlayerMuzzleFlashAt(x: number, y: number, dir: number, heat: number): void {
  const hot = heat > 0.68;
  spawnExplosionFlash(x, y, hot ? '#ff8a3a' : '#5effdb', 20 + heat * 12, 0.055);
  spawnStarFlare(x, y, '#fff5d8', 24 + heat * 14, 0.09, dir * 6);
  spawnSparkleBurst(x, y, [hot ? '#ff8a3a' : '#5effdb', '#fff5d8'], 2, 140);
}

// Enemy fire only ever had the old particle-spray spawnMuzzleFlash, even
// after the player shot got a proper flash+flare punch-up — this is the
// arcade-only equivalent for hostile shots, tuned smaller/harsher so a
// screen full of enemies firing doesn't overwhelm the player's own muzzle.
function spawnEnemyMuzzleFlashPunch(x: number, y: number, colour: string, scale: number): void {
  spawnExplosionFlash(x, y, colour, 15 + scale * 9, 0.048);
  spawnStarFlare(x, y, colour, 16 + scale * 9, 0.07, (rand() - 0.5) * 4);
}

function spawnLaserImpact(e: Enemy, heat: number): void {
  const colour = enemyColour(e.type);
  const scale = e.type === 'carrier' ? 1.35 : e.carryId !== null ? 1.12 : e.type === 'hunter' ? 1.04 : 0.92;
  spawnExplosionFlash(e.x, e.y, heat > 0.68 ? '#ff8a3a' : colour, 36 + scale * 28 + heat * 18, 0.085 + heat * 0.025);
  spawnShockwave(e.x, e.y, colour, 28 + scale * 18, 0.13);
  spawnSparkleBurst(e.x, e.y, [colour, '#fff5d8'], 2, 120);
  for (let i = 0; i < (e.type === 'carrier' ? 5 : 3); i += 1) {
    const a = rand() * Math.PI * 2;
    emitParticle({
      x: wrapX(e.x + (rand() - 0.5) * 12),
      y: e.y + (rand() - 0.5) * 9,
      vx: Math.cos(a) * (130 + rand() * 220) + e.vx * 0.12,
      vy: Math.sin(a) * (90 + rand() * 170) + e.vy * 0.08,
      ttl: 0.12 + rand() * 0.12,
      age: 0,
      size: 1,
      colour: i === 0 ? '#fff5d8' : colour,
      kind: 'beam',
      rot: a,
      length: 12 + rand() * 30,
      width: 1.2 + heat * 1.2,
    });
  }
}

function heatedLaserLength(heat = state.ship.heat): number {
  return tunedLaserLength() * (1 - clamp(heat, 0, 1) * 0.18);
}

function laserHitRadius(e: Enemy): number {
  const heatTrim = state.ship.heat * 4;
  if (e.type === 'carrier') return 72 - heatTrim * 0.4;
  if (e.carryId !== null) return 61 - heatTrim * 0.35;
  if (e.type === 'hunter') return 48 - heatTrim;
  if (e.type === 'jammer') return 47 - heatTrim;
  if (e.type === 'forgery') return 46 - heatTrim;
  if (e.type === 'troll') return (50 - heatTrim) * trollGrowthScale(e);
  return 45 - heatTrim;
}

function laserPriority(e: Enemy): number {
  if (e.carryId !== null) return 260;
  if (e.type === 'abductor' && e.captureCharge > tunedCaptureLockTime() * 0.58) return 190;
  if (e.type === 'abductor' && e.targetId !== null) {
    const target = signalById(e.targetId);
    if (target) return 62 + contactThreat(target).approach * 86;
  }
  if (e.type === 'hunter' && distWrapped(e.x, e.y, state.ship.x, state.ship.y) < 360) return 150;
  if (e.type === 'jammer') return 82;
  if (e.type === 'carrier') return -60;
  return 0;
}

function laserDamage(e: Enemy): number {
  const ship = shipSpec(state.shipClass);
  if (e.type === 'carrier') return ship.carrierDamage;
  if (e.type === 'hunter') return Math.min(ship.laserDamage, 1.15);
  return ship.laserDamage;
}

function maybeGrazeLaser(x: number, y: number, dir: -1 | 1, length: number): boolean {
  let nearest: Enemy | null = null;
  let nearestDy = Number.POSITIVE_INFINITY;
  for (const e of state.enemies) {
    if (!e.alive) continue;
    const dx = wrapDelta(e.x, x) * dir;
    const dy = Math.abs(e.y - y);
    const graze = laserHitRadius(e) + 18;
    if (dx > 30 && dx < length && dy < graze && dy < nearestDy) {
      nearest = e;
      nearestDy = dy;
    }
  }
  if (!nearest) return false;
  spawnTrail(nearest.x, nearest.y, '#fff5d8', 3);
  state.comboUntil = Math.max(state.comboUntil, 0.55);
  return true;
}

function tunedLaserLength(): number {
  return LASER_LENGTH * getTuning().laserRange;
}

function tunedCaptureLockTime(): number {
  return CAPTURE_LOCK_TIME * getTuning().captureTime * skillSpec(state.skill).liftLockScale;
}

function rescueWindowScale(): number {
  return skillSpec(state.skill).rescueWindowScale;
}

function carriedLiftSpeedScale(): number {
  return skillSpec(state.skill).carrySpeedScale;
}

function updateLasers(dt: number): void {
  for (const laser of state.lasers) laser.ttl -= dt;
  state.lasers = state.lasers.filter(laser => laser.ttl > 0);
}

function updateEnemies(dt: number): void {
  const tuning = getTuning();
  const speedMul = skillSpec(state.skill).enemySpeed * tuning.enemySpeed * earlyWaveEnemySpeed() * waveOpeningEnemySpeed();
  const captureLockTime = tunedCaptureLockTime();
  const lowTrace = clamp(state.lowCamp / 2.2, 0, 1);
  for (const e of state.enemies) {
    if (!e.alive) continue;
    e.phase += dt;
    e.age += dt;
    e.shotCooldown -= dt;
    e.muzzle = Math.max(0, e.muzzle - dt * 4.8);
    e.rescueGrace = Math.max(0, e.rescueGrace - dt);
    if (e.carryId !== null) {
      const s = signalById(e.carryId);
      e.captureCharge = 0;
      if (!s || s.status !== 'carried') {
        e.carryId = null;
      } else {
        e.vx += Math.sin(e.phase * 5.2) * 34 * dt;
        e.vx *= Math.exp(-1.6 * dt);
        e.vy = (-132 - state.wave * 7) * speedMul * carriedLiftSpeedScale();
        e.x = wrapX(e.x + Math.sin(e.phase * 5) * 15 * dt);
        e.y += e.vy * dt;
        s.x = e.x;
        s.y = e.y + 34;
        if (!trySnatchCarriedSignal(e, s) && e.y < PLAY_TOP + 18) forgeSignal(e, s);
      }
    } else if (e.type === 'abductor') {
      updateAbductor(e, captureLockTime, speedMul, lowTrace, dt);
    } else if (e.type === 'forgery') {
      updateForgery(e, speedMul, dt);
    } else if (e.type === 'hunter') {
      updateHunter(e, speedMul, lowTrace, dt);
    } else if (e.type === 'jammer') {
      updateJammer(e, speedMul, dt);
    } else if (e.type === 'carrier') {
      updateCarrier(e, speedMul, dt);
    } else if (e.type === 'spammer') {
      updateSpammer(e, speedMul, dt);
    } else if (e.type === 'sybil') {
      updateSybil(e, speedMul, dt);
    } else if (e.type === 'troll') {
      updateTroll(e, speedMul, dt);
    } else {
      e.captureCharge = 0;
      const hover = wrapX(state.ship.x + Math.sin(e.phase * 1.1) * 420);
      steer(e, hover, PLAY_TOP + 70 + Math.sin(e.phase * 2) * 34, (185 + state.wave * 10) * speedMul, dt);
    }

    e.x = wrapX(e.x + e.vx * dt);
    e.y = clamp(e.y + e.vy * dt, PLAY_TOP + 12, terrainY(e.x) - 42);
    updateEnemyFacingCue(e, dt);

    if (e.carryId !== null) {
      state.threatPulse = Math.max(state.threatPulse, 0.82);
    } else if (e.type === 'abductor') {
      const target = e.targetId ? signalById(e.targetId) : null;
      const threat = target ? contactThreat(target) : null;
      const capture = e.captureCharge / Math.max(0.1, captureLockTime);
      if (capture > 0.58) state.threatPulse = Math.max(state.threatPulse, 0.42 + capture * 0.44);
      else if (threat && threat.approach > 0.7) state.threatPulse = Math.max(state.threatPulse, 0.16 + threat.approach * 0.14);
    }

    if (!shipProtected() && e.rescueGrace <= 0 && distWrapped(e.x, e.y, state.ship.x, state.ship.y) < enemyCollisionRadius(e)) {
      if (carriedRescueGrace(e)) continue;
      damageShip(false, `collision:${e.type}`);
      if (e.type !== 'abductor' || e.carryId === null) killEnemy(e, true, 'collision');
    }

    if (!e.alive) continue;
    updateEnemyFire(e);
  }
  state.enemies = state.enemies.filter(e => e.alive);
}

function updateEnemyFire(e: Enemy): void {
  const kind = enemyShotKind(e);
  if (!kind) {
    e.shotCooldown = Math.max(e.shotCooldown, 0.4);
    return;
  }
  if (!enemyCanShoot(e, kind)) {
    if (e.shotCooldown <= 0) e.shotCooldown = 0.18;
    return;
  }
  if (e.shotCooldown > 0) {
    const arming = enemyFireReadiness(e, kind);
    if (arming > 0) {
      e.muzzle = Math.max(e.muzzle, 0.16 + arming * 0.46);
      e.intent = Math.max(e.intent, arming * (kind === 'barrage' ? 0.72 : 0.42));
      state.threatPulse = Math.max(state.threatPulse, arming * (kind === 'jam' ? 0.18 : 0.12));
    }
    return;
  }
  fireEnemyShot(e, kind);
  e.shotCooldown = nextEnemyShotCooldown(e, kind);
}

function enemyShotKind(e: Enemy): EnemyShotKind | null {
  if (e.carryId !== null) return null;
  if (e.type === 'hunter' || e.type === 'forgery') return 'dart';
  if (e.type === 'jammer') return 'jam';
  if (e.type === 'carrier') return 'barrage';
  if (e.type === 'spammer') return 'spam';
  if (e.type === 'sybil') return null;
  if (e.type === 'abductor' && e.captureCharge < 0.18) return 'dart';
  return null;
}

function enemyCanShoot(e: Enemy, kind: EnemyShotKind): boolean {
  if (shipProtected() || state.phase !== 'playing') return false;
  if (kind === 'dart' && state.wave < 2 && e.type !== 'forgery') {
    if (e.type === 'hunter' && state.waveTimer >= 7.5) {
      // First-wave hunters should eventually threaten the player, but not before the opening read is established.
    } else if (e.type !== 'abductor' || state.waveTimer < 6.5) {
      return false;
    }
  }
  if (kind === 'jam' && state.wave < 3) return false;
  if (e.type === 'hunter' && e.intent < 0.55) return false;
  if (e.type === 'jammer' && e.intent < 0.48) return false;
  if (e.type === 'abductor' && e.intent > 0.28) return false;
  const distance = distWrapped(e.x, e.y, state.ship.x, state.ship.y);
  if (kind === 'dart') {
    const lateral = Math.abs(wrapDelta(e.x, state.ship.x));
    const facingShip = wrapDelta(state.ship.x, e.x) * e.face > -150;
    if (!facingShip && e.type !== 'abductor') return false;
    return distance > 220 && distance < 1040 && lateral > 85 && Math.abs(e.y - state.ship.y) < 245;
  }
  if (kind === 'barrage') return distance > 300 && distance < 1460;
  if (kind === 'spam') {
    // Mines only matter near the player's routes; don't litter the far frontier.
    const lateral = Math.abs(wrapDelta(e.x, state.ship.x));
    return lateral > 120 && lateral < 940;
  }
  return distance > 210 && distance < 1180;
}

function fireEnemyShot(e: Enemy, kind: EnemyShotKind): void {
  if (kind === 'barrage') {
    fireCarrierBarrage(e);
    return;
  }
  if (kind === 'spam') {
    dropSpamMine(e);
    return;
  }
  const speed = enemyShotSpeed(e, kind);
  const start = enemyMuzzlePoint(e);
  const aim = enemyAimPoint(e, speed);
  const dx = wrapDelta(aim.x, start.x);
  const dy = aim.y - start.y;
  const d = Math.hypot(dx, dy) || 1;
  state.enemyShots.push({
    x: start.x,
    y: start.y,
    vx: (dx / d) * speed,
    vy: (dy / d) * speed,
    ttl: kind === 'jam' ? 2.5 : 1.7,
    age: 0,
    kind,
    nearMissed: false,
    armTime: kind === 'jam' ? 0.1 : 0.08,
  });
  e.muzzle = 1.25;
  spawnMuzzleFlash(e, enemyShotColour(kind), kind === 'jam' ? 1.08 : 0.82);
  spawnEnemyMuzzleFlashPunch(start.x, start.y, enemyShotColour(kind), kind === 'jam' ? 1.08 : 0.82);
  spawnTrail(e.x, e.y, enemyShotColour(kind), kind === 'jam' ? 7 : 4);
  state.shake = Math.max(state.shake, kind === 'jam' ? 0.055 : 0.035);
  state.threatPulse = Math.max(state.threatPulse, kind === 'jam' ? 0.34 : 0.22);
  const fireTone = kind === 'jam' ? 'jamFire' : 'enemyFireArcade';
  playAudio(fireTone, kind === 'jam' ? 0.9 : 0.72);
}

function fireCarrierBarrage(e: Enemy): void {
  const wounded = e.hp <= e.maxHp * 0.5;
  const speed = enemyShotSpeed(e, 'barrage');
  const aim = enemyAimPoint(e, speed);
  const baseDx = wrapDelta(aim.x, e.x);
  const baseDy = aim.y - e.y;
  const base = Math.atan2(baseDy, baseDx);
  const spread = wounded ? [-0.22, 0, 0.22] : [-0.13, 0.13];
  for (const offset of spread) {
    const a = base + offset;
    state.enemyShots.push({
      x: wrapX(e.x + Math.cos(a) * 42),
      y: e.y + Math.sin(a) * 24,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      ttl: wounded ? 2.55 : 2.35,
      age: 0,
      kind: 'barrage',
      nearMissed: false,
      armTime: wounded ? 0.24 : 0.2,
    });
  }
  state.message = wounded ? 'CARRIER BROADSIDE' : 'CARRIER BARRAGE';
  state.messageUntil = wounded ? 0.95 : 0.8;
  state.threatPulse = Math.max(state.threatPulse, wounded ? 0.78 : 0.55);
  state.shake = Math.max(state.shake, wounded ? 0.2 : 0.12);
  e.muzzle = 1.35;
  spawnMuzzleFlash(e, '#ff2f7a', wounded ? 1.42 : 1.08);
  spawnTrail(e.x, e.y, '#ff2f7a', wounded ? 11 : 7);
  playAudio('carrierFire', wounded ? 1.15 : 0.88);
}

function dropSpamMine(e: Enemy): void {
  state.enemyShots.push({
    x: e.x,
    y: e.y + 30,
    vx: e.vx * 0.14,
    vy: 24,
    ttl: 6.4,
    age: 0,
    kind: 'spam',
    nearMissed: false,
    armTime: 0.55,
    source: 'spam-mine',
  });
  e.muzzle = 1.05;
  spawnMuzzleFlash(e, enemyShotColour('spam'), 0.78);
  spawnTrail(e.x, e.y + 24, enemyShotColour('spam'), 4);
  state.threatPulse = Math.max(state.threatPulse, 0.2);
  playAudio('lock', 0.52);
}

function enemyFireArmWindow(kind: EnemyShotKind): number {
  if (kind === 'barrage') return 1.72;
  if (kind === 'jam') return 1.05;
  if (kind === 'spam') return 0.92;
  return 0.82;
}

function enemyFireReadiness(e: Enemy, kind: EnemyShotKind): number {
  const window = enemyFireArmWindow(kind);
  return clamp(1 - e.shotCooldown / window, 0, 1);
}

function enemyMuzzlePoint(e: Enemy): { x: number; y: number } {
  const nose = e.type === 'carrier' ? 68 : e.type === 'hunter' ? 45 : e.type === 'jammer' ? 39 : 35;
  return {
    x: wrapX(e.x + e.face * nose),
    y: e.y + (e.type === 'carrier' ? 0 : Math.sin(e.phase * 6) * 2),
  };
}

function spawnMuzzleFlash(e: Enemy, colour: string, scale: number): void {
  const muzzle = enemyMuzzlePoint(e);
  const muzzleX = muzzle.x;
  const muzzleY = muzzle.y;
  const aim = Math.atan2(state.ship.y - e.y, wrapDelta(state.ship.x, e.x) || e.face);
  const blastCount = e.type === 'carrier' ? 10 : e.type === 'jammer' ? 7 : 5;
  for (let i = 0; i < blastCount; i += 1) {
    const spread = (rand() - 0.5) * (e.type === 'carrier' ? 0.64 : 0.42);
    const angle = aim + spread;
    const speed = (140 + rand() * 230) * scale;
    emitParticle({
      x: muzzleX,
      y: muzzleY,
      vx: Math.cos(angle) * speed + e.vx * 0.1,
      vy: Math.sin(angle) * speed + e.vy * 0.1,
      ttl: 0.12 + rand() * 0.12,
      age: 0,
      size: 1,
      colour: i % 3 === 0 ? '#fff5d8' : colour,
      kind: 'beam',
      rot: angle,
      length: (e.type === 'carrier' ? 34 : 22) * scale * (0.72 + rand() * 0.7),
      width: (e.type === 'jammer' ? 2.8 : 2.2) * scale,
    });
  }
  spawnExplosionCore(muzzleX, muzzleY, colour, (e.type === 'carrier' ? 32 : 18) * scale, 0.12);
}

function enemyAimPoint(e: Enemy, shotSpeed: number): { x: number; y: number } {
  const distance = distWrapped(e.x, e.y, state.ship.x, state.ship.y);
  const leadTime = clamp(distance / shotSpeed, 0.16, 0.82);
  return {
    x: wrapX(state.ship.x + state.ship.vx * leadTime * 0.72),
    y: clamp(state.ship.y + state.ship.vy * leadTime * 0.54, PLAY_TOP + 28, terrainY(state.ship.x) - 58),
  };
}

function enemyShotSpeed(e: Enemy, kind: EnemyShotKind): number {
  const base = kind === 'jam'
    ? 238 + state.wave * 3.2
    : kind === 'barrage'
      ? (e.hp <= e.maxHp * 0.5 ? 316 + state.wave * 4 : 282 + state.wave * 3.4)
      : 386 + state.wave * 6.2;
  const earlyWaveEase = state.wave > 0 && state.wave <= 5 ? 1 - (6 - state.wave) * 0.022 : 1;
  const skillEase = state.skill === 'cadet' ? 0.94 : state.skill === '600b' ? 1.03 : 1;
  const openingEase = 1 - waveOpeningCalm() * (kind === 'barrage' ? 0.11 : kind === 'jam' ? 0.12 : 0.15);
  return base * earlyWaveEase * skillEase * openingEase;
}

function nextEnemyShotCooldown(e: Enemy, kind: EnemyShotKind): number {
  const waveTrim = Math.min(0.34, state.wave * 0.026);
  const openingRoom = waveOpeningCalm();
  const earlyRoom = state.wave > 0 && state.wave <= 3 ? (4 - state.wave) * 0.1 : 0;
  const skillRoom = state.skill === 'cadet' ? 0.18 : state.skill === 'normal' ? 0.08 : 0;
  if (kind === 'barrage') {
    const wounded = e.hp <= e.maxHp * 0.5;
    return (wounded ? 3.35 : 4.05) - waveTrim * 0.42 + openingRoom * 0.7 + skillRoom + rand() * (wounded ? 0.92 : 1.25);
  }
  if (kind === 'jam') return 2.52 - waveTrim + openingRoom * 0.52 + earlyRoom * 0.42 + skillRoom + rand() * 0.95;
  if (kind === 'spam') return 2.35 - waveTrim * 0.5 + openingRoom * 0.5 + skillRoom + rand() * 0.9;
  if (e.type === 'forgery') return 1.04 - waveTrim * 0.38 + rand() * 0.42;
  if (e.type === 'abductor') return 2.82 - waveTrim * 0.34 + openingRoom * 0.58 + earlyRoom * 0.36 + skillRoom + rand() * 1.28;
  if (e.type === 'hunter') return (e.intent > 0.72 ? 1.2 : 1.64) - waveTrim * 0.66 + openingRoom * 0.48 + earlyRoom * 0.32 + skillRoom + rand() * (e.intent > 0.72 ? 0.42 : 0.62);
  return 1.68 - waveTrim * 0.72 + openingRoom * 0.38 + skillRoom + rand() * 0.72;
}

function updateEnemyShots(dt: number): void {
  for (const shot of state.enemyShots) {
    shot.x = wrapX(shot.x + shot.vx * dt);
    shot.y += shot.vy * dt;
    shot.ttl -= dt;
    shot.age += dt;

    if (shot.y < PLAY_TOP - 28 || shot.y > terrainY(shot.x) + 10) {
      shot.ttl = 0;
      const colour = enemyShotColour(shot.kind);
      const impactY = clamp(shot.y, PLAY_TOP, GROUND_BASE);
      spawnTrail(shot.x, impactY, colour, shot.kind === 'barrage' ? 5 : 3);
      spawnExplosionCore(shot.x, impactY, colour, shot.kind === 'barrage' ? 24 : 17, 0.12);
      spawnBurst(shot.x, impactY, colour, shot.kind === 'barrage' ? 7 : 4, shot.kind === 'barrage' ? 150 : 105);
      playAudio('shotImpact', shot.kind === 'barrage' ? 0.58 : shot.kind === 'jam' ? 0.46 : 0.34);
      continue;
    }

    const armed = shot.age >= (shot.armTime ?? 0);
    const radius = shot.kind === 'jam' ? 28 : shot.kind === 'spam' ? 27 : shot.kind === 'barrage' ? 24 : 20;
    const distance = distWrapped(shot.x, shot.y, state.ship.x, state.ship.y);
    if (armed && !shipProtected() && !shot.nearMissed && distance < radius + 54 && distance >= radius) {
      shot.nearMissed = true;
      state.shake = Math.max(state.shake, shot.kind === 'barrage' ? 0.1 : 0.07);
      playAudio('nearMiss', shot.kind === 'barrage' ? 0.78 : shot.kind === 'jam' ? 0.68 : 0.52);
    }
    if (armed && !shipProtected() && distance < radius) {
      shot.ttl = 0;
      if (shot.kind === 'jam') jamShip();
      else damageShip(false, shot.source ?? shot.kind);
    }
  }
  state.enemyShots = state.enemyShots.filter(shot => shot.ttl > 0);
}

function jamShip(): void {
  state.jamCue = 1;
  state.threatPulse = Math.max(state.threatPulse, 0.45);
  state.ship.cooldown = Math.max(state.ship.cooldown, 0.22);
  state.ship.vx *= 0.86;
  state.ship.vy *= 0.82;
  state.shake = Math.max(state.shake, 0.18);
  state.message = 'RADAR JAM';
  state.messageUntil = 0.72;
  spawnText(state.ship.x, state.ship.y - 36, 'JAM', '#5f7cff');
  spawnBurst(state.ship.x, state.ship.y, '#5f7cff', 12, 120);
  playAudio('lock', 0.62);
}

function enemyCollisionRadius(e: Enemy): number {
  if (e.type === 'carrier') return 48;
  if (e.type === 'hunter') return 32;
  if (e.type === 'jammer') return 31;
  if (e.type === 'forgery') return 31;
  if (e.type === 'spammer') return 32;
  if (e.type === 'sybil') return e.maxHp > 1 ? 34 : 20;
  if (e.type === 'troll') return 36 * trollGrowthScale(e);
  return e.carryId !== null ? 36 : 30;
}

function updateAbductor(e: Enemy, captureLockTime: number, speedMul: number, lowTrace: number, dt: number): void {
  const target = chooseTarget(e);
  if (!target) {
    e.captureCharge = 0;
    steer(e, wrapX(e.x + 500), PLAY_TOP + 90, 120 * speedMul, dt);
    addEnemyStrafe(e, 72, dt, 0.24);
    return;
  }

  const dx = Math.abs(wrapDelta(target.x, e.x));
  const guarded = distWrapped(e.x, e.y, state.ship.x, state.ship.y) < 280 && Math.abs(e.y - state.ship.y) < 120;
  const exposed = isInShipLaserLane(e) && distWrapped(e.x, e.y, state.ship.x, state.ship.y) < 760;
  const verticalLock = e.y > target.y - 118 && e.y < target.y - 50;
  const ramp = firstWaveRamp();
  const calm = waveOpeningCalm();
  const settledDelay = state.wave === 1 ? 0.82 - ramp * 0.16 : state.wave === 2 ? 1.08 : 1.0;
  const settled = e.age > settledDelay + calm * (state.wave === 1 ? 0.16 : 0.28) && state.waveGrace <= (state.wave === 1 ? 0.28 : 1.0);
  const wasCharging = e.captureCharge > 0.01;
  const charging = settled && target.status === 'ground' && dx < 56 && verticalLock;
  const descentY = dx > 260
    ? PLAY_TOP + 72 + Math.sin(e.phase * 1.25) * 32
    : dx > 84
      ? target.y - 152 + Math.sin(e.phase * 1.9) * 18
      : target.y - 88 + Math.sin(e.phase * 2.8) * 4;
  let tx = wrapX(target.x + Math.sin(e.phase * 1.7 + e.id * 0.001) * (dx > 220 ? 96 : dx > 84 ? 54 : 8));
  let ty = descentY;

  if ((guarded || exposed) && !charging) {
    tx = wrapX(e.x + awayFromShip(e) * (guarded ? 285 + lowTrace * 130 : 430));
    ty = clamp(e.y - (exposed ? 132 : 96), PLAY_TOP + 26, terrainY(e.x) - 92);
  }

  const openingMove = (state.wave === 1 ? 0.98 + ramp * 0.08 : 1) * (1 - calm * 0.02);
  const openingLock = (state.wave === 1 ? 0.9 + ramp * 0.14 : state.wave === 2 ? 0.92 : 1) * (1 - calm * 0.04);
  const lockWarmup = clamp((e.age - settledDelay) / 0.92, 0.5, 1);
  const lockRate = (0.4 + lowTrace * 0.16 + (target.relation === 'high-wot' ? 0.05 : 0)) * (guarded || exposed ? 0.42 : 1) * openingLock * lockWarmup;
  const stealth = dx > 220 && !exposed ? 0.82 : 1;
  const moveSpeed = (112 + state.wave * 4.4 + lowTrace * 22) * speedMul * openingMove * stealth * (charging ? 0.46 : 1);
  steer(e, tx, ty, moveSpeed, dt);
  addEnemyStrafe(e, charging ? 26 : exposed ? 160 : dx > 180 ? 118 : 72, dt, charging ? 0.1 : 0.28);
  e.captureCharge = charging ? e.captureCharge + dt * lockRate : Math.max(0, e.captureCharge - dt * 2.05);
  e.intent = clamp(e.captureCharge / captureLockTime + (exposed ? 0.18 : 0), 0, 1);
  if (settled && target.status === 'ground' && dx < 132) e.muzzle = Math.max(e.muzzle, 0.18 + clamp(e.captureCharge / captureLockTime, 0, 1) * 0.4);
  if (charging && !wasCharging) {
    state.threatPulse = Math.max(state.threatPulse, 0.46);
    playAudio('warning', target.relation === 'high-wot' ? 0.74 : 0.58);
  }

  if (target.status === 'ground' && e.captureCharge > captureLockTime && dx < 58 && verticalLock) {
    target.status = 'carried';
    target.carriedBy = e.id;
    target.liftedAt = state.trace.elapsed;
    target.flash = 1;
    state.trace.contactsLifted += 1;
    e.carryId = target.id;
    e.targetId = target.id;
    e.captureCharge = 0;
    state.message = `${signalDisplayName(target).toUpperCase()} LIFTED`;
    state.messageUntil = 0.82;
    state.threatPulse = Math.max(state.threatPulse, 0.92);
    spawnText(target.x, target.y - 34, 'LIFTED', '#ff4d5e');
    spawnRing(target.x, target.y, '#ff4d5e', 62);
    playAudio('lock', 0.72);
  }
}

function trySnatchCarriedSignal(e: Enemy, s: Signal): boolean {
  if (s.status !== 'carried' || e.carryId !== s.id) return false;
  const spec = shipSpec(state.shipClass);
  const rescueScale = rescueWindowScale();
  const dx = Math.abs(wrapDelta(s.x, state.ship.x));
  const dy = Math.abs(s.y - state.ship.y);
  const xRadius = (spec.id === 'guardian' ? 178 : spec.id === 'heavy' ? 154 : 164) * rescueScale;
  const yRadius = (spec.id === 'guardian' ? 142 : spec.id === 'heavy' ? 120 : 130) * rescueScale;
  const belowAbductor = state.ship.y > e.y - 32 * rescueScale;
  const contactLine = state.ship.y < s.y + 124 * rescueScale;
  if (!belowAbductor || !contactLine || dx > xRadius || dy > yRadius) return false;

  const contactX = s.x;
  const contactY = s.y;
  e.carryId = null;
  e.targetId = null;
  e.captureCharge = 0;
  e.rescueGrace = 0.86;
  e.shotCooldown = Math.max(e.shotCooldown, 1.55);
  e.muzzle = 0;
  e.vx += awayFromShip(e) * (340 + Math.abs(state.ship.vx) * 0.26);
  e.vy = Math.min(e.vy - 108, -176);
  state.ship.invuln = Math.max(state.ship.invuln, 0.66);
  state.ship.vx *= 0.94;
  state.ship.vy *= 0.34;
  state.threatPulse = Math.max(state.threatPulse, 0.18);
  spawnTetherBreak(e.x, e.y + 18, contactX, contactY, relationColour(s.relation));
  spawnRescueShieldPulse(state.ship.x, state.ship.y, relationColour(s.relation), true);
  spawnRing(state.ship.x, state.ship.y, '#5effdb', 82);
  spawnText(state.ship.x, state.ship.y - 52, 'RESCUE SHIELD', '#5effdb');
  rescueSignal(s, 'snatch');
  return true;
}

function carriedRescueGrace(e: Enemy): boolean {
  if (e.carryId === null) return false;
  const s = signalById(e.carryId);
  if (!s || s.status !== 'carried') return false;
  const rescueScale = rescueWindowScale();
  const dx = Math.abs(wrapDelta(s.x, state.ship.x));
  const tetherDx = Math.abs(wrapDelta(e.x, state.ship.x));
  const withinTetherY = state.ship.y > e.y - 34 * rescueScale && state.ship.y < s.y + 126 * rescueScale;
  const closeToContact = Math.abs(s.y - state.ship.y) < 142 * rescueScale && dx < 172 * rescueScale;
  const closeToTether = tetherDx < 126 * rescueScale && withinTetherY;
  if (!closeToContact && !closeToTether) return false;
  if (closeToContact || (closeToTether && dx < 220 * rescueScale)) {
    e.carryId = null;
    e.targetId = null;
    e.captureCharge = 0;
    e.rescueGrace = 1.05;
    e.shotCooldown = Math.max(e.shotCooldown, 1.35);
    e.muzzle = 0;
    e.vx += awayFromShip(e) * (260 + Math.abs(state.ship.vx) * 0.18);
    e.vy = Math.min(e.vy - 72, -148);
    state.ship.invuln = Math.max(state.ship.invuln, 0.72);
    spawnTetherBreak(e.x, e.y + 18, s.x, s.y, relationColour(s.relation));
    spawnRescueShieldPulse(state.ship.x, state.ship.y, relationColour(s.relation), true);
    spawnRing(state.ship.x, state.ship.y, '#5effdb', 92);
    rescueSignal(s, 'snatch');
    return true;
  }
  e.rescueGrace = Math.max(e.rescueGrace, 0.26);
  e.shotCooldown = Math.max(e.shotCooldown, 0.82);
  e.vx += awayFromShip(e) * 86;
  e.vy = Math.min(e.vy, -64);
  state.ship.invuln = Math.max(state.ship.invuln, 0.18);
  state.threatPulse = Math.max(state.threatPulse, 0.12);
  spawnRescueShieldPulse(state.ship.x, state.ship.y, relationColour(s.relation), false);
  return true;
}

function shipCanSecureReleasedContact(e: Enemy, s: Signal): boolean {
  const rescueScale = rescueWindowScale();
  const dx = Math.abs(wrapDelta(s.x, state.ship.x));
  const tetherDx = Math.abs(wrapDelta(e.x, state.ship.x));
  const belowAbductor = state.ship.y > e.y - 34 * rescueScale;
  const nearContact = dx < 270 * rescueScale && Math.abs(s.y - state.ship.y) < 190 * rescueScale;
  const inTether = tetherDx < 190 * rescueScale && state.ship.y > e.y - 46 * rescueScale && state.ship.y < s.y + 170 * rescueScale;
  if (!belowAbductor || (!nearContact && !inTether)) return false;
  state.ship.invuln = Math.max(state.ship.invuln, 0.72);
  spawnTetherBreak(e.x, e.y + 18, s.x, s.y, relationColour(s.relation));
  spawnRescueShieldPulse(state.ship.x, state.ship.y, relationColour(s.relation), true);
  return true;
}

function updateHunter(e: Enemy, speedMul: number, lowTrace: number, dt: number): void {
  const threatLane = isInShipLaserLane(e);
  const wounded = e.hp < e.maxHp;
  const cycleSeconds = state.wave === 1 ? 3.55 : 4.35;
  const cyclePos = (e.age + (e.id % 1000) * 0.001) % cycleSeconds;
  const setupEnd = state.wave === 1 ? 0.92 : 1.55;
  const attackEnd = state.wave === 1 ? 2.42 : 2.95;
  const setup = !wounded && cyclePos < setupEnd;
  const attack = !wounded && cyclePos >= setupEnd && cyclePos < attackEnd;
  const retreat = wounded || cyclePos >= attackEnd;
  const attackCycle = Math.floor((e.age + (e.id % 1000) * 0.001) / cycleSeconds);
  const laneIndex = (((e.id + attackCycle) % 3) - 1) as -1 | 0 | 1;
  const lead = clamp(state.ship.vx * (attack ? 0.48 : 0.3), -420, 420);
  const cross = Math.sin(e.phase * 2.55 + e.id * 0.002) * (42 + lowTrace * 18);
  const dodge = threatLane ? (e.y <= state.ship.y ? -96 : 96) : 0;
  const flankSide = ((e.id + attackCycle) % 2 === 0 ? -1 : 1) as -1 | 1;
  const attackFront = ((e.id + attackCycle) % 4) !== 0;
  const setupX = -state.ship.dir * flankSide * (state.wave === 1 ? 430 : 520 + lowTrace * 90);
  const attackX = state.ship.dir * (attackFront ? 255 + lowTrace * 82 : -240 - lowTrace * 55);
  const retreatX = awayFromShip(e) * (wounded ? 780 + lowTrace * 130 : 620 + lowTrace * 120);
  const laneX = setup ? setupX : attack ? attackX : retreatX;
  const tx = wrapX(state.ship.x + lead + laneX);
  const ty = clamp(
    state.ship.y + laneIndex * (attack ? 74 : 96) + cross + dodge + lowTrace * 24 + (retreat ? (wounded ? -82 : -38) : 0),
    PLAY_TOP + 30,
    terrainY(tx) - 64,
  );
  const openingMove = state.wave === 1 ? 0.96 + firstWaveRamp() * 0.08 : 1;
  const laneSettle = wounded ? 1.16 : setup ? (state.wave === 1 ? 0.92 : 0.74) : attack ? 1.12 : 0.88;
  const speed = (188 + state.wave * 6 + lowTrace * 42) * speedMul * openingMove * laneSettle * (threatLane ? 1.03 : 1);
  e.intent = wounded ? 0.28 : attack ? 1 : setup ? clamp(cyclePos / setupEnd, 0, 0.74) : clamp(1 - (cyclePos - attackEnd) / 1.4, 0, 0.55);
  if (attack && e.shotCooldown > 0.34) e.shotCooldown = Math.min(e.shotCooldown, (state.wave === 1 ? 0.2 : 0.34) + rand() * 0.16);
  if (wounded && e.shotCooldown < 0.92) e.shotCooldown = 0.92 + rand() * 0.36;
  if (attack || e.shotCooldown < 0.42) e.muzzle = Math.max(e.muzzle, attack ? 0.24 + e.intent * 0.36 : 0.16);
  steer(e, tx, ty, speed, dt);
  addEnemyStrafe(e, wounded ? 168 : threatLane ? 190 : attack ? 112 : 132, dt, wounded ? 0.4 : attack ? 0.22 : 0.34);
}

function updateJammer(e: Enemy, speedMul: number, dt: number): void {
  const anchor = chooseJammerAnchor(e);
  if (anchor) e.targetId = anchor.id;
  const playerClose = distWrapped(e.x, e.y, state.ship.x, state.ship.y) < 430;
  const threatened = anchor ? contactThreat(anchor).targeted : false;
  const laneSide = (e.id % 2 === 0 ? -1 : 1) as -1 | 1;
  const orbit = Math.sin(e.phase * 0.84) * (threatened ? 96 : 150) + laneSide * (threatened ? 72 : 110);
  const tx = anchor
    ? wrapX(anchor.x + orbit + (threatened ? -state.ship.dir * 130 : 0))
    : wrapX(state.ship.x + state.ship.dir * 520 + Math.sin(e.phase * 0.72) * 320);
  const hoverY = anchor
    ? anchor.y - (threatened ? 176 : 230) + Math.cos(e.phase * 1.34) * (threatened ? 20 : 32)
    : PLAY_TOP + 92 + Math.cos(e.phase * 1.25) * 34;
  const evasionX = playerClose ? wrapX(e.x + awayFromShip(e) * 360) : tx;
  const evasionY = playerClose ? PLAY_TOP + 58 + Math.sin(e.phase * 3.6) * 42 : hoverY;
  steer(e, evasionX, clamp(evasionY, PLAY_TOP + 28, terrainY(e.x) - 92), (124 + state.wave * 5.4) * speedMul * (playerClose ? 1.06 : threatened ? 0.9 : 1), dt);
  addEnemyStrafe(e, playerClose ? 126 : threatened ? 58 : 82, dt, threatened ? 0.22 : 0.38);
  e.captureCharge = clamp(e.captureCharge + dt * (playerClose ? 0.1 : threatened ? 0.22 : 0.15), 0, 0.92);
  e.intent = clamp(e.captureCharge + (threatened ? 0.22 : 0), 0, 1);
  if (e.intent > 0.38 || e.shotCooldown < 0.52) e.muzzle = Math.max(e.muzzle, 0.14 + e.intent * 0.24);
}

function updateCarrier(e: Enemy, speedMul: number, dt: number): void {
  const wounded = e.hp <= e.maxHp * 0.5;
  const side = wrapDelta(e.x, state.ship.x) < 0 ? -1 : 1;
  const hover = wrapX(state.ship.x + side * (wounded ? 430 : 520) + Math.sin(e.phase * (wounded ? 0.82 : 0.64)) * (wounded ? 390 : 320));
  steer(e, hover, PLAY_TOP + 98 + Math.sin(e.phase * (wounded ? 1.85 : 1.42)) * (wounded ? 48 : 38), (wounded ? 132 + state.wave * 6 : 108 + state.wave * 5) * speedMul, dt);

  e.captureCharge -= dt;
  const escortCap = wounded ? 3 : 2;
  if (e.captureCharge <= 0 && state.waveTimer > 12 && state.enemies.filter(enemy => enemy.alive && enemy.type !== 'carrier').length < escortCap) {
    e.captureCharge = Math.max(wounded ? 3.1 : 4.2, (wounded ? 4.5 : 5.8) - state.wave * 0.04);
    state.message = wounded ? 'CARRIER ESCORTS' : 'CARRIER LAUNCH';
    state.messageUntil = 0.72;
    spawnEnemy(pickSpawnSignal() ?? undefined);
  }
}

function updateForgery(e: Enemy, speedMul: number, dt: number): void {
  const threatLane = isInShipLaserLane(e);
  const tx = wrapX(state.ship.x + state.ship.vx * 0.55 + Math.sin(e.phase * 3.2) * 150);
  const ty = clamp(
    state.ship.y + Math.cos(e.phase * 4.4) * 76 + (threatLane ? (e.y <= state.ship.y ? -88 : 88) : 0),
    PLAY_TOP + 32,
    terrainY(tx) - 68,
  );
  steer(e, tx, ty, (360 + state.wave * 18) * speedMul * (threatLane ? 1.1 : 1), dt);
}

function updateSpammer(e: Enemy, speedMul: number, dt: number): void {
  // Bomber pattern: cruise across the frontier in long passes, seeding spam mines
  // under the flight path. Reverses heading every pass rather than chasing the ship.
  const cruise = ((Math.floor(e.age / 10.5) + e.id) % 2 === 0 ? 1 : -1) as -1 | 1;
  const dxShip = Math.abs(wrapDelta(e.x, state.ship.x));
  const dodge = dxShip < 250 ? (e.y <= state.ship.y ? -76 : 76) : 0;
  const tx = wrapX(e.x + cruise * 540);
  const ty = clamp(
    PLAY_TOP + 128 + Math.sin(e.phase * 0.92) * 92 + dodge,
    PLAY_TOP + 34,
    terrainY(e.x) - 128,
  );
  steer(e, tx, ty, (152 + state.wave * 5) * speedMul, dt);
  addEnemyStrafe(e, 68, dt, 0.42);
  e.intent = clamp(dxShip < 780 ? 0.66 : 0.28, 0, 1);
  if (e.shotCooldown < 0.5) e.muzzle = Math.max(e.muzzle, 0.18 + e.intent * 0.22);
}

function updateSybil(e: Enemy, speedMul: number, dt: number): void {
  const shard = e.maxHp <= 1;
  const threatLane = isInShipLaserLane(e);
  if (shard) {
    // Split shards harry the ship directly, slightly slower than a forgery.
    const tx = wrapX(state.ship.x + state.ship.vx * 0.42 + Math.sin(e.phase * 4.6) * 128);
    const ty = clamp(
      state.ship.y + Math.cos(e.phase * 5.1) * 92 + (threatLane ? (e.y <= state.ship.y ? -78 : 78) : 0),
      PLAY_TOP + 32,
      terrainY(tx) - 64,
    );
    steer(e, tx, ty, (298 + state.wave * 13) * speedMul * (threatLane ? 1.08 : 1), dt);
    e.intent = 0.85;
    return;
  }
  // The cluster looms at a standoff and weaves; the threat is the decision to pop it.
  const standoff = 330 + Math.sin(e.phase * 0.72) * 92;
  const tx = wrapX(state.ship.x + awayFromShip(e) * standoff);
  const ty = clamp(state.ship.y + Math.sin(e.phase * 1.55) * 132, PLAY_TOP + 40, terrainY(tx) - 80);
  steer(e, tx, ty, (172 + state.wave * 7) * speedMul, dt);
  addEnemyStrafe(e, 96, dt, 0.5);
  e.intent = clamp(0.32 + Math.sin(e.phase * 1.1) * 0.24, 0, 1);
}

// Don't feed the troll: it cycles between FEEDING (bright, aggressive, laser
// hits heal it) and DORMANT (dim, vulnerable). phase drives the cycle so the
// tell is readable and each troll desyncs from its siblings.
function trollFeeding(e: Enemy): boolean {
  return Math.sin(e.phase * 1.7) > -0.15;
}

function updateTroll(e: Enemy, speedMul: number, dt: number): void {
  // captureCharge is unused by trolls; it doubles as the fed-cue cooldown so
  // held fire doesn't spam the callout at full fire rate.
  e.captureCharge = Math.max(0, e.captureCharge - dt);
  const feeding = trollFeeding(e);
  e.intent = feeding ? Math.min(1, e.intent + dt * 2.6) : Math.max(0, e.intent - dt * 2.2);
  const chase = (feeding ? 150 : 98) * speedMul + state.wave * 4;
  const tx = wrapX(state.ship.x + Math.sin(e.phase * 0.7) * 170);
  const ty = clamp(state.ship.y + Math.cos(e.phase * 1.3) * 96, PLAY_TOP + 60, terrainY(tx) - 90);
  steer(e, tx, ty, chase, dt);
  addEnemyStrafe(e, feeding ? 58 : 26, dt, 0.5);
}

function fallingRescueWindow(s: Signal): { catch: boolean; magnet: boolean; dx: number; dy: number } {
  const spec = shipSpec(state.shipClass);
  const rescueScale = rescueWindowScale();
  const dx = Math.abs(wrapDelta(s.x, state.ship.x));
  const dy = s.y - state.ship.y;
  const xCatch = (spec.id === 'guardian' ? 162 : spec.id === 'heavy' ? 140 : 150) * rescueScale;
  const xMagnet = (spec.id === 'guardian' ? 304 : spec.id === 'heavy' ? 270 : 288) * rescueScale;
  const yCatchTop = (spec.id === 'guardian' ? -164 : spec.id === 'heavy' ? -140 : -152) * rescueScale;
  const yCatchBottom = (spec.id === 'guardian' ? 124 : spec.id === 'heavy' ? 106 : 114) * rescueScale;
  const yMagnetTop = yCatchTop - 86;
  const yMagnetBottom = yCatchBottom + 82;
  return {
    catch: dx < xCatch && dy > yCatchTop && dy < yCatchBottom,
    magnet: dx < xMagnet && dy > yMagnetTop && dy < yMagnetBottom,
    dx,
    dy,
  };
}

function updateSignals(dt: number): void {
  for (const s of state.signals) {
    s.flash = Math.max(0, s.flash - dt);
    if (s.status === 'ground') {
      s.y = terrainY(s.x) - 22;
    } else if (s.status === 'returning') {
      const homeDx = wrapDelta(s.homeX, s.x);
      const driftSpeed = 145 + Math.min(245, Math.abs(homeDx) * 0.32);
      const drift = clamp(homeDx, -driftSpeed * dt, driftSpeed * dt);
      s.x = wrapX(s.x + drift);
      const nextGroundY = terrainY(s.x) - 22;
      const descent = (86 + Math.min(72, Math.abs(nextGroundY - s.y) * 0.18)) * dt;
      s.vy = descent / Math.max(0.001, dt);
      s.y = Math.min(nextGroundY, s.y + descent);
      if (s.y >= nextGroundY - 0.5) {
        s.status = 'ground';
        s.y = nextGroundY;
        s.vy = 0;
        s.carriedBy = null;
        s.liftedAt = 0;
        s.flash = 0.72;
        spawnRing(s.x, s.y, relationColour(s.relation), 34);
      } else if (rand() < dt * 5) {
        spawnTrail(s.x, s.y, relationColour(s.relation), 1);
      }
    } else if (s.status === 'falling') {
      s.vy += 410 * dt;
      s.y += s.vy * dt;
      let rescue = fallingRescueWindow(s);
      if (state.rescueNet > 0 && !rescue.magnet && Math.abs(wrapDelta(s.x, state.ship.x)) < 640) {
        // WoT net pickup: falling signals inside the net radius are hauled toward the ship.
        const netPull = 1 - Math.pow(0.04, dt);
        s.x = lerpWrap(s.x, state.ship.x, netPull);
        s.y += (state.ship.y - 7 - s.y) * netPull * 0.7;
        s.vy *= Math.exp(-5.6 * dt);
        if (rand() < dt * 9) spawnTrail(s.x, s.y, '#8cffb4', 2);
        rescue = fallingRescueWindow(s);
      }
      if (rescue.magnet) {
        const pull = 1 - Math.pow(0.02, dt);
        const clutchBoost = rescue.dy > -20 ? 1.32 : 1.08;
        s.x = lerpWrap(s.x, state.ship.x, pull * 1.18);
        s.y += (state.ship.y - 7 - s.y) * pull * 0.86 * clutchBoost;
        s.vy *= Math.exp(-8.4 * dt);
        state.threatPulse = Math.max(state.threatPulse, 0.08);
        rescue = fallingRescueWindow(s);
      }
      if (rescue.catch) {
        rescueSignal(s);
        continue;
      } else if (s.y >= terrainY(s.x) - 22) {
        s.status = 'ground';
        s.x = s.homeX;
        s.y = terrainY(s.x) - 22;
        s.vy = 0;
        s.liftedAt = 0;
        s.flash = 0.8;
        state.trace.contactsDropped += 1;
      }
    }
  }
}

function updateBeacons(dt: number): void {
  for (const b of state.beacons) {
    b.ttl -= dt;
    b.age += dt;
    if (distWrapped(b.x, b.y, state.ship.x, state.ship.y) < 48) {
      b.ttl = 0;
      state.trace.beaconsCollected += 1;
      const lifePickup = b.kind === 'life';
      if (lifePickup) {
        const before = state.timeLeft;
        addTime(TIME_PICKUP_SECONDS);
        const capped = state.timeLeft <= before + 0.5;
        state.score += capped ? 900 : 600;
        state.message = capped ? 'Clock Maxed!' : `+${TIME_PICKUP_SECONDS}s · Time`;
        spawnText(b.x, b.y - 46, capped ? 'CLOCK MAX' : `+${TIME_PICKUP_SECONDS}s`, '#8cffb4');
      } else {
        state.sats += b.value;
        state.score += b.value * 600 * scoreMultiplier();
        applyBeaconEffect(b);
      }
      state.messageUntil = beaconPickupMessageDuration(b);
      // 600B in-jokes: the roll of the 600 billion occasionally reminds you it
      // is definitely not a cult, and the very first pickup of a run says gm.
      const sixHundredFlavourKind = b.kind === 'rose' || b.kind === 'cake-piece' || b.kind === 'whole-cake' || b.kind === '600b';
      if (state.skill === '600b' && sixHundredFlavourKind && rand() < 0.25) {
        state.message = 'We Are Not A Cult';
        state.messageUntil = 1.8;
        // The denial speaks only on the medallion; rose and cake pickups have their own lines.
        if (b.kind === '600b') {
          playVoiceClip(CULT_VOICE_URL, 1.05);
          spawnVoiceLine(b.x, b.y - 66, 'WE ARE NOT A CULT!', '#ff9ce2');
        } else {
          spawnText(b.x, b.y - 66, 'WE ARE NOT A CULT', '#ff9ce2');
        }
      } else if (b.kind === '600b') {
        // The medallion's own bark pool, so the jackpot speaks even on the 75% of
        // pickups that don't roll the cult denial.
        const line = SIX_HUNDRED_B_VOICE_LINES[Math.floor(rand() * SIX_HUNDRED_B_VOICE_LINES.length)]!;
        state.message = line.caption;
        state.messageUntil = 1.8;
        playVoiceClip(line.url, 1.15);
        spawnVoiceLine(b.x, b.y - 66, line.caption, '#ffd84a');
      }
      if (state.trace.beaconsCollected === 1) {
        state.message = 'GM';
        state.messageUntil = 1.6;
        spawnText(b.x, b.y - 80, 'GM', '#ffd84a');
      }
      state.flash = Math.max(state.flash, 0.22);
      const colour = beaconColour(b.kind);
      spawnPickupFx(b.x, b.y, colour, lifePickup);
      if (lifePickup) playAudio('oneUp', 1.4);
      else playAudio(beaconPickupTone(b.kind), 1.45 + b.value * 0.18);
      if (b.kind === '600b') {
        // Carry the normal-mode reward lesson into 600B's signature moment: the
        // medallion is the jackpot, so it should LAND, not just tick — a
        // freeze-frame, gold star flare, confetti and a shockwave make hitting
        // the roll of the 600 billion feel like the jackpot it is.
        addHitstop(0.07);
        state.flash = Math.max(state.flash, 0.42);
        spawnStarFlare(b.x, b.y, '#ffd84a', 110, 0.34, 2.6);
        spawnSparkleBurst(b.x, b.y, ['#ffd84a', '#fff5d8', '#ffe14a'], 28, 250);
        spawnShockwave(b.x, b.y, '#ffd84a', 152, 0.34);
        spawnRing(b.x, b.y, '#ffd84a', 142);
        playAudio('musicSurge', 0.66);
      }
      // Every spoken clip pairs with its words as a floating subtitle.
      if (b.kind === 'rose') {
        playVoiceClip(ROSE_VOICE_URL, 1.15);
        spawnVoiceLine(b.x, b.y - 78, 'WANT ROSE, FREN?', beaconColour(b.kind));
      }
      if (b.kind === 'cult') {
        playVoiceClip(CULT_VOICE_URL, 1.15);
        spawnVoiceLine(b.x, b.y - 78, 'WE ARE NOT A CULT!', beaconColour(b.kind));
      }
      if (b.kind === 'cake-piece') {
        playVoiceClip(CAKE_VOICE_URL, 1.15);
        spawnVoiceLine(b.x, b.y - 78, 'SLICE OF CAKE, SIR?', beaconColour(b.kind));
      }
      if (b.kind === 'whole-cake') {
        playVoiceClip(WHOLE_CAKE_VOICE_URL, 1.15);
        spawnVoiceLine(b.x, b.y - 78, 'THE WHOLE CAKE, SIR?', beaconColour(b.kind));
      }
      if (b.kind === 'fourtwenty') {
        playVoiceClip(FOURTWENTY_VOICE_URL, 1.15);
        spawnVoiceLine(b.x, b.y - 78, "IT'S 4:20 SOMEWHERE", beaconColour(b.kind));
      }
      // Ship-system pickups (no character, unlike the flavour set above)
      // still get a spoken callout — every pickup should say what it is.
      if (b.kind === 'life') {
        playVoiceClip(LIFE_VOICE_URL, 1.15);
        spawnVoiceLine(b.x, b.y - 78, 'MORE TIME!', beaconColour(b.kind));
      }
      if (b.kind === 'shield') {
        playVoiceClip(SHIELD_VOICE_URL, 1.15);
        spawnVoiceLine(b.x, b.y - 78, 'SHIELD UP!', beaconColour(b.kind));
      }
      if (b.kind === 'relay') {
        playVoiceClip(RELAY_VOICE_URL, 1.15);
        spawnVoiceLine(b.x, b.y - 78, 'RELAY STABILISED!', beaconColour(b.kind));
      }
      if (b.kind === 'charge') {
        playVoiceClip(CHARGE_VOICE_URL, 1.15);
        spawnVoiceLine(b.x, b.y - 78, 'CHARGE CELL READY!', beaconColour(b.kind));
      }
      if (b.kind === 'zap') {
        playVoiceClip(ZAP_VOICE_URL, 1.15);
        spawnVoiceLine(b.x, b.y - 78, 'ZAP! DOUBLE SCORE!', beaconColour(b.kind));
      }
      if (b.kind === 'net') {
        playVoiceClip(NET_VOICE_URL, 1.15);
        spawnVoiceLine(b.x, b.y - 78, 'NET ACTIVE!', beaconColour(b.kind));
      }
      if (b.kind === 'multi') {
        playVoiceClip(MULTI_VOICE_URL, 1.15);
        spawnVoiceLine(b.x, b.y - 78, 'FANOUT ONLINE!', beaconColour(b.kind));
      }
      if (b.kind === 'timelock') {
        playVoiceClip(TIMELOCK_VOICE_URL, 1.15);
        spawnVoiceLine(b.x, b.y - 78, 'TIME LOCKED!', beaconColour(b.kind));
      }
    }
  }
  state.beacons = state.beacons.filter(b => b.ttl > 0);
}

function applyBeaconEffect(b: Beacon): void {
  if (b.kind === 'shield') {
    addShipShield(1);
    state.message = 'Shield Hardened';
    spawnText(b.x, b.y - 48, '+1 SHIELD', '#5effdb');
    return;
  }
  if (b.kind === 'charge') {
    addBurstCharge(1);
    state.ship.heat = Math.max(0, state.ship.heat - 0.72);
    state.ship.cooldown = 0;
    state.message = 'Charge Cell!';
    spawnText(b.x, b.y - 48, 'BURST READY', '#ffd84a');
    return;
  }
  if (b.kind === 'relay') {
    state.ship.invuln = Math.max(state.ship.invuln, 1.45);
    state.waveGrace = Math.max(state.waveGrace, 1.35);
    state.lowCamp = 0;
    state.threatPulse = Math.max(state.threatPulse, 0.42);
    state.message = 'Relay Stabilised';
    spawnText(b.x, b.y - 48, 'RELAY PULSE', '#8cffb4');
    spawnRescueShieldPulse(state.ship.x, state.ship.y, '#8cffb4', false);
    return;
  }
  if (b.kind === 'rose') {
    addShipShield(1);
    state.message = 'Want Rose, Fren?';
    spawnText(b.x, b.y - 48, '+ROSE SHIELD', '#ff4d8d');
    return;
  }
  if (b.kind === 'cake-piece') {
    addBurstCharge(1);
    state.ship.heat = 0;
    state.message = 'Got Cake!';
    spawnText(b.x, b.y - 48, 'CAKE CHARGE', '#ffd84a');
    return;
  }
  if (b.kind === 'whole-cake') {
    addShipShield(1);
    addBurstCharge(1);
    state.ship.heat = 0;
    state.message = 'Whole Cake!';
    spawnText(b.x, b.y - 48, 'SHIELD + BURST', '#ffd84a');
    return;
  }
  if (b.kind === '600b') {
    addShipShield(1);
    addBurstCharge(1);
    state.ship.invuln = Math.max(state.ship.invuln, 1.25);
    state.message = '$600B Boost!';
    spawnText(b.x, b.y - 48, '600B BOOST', '#ffd84a');
    return;
  }
  if (b.kind === 'cult') {
    state.ship.invuln = Math.max(state.ship.invuln, 1.6);
    state.combo = Math.min(40, state.combo + 3);
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    state.comboUntil = Math.max(state.comboUntil, 3);
    state.message = 'We Are NOT A Cult!';
    spawnText(b.x, b.y - 48, 'NOT A CULT', '#c58bff');
    return;
  }
  if (b.kind === 'multi') {
    state.fanout = Math.max(state.fanout, FANOUT_DURATION);
    state.message = 'Fanout! Triple Beam!';
    spawnText(b.x, b.y - 48, 'FANOUT x3', '#ffb03a');
    spawnRing(state.ship.x, state.ship.y, '#ffb03a', 112);
    spawnStarFlare(state.ship.x, state.ship.y, '#ffb03a', 62, 0.26, 3.2);
    return;
  }
  if (b.kind === 'scooter') {
    if (rand() < 0.65) {
      addBurstCharge(1);
      state.ship.invuln = Math.max(state.ship.invuln, 2);
      state.combo = Math.min(40, state.combo + 2);
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      state.comboUntil = Math.max(state.comboUntil, 3);
      state.message = 'Scooter Zoom!';
      spawnText(b.x, b.y - 48, 'DNI SCOOTER · ZOOM', '#7dcfff');
    } else {
      // The CEO precedent: sometimes the scooter wins. Weapons out while you
      // dust yourself off, with mercy invulnerability so it never kills.
      state.ship.cooldown = Math.max(state.ship.cooldown, 1.6);
      state.ship.heat = 1;
      state.ship.invuln = Math.max(state.ship.invuln, 1.6);
      state.shake = Math.max(state.shake, 0.42);
      state.damageCue = Math.max(state.damageCue, 0.8);
      state.message = 'Scooter Accident! Get Well Soon DNI';
      playVoiceClip(SCOOTER_ACCIDENT_VOICE_URL, 1.15);
      spawnVoiceLine(b.x, b.y - 48, 'GET WELL SOON, DNI', '#ff8a8a');
      playAudio('hit', 0.72);
    }
    return;
  }
  if (b.kind === 'fourtwenty') {
    state.chill = 4.2;
    state.score += 420 * scoreMultiplier();
    state.message = "It's 4:20 Somewhere";
    spawnText(b.x, b.y - 48, 'EVERYTHING CHILLS', '#8cff5a');
    spawnRing(state.ship.x, state.ship.y, '#8cff5a', 112);
    return;
  }
  if (b.kind === 'timelock') {
    // The trap pickup: the clock seizes and so does the ship. Frozen for
    // 2.100 seconds while the abductors keep working — but the aliens don't
    // get free shots at a ship that can't dodge (see shipProtected).
    state.timeLock = TIME_LOCK_FREEZE;
    state.ship.vx = 0;
    state.ship.vy = 0;
    state.message = 'TIME LOCKED';
    spawnText(b.x, b.y - 48, 'SHIP FROZEN', '#ff4d5e');
    spawnRing(state.ship.x, state.ship.y, '#ff4d5e', 118);
    spawnShockwave(state.ship.x, state.ship.y, '#ff4d5e', 96, 0.26);
    state.shake = Math.max(state.shake, 0.3);
    return;
  }
  if (b.kind === 'zap') {
    state.scoreSurge = 8;
    state.message = 'Zap! Double Score!';
    spawnText(b.x, b.y - 48, 'x2 SCORE', '#ffe14a');
    spawnRing(state.ship.x, state.ship.y, '#ffe14a', 108);
    playAudio('musicSurge', 0.66);
    return;
  }
  if (b.kind === 'net') {
    state.rescueNet = 7;
    state.message = 'WoT Net Active!';
    spawnText(b.x, b.y - 48, 'AUTO CATCH', '#8cffb4');
    spawnRescueShieldPulse(state.ship.x, state.ship.y, '#8cffb4', false);
    return;
  }
  state.message = beaconPickupMessage(b);
}

function scoreMultiplier(): number {
  return state.scoreSurge > 0 ? 2 : 1;
}

function beaconPickupMessageDuration(b: Beacon): number {
  // Every pickup with a spoken line holds the centre message long enough to
  // be read; the rest flash briefly.
  const spoken = b.kind === 'rose' || b.kind === 'cult' || b.kind === 'scooter'
    || b.kind === 'cake-piece' || b.kind === 'whole-cake' || b.kind === 'fourtwenty';
  return spoken ? 1.9 : 0.9;
}

function addShipShield(amount: number): void {
  const maxShield = state.skill === '600b' ? 2 : 3;
  state.ship.shieldHits = clamp(state.ship.shieldHits + amount, 0, maxShield);
  state.ship.invuln = Math.max(state.ship.invuln, 0.5);
  spawnRescueShieldPulse(state.ship.x, state.ship.y, '#5effdb', true);
  spawnStarFlare(state.ship.x, state.ship.y, '#5effdb', 62, 0.26, -2.8);
}

function addBurstCharge(amount: number): void {
  const cap = shipSpec(state.shipClass).burstCap;
  state.burstCharges = Math.min(cap, state.burstCharges + amount);
}

function updateParticles(dt: number): void {
  for (const p of state.particles) {
    p.x = wrapX(p.x + p.vx * dt);
    p.y += p.vy * dt;
    const drag = p.kind === 'chunk' ? 0.5 : p.kind === 'debris' ? 0.42 : p.kind === 'core' || p.kind === 'shockwave' ? 0.35 : 1.8;
    p.vx *= Math.exp(-drag * dt);
    p.vy *= Math.exp(-drag * dt);
    if (p.kind === 'debris' || p.kind === 'chunk') p.vy += (p.kind === 'debris' ? 46 : 92) * dt;
    if (p.grav) p.vy += p.grav * dt;
    if (p.spin) p.rot = (p.rot ?? 0) + p.spin * dt;
    p.ttl -= dt;
    p.age += dt;
  }
  state.particles = state.particles.filter(p => p.ttl > 0);
  if (state.particles.length > MAX_PARTICLES) state.particles.splice(0, state.particles.length - MAX_PARTICLES);
}

function maybeSpawnEnemy(dt: number): void {
  state.nextSpawn -= dt;
  if (state.spawnLeft <= 0 || state.nextSpawn > 0) return;
  const activePressure = activePressureEnemyCount();
  const pressureCap = pressureEnemySoftCap();
  if (activePressure >= pressureCap) {
    state.nextSpawn = 0.58 + Math.min(0.56, (activePressure - pressureCap + 1) * 0.14) + waveOpeningSpawnDelay();
    return;
  }
  if (firstWaveNeedsLaneRefill()) {
    state.spawnLeft -= 1;
    spawnOpeningLaneHunter();
    state.nextSpawn = 0.46;
    return;
  }
  if (firstWaveAbductorLimited()) {
    state.nextSpawn = 0.5 + firstWaveCalm() * 0.16;
    return;
  }
  state.spawnLeft -= 1;
  spawnEnemy();
  const nextActivePressure = activePressureEnemyCount();
  const breathingRoom = nextActivePressure >= pressureCap ? 0.34 : nextActivePressure >= pressureCap - 1 ? 0.2 : nextActivePressure > 4 ? 0.1 : 0;
  const portraitRoom = isPortraitViewport() ? 0.1 : 0;
  const openingRoom = firstWaveCalm() * 0.1;
  const earlyWaveRoom = state.wave <= 5 ? (6 - state.wave) * 0.032 : 0;
  const skillRoom = state.skill === 'cadet' ? 0.12 : state.skill === 'normal' ? 0.06 : -0.08;
  const spawnFloor = state.skill === '600b' ? 0.44 : state.wave <= 5 ? 0.5 : 0.56;
  state.nextSpawn = Math.max(
    spawnFloor,
    1.08 - state.wave * 0.028 + breathingRoom + portraitRoom + openingRoom + earlyWaveRoom + skillRoom + waveOpeningSpawnDelay() * 0.8,
  );
}

function firstWaveNeedsLaneRefill(): boolean {
  if (state.wave !== 1 || state.waveTimer < 1.55 || state.waveTimer > 18) return false;
  const active = state.enemies.filter(e => e.alive && e.type !== 'carrier');
  if (active.length >= 7) return false;
  const forwardPressure = active.some(e => {
    const dx = wrapDelta(e.x, state.ship.x) * state.ship.dir;
    return dx > -110 && dx < 840 && Math.abs(e.y - state.ship.y) < 340;
  });
  const visiblePressure = active.some(e => Math.abs(wrapDelta(e.x, cameraX)) < VIEW_W * 0.52);
  const huntersNear = active.some(e => e.type === 'hunter' && Math.abs(wrapDelta(e.x, state.ship.x)) < 760);
  return !forwardPressure || (!huntersNear && state.waveTimer > 5.2 && !visiblePressure);
}

function spawnOpeningLaneHunter(): void {
  const x = wrapX(state.ship.x + state.ship.dir * (340 + rand() * 210));
  const y = clamp(state.ship.y + (rand() - 0.5) * 130, PLAY_TOP + 58, terrainY(x) - 88);
  const hp = enemyHp('hunter');
  state.enemies.push({
    id: Math.floor(rand() * 1_000_000_000),
    type: 'hunter',
    hp,
    maxHp: hp,
    x,
    y,
    vx: -state.ship.dir * (132 + rand() * 54),
    vy: (rand() - 0.5) * 46,
    targetId: null,
    carryId: null,
    captureCharge: 0,
    shotCooldown: 0.92 + rand() * 0.28,
    muzzle: 0.44,
    phase: rand() * Math.PI * 2,
    age: 0,
    intent: 0.86,
    rescueGrace: 0,
    face: -state.ship.dir as -1 | 1,
    turnCue: 0.58,
    alive: true,
  });
  state.threatPulse = Math.max(state.threatPulse, 0.42);
  spawnRing(x, y, '#ff8a3a', 52);
}

function firstWaveRamp(): number {
  if (state.wave !== 1) return 1;
  return clamp(state.waveTimer / FIRST_WAVE_RAMP_SECONDS, 0, 1);
}

function firstWaveCalm(): number {
  return state.wave === 1 ? 1 - firstWaveRamp() : 0;
}

function firstWaveAbductorLimited(): boolean {
  if (state.wave !== 1) return false;
  const activeAbductors = state.enemies.filter(e => e.alive && e.type === 'abductor').length;
  const cap = state.waveTimer < 4.5 ? 2 : state.waveTimer < 10 ? 3 : 4;
  return activeAbductors >= cap;
}

function isBossWave(wave = state.wave): boolean {
  return wave > 0 && wave % skillSpec(state.skill).bossEvery === 0;
}

function waveOpeningCalm(): number {
  if (state.phase !== 'playing') return 0;
  const seconds = activeCarrier() ? BOSS_OPENING_SECONDS : WAVE_OPENING_SECONDS;
  const base = clamp(1 - state.waveTimer / seconds, 0, 1);
  return state.wave === 1 ? Math.max(base, firstWaveCalm()) : base * 0.72;
}

function waveOpeningEnemySpeed(): number {
  return 1 - waveOpeningCalm() * (activeCarrier() ? 0.1 : 0.04);
}

function earlyWaveEnemySpeed(): number {
  if (state.wave <= 0) return 1;
  if (state.wave === 1) return 1;
  if (state.wave === 2) return 0.98;
  if (state.wave === 3) return 0.98;
  if (state.wave === 4) return 0.99;
  return 1;
}

function waveOpeningSpawnDelay(): number {
  return waveOpeningCalm() * (activeCarrier() ? 0.22 : state.wave === 1 ? 0.015 : 0.05);
}

function seedOpeningThreats(wave: number): void {
  const bossWave = isBossWave(wave);
  const sixHundredB = state.skill === '600b';
  const pressureBonus = sixHundredB && !bossWave && wave >= 2 ? 1 : 0;
  const count = bossWave ? 1 : wave === 1 ? 2 : Math.min(sixHundredB ? 4 : 3, 1 + Math.floor(wave / 2) + pressureBonus);
  const candidates = state.signals.filter(s => s.status === 'ground');
  const near = [...candidates].sort((a, b) => Math.abs(wrapDelta(a.x, state.ship.x)) - Math.abs(wrapDelta(b.x, state.ship.x)));
  const opening = [...candidates].sort((a, b) => {
    const ad = wrapDelta(a.x, state.ship.x) * state.ship.dir;
    const bd = wrapDelta(b.x, state.ship.x) * state.ship.dir;
    const aScore = (ad >= -120 ? 0 : 900) + Math.abs(ad - 320) - relationWeight(a) * 120;
    const bScore = (bd >= -120 ? 0 : 900) + Math.abs(bd - 320) - relationWeight(b) * 120;
    return aScore - bScore;
  });
  const far = [...candidates].sort((a, b) => Math.abs(wrapDelta(b.x, state.ship.x)) - Math.abs(wrapDelta(a.x, state.ship.x)));
  for (let i = 0; i < count && state.spawnLeft > 0; i += 1) {
    const targets = wave === 1 ? opening : i === 0 ? near : far;
    state.spawnLeft -= 1;
    spawnEnemy(targets[i % Math.max(1, targets.length)], 'abductor');
  }
  if (!bossWave && wave === 1 && state.spawnLeft > 0) {
    state.spawnLeft -= 1;
    const hunter = spawnEnemy(undefined, 'hunter');
    if (hunter) {
      hunter.x = wrapX(state.ship.x + state.ship.dir * (340 + rand() * 160));
      hunter.y = clamp(state.ship.y + (rand() - 0.5) * 88, PLAY_TOP + 58, terrainY(hunter.x) - 90);
      hunter.vx = -state.ship.dir * 116;
      hunter.vy = (rand() - 0.5) * 34;
      hunter.face = -state.ship.dir as -1 | 1;
      hunter.intent = 0.72;
      hunter.shotCooldown = 1.28 + rand() * 0.32;
      hunter.muzzle = 0.42;
      hunter.turnCue = 0.58;
      spawnRing(hunter.x, hunter.y, '#ff8a3a', 48);
    }
  }
  if (!bossWave && wave >= 2 && state.spawnLeft > 0) {
    state.spawnLeft -= 1;
    spawnEnemy(undefined, 'hunter');
  }
  if (!bossWave && wave >= (sixHundredB ? 2 : 3) && state.spawnLeft > 0 && state.signals.some(s => s.relation === 'high-wot' && s.status === 'ground')) {
    state.spawnLeft -= 1;
    spawnEnemy(undefined, 'jammer');
  }
}

function maybeAdvanceWave(dt: number): void {
  if (state.spawnLeft > 0 || state.enemies.length > 0 || state.signals.some(s => s.status === 'carried' || s.status === 'falling')) {
    state.waveClear = 0;
    return;
  }
  if (state.waveClear <= 0) {
    state.waveClear = 1.8;
    state.score += 1200 + state.wave * 420;
    if (state.skill === '600b') {
      spawnBeacon(state.wave % 4 === 0 ? 3 : state.wave % 2 === 0 ? 2 : 1);
    } else if (state.signals.filter(s => s.status !== 'lost').length >= CONTACT_COUNT - 2) {
      spawnBeacon(2);
    }
    const comebackTime = state.timeLeft < 40 && state.wave > 1;
    if (state.timeLeft < MAX_TIME - 12 && (comebackTime || state.wave === 2 || (state.wave > 0 && state.wave % 3 === 0))) spawnBeacon(0, 'life');
    // A perfect wave — no ships lost, no contacts forged — arms a burst cell,
    // so the smart bomb stays earned rather than stocked.
    const perfect = state.wave > 0 && state.waveLivesLost === 0 && state.waveContactsLost === 0;
    const sx = state.ship.x;
    const sy = state.ship.y;
    if (perfect) {
      addBurstCharge(1);
      addTime(12);
      state.message = `PERFECT WAVE ${state.wave} · BURST ARMED`;
      spawnText(sx, sy - 66, 'PERFECT WAVE', '#ffd84a', undefined, 1.7);
      // A cleared screen falls silent — fill the beat with a real celebration
      // so a flawless wave feels like the achievement it is.
      state.flash = Math.max(state.flash, 0.4);
      spawnStarFlare(sx, sy, '#ffd84a', 104, 0.34, 2.4);
      spawnSparkleBurst(sx, sy, ['#ffd84a', '#fff5d8', '#5effdb'], 22, 220);
      spawnRing(sx, sy, '#ffd84a', 140);
      spawnShockwave(sx, sy, '#ffd84a', 150, 0.34);
      addHitstop(0.05);
      playAudio('pickupCharge', 1.35);
      playAudio('oneUp', 1.05);
      playAudio('musicSurge', 0.6);
    } else if (state.wave > 0) {
      // Even a scrappy hold gets a punctuating stinger and the wave number, so
      // the clear reads as progress rather than a sudden lull.
      addTime(6);
      state.message = `WAVE ${state.wave} HELD`;
      spawnText(sx, sy - 60, 'RELAY HELD', '#5effdb', undefined, 1.35);
      state.flash = Math.max(state.flash, 0.26);
      spawnStarFlare(sx, sy, '#5effdb', 82, 0.3, 2.0);
      spawnRing(sx, sy, '#5effdb', 118);
      playAudio('overtake', 0.92);
      playAudio('musicSurge', 0.42);
    } else {
      state.message = 'RELAY HELD';
    }
    state.messageUntil = 1.35;
    return;
  }
  state.waveClear -= dt;
  if (state.waveClear <= 0) {
    recordWaveDuration(true);
    startWave(state.wave + 1);
  }
}

function recordWaveDuration(cleared: boolean): void {
  if (state.wave <= 0) return;
  const seconds = Math.max(0, state.trace.elapsed - state.trace.currentWaveStartedAt);
  if (seconds <= 0.05 && !cleared) return;
  const last = state.trace.waveDurations[state.trace.waveDurations.length - 1];
  if (last && last.wave === state.wave) {
    last.seconds = Math.max(last.seconds, seconds);
    last.cleared = last.cleared || cleared;
    return;
  }
  state.trace.waveDurations.push({
    wave: state.wave,
    seconds,
    cleared,
  });
}

function spawnEnemy(forcedTarget?: Signal, forcedType?: EnemyType): Enemy | null {
  const type = forcedType ?? chooseWaveEnemyType(forcedTarget);
  const target = type === 'abductor' ? forcedTarget ?? pickSpawnSignal() : null;
  const side = rand() < 0.5 ? -1 : 1;
  const targetDx = target ? wrapDelta(target.x, state.ship.x) : 0;
  const openingLane = Boolean(target && state.wave <= 2 && state.waveTimer < 4);
  const targetSide = target && openingLane
    ? (targetDx < 0 ? 1 : -1)
    : target && Math.abs(targetDx) < 720
      ? (targetDx < 0 ? -1 : 1)
      : side;
  const targetDistance = openingLane ? 108 + rand() * 118 : 285 + rand() * 220;
  const freeDistance = state.wave === 1 && state.waveTimer < 4 ? 280 + rand() * 420 : 620 + rand() * 840;
  const x = target
    ? wrapX(target.x + targetSide * targetDistance)
    : wrapX(state.ship.x + side * freeDistance);
  const y = type === 'abductor' && target
    ? clamp(target.y - 305 - rand() * 120, PLAY_TOP + 38, GROUND_BASE - 124)
    : type === 'abductor'
      ? PLAY_TOP + 34 + rand() * 150
      : PLAY_TOP + 52 + rand() * 230;
  const enemy: Enemy = {
    id: Math.floor(rand() * 1_000_000_000),
    type,
    hp: enemyHp(type),
    maxHp: enemyHp(type),
    x,
    y,
    vx: 0,
    vy: 0,
    targetId: target?.id ?? null,
    carryId: null,
    captureCharge: 0,
    shotCooldown: initialEnemyShotCooldown(type),
    muzzle: 0,
    phase: rand() * Math.PI * 2,
    age: 0,
    intent: 0,
    rescueGrace: 0,
    face: target ? (targetSide < 0 ? -1 : 1) : (side < 0 ? -1 : 1),
    turnCue: 0,
    alive: true,
  };
  if (openingLane && target) {
    enemy.vx = wrapDelta(target.x, enemy.x) > 0 ? 80 : -80;
    enemy.muzzle = type === 'abductor' ? 0.12 : 0;
  }
  state.enemies.push(enemy);
  state.threatPulse = Math.max(state.threatPulse, type === 'abductor' ? 0.28 : type === 'hunter' ? 0.2 : type === 'jammer' ? 0.32 : type === 'spammer' ? 0.26 : type === 'sybil' ? 0.24 : type === 'troll' ? 0.22 : 0.16);
  // Decode Karen's scolds while the troll closes in, so every tier speaks instantly.
  if (type === 'troll') {
    state.lastTrollSpawnAt = state.trace.elapsed;
    preloadVoiceClip(TROLL_FEED_VOICE_URL);
    preloadVoiceClip(TROLL_FEED_VOICE_URL_2);
    preloadVoiceClip(TROLL_FEED_VOICE_URL_3);
  }
  // playVoiceClip below decodes-and-plays on first call (no separate preload
  // needed — this fires once per run, unlike the feed clips above which need
  // to be ready well before the first gulp lands).
  if (type === 'troll' && !state.trollSpotted) {
    state.trollSpotted = true;
    state.message = "Donkey's Gone Rogue!";
    state.messageUntil = 1.6;
    state.flash = Math.max(state.flash, 0.24);
    playVoiceClip(TROLL_SPOTTED_VOICE_URL, 1.15);
    spawnVoiceLine(enemy.x, enemy.y - 44, "DONKEY'S GONE ROGUE!", '#96ff3c');
  }
  return enemy;
}

function chooseWaveEnemyType(forcedTarget?: Signal): EnemyType {
  if (forcedTarget) return 'abductor';
  const sixHundredB = state.skill === '600b';
  const hunters = state.enemies.filter(e => e.alive && e.type === 'hunter').length;
  const jammers = state.enemies.filter(e => e.alive && e.type === 'jammer').length;
  const abductors = state.enemies.filter(e => e.alive && e.type === 'abductor').length;
  const active = state.enemies.filter(e => e.alive && e.type !== 'carrier').length;
  const roll = rand();
  const pressure = clamp(state.lowCamp / 2.4, 0, 1);
  const skillPush = sixHundredB ? 0.075 : state.skill === 'cadet' ? -0.04 : 0;
  const hunterWave = sixHundredB ? 3 : 4;
  const jammerWave = sixHundredB ? 2 : 3;
  const abductorFloor = sixHundredB ? Math.max(2, 5 - Math.floor(state.wave / 5)) : Math.max(2, 4 - Math.floor(state.wave / 4));

  if (state.wave >= hunterWave && hunters < 1 + Math.floor(state.wave / 5) + (sixHundredB && state.wave >= 6 ? 1 : 0) && roll < 0.08 + skillPush + pressure * 0.24) return 'hunter';
  if (state.wave >= jammerWave && jammers < 1 + Math.floor(state.wave / 7) + (sixHundredB && state.wave >= 8 ? 1 : 0) && roll < 0.14 + skillPush + pressure * 0.12) return 'jammer';
  const spammers = state.enemies.filter(e => e.alive && e.type === 'spammer').length;
  const sybils = state.enemies.filter(e => e.alive && e.type === 'sybil' && e.maxHp > 1).length;
  const spammerWave = sixHundredB ? 4 : 5;
  const sybilWave = sixHundredB ? 5 : 6;
  if (state.wave >= spammerWave && spammers < 1 + Math.floor(state.wave / 9) && roll < 0.2 + skillPush) return 'spammer';
  if (state.wave >= sybilWave && sybils < 1 + Math.floor(state.wave / 8) + (sixHundredB ? 1 : 0) && roll < 0.27 + skillPush) return 'sybil';
  const trolls = state.enemies.filter(e => e.alive && e.type === 'troll').length;
  const trollWave = sixHundredB ? 4 : 5;
  // A minimum real-time gap between troll spawns, on top of the concurrent-
  // count cap above — without it, a second troll could roll in moments after
  // (and land right on top of) the first once the wave-10+ cap allows two.
  const trollCooldownClear = state.trace.elapsed - state.lastTrollSpawnAt >= 22;
  if (state.wave >= trollWave && trolls < 1 + Math.floor(state.wave / 10) && trollCooldownClear && roll < 0.33 + skillPush) return 'troll';
  if (state.wave >= 5 && active > 4 && hunters < 2 + (sixHundredB ? 1 : 0) && roll > (sixHundredB ? 0.88 : 0.91)) return 'hunter';
  if (abductors < abductorFloor) return 'abductor';
  return roll < (sixHundredB ? 0.66 : 0.8) ? 'abductor' : state.wave >= hunterWave ? 'hunter' : 'abductor';
}

function initialEnemyShotCooldown(type: EnemyType): number {
  const openingRoom = state.wave === 1 ? 0.42 : state.waveGrace > 0 ? 0.24 : 0;
  if (type === 'hunter') return 0.85 + openingRoom + rand() * 0.65;
  if (type === 'jammer') return 1.1 + openingRoom + rand() * 0.85;
  if (type === 'spammer') return 1.55 + openingRoom + rand() * 0.8;
  if (type === 'forgery') return 0.92 + rand() * 0.5;
  if (type === 'carrier') return 2.35 + rand() * 1.05;
  if (type === 'abductor') return 2.4 + openingRoom + rand() * 1.2;
  return 99;
}

function spawnPressureHunter(label: string): void {
  const side = state.ship.dir > 0 ? -1 : 1;
  const x = wrapX(state.ship.x + side * (720 + rand() * 520));
  const y = clamp(state.ship.y + (rand() - 0.5) * 190, PLAY_TOP + 34, terrainY(x) - 68);
  state.enemies.push({
    id: Math.floor(rand() * 1_000_000_000),
    type: 'hunter',
    hp: enemyHp('hunter') + (state.wave >= 5 ? 1 : 0),
    maxHp: enemyHp('hunter') + (state.wave >= 5 ? 1 : 0),
    x,
    y,
    vx: side * (180 + state.wave * 10),
    vy: 0,
    targetId: null,
    carryId: null,
    captureCharge: 0,
    shotCooldown: 0.75 + rand() * 0.55,
    muzzle: 0,
    phase: rand() * Math.PI * 2,
    age: 0,
    intent: 0,
    rescueGrace: 0,
    face: side < 0 ? -1 : 1,
    turnCue: 0,
    alive: true,
  });
  state.threatPulse = Math.max(state.threatPulse, 0.24);
  state.message = label;
  state.messageUntil = 0.8;
  state.shake = Math.max(state.shake, 0.12);
  spawnRing(x, y, '#ff8a3a', 54);
  playAudio('lock', 0.85);
}

function spawnPressureJammer(label: string): void {
  const anchor = chooseJammerAnchor();
  const side = rand() < 0.5 ? -1 : 1;
  const x = anchor
    ? wrapX(anchor.x + side * (260 + rand() * 180))
    : wrapX(state.ship.x + side * (680 + rand() * 360));
  const y = anchor
    ? clamp(anchor.y - 230, PLAY_TOP + 38, terrainY(x) - 92)
    : PLAY_TOP + 70 + rand() * 130;
  state.enemies.push({
    id: Math.floor(rand() * 1_000_000_000),
    type: 'jammer',
    hp: enemyHp('jammer'),
    maxHp: enemyHp('jammer'),
    x,
    y,
    vx: 0,
    vy: 0,
    targetId: anchor?.id ?? null,
    carryId: null,
    captureCharge: 0,
    shotCooldown: 0.9 + rand() * 0.7,
    muzzle: 0,
    phase: rand() * Math.PI * 2,
    age: 0,
    intent: 0,
    rescueGrace: 0,
    face: side < 0 ? -1 : 1,
    turnCue: 0,
    alive: true,
  });
  state.threatPulse = Math.max(state.threatPulse, 0.34);
  state.message = label;
  state.messageUntil = 0.85;
  state.shake = Math.max(state.shake, 0.1);
  spawnRing(x, y, '#5f7cff', 58);
  playAudio('lock', 0.78);
}

function spawnGroundFlak(camp: number): void {
  const lead = clamp(state.ship.vx * 0.18, -190, 190);
  const aimBase = wrapX(state.ship.x + lead);
  const tower = nearestRelayColumnX(aimBase);
  const towerDelta = wrapDelta(tower, aimBase);
  const rawX = Math.abs(towerDelta) < RELAY_COLUMN_HALF * 0.86
    ? wrapX(tower + (rand() - 0.5) * 42)
    : wrapX(aimBase + (rand() < 0.5 ? -1 : 1) * (150 + rand() * 230));
  const x = avoidShipSpawnX(rawX, 230);
  const y = terrainY(x) - (Math.abs(towerDelta) < RELAY_COLUMN_HALF * 0.86 ? 84 : 18);
  const speed = 255 + state.wave * 5 + clamp(camp, 0, 2.6) * 26;
  const aimX = wrapX(state.ship.x + state.ship.vx * 0.14 + (rand() - 0.5) * 72);
  const aimY = clamp(state.ship.y - 28 - rand() * 44, PLAY_TOP + 28, terrainY(state.ship.x) - 86);
  const dx = wrapDelta(aimX, x);
  const dy = aimY - y;
  const d = Math.hypot(dx, dy) || 1;
  state.enemyShots.push({
    x,
    y,
    vx: (dx / d) * speed,
    vy: (dy / d) * speed,
    ttl: 1.18,
    age: 0,
    kind: camp > 1.4 ? 'barrage' : 'dart',
    nearMissed: false,
    armTime: 0.34,
    source: 'ground-flak',
  });
  state.threatPulse = Math.max(state.threatPulse, 0.18 + clamp(camp / 3, 0, 0.32));
  state.lowAltitudeWarning = 1;
  state.message = 'LOW ALTITUDE FLAK';
  state.messageUntil = 0.82;
  spawnText(x, y - 28, 'FLAK', camp > 1.4 ? '#ff2f7a' : '#ffd84a');
  spawnTrail(x, y, camp > 1.4 ? '#ff2f7a' : '#ff8a3a', camp > 1.4 ? 7 : 4);
  spawnRing(x, y, camp > 1.4 ? '#ff2f7a' : '#ffd84a', 38 + camp * 16);
  playAudio(camp > 1.4 ? 'carrierFire' : 'warning', 0.42 + clamp(camp / 3, 0, 0.42));
}

function avoidShipSpawnX(x: number, minDistance: number): number {
  const dx = wrapDelta(x, state.ship.x);
  if (Math.abs(dx) >= minDistance) return x;
  const side = dx >= 0 ? 1 : -1;
  return wrapX(state.ship.x + side * (minDistance + rand() * 70));
}

function spawnCarrier(): void {
  const side = rand() < 0.5 ? -1 : 1;
  const hp = enemyHp('carrier');
  const carrier: Enemy = {
    id: Math.floor(rand() * 1_000_000_000),
    type: 'carrier',
    hp: START_WOUNDED ? Math.max(1, Math.floor(hp * 0.44)) : hp,
    maxHp: hp,
    x: wrapX(state.ship.x + side * 520),
    y: PLAY_TOP + 112,
    vx: 0,
    vy: 0,
    targetId: null,
    carryId: null,
    captureCharge: 0,
    shotCooldown: START_WOUNDED ? 0.85 : 2.55 + rand() * 1.15,
    muzzle: START_WOUNDED ? 1 : 0,
    phase: rand() * Math.PI * 2,
    age: 0,
    intent: START_WOUNDED ? 1 : 0,
    rescueGrace: 0,
    face: side < 0 ? -1 : 1,
    turnCue: 0,
    alive: true,
  };
  state.enemies.push(carrier);
  state.flash = Math.max(state.flash, 0.18);
  state.threatPulse = Math.max(state.threatPulse, 0.9);
  state.shake = Math.max(state.shake, 0.18);
  state.message = START_WOUNDED ? 'CARRIER BROADSIDE' : 'CARRIER BREACH';
  state.messageUntil = START_WOUNDED ? 1.2 : 1.05;
}

function activeCarrier(): Enemy | null {
  return state.enemies.find(e => e.alive && e.type === 'carrier') ?? null;
}

function enemyHp(type: EnemyType): number {
  if (type === 'carrier') return 14 + state.wave * 2;
  if (type === 'hunter') return 2;
  if (type === 'jammer') return 3;
  if (type === 'forgery') return 2;
  if (type === 'spammer') return 2;
  if (type === 'sybil') return 3;
  if (type === 'troll') return 16;
  return 1;
}

// The donkey/bankster troll balloons up dramatically as it takes damage —
// a slow swell early on that accelerates into a proper "about to pop" bulge
// (over 6x its resting size) right before it finally goes down. Reuses
// hp/maxHp rather than a new stored field, so feeding it back to health (see
// hitEnemy's trollFeeding branch) also settles it back down, consistent
// with "less hurt, less big".
function trollGrowthScale(e: Enemy): number {
  if (e.type !== 'troll') return 1;
  const damageFrac = clamp(1 - e.hp / e.maxHp, 0, 1);
  return 1 + damageFrac ** 1.3 * 5.6;
}

// The last quarter of the troll's health is the "about to pop" telegraph
// window — flashing rainbow colours over the last stretch before it bursts.
function trollPopFlash(e: Enemy): number {
  if (e.type !== 'troll') return 0;
  const damageFrac = clamp(1 - e.hp / e.maxHp, 0, 1);
  return clamp((damageFrac - 0.75) / 0.25, 0, 1);
}

function pickSpawnSignal(): Signal | null {
  const candidates = state.signals.filter(s => s.status === 'ground');
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const aw = relationWeight(a) + Math.min(0.7, Math.abs(wrapDelta(a.x, state.ship.x)) / 1900);
    const bw = relationWeight(b) + Math.min(0.7, Math.abs(wrapDelta(b.x, state.ship.x)) / 1900);
    return bw - aw;
  });
  return candidates[Math.floor(rand() * Math.min(6, candidates.length))] ?? null;
}

function chooseTarget(e: Enemy): Signal | null {
  const existing = e.targetId ? signalById(e.targetId) : null;
  if (existing && existing.status === 'ground') return existing;
  const candidates = state.signals.filter(s => s.status === 'ground');
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => distWrapped(e.x, e.y, a.x, a.y) - distWrapped(e.x, e.y, b.x, b.y));
  e.targetId = candidates[0]?.id ?? null;
  return candidates[0] ?? null;
}

function chooseJammerAnchor(e?: Enemy): Signal | null {
  const existing = e?.targetId ? signalById(e.targetId) : null;
  if (existing && existing.status === 'ground') return existing;
  const candidates = state.signals.filter(s => s.status === 'ground');
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const threatDelta = signalUrgency(b) - signalUrgency(a);
    if (Math.abs(threatDelta) > 0.08) return threatDelta;
    const relationDelta = relationWeight(b) - relationWeight(a);
    if (relationDelta !== 0) return relationDelta;
    const ax = e ? Math.abs(wrapDelta(a.x, e.x)) : Math.abs(wrapDelta(a.x, state.ship.x));
    const bx = e ? Math.abs(wrapDelta(b.x, e.x)) : Math.abs(wrapDelta(b.x, state.ship.x));
    return ax - bx;
  });
  return candidates[0] ?? null;
}

function isInShipLaserLane(e: Enemy): boolean {
  const dx = wrapDelta(e.x, state.ship.x) * state.ship.dir;
  const dy = Math.abs(e.y - state.ship.y);
  const readyOrFiring = state.ship.cooldown < 0.04 || keys.has('Space') || keys.has('KeyJ') || touch.fire;
  return readyOrFiring && dx > 18 && dx < tunedLaserLength() + 120 && dy < 72;
}

function awayFromShip(e: Enemy): -1 | 1 {
  return wrapDelta(e.x, state.ship.x) < 0 ? -1 : 1;
}

function updateEnemyFacingCue(e: Enemy, dt: number): void {
  const desired = enemyDesiredFace(e);
  const shouldFlip = e.turnCue < 0.08 && (Math.abs(e.vx) > 44 || e.intent > 0.34 || e.type === 'hunter' || e.type === 'forgery' || e.type === 'sybil');
  if (desired !== e.face && shouldFlip) {
    e.face = desired;
    e.turnCue = Math.max(e.turnCue, 1);
    if (e.type !== 'carrier') e.vx *= 0.9;
  }
  e.turnCue = Math.max(0, e.turnCue - dt * (e.type === 'carrier' ? 1.35 : 2.45));
}

function enemyDesiredFace(e: Enemy): -1 | 1 {
  if (e.vx > 70) return 1;
  if (e.vx < -70) return -1;
  if (e.type === 'hunter' || e.type === 'forgery' || e.type === 'sybil') {
    const dx = wrapDelta(state.ship.x, e.x);
    return Math.abs(dx) > 130 ? (dx >= 0 ? 1 : -1) : e.face;
  }
  if (e.targetId !== null) {
    const target = signalById(e.targetId);
    if (target) {
      const dx = wrapDelta(target.x, e.x);
      return Math.abs(dx) > 105 ? (dx >= 0 ? 1 : -1) : e.face;
    }
  }
  const dx = wrapDelta(state.ship.x, e.x);
  return Math.abs(dx) > 150 ? (dx >= 0 ? 1 : -1) : e.face;
}

function forgeSignal(e: Enemy, s: Signal): void {
  const highValue = s.relation === 'high-wot';
  s.status = 'lost';
  s.carriedBy = null;
  s.vy = 0;
  s.liftedAt = 0;
  state.lost += 1;
  state.waveContactsLost += 1;
  state.trace.contactsForged += 1;
  state.combo = 0;
  state.comboUntil = 0;
  state.comboCalled = 0;
  e.type = 'forgery';
  e.targetId = null;
  e.carryId = null;
  e.captureCharge = 0;
  e.shotCooldown = 0.75;
  e.vx = 0;
  e.vy = 70;
  // The forgery wears the stolen identity: glitched avatar, name tag, and —
  // when the victim is a verified 600.wtf member — a tougher, richer bounty.
  e.forgedName = savedCalloutName(s);
  e.forgedPicture = signalAvatarPicture(s);
  e.forgedMember = isSixHundredMember(s.pubkey);
  if (e.forgedMember) {
    e.hp = 3;
    e.maxHp = 3;
  }
  const name = savedCalloutName(s).toUpperCase();
  state.message = e.forgedMember ? `${name} FORGED · 600B BOUNTY` : highValue ? `${name} WOT MUTATED` : `${name} MUTATED`;
  state.messageUntil = 1.2;
  state.flash = Math.max(state.flash, 0.28);
  state.threatPulse = Math.max(state.threatPulse, highValue ? 1 : 0.62);
  spawnText(e.x, e.y + 24, highValue ? `${name} BREACH` : `${name} LOST`, '#ff3aff');
  spawnBurst(e.x, e.y, '#ff3aff', 32, 210);
  playAudio('damage', 0.9);
  if (highValue && state.enemies.filter(enemy => enemy.alive && enemy.type === 'hunter').length < 4) {
    spawnPressureHunter('WOT BREACH');
  }
  maybeCollapseRelayFromContactLoss();
}

function hitEnemy(e: Enemy, damage: number, burst: boolean): void {
  if (e.type === 'troll' && !burst && trollFeeding(e)) {
    // Don't feed the troll: while it feeds, laser hits heal it instead of
    // hurting it. Bursts still bypass — the smart bomb argues with no one.
    e.hp = Math.min(e.maxHp, e.hp + damage * 0.5);
    e.intent = 1;
    spawnBurst(e.x, e.y, enemyColour('troll'), 4, 62);
    if (e.captureCharge <= 0) {
      e.captureCharge = 0.9;
      e.trollFeedCount = (e.trollFeedCount ?? 0) + 1;
      state.message = "Don't Feed The Donkey!";
      state.messageUntil = 0.9;
      playAudio('trollFeed', 0.85);
      // Karen tells you off once per run on the first troll — after that the
      // gulps carry the lesson, unless you keep going back to the SAME troll,
      // in which case she escalates on feeds 2 and 3+ of that one.
      if (!state.trollScolded) {
        state.trollScolded = true;
        playVoiceClip(TROLL_FEED_VOICE_URL, 1.15);
        spawnVoiceLine(e.x, e.y - 44, "DON'T FEED THE DONKEY!", '#96ff3c');
      } else if (e.trollFeedCount === 2) {
        playVoiceClip(TROLL_FEED_VOICE_URL_2, 1.15);
        spawnVoiceLine(e.x, e.y - 44, "I SAID, DON'T FEED IT!", '#96ff3c');
      } else if (e.trollFeedCount >= 3) {
        playVoiceClip(TROLL_FEED_VOICE_URL_3, 1.15);
        spawnVoiceLine(e.x, e.y - 44, "NO MORE DONKEY FOR YOU!", '#96ff3c');
      } else {
        spawnText(e.x, e.y - 44, 'FED!', '#96ff3c');
      }
    }
    return;
  }
  const carrierBreak = e.type === 'carrier' && e.hp > e.maxHp * 0.5 && e.hp - damage <= e.maxHp * 0.5;
  e.hp -= damage;
  spawnBurst(e.x, e.y, enemyColour(e.type), e.type === 'carrier' ? 10 : 5, e.type === 'carrier' ? 90 : 70);
  playAudio('hit', e.type === 'carrier' ? 0.8 : 0.55);
  if (e.type === 'carrier') {
    state.shake = Math.max(state.shake, 0.08);
    state.message = `CARRIER ${Math.ceil(Math.max(0, e.hp))}/${e.maxHp}`;
    state.messageUntil = 0.32;
  }
  if (carrierBreak && e.hp > 0) carrierPhaseBreak(e);
  if (e.hp <= 0) killEnemy(e, burst, burst ? 'burst' : 'shot');
}

function carrierPhaseBreak(e: Enemy): void {
  e.shotCooldown = Math.min(e.shotCooldown, 1.18);
  e.muzzle = 1;
  state.message = 'CARRIER ARMOR BREAK';
  state.messageUntil = 1.2;
  state.threatPulse = Math.max(state.threatPulse, 1);
  state.shake = Math.max(state.shake, 0.46);
  state.flash = Math.max(state.flash, 0.16);
  spawnText(e.x, e.y - 72, 'BROADSIDES ARMED', '#ffbdd2');
  spawnExplosionFlash(e.x, e.y, '#ff2f7a', 158, 0.18);
  spawnRing(e.x, e.y, '#ff2f7a', 128);
  spawnBurst(e.x, e.y, '#ff2f7a', 34, 260);
  spawnCarrierEscort(e, 210 * (wrapDelta(e.x, state.ship.x) < 0 ? -1 : 1));
  playAudio('burst', 1.05);
}

function spawnCarrierEscort(carrier: Enemy, offset: number): void {
  if (state.enemies.filter(e => e.alive && e.type === 'hunter').length >= 3) return;
  const x = wrapX(carrier.x + offset);
  const y = clamp(carrier.y + (offset < 0 ? -54 : 54), PLAY_TOP + 40, terrainY(x) - 76);
  const hp = enemyHp('hunter') + (state.wave >= 5 ? 1 : 0);
  state.enemies.push({
    id: Math.floor(rand() * 1_000_000_000),
    type: 'hunter',
    hp,
    maxHp: hp,
    x,
    y,
    vx: offset < 0 ? -180 : 180,
    vy: 0,
    targetId: null,
    carryId: null,
    captureCharge: 0,
    shotCooldown: 1.28 + rand() * 0.62,
    muzzle: 0,
    phase: rand() * Math.PI * 2,
    age: 0,
    intent: 0,
    rescueGrace: 0,
    face: offset < 0 ? -1 : 1,
    turnCue: 0,
    alive: true,
  });
  spawnTrail(x, y, '#ff8a3a', 4);
}

// Fire the highest newly-reached chain milestone (called after any combo bump,
// from kills and rescues alike). Only the top newly-crossed rung speaks, so a
// rescue that jumps the chain several links doesn't stack callouts.
function registerComboMilestone(): void {
  let reached: (typeof COMBO_MILESTONES)[number] | null = null;
  for (const tier of COMBO_MILESTONES) {
    if (state.combo >= tier.at && tier.at > state.comboCalled) reached = tier;
  }
  if (!reached) return;
  state.comboCalled = reached.at;
  spawnText(state.ship.x, state.ship.y - 84, reached.label, reached.colour, undefined, reached.scale);
  playAudio('musicSurge', 0.5 + (reached.at - 8) * 0.02);
  playVoiceClip(reached.voice, 1.1);
  if (reached.flare) {
    spawnStarFlare(state.ship.x, state.ship.y, reached.colour, 68 + reached.at, 0.3, 2.2);
    spawnSparkleBurst(state.ship.x, state.ship.y, [reached.colour, '#fff5d8'], 14, 200);
    state.flash = Math.max(state.flash, 0.24);
  }
  // Only the elite top rung freezes the frame — keeps the crunch special.
  if (reached.at >= 24) addHitstop(0.055);
}

function killEnemy(e: Enemy, burst: boolean, source: KillSource = burst ? 'burst' : 'shot'): void {
  e.alive = false;
  state.trace.kills[e.type] += 1;
  if (e.carryId !== null) {
    const s = signalById(e.carryId);
    if (s && s.status === 'carried') {
      if (shipCanSecureReleasedContact(e, s)) {
        rescueSignal(s, 'snatch');
        e.carryId = null;
        e.targetId = null;
      } else {
        s.status = 'falling';
        s.carriedBy = null;
        s.vy = -90;
        s.flash = 1;
        state.message = `CATCH ${signalDisplayName(s).toUpperCase()}`;
        state.messageUntil = 0.78;
        state.threatPulse = Math.max(state.threatPulse, 0.72);
        spawnText(s.x, s.y - 26, 'CATCH', '#fff5d8');
        spawnRing(s.x, s.y, '#fff5d8', 58);
      }
    }
  }
  const collision = source === 'collision';
  if (!collision) {
    state.combo = Math.min(40, state.combo + 1);
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    state.comboUntil = 2.6;
    if (state.combo >= 2) {
      // Every chain link blips a semitone-ish higher — the cheapest dopamine
      // in the genre. The announcer marks x8 once per chain.
      playAudio('comboTick', 0.7 + Math.min(state.combo, 20) * 0.02, 1 + Math.min(state.combo, 24) * 0.055);
      // Decode the announcers while the chain builds so each rung speaks instantly.
      if (state.combo === 4) for (const tier of COMBO_MILESTONES) preloadVoiceClip(tier.voice);
    }
    registerComboMilestone();
  }
  const base = e.type === 'carrier' ? 5200
    : e.type === 'forgery' ? (e.forgedMember ? 1200 : 850)
      : e.type === 'troll' ? 980
        : e.type === 'hunter' ? 760
          : e.type === 'spammer' ? 720
            : e.type === 'jammer' ? 680
              : e.type === 'sybil' ? (e.maxHp > 1 ? 540 : 260)
                : 430;
  const points = collision ? 0 : Math.floor(base * (1 + Math.floor(state.combo / 5) * 0.18) * (burst ? 0.65 : 1)) * scoreMultiplier();
  state.score += points;
  if (!collision) {
    const popScale = 1 + Math.min(state.combo, 20) * 0.05;
    spawnText(e.x, e.y - 24, `+${points}`, e.type === 'carrier' ? '#ffd84a' : enemyColour(e.type), undefined, popScale);
  }
  if (collision) {
    spawnBurst(e.x, e.y, enemyColour(e.type), 8, 92);
    spawnEnemyDeathDebris(e.x, e.y, e.vx, e.vy, e.type, true);
  } else {
    spawnEnemyKillFx(e.x, e.y, e.vx, e.vy, e.type);
  }
  if (e.type === 'carrier') {
    playAudio('boomArcade', 1.45);
  } else {
    const killPunch = e.type === 'hunter' ? 1.12 : e.type === 'jammer' ? 1.02 : e.type === 'forgery' ? 0.96 : 0.9;
    if (collision) playAudio('hit', 0.55);
    else playAudio('enemyBoomArcade', burst ? killPunch * 1.16 : killPunch, 1 + Math.min(state.combo, 18) * 0.022);
  }
  if (e.type === 'carrier') {
    state.message = 'CARRIER DOWN · BURST ARMED';
    state.messageUntil = 1.2;
    // A boss kill always arms a burst cell — the other half of the earned
    // smart-bomb rhythm alongside perfect waves — and buys a solid slab of time.
    addBurstCharge(1);
    if (!collision) addTime(6);
    spawnText(e.x, e.y - 52, 'BURST ARMED', '#ffd84a', undefined, 1.3);
    spawnBeacon(3);
    if (state.timeLeft < MAX_TIME - 12 && rand() < 0.38) spawnBeacon(0, 'life');
  }
  if (e.type === 'sybil' && e.maxHp > 1) spawnSybilShards(e);
  if (e.type === 'troll' && !collision) spawnText(e.x, e.y - 52, 'TOUCH GRASS', '#96ff3c');
  state.shake = Math.max(state.shake, collision ? 0.12 : e.type === 'carrier' ? 0.68 : burst ? 0.34 : 0.17);
  // Freeze-frame weighted by how big the kill is: a boss or troll pop lands
  // hard, a burst clear thumps once, and even a trash mob gets a one-frame
  // crunch so every shot that connects feels like it hit something.
  addHitstop(
    e.type === 'carrier' ? 0.09
      : e.type === 'troll' ? 0.075
        : collision ? 0.035
          : burst ? 0.05
            : e.type === 'forgery' && e.forgedMember ? 0.045
              : 0.022,
  );
}

function spawnSybilShards(parent: Enemy): void {
  state.message = 'SYBIL SPLIT';
  state.messageUntil = 0.85;
  state.threatPulse = Math.max(state.threatPulse, 0.52);
  for (const side of [-1, 1] as const) {
    const x = wrapX(parent.x + side * 38);
    const y = clamp(parent.y + side * 16, PLAY_TOP + 32, terrainY(x) - 64);
    state.enemies.push({
      id: Math.floor(rand() * 1_000_000_000),
      type: 'sybil',
      hp: 1,
      maxHp: 1,
      x,
      y,
      vx: side * (216 + state.wave * 8),
      vy: -side * 40,
      targetId: null,
      carryId: null,
      captureCharge: 0,
      shotCooldown: 99,
      muzzle: 0,
      phase: rand() * Math.PI * 2,
      age: 0,
      intent: 0.85,
      rescueGrace: 0.55,
      face: side,
      turnCue: 0,
      alive: true,
    });
    spawnTrail(x, y, enemyColour('sybil'), 5);
  }
  spawnRing(parent.x, parent.y, enemyColour('sybil'), 62);
  playAudio('lock', 0.68);
}

function spawnEnemyDeathDebris(x: number, y: number, vx: number, vy: number, type: EnemyType, collision: boolean): void {
  const colours = enemyDeathColours(type);
  const count = collision ? 4 : type === 'carrier' ? 24 : type === 'jammer' ? 12 : type === 'hunter' ? 10 : 8;
  const effective = particleSpawnCount(count, 'detail');
  const basePower = collision ? 90 : type === 'carrier' ? 360 : type === 'hunter' ? 280 : 220;
  for (let i = 0; i < effective; i += 1) {
    const a = rand() * Math.PI * 2;
    const speed = basePower * (0.3 + rand() * 0.92);
    const colour = colours[i % colours.length]!;
    const line = type === 'carrier' || i % 4 === 0;
    const block = !line && i % 2 === 0;
    emitParticle({
      x: wrapX(x + (rand() - 0.5) * (type === 'carrier' ? 74 : 28)),
      y: y + (rand() - 0.5) * (type === 'carrier' ? 38 : 18),
      vx: Math.cos(a) * speed + vx * 0.22,
      vy: Math.sin(a) * speed * 0.72 + vy * 0.16,
      ttl: line ? 0.9 + rand() * 0.8 : block ? 0.72 + rand() * 0.68 : 0.44 + rand() * 0.36,
      age: 0,
      size: line ? 1 : block ? 2.4 + rand() * 4.8 : 1.2 + rand() * 3.8,
      colour,
      kind: line ? 'debris' : block ? 'chunk' : 'spark',
      rot: a,
      spin: block ? (rand() - 0.5) * 9 : undefined,
      length: line ? 12 + rand() * (type === 'carrier' ? 34 : 22) : undefined,
      width: line ? 1.4 + rand() * 2.2 : undefined,
    });
  }
}

function scheduleEnemyExplosionAftershock(runId: string, x: number, y: number, colours: readonly string[], blast: number, type: EnemyType): void {
  window.setTimeout(() => {
    if (state.runId !== runId || state.phase === 'title') return;
    const colour = colours[1] ?? colours[0] ?? '#fff5d8';
    const carrier = type === 'carrier';
    const force = carrier ? 1.34 : blast;
    spawnExplosionFlash(x, y, colour, carrier ? 188 : 58 + force * 42, carrier ? 0.18 : 0.12);
    spawnShockwave(x, y, colour, carrier ? 152 : 58 + force * 44, carrier ? 0.28 : 0.2);
    spawnBurst(x, y, colour, Math.round(carrier ? 24 : 7 + force * 8), carrier ? 290 : 148 + force * 72);
    playAudio('enemyDebris', carrier ? 1.35 : type === 'hunter' ? 1.08 : type === 'jammer' ? 1.02 : 0.88);
  }, type === 'carrier' ? 115 : 72);
}

// The donkey/bankster troll's confetti send-off — a real rainbow, not the
// usual 4-colour type palette every other kill gets.
const RAINBOW_CONFETTI_COLOURS: readonly string[] = ['#ff3b3b', '#ff9a3a', '#ffd84a', '#96ff3c', '#5effdb', '#5f7cff', '#c58bff', '#ff5ad1'];

function enemyDeathColours(type: EnemyType): readonly string[] {
  if (type === 'carrier') return ['#ff2f7a', '#ffd84a', '#ffd5e5', '#5effdb'];
  if (type === 'jammer') return ['#5f7cff', '#b6c7ff', '#5effdb', '#ff3aff'];
  if (type === 'hunter') return ['#ff8a3a', '#ffd84a', '#fff5d8', '#5effdb'];
  if (type === 'forgery') return ['#ff3aff', '#5effdb', '#ffd84a', '#fff5d8'];
  if (type === 'spammer') return ['#8f5bff', '#c9a8ff', '#5effdb', '#fff5d8'];
  if (type === 'sybil') return ['#ff5ad1', '#ffb1e8', '#ffd84a', '#fff5d8'];
  if (type === 'troll') return ['#96ff3c', '#d4ffb0', '#5effdb', '#fff5d8'];
  return ['#ff4d5e', '#ffd84a', '#fff5d8', '#5effdb'];
}

function rescueSignal(s: Signal, mode: RescueMode = 'catch'): void {
  const wasFalling = s.status === 'falling';
  const wasCarried = s.status === 'carried';
  const groundGap = terrainY(s.x) - 22 - s.y;
  const clutch = wasFalling && (groundGap < 92 || s.vy > 280);
  const response = s.liftedAt > 0 ? state.trace.elapsed - s.liftedAt : 0;
  const catchX = s.x;
  const catchY = s.y;
  s.status = 'returning';
  s.carriedBy = null;
  s.vy = 68;
  s.liftedAt = 0;
  s.flash = 1.0;
  s.x = state.ship.x;
  s.y = state.ship.y + 38;
  state.rescued += 1;
  state.trace.contactsSaved += 1;
  if (response > 0) {
    state.trace.rescueResponseCount += 1;
    state.trace.rescueResponseTotal += response;
    state.trace.rescueResponseFastest = Math.min(state.trace.rescueResponseFastest, response);
    state.trace.rescueResponseSlowest = Math.max(state.trace.rescueResponseSlowest, response);
  }
  const snatch = mode === 'snatch' || wasCarried;
  state.combo = Math.min(40, state.combo + (clutch ? 4 : snatch ? 3 : 2));
  state.maxCombo = Math.max(state.maxCombo, state.combo);
  state.comboUntil = clutch ? 4.0 : snatch ? 3.5 : 3.0;
  // A rescue can vault the chain several links — mark any milestone it crosses.
  registerComboMilestone();
  const bonus = s.relation === 'high-wot' ? 1500 : s.relation === 'mutual' ? 1100 : 780;
  const clutchBonus = clutch ? 650 + s.rank * 6 : 0;
  const snatchBonus = snatch ? 520 + s.rank * 4 : 0;
  const total = (bonus + s.rank * 9 + clutchBonus + snatchBonus) * scoreMultiplier();
  state.score += total;
  // Saving the keys is the whole point — so it's the main way to buy back time.
  addTime(clutch ? 3 : snatch ? 2.5 : 2);
  const savedName = savedCalloutName(s);
  state.message = `${savedName} Saved`;
  state.messageUntil = snatch ? 1.18 : 1.0;
  spawnText(s.x, s.y - 42, `${clutch ? 'CLUTCH ' : snatch ? 'SNATCH ' : ''}RESCUE +${total}`, '#fff5d8');
  spawnText(catchX, catchY - 35, snatch ? 'CONTACT SECURED' : 'SAFE CATCH', '#5effdb');
  spawnText(state.ship.x, state.ship.y - 72, `${savedName} Saved`, '#5effdb');
  spawnRescueSweep(catchX, catchY, s.x, s.y, relationColour(s.relation), clutch, snatch);
  spawnRescueBurst(s.x, s.y, relationColour(s.relation), clutch || snatch);
  spawnRescueShieldPulse(s.x, s.y, relationColour(s.relation), clutch || snatch);
  spawnRing(catchX, catchY, snatch ? '#5effdb' : relationColour(s.relation), snatch ? 42 : 34);
  spawnRing(s.x, s.y, relationColour(s.relation), clutch ? 70 : snatch ? 58 : 48);
  spawnRing(state.ship.x, state.ship.y, '#5effdb', clutch ? 124 : snatch ? 108 : 92);
  spawnShockwave(state.ship.x, state.ship.y, '#5effdb', clutch ? 132 : snatch ? 112 : 94, 0.34);
  spawnExplosionFlash(state.ship.x, state.ship.y, '#5effdb', clutch ? 126 : snatch ? 108 : 88, 0.14);
  spawnBurst(state.ship.x, state.ship.y, '#fff5d8', clutch ? 18 : snatch ? 14 : 10, clutch ? 250 : 190);
  // The catch is the game's hero moment: star flare at the catch point and
  // twinkling confetti around the ship, scaled up for clutch saves.
  spawnStarFlare(s.x, s.y, '#fff5d8', clutch ? 96 : snatch ? 82 : 70, 0.3, 2.2);
  spawnSparkleBurst(state.ship.x, state.ship.y, [relationColour(s.relation), '#fff5d8', '#5effdb'], clutch ? 24 : 16, clutch ? 230 : 190);
  state.ship.invuln = Math.max(state.ship.invuln, clutch ? 1.22 : snatch ? 1.12 : 0.58);
  state.flash = Math.max(state.flash, clutch ? 0.38 : snatch ? 0.3 : 0.22);
  state.shake = Math.max(state.shake, clutch ? 0.26 : snatch ? 0.18 : 0.1);
  // The game's hero moment: a last-gasp clutch catch freezes for a beat so the
  // save reads as heroic. Routine safe catches stay fluid (they happen often).
  addHitstop(clutch ? 0.07 : snatch ? 0.04 : 0);
  if (clutch || snatch) state.threatPulse = 0;
  if (state.rescued > 0 && state.rescued % 4 === 0 && state.timeLeft < MAX_TIME - 12) {
    spawnBeacon(0, 'life');
  } else if (state.timeLeft < 25 && state.rescued > 0 && state.rescued % 3 === 0 && rand() < 0.55) {
    spawnBeacon(0, 'life');
  }
  const dropChance = state.skill === '600b'
    ? (s.relation === 'high-wot' ? 0.1 : s.relation === 'mutual' ? 0.07 : 0.045)
    : (s.relation === 'high-wot' ? 0.045 : s.relation === 'mutual' ? 0.035 : 0.022);
  if (rand() < dropChance) spawnBeacon(1);
  playAudio('rescue', (s.relation === 'high-wot' ? 1.38 : 1.12) + (snatch ? 0.24 : 0));
  playAudio('rescueBass', (s.relation === 'high-wot' ? 1.22 : 0.98) + (clutch ? 0.3 : snatch ? 0.2 : 0));
  playAudio('pickup', snatch ? 0.82 : clutch ? 0.68 : 0.5);
  if (clutch || snatch) playAudio('musicSurge', clutch ? 0.74 : 0.58);
  // The rescued fren thanks you on the dramatic saves. Clutch catches always
  // earn a bark (they are rare and heroic); snatches roll ~55%. A shared
  // cooldown keeps back-to-back saves from turning gratitude into chatter.
  const now = performance.now();
  if ((clutch || snatch) && now > rescueThanksReadyAt && (clutch || Math.random() < 0.55)) {
    rescueThanksReadyAt = now + 9000;
    const line = RESCUE_THANKS_LINES[Math.floor(Math.random() * RESCUE_THANKS_LINES.length)]!;
    playVoiceClip(line.url, 1.1);
    spawnVoiceLine(state.ship.x, state.ship.y - 96, line.text, '#5effdb');
  }
}

function spawnRescueSweep(fromX: number, fromY: number, toX: number, toY: number, colour: string, clutch: boolean, snatch = false): void {
  const count = clutch ? 34 : snatch ? 28 : 18;
  const dx = wrapDelta(toX, fromX);
  const dy = toY - fromY;
  const angle = Math.atan2(dy, dx || state.ship.dir);
  const distance = Math.hypot(dx, dy);
  const beamCount = snatch ? 16 : clutch ? 12 : 8;
  for (let i = 0; i < beamCount; i += 1) {
    const f = (i + 0.5) / beamCount;
    const drift = (rand() - 0.5) * (snatch ? 16 : 10);
    emitParticle({
      x: wrapX(fromX + dx * f + Math.cos(angle + Math.PI / 2) * drift),
      y: fromY + dy * f + Math.sin(angle + Math.PI / 2) * drift,
      vx: Math.cos(angle) * (snatch ? 132 : 96) + state.ship.vx * 0.12,
      vy: Math.sin(angle) * (snatch ? 132 : 96) - 18,
      ttl: 0.24 + rand() * (snatch ? 0.2 : 0.16),
      age: 0,
      size: 1,
      colour: i % 3 === 0 ? '#fff5d8' : colour,
      kind: 'beam',
      rot: angle,
      length: Math.max(24, Math.min(snatch ? 72 : 54, distance / (beamCount * 0.54))),
      width: snatch ? 4.2 : clutch ? 3.5 : 2.7,
    });
  }
  for (let i = 0; i < count; i += 1) {
    const f = (i + rand() * 0.7) / count;
    const x = wrapX(fromX + dx * f + (rand() - 0.5) * 18);
    const y = fromY + dy * f + (rand() - 0.5) * 14;
    const sparkAngle = angle + (rand() - 0.5) * 0.9;
    const speed = (clutch ? 90 : snatch ? 78 : 62) * (0.45 + rand() * 0.8);
    emitParticle({
      x,
      y,
      vx: Math.cos(sparkAngle) * speed + state.ship.vx * 0.08,
      vy: Math.sin(sparkAngle) * speed - 28 - rand() * 34,
      ttl: 0.36 + rand() * 0.34,
      age: 0,
      size: 1.1 + rand() * (clutch || snatch ? 2.6 : 1.8),
      colour: i % 4 === 0 ? '#fff5d8' : colour,
      kind: 'spark',
    });
  }
}

function spawnRescueBurst(x: number, y: number, colour: string, heroic: boolean): void {
  const rays = heroic ? 22 : 14;
  const speed = heroic ? 190 : 135;
  for (let i = 0; i < rays; i += 1) {
    const a = (i / rays) * Math.PI * 2 + rand() * 0.12;
    const length = (heroic ? 34 : 24) + rand() * (heroic ? 38 : 24);
    emitParticle({
      x: wrapX(x + Math.cos(a) * 7),
      y: y + Math.sin(a) * 7,
      vx: Math.cos(a) * speed * (0.35 + rand() * 0.5) + state.ship.vx * 0.08,
      vy: Math.sin(a) * speed * (0.35 + rand() * 0.5) + state.ship.vy * 0.06,
      ttl: 0.24 + rand() * 0.22,
      age: 0,
      size: 1,
      colour: i % 4 === 0 ? '#fff5d8' : i % 3 === 0 ? '#ffd84a' : colour,
      kind: 'beam',
      rot: a,
      length,
      width: heroic ? 3.8 : 2.6,
    });
  }
  spawnBurst(x, y, '#fff5d8', heroic ? 24 : 14, heroic ? 220 : 150);
}

function spawnRescueShieldPulse(x: number, y: number, colour: string, full: boolean): void {
  const rays = full ? 18 : 9;
  const radius = full ? 62 : 38;
  spawnRing(x, y, '#5effdb', full ? 76 : 48);
  spawnRing(x, y, colour, full ? 104 : 62);
  for (let i = 0; i < rays; i += 1) {
    const a = (i / rays) * Math.PI * 2 + rand() * 0.16;
    const side = i % 2 === 0 ? '#fff5d8' : colour;
    emitParticle({
      x: wrapX(x + Math.cos(a) * radius * 0.45),
      y: y + Math.sin(a) * radius * 0.26,
      vx: Math.cos(a) * (full ? 118 : 64) + state.ship.vx * 0.08,
      vy: Math.sin(a) * (full ? 76 : 42) + state.ship.vy * 0.04,
      ttl: full ? 0.34 + rand() * 0.22 : 0.18 + rand() * 0.14,
      age: 0,
      size: 1,
      colour: side,
      kind: 'beam',
      rot: a,
      length: full ? 34 + rand() * 34 : 18 + rand() * 18,
      width: full ? 3.6 : 2.4,
    });
  }
}

function spawnTetherBreak(enemyX: number, enemyY: number, contactX: number, contactY: number, colour: string): void {
  const dx = wrapDelta(contactX, enemyX);
  const dy = contactY - enemyY;
  const angle = Math.atan2(dy, dx || 1);
  for (let i = 0; i < 12; i += 1) {
    const f = (i + rand() * 0.65) / 12;
    const side = i % 2 === 0 ? -1 : 1;
    const x = wrapX(enemyX + dx * f + side * Math.sin(f * Math.PI) * (6 + rand() * 9));
    const y = enemyY + dy * f + (rand() - 0.5) * 8;
    emitParticle({
      x,
      y,
      vx: Math.cos(angle + side * 1.15) * (38 + rand() * 88),
      vy: Math.sin(angle + side * 1.15) * (38 + rand() * 88) - 16,
      ttl: 0.22 + rand() * 0.22,
      age: 0,
      size: 1,
      colour: i % 3 === 0 ? '#fff5d8' : colour,
      kind: 'beam',
      rot: angle + side * (0.18 + rand() * 0.32),
      length: 12 + rand() * 22,
      width: 2 + rand() * 1.5,
    });
  }
}

/** Seconds a single hit costs the clock, by skill. */
function hitTimePenalty(): number {
  return state.skill === 'cadet' ? 5 : state.skill === '600b' ? 7 : HIT_TIME_BASE;
}

/** Bank time onto the run clock (capped) and flash the TIME readout green. */
function addTime(seconds: number): void {
  if (seconds <= 0) return;
  const before = state.timeLeft;
  state.timeLeft = Math.min(MAX_TIME, state.timeLeft + seconds);
  if (state.timeLeft <= before + 0.01) return;
  state.timePop = 1;
  state.timePopGain = true;
}

/** Burn time off the clock and flash the TIME readout red. */
function spendTime(seconds: number): void {
  if (seconds <= 0) return;
  state.timeLeft = Math.max(0, state.timeLeft - seconds);
  state.timePop = 1;
  state.timePopGain = false;
}

/** The run's one terminal end: the clock stops. Blows the ship and rolls to
 *  the game-over screen. `time-lock` is the timeout; other sources (network
 *  loss, debug) reuse the same explosion but keep their own headline. */
function killShip(source: string): void {
  if (state.shipDestroyed) return;
  lastDeathSource = source;
  triggerPlayerExplosion(source, true);
  scheduleGameOverAfterExplosion(state.runId);
}

/** A non-fatal hit: the ship staggers (shake, flash, brief mercy invuln) but
 *  keeps flying — the cost is seconds off the clock, not a life. */
function staggerShip(source: string, penalty: number): void {
  const x = state.ship.x;
  const y = state.ship.y;
  state.ship.invuln = Math.max(state.ship.invuln, 1.3);
  state.flash = Math.max(state.flash, 0.5);
  state.shake = Math.max(state.shake, 0.62);
  state.damageCue = Math.max(state.damageCue, 0.95);
  state.threatPulse = Math.max(state.threatPulse, 0.85);
  // A short freeze sells the blow without the full death hold.
  addHitstop(0.05);
  state.message = `HIT · -${Math.round(penalty)}s`;
  state.messageUntil = 0.9;
  spawnText(x, y - 56, `-${Math.round(penalty)}s`, '#ff4d5e', undefined, 1.5);
  if (source.startsWith('collision:')) spawnText(x, y + 50, 'HULL IMPACT', '#ff4d5e');
  else if (source === 'ground-flak') spawnText(x, y + 50, 'LOW ALTITUDE FLAK', '#ffd84a');
  spawnExplosionFlash(x, y, '#ff8a3a', 92, 0.14);
  spawnRing(x, y, '#ff4d5e', 76);
  spawnShockwave(x, y, '#ff4d5e', 104, 0.26);
  spawnBurst(x, y, '#ff6a6a', 16, 240);
  spawnShipArcadeDots(x, y, 14, 0.4);
  playAudio('hit', 0.95);
  playAudio('shipBoom', 0.62);
}

function damageShip(forceGameover = false, source = 'unknown'): void {
  if (state.ship.invuln > 0 && !forceGameover) return;
  if (state.ship.shieldHits > 0 && !forceGameover) {
    state.ship.shieldHits -= 1;
    state.ship.invuln = Math.max(state.ship.invuln, 1.15);
    state.flash = Math.max(state.flash, 0.34);
    state.shake = Math.max(state.shake, 0.26);
    state.damageCue = Math.max(state.damageCue, 0.42);
    state.message = 'SHIELD HELD';
    state.messageUntil = 0.86;
    state.trace.damageEvents += 1;
    state.trace.damageBy[`shield:${source}`] = (state.trace.damageBy[`shield:${source}`] ?? 0) + 1;
    spawnText(state.ship.x, state.ship.y - 58, 'SHIELD BLOCK', '#5effdb');
    spawnRescueShieldPulse(state.ship.x, state.ship.y, '#5effdb', true);
    spawnRing(state.ship.x, state.ship.y, '#5effdb', 106);
    spawnShockwave(state.ship.x, state.ship.y, '#5effdb', 118, 0.28);
    playAudio('hit', 0.72);
    return;
  }
  state.trace.damageEvents += 1;
  state.trace.livesLost += 1;
  state.waveLivesLost += 1;
  state.trace.damageBy[source] = (state.trace.damageBy[source] ?? 0) + 1;
  state.combo = 0;
  state.comboCalled = 0;
  if (forceGameover) {
    killShip(source);
    return;
  }
  // Time model: a hit staggers the ship and costs seconds. The run only ends
  // if that penalty empties the clock — then it's TIME LOCKED like any timeout.
  const penalty = hitTimePenalty();
  spendTime(penalty);
  staggerShip(source, penalty);
  if (state.timeLeft <= 0) killShip('time-lock');
}

function maybeCollapseRelayFromContactLoss(): void {
  if (state.phase !== 'playing' || state.shipDestroyed) return;
  if (!state.signals.every(signal => signal.status === 'lost')) return;
  state.message = 'ALL CONTACTS LOST';
  state.messageUntil = 1.4;
  damageShip(true, 'network-loss');
}

function triggerPlayerExplosion(source: string, finalDeath: boolean): void {
  const x = state.ship.x;
  const y = state.ship.y;
  const runId = state.runId;
  state.shipDestroyed = true;
  state.ship.invuln = 999;
  state.ship.vx *= 0.22;
  state.ship.vy *= 0.1;
  state.flash = Math.max(state.flash, finalDeath ? 1.58 : 0.72);
  state.shake = Math.max(state.shake, finalDeath ? 1.95 : 0.72);
  // A hard freeze at the instant of death sells the blow before the debris
  // flies — the final death holds longest, a lost life a shorter beat.
  addHitstop(finalDeath ? 0.11 : 0.06);
  state.damageCue = Math.max(state.damageCue, finalDeath ? 1.62 : 0.82);
  state.threatPulse = Math.max(state.threatPulse, 1);
  state.message = source === 'time-lock' ? 'TIME LOCKED!' : source === 'network-loss' ? 'ALL CONTACTS LOST' : finalDeath ? 'RELAY DOWN' : 'SENTINEL DOWN';
  state.messageUntil = finalDeath ? 1.6 : 1.2;
  if (source.startsWith('collision:')) {
    spawnText(x, y + 54, 'HULL IMPACT', '#ff4d5e');
    spawnRing(x, y, '#ff4d5e', finalDeath ? 118 : 56);
  } else if (source === 'ground-flak') {
    spawnText(x, y + 54, 'LOW ALTITUDE FLAK', '#ffd84a');
    spawnRing(x, y, '#ffd84a', finalDeath ? 124 : 58);
  }
  spawnText(x, y - 68, source === 'time-lock' ? 'CLOCK STOPPED' : source === 'network-loss' ? 'RELAY COLLAPSE' : finalDeath ? 'SENTINEL LOST' : 'SENTINEL DOWN', '#fff5d8');
  if (finalDeath && source !== 'time-lock') spawnText(x, y - 96, `DOWNED BY ${killerLabel(source)}`, '#ff8a3a');
  spawnExplosionFlash(x, y, '#fff5d8', finalDeath ? 270 : 104, finalDeath ? 0.36 : 0.16);
  spawnExplosionCore(x, y, '#fff5d8', finalDeath ? 142 : 48, finalDeath ? 0.82 : 0.32);
  spawnExplosionCore(x + state.ship.dir * 18, y - 5, '#5effdb', finalDeath ? 96 : 34, finalDeath ? 0.52 : 0.24);
  spawnExplosionCore(x - state.ship.dir * 24, y + 8, '#ff4d8d', finalDeath ? 104 : 38, finalDeath ? 0.56 : 0.26);
  spawnShockwave(x, y, '#fff5d8', finalDeath ? 134 : 52, finalDeath ? 0.44 : 0.2);
  spawnShockwave(x, y, '#5effdb', finalDeath ? 248 : 82, finalDeath ? 0.56 : 0.24);
  if (finalDeath) spawnShockwave(x, y, '#ff4d8d', 390, 0.72);
  spawnBurst(x, y, '#fff5d8', finalDeath ? 64 : 16, finalDeath ? 690 : 210);
  spawnBurst(x, y, '#5effdb', finalDeath ? 52 : 12, finalDeath ? 780 : 240);
  spawnBurst(x, y, '#ff4d8d', finalDeath ? 44 : 10, finalDeath ? 720 : 220);
  spawnShipArcadeDots(x, y, finalDeath ? 104 : 24, finalDeath ? 1.34 : 0.48);
  spawnShipSquareChunks(x, y, finalDeath ? 92 : 20, finalDeath ? 1.38 : 0.42);
  for (const [colour, size] of [
    ['#fff5d8', finalDeath ? 104 : 48],
    ['#5effdb', finalDeath ? 184 : 74],
    ['#ff4d8d', finalDeath ? 274 : 108],
    ['#ffd84a', finalDeath ? 380 : 140],
  ] as const) {
    spawnRing(x, y, colour, size);
  }
  playAudio('shipBoom', finalDeath ? 1.8 : 1.45);
  if (finalDeath) {
    schedulePlayerExplosionPulse(runId, x, y, 180, 0.96, true);
    schedulePlayerExplosionPulse(runId, wrapX(x - state.ship.dir * 92), y + 16, 520, 0.78, true);
    schedulePlayerExplosionPulse(runId, wrapX(x + state.ship.dir * 136), y - 22, 900, 0.62, true);
    schedulePlayerExplosionPulse(runId, wrapX(x - state.ship.dir * 210), y - 8, 1320, 0.46, true);
  } else {
    schedulePlayerExplosionPulse(runId, x, y, 140, 0.22, false);
  }
}

function schedulePlayerExplosionPulse(runId: string, x: number, y: number, delayMs: number, force: number, finalDeath: boolean): void {
  window.setTimeout(() => {
    if (state.runId !== runId || !state.shipDestroyed) return;
    state.flash = Math.max(state.flash, (finalDeath ? 0.5 : 0.2) + force * (finalDeath ? 0.48 : 0.22));
    state.shake = Math.max(state.shake, (finalDeath ? 0.42 : 0.12) + force * (finalDeath ? 0.72 : 0.2));
    spawnExplosionFlash(x, y, force > 0.6 ? '#ffd84a' : '#ff4d8d', (finalDeath ? 96 : 38) + force * (finalDeath ? 128 : 44), finalDeath ? 0.18 + force * 0.12 : 0.1);
    spawnExplosionCore(x, y, force > 0.6 ? '#ffd84a' : '#ff4d8d', (finalDeath ? 56 : 24) + force * (finalDeath ? 76 : 26), finalDeath ? 0.3 + force * 0.2 : 0.18);
    spawnShockwave(x, y, force > 0.6 ? '#ffd84a' : '#5effdb', (finalDeath ? 116 : 44) + force * (finalDeath ? 210 : 58), finalDeath ? 0.4 + force * 0.22 : 0.18);
    spawnBurst(x, y, force > 0.6 ? '#ffd84a' : '#ff4d8d', Math.round((finalDeath ? 18 : 5) + force * (finalDeath ? 34 : 8)), (finalDeath ? 270 : 90) + force * (finalDeath ? 240 : 80));
    spawnShipArcadeDots(x, y, Math.round((finalDeath ? 20 : 4) + force * (finalDeath ? 34 : 8)), finalDeath ? 0.58 + force * 0.38 : 0.28);
    spawnShipSquareChunks(x, y, Math.round((finalDeath ? 12 : 3) + force * (finalDeath ? 24 : 5)), finalDeath ? 0.52 + force * 0.36 : 0.24);
    playAudio('boom', 0.9 + force * 0.48);
  }, delayMs);
}


function scheduleGameOverAfterExplosion(runId: string): void {
  window.setTimeout(() => {
    if (state.runId !== runId || state.phase !== 'playing' || !state.shipDestroyed) return;
    if (state.demo) {
      // The demo pilot doesn't get a funeral — straight back to the title.
      exitAttractRun();
      return;
    }
    state.phase = 'gameover';
    state.finishedAt = Date.now();
    state.message = lastDeathSource === 'time-lock' ? 'TIME LOCKED!' : 'RELAY DOWN';
    state.messageUntil = Number.POSITIVE_INFINITY;
    musicForceRefresh();
    gameOverNamePending = state.playerMode === 'guest';
    gameOverStage = VALUE_FOR_VALUE.configured ? 'support' : gameOverNamePending ? 'name' : 'score';
    gameOverSupportOpen = gameOverStage === 'support' || DEBUG_AUTO_SUPPORT;
    supportActionStatus = null;
    if (gameOverStage === 'name') beginGameOverNameEntry();
    recordFinishedRun();
    syncScoreActions();
  }, DEBUG_EXPLOSION ? 30000 : 2200);
}

function smartBurst(): void {
  if (state.burstCharges <= 0) return;
  state.burstCharges -= 1;
  state.trace.burstUses += 1;
  let kills = 0;
  for (const e of state.enemies) {
    if (!e.alive) continue;
    const visible = Math.abs(wrapDelta(e.x, cameraX)) < VIEW_W * 0.62;
    const threat = e.carryId !== null || distWrapped(e.x, e.y, state.ship.x, state.ship.y) < 560;
    if (visible || threat) {
      if (e.type === 'carrier') hitEnemy(e, 8, true);
      else {
        killEnemy(e, true, 'burst');
        kills += 1;
      }
    }
  }
  state.score += kills * 200;
  state.enemyShots = state.enemyShots.filter(shot => Math.abs(wrapDelta(shot.x, cameraX)) > VIEW_W * 0.62);
  state.flash = Math.max(state.flash, 0.3);
  state.shake = Math.max(state.shake, 0.46);
  playAudio('burst', 1);
}

function maybeAwardExtend(): void {
  while (state.score >= state.nextExtendAt) {
    state.nextExtendAt += EXTEND_STEP;
    // Score buys time — every 50k banks a slab of clock, plus a burst cell if
    // the clock is already near full so the milestone never feels wasted.
    const topped = state.timeLeft >= MAX_TIME - 15;
    addTime(15);
    if (topped) addBurstCharge(1);
    state.message = topped ? 'EXTEND · BURST CELL' : 'EXTEND · +15s';
    state.messageUntil = 1.7;
    state.flash = Math.max(state.flash, 0.3);
    spawnText(state.ship.x, state.ship.y - 66, topped ? 'EXTEND · BURST' : 'EXTEND +15s', '#8cffb4', undefined, 1.6);
    spawnRing(state.ship.x, state.ship.y, '#8cffb4', 124);
    spawnStarFlare(state.ship.x, state.ship.y, '#8cffb4', 84, 0.32, 2.4);
    // A short celebratory freeze punctuates the milestone fanfare.
    addHitstop(0.06);
    playAudio('extend', 1.4);
  }
}

function spawnBeacon(value: number, forcedKind?: BeaconKind): void {
  const side = rand() < 0.7 ? state.ship.dir : (state.ship.dir === 1 ? -1 : 1);
  const x = wrapX(state.ship.x + side * (360 + rand() * 640));
  const y = clamp(state.ship.y + (rand() - 0.5) * 220, PLAY_TOP + 70, GROUND_BASE - 120);
  const kind = forcedKind ?? chooseBeaconKind(value);
  const spriteIndex = kind === 'cake-piece' ? Math.floor(rand() * CAKE_PICKUPS.length) : 0;
  const ttl = kind === 'life' ? 9.5 : state.skill === '600b' ? 9.6 : 8.5;
  state.beacons.push({ x, y, ttl, age: 0, value, kind, spriteIndex });
  state.trace.beaconsSpawned += 1;
  // Decode the voice lines while the pickup is still on screen, so the collect speaks instantly.
  if (kind === 'rose') preloadVoiceClip(ROSE_VOICE_URL);
  if (kind === 'cult' || (state.skill === '600b' && kind === '600b')) preloadVoiceClip(CULT_VOICE_URL);
  if (kind === 'cake-piece') preloadVoiceClip(CAKE_VOICE_URL);
  if (kind === 'whole-cake') preloadVoiceClip(WHOLE_CAKE_VOICE_URL);
  if (kind === 'fourtwenty') preloadVoiceClip(FOURTWENTY_VOICE_URL);
  if (kind === 'scooter') preloadVoiceClip(SCOOTER_ACCIDENT_VOICE_URL);
  if (kind === '600b') for (const line of SIX_HUNDRED_B_VOICE_LINES) preloadVoiceClip(line.url);
  if (kind === 'life') preloadVoiceClip(LIFE_VOICE_URL);
  if (kind === 'shield') preloadVoiceClip(SHIELD_VOICE_URL);
  if (kind === 'relay') preloadVoiceClip(RELAY_VOICE_URL);
  if (kind === 'charge') preloadVoiceClip(CHARGE_VOICE_URL);
  if (kind === 'zap') preloadVoiceClip(ZAP_VOICE_URL);
  if (kind === 'net') preloadVoiceClip(NET_VOICE_URL);
  if (kind === 'multi') preloadVoiceClip(MULTI_VOICE_URL);
  if (kind === 'timelock') preloadVoiceClip(TIMELOCK_VOICE_URL);
  spawnRing(x, y, beaconColour(kind), kind === 'life' ? 92 : 78);
  playAudio('pickup', 0.55);
}

// Two voice casts ship side by side: the macOS `say` originals won the
// audition (default); the GPT studio takes stay behind ?voices=gpt.
const VOICE_SET: 'say' | 'gpt' = QUERY.get('voices') === 'gpt' ? 'gpt' : 'say';
function voiceUrl(name: string): string {
  return VOICE_SET === 'gpt' ? `/sfx/gpt-${name}.m4a` : `/sfx/${name}.m4a`;
}
const ROSE_VOICE_URL = voiceUrl('want-rose-fren');
// The chain announcer has no GPT twin — the say cast owns the booth (Grandpa
// en_GB). x8 was the only rung; x12/x16 and the top "Unstoppable!" extend the
// same voice so a long chain keeps paying off.
const CHAIN_VOICE_URL = '/sfx/chain-times-eight.m4a';
const CHAIN_12_VOICE_URL = '/sfx/chain-times-twelve.m4a';
const CHAIN_16_VOICE_URL = '/sfx/chain-times-sixteen.m4a';
const CHAIN_MAX_VOICE_URL = '/sfx/chain-unstoppable.m4a';
// Escalating chain milestones: each rung fires once per chain, tracked by
// state.comboCalled (re-armed when the chain breaks). Ordered ascending.
const COMBO_MILESTONES: ReadonlyArray<{
  at: number; label: string; colour: string; scale: number; voice: string; flare: boolean;
}> = [
  { at: 8, label: 'CHAIN x8', colour: '#ffd84a', scale: 1.7, voice: CHAIN_VOICE_URL, flare: false },
  { at: 12, label: 'CHAIN x12', colour: '#ffd84a', scale: 1.9, voice: CHAIN_12_VOICE_URL, flare: true },
  { at: 16, label: 'CHAIN x16', colour: '#ff8a3a', scale: 2.1, voice: CHAIN_16_VOICE_URL, flare: true },
  { at: 24, label: 'UNSTOPPABLE!', colour: '#ff4d5e', scale: 2.4, voice: CHAIN_MAX_VOICE_URL, flare: true },
];
// Grandma joins Grandpa in the booth: the scooter accident's get-well card.
const SCOOTER_ACCIDENT_VOICE_URL = '/sfx/get-well-soon-dni.m4a';
// Karen scolds anyone caught shooting a feeding troll. Once per run.
const TROLL_FEED_VOICE_URL = '/sfx/dont-feed-the-donkey.m4a';
// Karen's patience runs out if you keep feeding the SAME troll.
const TROLL_FEED_VOICE_URL_2 = '/sfx/dont-feed-the-donkey-2.m4a';
const TROLL_FEED_VOICE_URL_3 = '/sfx/dont-feed-the-donkey-3.m4a';
// Karen's entrance alert: the first troll spawn of a run only.
const TROLL_SPOTTED_VOICE_URL = '/sfx/donkeys-gone-rogue.m4a';
const CULT_VOICE_URL = voiceUrl('not-a-cult');
const CAKE_VOICE_URL = voiceUrl('slice-of-cake');
const FOURTWENTY_VOICE_URL = voiceUrl('four-twenty');
const WHOLE_CAKE_VOICE_URL = voiceUrl('whole-cake-sir');
// The plain ship-system pickups (no character, unlike rose/cult/cake/etc.)
// share one crisp "combat computer" announcer voice — no GPT twin recorded.
const LIFE_VOICE_URL = '/sfx/more-time.m4a';
const SHIELD_VOICE_URL = '/sfx/shield-up.m4a';
const RELAY_VOICE_URL = '/sfx/relay-stabilised.m4a';
const CHARGE_VOICE_URL = '/sfx/charge-ready.m4a';
const ZAP_VOICE_URL = '/sfx/zap-double-score.m4a';
const NET_VOICE_URL = '/sfx/net-active.m4a';
const MULTI_VOICE_URL = '/sfx/fanout-online.m4a';
// The trap pickup's cold system-voice verdict.
const TIMELOCK_VOICE_URL = '/sfx/time-locked.m4a';
// The rescued frens thank you — a small rotating cast in varied voices, so
// different saves sound like different members of the roll. Only the dramatic
// clutch/snatch catches trigger it, and a hard cooldown keeps gratitude a warm
// surprise rather than a running commentary. Cosmetic, so the pick uses
// Math.random (never the seeded rand()).
const RESCUE_THANKS_LINES: ReadonlyArray<{ url: string; text: string }> = [
  { url: '/sfx/thanks-fren.m4a', text: 'THANK YOU, FREN!' },
  { url: '/sfx/thanks-legend.m4a', text: "YOU'RE A LEGEND!" },
  { url: '/sfx/thanks-keys.m4a', text: 'YOU SAVED MY KEYS!' },
  { url: '/sfx/thanks-gm.m4a', text: 'GM · MUCH OBLIGED' },
  { url: '/sfx/thanks-hero.m4a', text: "YOU'RE MY HERO!" },
];
// performance.now() timestamp before which no gratitude bark may play. Uses
// wall-clock rather than a per-run reset so it needs no bookkeeping across
// runs (a stale cooldown self-clears within a few seconds of a fresh run).
let rescueThanksReadyAt = 0;
// The 600B medallion's own barks — GPT-4o-mini-tts (Onyx, German-accent
// instruction) won this audition on 2026-07-03, unlike the rest of the say
// cast, so these go straight to the gpt- clips rather than through
// voiceUrl()'s ?voices=gpt toggle. The macOS say takes stay in public/sfx/
// as 600b-*.m4a but aren't wired up. One of these fires whenever the
// cult-flavour roll below doesn't, so the jackpot pickup nearly always speaks.
const SIX_HUNDRED_B_VOICE_LINES: ReadonlyArray<{ url: string; caption: string }> = [
  { url: '/sfx/gpt-600b-fiat-nam.m4a', caption: 'FIAT NAM!' },
  { url: '/sfx/gpt-600b-all-time-high.m4a', caption: 'ALL TIME HIGH!' },
  { url: '/sfx/gpt-600b-meme.m4a', caption: 'MEME!' },
  { url: '/sfx/gpt-600b-time-lock.m4a', caption: 'TIME LOCK!' },
];

function beaconPickupTone(kind: BeaconKind): Parameters<typeof playAudio>[0] {
  if (kind === 'shield' || kind === 'rose') return 'pickupShield';
  if (kind === 'charge') return 'pickupCharge';
  if (kind === 'zap') return 'pickupZap';
  if (kind === 'net') return 'pickupNet';
  if (kind === 'cake-piece' || kind === 'whole-cake') return 'pickupCake';
  if (kind === '600b') return 'pickupJackpot';
  if (kind === 'cult') return 'pickupCult';
  if (kind === 'fourtwenty') return 'pickupFourTwenty';
  if (kind === 'scooter') return 'pickupScooter';
  if (kind === 'multi') return 'pickupMulti';
  if (kind === 'timelock') return 'pickupTimeLock';
  return 'pickupArcade';
}

function chooseBeaconKind(value: number): BeaconKind {
  // Zap and net are rare universal drops shared by both pickup economies.
  if (value >= 2) {
    const universalRoll = rand();
    if (universalRoll < 0.09) return 'zap';
    if (universalRoll < 0.17) return 'net';
    if (universalRoll < 0.225) return 'fourtwenty';
    if (universalRoll < 0.285) return 'multi';
    // The trap in the goody bag: same shelf as the best drops, so a greedy
    // grab sometimes seizes the clock instead.
    if (universalRoll < 0.33) return 'timelock';
  }
  if (state.skill !== '600b') {
    if (value >= 3) return 'charge';
    if (value >= 2) return rand() < 0.58 ? 'relay' : 'shield';
    // DNI rides in every economy — same 6% rarity the 600B roll gives it.
    const standardRoll = rand();
    if (standardRoll < 0.44) return 'relay';
    if (standardRoll < 0.74) return 'shield';
    if (standardRoll < 0.94) return 'charge';
    return 'scooter';
  }
  if (value >= 3) {
    const bigRoll = rand();
    if (bigRoll < 0.72) return 'whole-cake';
    return bigRoll < 0.88 ? 'cult' : '600b';
  }
  if (value >= 2) return rand() < 0.78 ? 'cake-piece' : 'rose';
  const roll = rand();
  if (roll < 0.44) return 'rose';
  if (roll < 0.76) return 'cake-piece';
  if (roll < 0.9) return 'cult';
  if (roll < 0.96) return 'scooter';
  return '600b';
}

function beaconPickupMessage(b: Beacon): string {
  if (b.kind === 'life') return 'Extra Life!';
  if (b.kind === 'rose') return 'Want Rose, Fren?';
  if (b.kind === 'cake-piece' || b.kind === 'whole-cake') return 'Got Cake!';
  if (b.kind === 'shield') return 'Shield Cache!';
  if (b.kind === 'relay') return 'Relay Cache!';
  if (b.kind === 'charge') return 'Charge Cell!';
  if (b.kind === 'zap') return 'Zap! Double Score!';
  if (b.kind === 'net') return 'WoT Net Active!';
  return b.value > 0 ? `+${b.value} CRED` : 'Credit Boost!';
}

function steer(e: Enemy, tx: number, ty: number, speed: number, dt: number): void {
  const dx = wrapDelta(tx, e.x);
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy) || 1;
  const tvx = (dx / d) * speed;
  const tvy = (dy / d) * speed;
  e.vx += (tvx - e.vx) * Math.min(1, dt * 3.2);
  e.vy += (tvy - e.vy) * Math.min(1, dt * 3.2);
}

function addEnemyStrafe(e: Enemy, amount: number, dt: number, vertical = 0.3): void {
  const phase = e.phase * (e.type === 'hunter' ? 2.2 : e.type === 'jammer' ? 1.55 : 1.25) + (e.id % 997) * 0.01;
  e.vx += Math.sin(phase) * amount * dt;
  e.vy += Math.cos(phase * 0.82) * amount * vertical * dt;
}

function render(t: number): void {
  fitCanvas();
  const meshMode = isMeshModeActive();
  syncMeshCanvas(meshMode);
  ctx.fillStyle = '#02040b';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  beginInterpolatedRender(renderAlpha);
  const shake = screenShake(t);
  ctx.save();
  ctx.translate(shake.x, shake.y);
  drawBackdrop(t);
  drawWorld(t, meshMode);
  ctx.restore();
  drawFlash();
  drawHud(t);
  drawMessages(t, meshMode);
  if (attractMode) drawAttractOverlay(t);
  applyPostFx(canvas, effectivePostFxTheme(), t * 1000);
  if (meshMode) meshModule?.renderMeshOverlay(makeMeshFrame(t));
  endInterpolatedRender();
}

function effectivePostFxTheme(): ReturnType<typeof getTheme> {
  const theme = getTheme();
  if (theme === 'none') return theme;
  // Full-canvas post-fx passes are the most expensive draw stage; shed them
  // entirely while the adaptive quality monitor has us on the low tier.
  if (renderQualityLow && state.phase === 'playing') return 'none';
  if (theme === 'crt' && (state.damageCue > 0.35 || state.shake > 0.7 || particleLoad() > PARTICLE_PRESSURE_LOAD)) return 'none';
  return theme;
}

function requestMeshOverlay(): void {
  if (meshAttempted || getVisualTier() !== 'mesh') return;
  meshAttempted = true;
  void loadMeshOverlay().then(module => module.ensureMeshOverlay({
    onContextLost: () => {
      // iOS drops WebGL contexts under memory pressure; fall back to the 2D
      // vector tier rather than leaving a frozen overlay on screen.
      setVisualTier('vector');
      meshAttempted = false;
      window.dispatchEvent(new CustomEvent('neonsentinel:mesh-status', { detail: { label: '3D CONTEXT LOST · USING VECTOR' } }));
    },
  })).catch(err => {
    meshAttempted = false;
    console.warn('Mesh overlay unavailable', err);
  });
}

function loadMeshOverlay(): Promise<MeshOverlayModule> {
  if (meshModule) return Promise.resolve(meshModule);
  if (!meshLoading) {
    meshLoading = import('./mesh-overlay.js')
      .then(module => {
        meshModule = module;
        return module;
      })
      .catch(err => {
        meshLoading = null;
        throw err;
      });
  }
  return meshLoading;
}

function isMeshModeActive(): boolean {
  if (getVisualTier() !== 'mesh') return false;
  requestMeshOverlay();
  return Boolean(meshModule?.isMeshOverlayReady());
}

function syncMeshCanvas(visible: boolean): void {
  const meshCanvas = meshModule?.getMeshCanvas();
  if (!meshCanvas) return;
  meshCanvas.style.visibility = visible ? 'visible' : 'hidden';
}

// Title has no run to show and the final screens clear the stage for the
// score panels, so the mesh overlay renders no actors in either phase.
function meshActorsHidden(): boolean {
  return state.phase === 'title' || state.phase === 'gameover';
}

function makeMeshFrame(t: number): MeshFrame {
  const viewport = visibleCanvasRect();
  const ship = meshFrameShip(viewport, t);
  return {
    phase: state.phase,
    viewW: VIEW_W,
    viewH: VIEW_H,
    worldW: WORLD_W,
    cameraX,
    dpr: renderPixelRatio(),
    t,
    ship,
    citizens: meshActorsHidden() ? [] : state.signals.map(signal => {
      const threat = contactThreat(signal);
      return {
        id: signal.id,
        relation: signal.relation,
        x: signal.x,
        y: signal.y,
        homeX: signal.homeX,
        homeY: terrainY(signal.homeX) - 22,
        status: signal.status === 'ground' ? 'waiting' : signal.status,
        savedFlash: signal.flash,
        avatarUrl: signalAvatarPicture(signal),
        threat: threat.urgency,
        capture: threat.capture,
        targeted: threat.targeted,
      };
    }),
    enemies: meshActorsHidden() ? [] : state.enemies.map(enemy => ({
      targetX: enemy.targetId ? signalById(enemy.targetId)?.x ?? null : null,
      targetY: enemy.targetId ? signalById(enemy.targetId)?.y ?? null : null,
      id: enemy.id,
      type: enemy.type === 'forgery' ? 'spoof' : enemy.type,
      sizeScale: (enemy.type === 'sybil' && enemy.maxHp <= 1 ? 0.62 : 1) * trollGrowthScale(enemy),
      popFlash: trollPopFlash(enemy),
      stolenAvatarUrl: enemy.forgedPicture,
      x: enemy.x,
      y: enemy.y,
      vx: enemy.vx,
      vy: enemy.vy,
      carryingCitizenId: enemy.carryId,
      captureCharge: enemy.captureCharge,
      muzzle: enemy.muzzle,
      phase: enemy.phase,
      face: enemy.face,
      turnCue: enemy.turnCue,
      intent: enemy.intent,
    })),
    beacons: meshActorsHidden() ? [] : state.beacons.map(beacon => ({
      x: beacon.x,
      y: beacon.y,
      age: beacon.age,
      value: beacon.value,
      kind: beacon.kind,
      spriteIndex: beacon.spriteIndex,
    })),
    lasers: meshActorsHidden() ? [] : state.lasers.map(laser => ({
      x: laser.x,
      y: laser.y,
      dir: laser.dir,
      ttl: laser.ttl,
      length: laser.length,
      heat: laser.heat,
      impact: laser.impact,
      impactX: laser.impactX,
      impactY: laser.impactY,
    })),
    enemyShots: meshActorsHidden() ? [] : state.enemyShots.map(shot => ({
      x: shot.x,
      y: shot.y,
      vx: shot.vx,
      vy: shot.vy,
      ttl: shot.ttl,
      age: shot.age,
      kind: shot.kind,
    })),
    tuning: {
      actorScale: getTuning().actorScale,
      contactScale: getTuning().contactScale,
      captureLockTime: tunedCaptureLockTime(),
    },
    viewport: {
      portrait: viewport.portrait,
      cropped: viewport.cropped,
      visibleW: viewport.w,
    },
  };
}

function meshFrameShip(viewport: VisibleCanvasRect, t: number): MeshFrame['ship'] {
  if (state.phase === 'title') {
    const layout = titleMenuLayout(viewport);
    const compact = usePortraitHud(viewport);
    const screenX = compact ? layout.shipCard.x + layout.shipCard.w * 0.25 : layout.shipCard.x + layout.shipCard.w * 0.24;
    const screenY = layout.shipCard.y + (compact ? 90 : 90);
    return {
      x: wrapX(cameraX + screenX - VIEW_W / 2),
      y: screenY,
      vx: 520 + Math.sin(t * 1.3) * 90,
      vy: Math.sin(t * 1.8) * 80,
      speed: 680,
      dir: 1,
      invuln: 0,
      shieldHits: 0,
      heat: 0.08,
      turnCue: titleMenuField === 'ship' ? 0.42 : 0.18,
      shipClass: selectedShip,
      destroyed: false,
    };
  }
  return {
    x: state.ship.x,
    y: state.ship.y,
    vx: state.ship.vx,
    vy: state.ship.vy,
    speed: Math.hypot(state.ship.vx, state.ship.vy),
    dir: state.ship.dir,
    invuln: state.ship.invuln,
    shieldHits: state.ship.shieldHits,
    heat: state.ship.heat,
    turnCue: state.ship.turnCue,
    shipClass: state.shipClass,
    destroyed: state.shipDestroyed,
  };
}

function makeDebugFrame() {
  const viewport = visibleCanvasRect();
  const frame = makeMeshFrame(performance.now() / 1000);
  const activeEnemies = state.enemies.filter(e => e.alive && e.type !== 'carrier');
  const carrier = activeCarrier();
  const visibleEnemies = activeEnemies.filter(e => Math.abs(wrapDelta(e.x, cameraX)) < VIEW_W * 0.56);
  const closestEnemyDistance = activeEnemies.length > 0
    ? Math.min(...activeEnemies.map(e => Math.abs(wrapDelta(e.x, state.ship.x))))
    : null;
  const targetedContacts = state.signals
    .map(signal => ({ signal, threat: contactThreat(signal) }))
    .filter(item => item.threat.targeted || item.signal.status === 'carried' || item.signal.status === 'falling');
  return {
    ...frame,
    phase: state.phase,
    demo: state.demo,
    daily: state.daily,
    wave: state.wave,
    timeLeft: state.timeLeft,
    timePop: state.timePop,
    timeLock: state.timeLock,
    waveTimer: state.waveTimer,
    waveGrace: state.waveGrace,
    hitstop: state.hitstop,
    combo: state.combo,
    maxCombo: state.maxCombo,
    comboCalled: state.comboCalled,
    scorePop: state.scorePop,
    lowAltitudeWarning: state.lowAltitudeWarning,
    lowCamp: state.lowCamp,
    spawnLeft: state.spawnLeft,
    nextSpawn: state.nextSpawn,
    cameraX,
    message: state.message,
    enemiesVisible: visibleEnemies.length,
    carrier: carrier ? {
      hp: carrier.hp,
      maxHp: carrier.maxHp,
      visible: Math.abs(wrapDelta(carrier.x, cameraX)) < VIEW_W * 0.56,
      wounded: carrier.hp <= carrier.maxHp * 0.5,
    } : null,
    closestEnemyDistance,
    targetedContacts: targetedContacts.map(({ signal, threat }) => ({
      id: signal.id,
      name: signalDisplayName(signal),
      status: signal.status,
      label: threat.label,
      urgency: threat.urgency,
      x: signal.x,
      y: signal.y,
    })),
    trace: playtestTraceSummary(false),
    audio: getAudioDebugSnapshot(),
    music: getMusicDebugSnapshot(),
    profileImages: profileImageDebugSummary(),
    radar: makeRadarDebugFrame(viewport),
    titleMenu: {
      field: titleMenuField,
      ship: selectedShip,
      skill: selectedSkill,
      visual: getVisualTier(),
      paymentModalOpen: titlePaymentModalOpen,
      valueStatus: titleValueStatus,
    },
    titleHitBoxes: state.phase === 'title'
      ? titleMenuButtons().map(button => ({
        action: button.action,
        label: button.label,
        x: button.x,
        y: button.y,
        w: button.w,
        h: button.h,
      }))
      : [],
    valueThanksVisible,
    scoreStatus,
    scoreActionsVisible: scoreActions instanceof HTMLElement ? !scoreActions.hidden : false,
    gameOverStage,
    gameOverSupportOpen,
    gameOverValueButtons: valueMethodButtons().length,
    leaderboardEntries: gameOverBoard?.entries.length ?? 0,
    leaderboardSource: gameOverBoard?.source ?? null,
    scoreSupportLinks: [valueSupportLink, geyserSupportLink, kofiSupportLink]
      .filter((element): element is HTMLAnchorElement => element instanceof HTMLAnchorElement)
      .map(element => ({
        id: element.id,
        hidden: element.hidden,
        text: element.textContent ?? '',
        href: element.href,
      })),
  };
}

function makeRadarDebugFrame(viewport: VisibleCanvasRect) {
  const area = radarHudArea(viewport);
  const shipX = radarX(area, state.ship.x);
  const shipY = radarY(area, state.ship.y);
  const cameraBoxW = (area.viewW / WORLD_W) * area.w;
  const cameraBoxX = radarX(area, cameraX - area.viewW / 2);
  return {
    portraitHud: usePortraitHud(viewport),
    viewport: {
      x: viewport.x,
      y: viewport.y,
      w: viewport.w,
      h: viewport.h,
      portrait: viewport.portrait,
      cropped: viewport.cropped,
    },
    area,
    ship: {
      worldX: state.ship.x,
      worldY: state.ship.y,
      x: shipX,
      y: shipY,
      insideRadar: shipX >= area.x && shipX <= area.x + area.w && shipY >= area.y && shipY <= area.y + area.h,
      insideVisibleCrop: shipX >= viewport.x && shipX <= viewport.x + viewport.w && shipY >= viewport.y && shipY <= viewport.y + viewport.h,
    },
    cameraBox: {
      x: cameraBoxX,
      w: cameraBoxW,
      wraps: cameraBoxX + cameraBoxW > area.x + area.w,
    },
  };
}

let signalProfileRetryTimer: number | null = null;
let signalProfileAttempts = 0;

function primeSignalProfiles(force = false): void {
  signalProfileAttempts = 0;
  for (const signal of state.signals) {
    signal.profile = force ? null : getCachedProfile(signal.pubkey);
  }
  preloadProfileImages(state.signals);
  requestSignalProfileFetch(force);
}

function requestSignalProfileFetch(force: boolean): void {
  if (signalProfileRetryTimer !== null) {
    window.clearTimeout(signalProfileRetryTimer);
    signalProfileRetryTimer = null;
  }
  signalProfileAttempts += 1;
  void fetchProfiles(state.signals.map(signal => signal.pubkey), { force, refreshMissingPictures: true, timeoutMs: 8000 }).then(profiles => {
    for (const signal of state.signals) {
      const profile = profiles.get(signal.pubkey);
      if (profile) signal.profile = profile;
    }
    preloadProfileImages(state.signals);
    // Page-load socket contention regularly starves the first fetch before
    // the relays finish their handshakes, so retry until the roster has
    // pictures or the bounded attempts run out.
    if (state.signals.some(signal => !signal.profile?.picture) && signalProfileAttempts < 4) {
      signalProfileRetryTimer = window.setTimeout(() => {
        signalProfileRetryTimer = null;
        requestSignalProfileFetch(false);
      }, 6000);
    }
  }).catch(() => { /* profile pictures are opportunistic; gameplay must never wait on relays */ });
}

function preloadProfileImages(signals: readonly Signal[]): void {
  const ordered = [...signals]
    .filter(signal => profilePictureCandidates(signalAvatarPicture(signal)).length > 0)
    .sort((a, b) => relationWeight(b) - relationWeight(a) || b.rank - a.rank);
  for (const signal of ordered) ensureProfileImageEntry(signalAvatarPicture(signal));
}

function profileImageDebugSummary(): { profiles: number; loaded: number; loading: number; failed: number; queued: number } {
  let loaded = 0;
  let failed = 0;
  for (const entry of profileImageCache.values()) {
    if (entry.loaded) loaded += 1;
    else if (entry.failed) failed += 1;
  }
  return {
    profiles: state.signals.filter(signal => Boolean(signal.profile?.picture)).length,
    loaded,
    loading: activeProfileImageLoads,
    failed,
    queued: pendingProfileImageLoads.length,
  };
}

function drawBackdrop(t: number): void {
  if (backdrop.complete && backdrop.naturalWidth > 0) {
    const parallax = wrapDelta(cameraX, WORLD_W / 2) * 0.012;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(backdrop, -86 - parallax, 0, VIEW_W + 172, VIEW_H);
    ctx.globalAlpha = 1;
  }

  drawAuroraNebula(t);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const lowCost = lowCostRender();
  for (let i = 0; i < stars.length; i += lowCost ? 2 : 1) {
    const star = stars[i]!;
    const sx = VIEW_W / 2 + wrapDelta(star.x, cameraX * (0.08 + star.depth * 0.25));
    if (sx < -4 || sx > VIEW_W + 4) continue;
    const twinkle = 0.45 + Math.sin(t * (1.4 + star.depth * 2.1) + star.phase) * 0.28;
    ctx.globalAlpha = (0.2 + star.depth * 0.55) * twinkle;
    ctx.fillStyle = star.depth > 0.72 ? '#fff8c7' : '#bdfcff';
    ctx.fillRect(sx, star.y * 0.84 + 14, 1 + star.depth * 2.2, 1 + star.depth * 2.2);
  }
  ctx.restore();

  const shade = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  shade.addColorStop(0, 'rgba(1,4,9,0.22)');
  shade.addColorStop(0.42, 'rgba(1,8,15,0.3)');
  shade.addColorStop(0.86, 'rgba(0,6,9,0.42)');
  shade.addColorStop(1, 'rgba(0,3,5,0.7)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const corridor = ctx.createLinearGradient(0, PLAY_TOP, 0, GROUND_BASE);
  corridor.addColorStop(0, 'rgba(0,0,0,0.12)');
  corridor.addColorStop(0.42, 'rgba(0,0,0,0.18)');
  corridor.addColorStop(1, 'rgba(0,0,0,0.06)');
  ctx.fillStyle = corridor;
  ctx.fillRect(0, PLAY_TOP - 6, VIEW_W, GROUND_BASE - PLAY_TOP + 24);

  updateAndDrawMeteor(t);
  drawRelayWeather(t);
}

// Slow-drifting coloured nebula clouds high in the sky — soft radial glows on
// a screen blend, breathing in and out. Pure atmosphere: render-only, no gameplay
// coupling. Kept cheap (2-3 gradient fills, bounded to each blob's box) and
// trimmed a touch on the low-cost tier rather than dropped, so mobile still
// gets the depth.
const NEBULA_BLOBS: ReadonlyArray<{ colour: string; x: number; y: number; r: number; sp: number; a: number }> = [
  { colour: '94,255,219', x: 0.24, y: 0.26, r: 300, sp: 0.011, a: 0.055 },
  { colour: '124,107,255', x: 0.60, y: 0.19, r: 360, sp: -0.008, a: 0.05 },
  { colour: '255,96,170', x: 0.83, y: 0.32, r: 250, sp: 0.015, a: 0.034 },
];

// Each nebula blob's radial gradient is baked into an offscreen sprite ONCE;
// per frame we just drawImage it (cheap textured quad) with animated position
// and alpha, instead of rebuilding a big gradient fill every frame.
let nebulaSprites: HTMLCanvasElement[] | null = null;

function ensureNebulaSprites(): HTMLCanvasElement[] {
  if (nebulaSprites) return nebulaSprites;
  nebulaSprites = NEBULA_BLOBS.map(b => {
    const size = Math.ceil(b.r * 2);
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(b.r, b.r, 0, b.r, b.r, b.r);
    grad.addColorStop(0, `rgba(${b.colour},1)`);
    grad.addColorStop(1, `rgba(${b.colour},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  });
  return nebulaSprites;
}

function drawAuroraNebula(t: number): void {
  const sprites = ensureNebulaSprites();
  const count = lowCostRender() ? 2 : NEBULA_BLOBS.length;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < count; i += 1) {
    const b = NEBULA_BLOBS[i]!;
    const breath = 0.55 + Math.sin(t * 0.09 + b.x * 6) * 0.45;
    const cx = (((b.x + t * b.sp) % 1.2 + 1.2) % 1.2 - 0.1) * VIEW_W;
    const cy = PLAY_TOP + b.y * (GROUND_BASE - PLAY_TOP);
    ctx.globalAlpha = b.a * breath;
    ctx.drawImage(sprites[i]!, cx - b.r, cy - b.r, b.r * 2, b.r * 2);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// Occasional shooting star streaking across the sky — one at a time, spawned on
// a random 5-16s cadence, cheap and render-only. A small "did you see that?"
// moment that keeps the frontier feeling alive.
let meteor: { x: number; y: number; vx: number; vy: number; life: number; max: number } | null = null;
let nextMeteorT = 3;
let lastBackdropT = 0;

function updateAndDrawMeteor(t: number): void {
  const dt = Math.min(0.05, Math.max(0, t - lastBackdropT));
  lastBackdropT = t;
  if (!meteor && t > nextMeteorT) {
    const fromRight = Math.random() < 0.65;
    const sp = 640 + Math.random() * 360;
    meteor = {
      x: fromRight ? VIEW_W + 30 : -30,
      y: PLAY_TOP + 8 + Math.random() * (GROUND_BASE - PLAY_TOP) * 0.34,
      vx: (fromRight ? -1 : 1) * sp,
      vy: sp * (0.26 + Math.random() * 0.2),
      life: 0,
      max: 0.85 + Math.random() * 0.5,
    };
  }
  if (!meteor) return;
  meteor.x += meteor.vx * dt;
  meteor.y += meteor.vy * dt;
  meteor.life += dt;
  const p = meteor.life / meteor.max;
  if (p >= 1 || meteor.x < -90 || meteor.x > VIEW_W + 90) {
    meteor = null;
    nextMeteorT = t + 4 + Math.random() * 9;
    return;
  }
  const fade = Math.min(1, p / 0.14) * Math.min(1, (1 - p) / 0.32);
  const tail = 0.14;
  const tx = meteor.x - meteor.vx * tail;
  const ty = meteor.y - meteor.vy * tail;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const g = ctx.createLinearGradient(tx, ty, meteor.x, meteor.y);
  g.addColorStop(0, 'rgba(94,255,219,0)');
  g.addColorStop(0.55, `rgba(120,238,255,${(0.34 * fade).toFixed(3)})`);
  g.addColorStop(0.85, `rgba(200,252,255,${(0.72 * fade).toFixed(3)})`);
  g.addColorStop(1, `rgba(255,255,255,${(0.98 * fade).toFixed(3)})`);
  ctx.strokeStyle = g;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(meteor.x, meteor.y);
  ctx.stroke();
  // A single meteor is a low-count centrepiece, so a real glow on the head is
  // affordable (per the shadow-cost rule: shadows only for low-count draws).
  ctx.shadowColor = 'rgba(200,252,255,0.9)';
  ctx.shadowBlur = 8 * fade;
  ctx.fillStyle = `rgba(255,255,255,${(0.95 * fade).toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(meteor.x, meteor.y, 2.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawWorld(t: number, meshMode: boolean): void {
  const lowCost = lowCostRender();
  const showContactLayer = state.phase !== 'title';
  if (!meshMode) {
    if (!lowCost) drawVelocityField(t);
    drawTerrainBackLayers(t, lowCost);
    if (!lowCost) drawRelayArcs(t);
    drawTerrain(t, lowCost);
    if (!lowCost && showContactLayer) drawSignalHabitats(t);
    if (!lowCost && showContactLayer) drawLandscapePhotoOverlays(t);
  } else {
    ctx.save();
    ctx.globalAlpha = 0.68;
    drawTerrainBackLayers(t, lowCost);
    drawRelayArcs(t);
    drawTerrain(t, lowCost);
    if (!lowCost && showContactLayer) drawSignalHabitats(t);
    if (!lowCost && showContactLayer) drawLandscapePhotoOverlays(t);
    ctx.restore();
    drawMeshActionGrade(t);
  }
  drawThreatOverlays(t);
  drawEnemyFireIntents(t);
  for (const p of state.particles) if (p.kind !== 'text') drawParticle(p);
  // The final screens own the stage: enemies, contacts, and pickups leave the
  // backdrop with the HUD instead of loitering behind the score panels.
  const showActors = state.phase !== 'gameover';
  if (!meshMode && showActors) {
    if (showContactLayer) for (const s of state.signals) drawSignal(s, t);
    for (const b of state.beacons) drawBeacon(b, t);
    for (const e of state.enemies) drawEnemy(e, t);
  } else if (meshMode && showActors) {
    drawMeshWorldLabels(t, showContactLayer);
  }
  if (!meshMode && showActors) for (const shot of state.enemyShots) drawEnemyShot(shot, t);
  if (!meshMode && showActors) for (const l of state.lasers) drawLaser(l);
  if (!meshMode && showActors && state.phase !== 'title') drawShip(t);
  if (!meshMode) drawLowAltitudeWarning(t);
  drawDamageCue(t);
  drawJamCue(t);
  for (const p of state.particles) if (p.kind === 'text') drawParticle(p);
  if (DEBUG_FXLAB && state.phase === 'playing') drawFxLabOverlay();
}

function drawRelayWeather(t: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const count = lowCostRender() ? 12 : 34;
  for (let i = 0; i < count; i += 1) {
    const depth = (i % 7) / 6;
    const drift = (t * (28 + depth * 54) + i * 97) % (VIEW_W + 220);
    const x = VIEW_W - drift + Math.sin(t * 0.7 + i) * 18;
    const y = PLAY_TOP - 24 + ((i * 41 + t * (18 + depth * 20)) % (GROUND_BASE - PLAY_TOP + 72));
    const alpha = 0.018 + depth * 0.03;
    ctx.fillStyle = i % 9 === 0
      ? `rgba(255,216,74,${alpha.toFixed(3)})`
      : `rgba(94,255,219,${alpha.toFixed(3)})`;
    ctx.fillRect(x, y, 1 + depth * 1.6, 1 + depth * 1.6);
  }
  ctx.restore();
}

function drawTerrainBackLayers(t: number, lowCost = false): void {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const layerCount = lowCost ? 1 : 3;
  const step = lowCost ? 26 : 12;
  for (let layer = 0; layer < layerCount; layer += 1) {
    const offset = 48 + layer * 28;
    const parallax = 0.66 - layer * 0.11;
    const alpha = 0.08 - layer * 0.014;
    const fill = ctx.createLinearGradient(0, GROUND_BASE - offset - 70, 0, VIEW_H);
    fill.addColorStop(0, layer % 2 === 0 ? `rgba(94,255,219,${(alpha * 0.65).toFixed(3)})` : `rgba(255,77,141,${(alpha * 0.38).toFixed(3)})`);
    fill.addColorStop(0.48, `rgba(12,80,92,${alpha.toFixed(3)})`);
    fill.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    for (let px = -20; px <= VIEW_W + 20; px += step) {
      const wx = wrapX(cameraX * parallax - VIEW_W / 2 + px);
      const ridge = terrainY(wx) - offset
        + Math.sin(wx * (0.003 + layer * 0.0017) + t * 0.11 + layer) * (12 + layer * 5)
        - Math.max(0, Math.sin(wx * 0.006 + layer)) ** 3 * (12 + layer * 4);
      if (px === -20) ctx.moveTo(px, ridge);
      else ctx.lineTo(px, ridge);
    }
    ctx.lineTo(VIEW_W + 20, VIEW_H);
    ctx.lineTo(-20, VIEW_H);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.restore();
}

function drawTerrain(t: number, lowCost = false): void {
  ctx.save();
  const fill = ctx.createLinearGradient(0, GROUND_BASE - 70, 0, VIEW_H);
  fill.addColorStop(0, 'rgba(18, 137, 119, 0.14)');
  fill.addColorStop(0.34, 'rgba(5, 48, 56, 0.18)');
  fill.addColorStop(0.72, 'rgba(3, 20, 31, 0.18)');
  fill.addColorStop(1, 'rgba(0, 8, 9, 0.22)');
  ctx.beginPath();
  const terrainStep = lowCost ? 14 : 7;
  for (let px = -10; px <= VIEW_W + 10; px += terrainStep) {
    const wx = wrapX(cameraX - VIEW_W / 2 + px);
    const y = terrainY(wx);
    if (px === -10) ctx.moveTo(px, y);
    else ctx.lineTo(px, y);
  }
  ctx.lineTo(VIEW_W + 10, VIEW_H);
  ctx.lineTo(-10, VIEW_H);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  // A shadowed stroke here blurs a full-canvas-width path every frame — the
  // single biggest blur area in the game. A wide translucent under-stroke
  // reads the same and costs a plain rasterise.
  ctx.strokeStyle = 'rgba(94,255,219,0.28)';
  ctx.lineWidth = lowCost ? 4.5 : 7.5;
  ctx.stroke();
  ctx.strokeStyle = '#5effdb';
  ctx.lineWidth = lowCost ? 1.6 : 2.1;
  ctx.stroke();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = '#5effdb';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  for (let px = -10; px <= VIEW_W + 10; px += lowCost ? 18 : 10) {
    const wx = wrapX(cameraX - VIEW_W / 2 + px);
    const y = terrainY(wx) + 11 + Math.sin(wx * 0.024 + t * 0.5) * 4;
    if (px === -10) ctx.moveTo(px, y);
    else ctx.lineTo(px, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = '#ffd84a';
  const laneCount = lowCost ? 1 : 3;
  for (let lane = 0; lane < laneCount; lane += 1) {
    ctx.beginPath();
    for (let px = -10; px <= VIEW_W + 10; px += 14) {
      const wx = wrapX(cameraX - VIEW_W / 2 + px);
      const y = terrainY(wx) + 26 + lane * 24 + Math.sin(wx * 0.018 + lane) * 3;
      if (px === -10) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  for (let x = Math.floor((cameraX - VIEW_W / 2) / RELAY_COLUMN_SPACING) * RELAY_COLUMN_SPACING; x < cameraX + VIEW_W / 2 + RELAY_COLUMN_SPACING; x += RELAY_COLUMN_SPACING) {
    const sx = screenX(wrapX(x));
    if (sx < -80 || sx > VIEW_W + 80) continue;
    const wx = wrapX(x);
    const base = terrainY(wx);
    const relay = relayColumnState(wx);
    const dormant = !relay.active && !relay.highValue && Math.round(wx / RELAY_COLUMN_SPACING) % 2 !== 0;
    if (dormant) continue;
    const towerHot = relay.intensity > 0.34;
    const height = relay.active
      ? 21 + relay.intensity * 44 + Math.max(0, Math.sin(wx * 0.011 + 1.7)) * 7
      : relay.highValue
        ? 20 + Math.max(0, Math.sin(wx * 0.011 + 1.7)) * 6
        : 13;
    const colour = relay.colour;
    const pulse = 0.45 + Math.sin(t * (towerHot ? 7.4 : 2.5) + wx * 0.01) * 0.35;
    const alpha = relay.active ? 0.24 + relay.intensity * 0.36 + pulse * 0.12 : relay.highValue ? 0.24 + pulse * 0.08 : 0.13;
    ctx.strokeStyle = colourWithAlpha(colour, alpha);
    ctx.fillStyle = colourWithAlpha(colour, relay.active ? 0.07 + relay.intensity * 0.08 : 0.035);
    ctx.shadowColor = colour;
    ctx.shadowBlur = lowCost ? (towerHot ? 6 : relay.highValue ? 3 : 1) : towerHot ? 14 + relay.intensity * 15 + pulse * 8 : relay.highValue ? 7 + pulse * 4 : 3;
    ctx.lineWidth = lowCost ? (towerHot ? 1 : 0.7) : towerHot ? 1.35 : relay.highValue ? 1 : 0.7;
    roundedRect(sx - (relay.active ? 16 : 11), base - 7, relay.active ? 32 : 22, 7, 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx - (relay.active ? 12 : 7), base - 6);
    ctx.lineTo(sx, base - height);
    ctx.lineTo(sx + (relay.active ? 12 : 7), base - 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (relay.active || relay.highValue) {
      ctx.beginPath();
      ctx.ellipse(sx, base - height - 4, 10 + relay.intensity * 18 + pulse * (towerHot ? 8 : 3), 3.2 + pulse * 1.1, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (relay.active) {
      ctx.globalAlpha = 0.15 + relay.intensity * 0.2;
      ctx.beginPath();
      ctx.moveTo(sx, base - 8);
      ctx.lineTo(sx, base - height - 38 - relay.intensity * 18);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  if (lowCost) {
    ctx.restore();
    return;
  }

  ctx.globalAlpha = 0.38;
  for (let x = Math.floor((cameraX - VIEW_W / 2) / 192) * 192; x < cameraX + VIEW_W / 2 + 220; x += 192) {
    const wx = wrapX(x);
    const sx = screenX(wx);
    if (sx < -70 || sx > VIEW_W + 70) continue;
    const base = terrainY(wx);
    const relay = relayColumnState(nearestRelayColumnX(wx));
    const premium = x % 768 === 0 || relay.highValue;
    if (!premium && relay.intensity < 0.12 && x % 384 !== 0) continue;
    const pulse = 0.45 + Math.sin(t * 3.6 + wx * 0.014) * 0.35;
    const colour = relay.intensity > 0.2 ? relay.colour : premium ? '#ffd84a' : x % 576 === 0 ? '#ff4d8d' : '#5effdb';
    ctx.strokeStyle = colourWithAlpha(colour, (relay.intensity > 0.2 ? 0.22 + relay.intensity * 0.16 : 0.16) + pulse * 0.12);
    ctx.fillStyle = colourWithAlpha(colour, (relay.intensity > 0.2 ? 0.07 + relay.intensity * 0.05 : 0.045) + pulse * 0.05);
    ctx.shadowColor = colour;
    ctx.shadowBlur = premium || relay.intensity > 0.2 ? 9 + pulse * 7 + relay.intensity * 10 : 3 + pulse * 2;
    ctx.lineWidth = premium ? 1.25 : 0.85;
    const w = premium ? 28 : 18;
    const h = premium ? 10 : 7;
    roundedRect(sx - w / 2, base - h - 4, w, h, 2.5);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx - w * 0.38, base - h - 4);
    ctx.lineTo(sx - w * 0.16, base - h - 11 - pulse * 3);
    ctx.moveTo(sx + w * 0.38, base - h - 4);
    ctx.lineTo(sx + w * 0.16, base - h - 11 - pulse * 3);
    ctx.stroke();
    ctx.fillStyle = colourWithAlpha('#fff5d8', premium ? 0.48 : 0.32);
    ctx.fillRect(sx - w * 0.24, base - h - 2, w * 0.48, 1.4);
  }
  ctx.restore();
}

function drawRelayArcs(t: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let x = 0; x < WORLD_W; x += RELAY_COLUMN_SPACING) {
    const a = screenX(x);
    const b = screenX(wrapX(x + RELAY_COLUMN_SPACING));
    if ((a < -160 || a > VIEW_W + 160) && (b < -160 || b > VIEW_W + 160)) continue;
    const leftRelay = relayColumnState(x);
    const rightRelay = relayColumnState(wrapX(x + RELAY_COLUMN_SPACING));
    const linkIntensity = Math.max(leftRelay.intensity, rightRelay.intensity);
    if (linkIntensity < 0.12 && !leftRelay.highValue && !rightRelay.highValue && x % 1024 !== 0) continue;
    const ay = terrainY(x) - 78;
    const by = terrainY(wrapX(x + RELAY_COLUMN_SPACING)) - 78;
    const midX = (a + b) / 2;
    const midY = Math.min(ay, by) - 24 - linkIntensity * 18 - Math.sin(t * 0.9 + x * 0.01) * 6;
    const pulse = 0.5 + Math.sin(t * 2.4 + x * 0.007) * 0.5;
    const colour = linkIntensity > 0.12 ? (leftRelay.intensity >= rightRelay.intensity ? leftRelay.colour : rightRelay.colour) : '#5effdb';
    ctx.strokeStyle = colourWithAlpha(colour, linkIntensity > 0.12 ? 0.06 + linkIntensity * 0.14 + pulse * 0.05 : 0.026 + pulse * 0.034);
    ctx.shadowColor = colour;
    ctx.shadowBlur = linkIntensity > 0.12 ? 7 + linkIntensity * 14 + pulse * 6 : 3 + pulse * 3;
    ctx.lineWidth = 0.7 + linkIntensity * 0.9 + pulse * 0.35;
    ctx.beginPath();
    ctx.moveTo(a, ay);
    ctx.quadraticCurveTo(midX, midY, b, by);
    ctx.stroke();
    if (x % 1024 === 0 || linkIntensity > 0.35) {
      const packet = (t * 0.18 + (x / WORLD_W)) % 1;
      const px = (1 - packet) * (1 - packet) * a + 2 * (1 - packet) * packet * midX + packet * packet * b;
      const py = (1 - packet) * (1 - packet) * ay + 2 * (1 - packet) * packet * midY + packet * packet * by;
      ctx.fillStyle = linkIntensity > 0.35 ? colour : '#ffd84a';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = linkIntensity > 0.35 ? 14 + linkIntensity * 9 : 10;
      ctx.fillRect(px - 2.2, py - 2.2, 4.4, 4.4);
    }
  }
  ctx.restore();
}

function drawSignalHabitats(t: number): void {
  for (const s of state.signals) {
    const sx = screenX(s.homeX);
    if (sx < -110 || sx > VIEW_W + 110) continue;
    const ground = terrainY(s.homeX);
    const threat = contactThreat(s);
    const dark = s.status === 'carried' || s.status === 'lost';
    const hot = threat.targeted || s.status === 'falling';
    const colour = dark ? (s.status === 'lost' ? '#ff3aff' : '#ff4d5e') : hot ? threat.colour : relationColour(s.relation);
    const premium = s.relation === 'high-wot';
    const pulse = 0.5 + Math.sin(t * (hot ? 9 : 3.2) + s.id) * 0.5;

    ctx.save();
    ctx.translate(sx, ground);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = dark ? 0.48 : 0.72;
    ctx.shadowColor = colour;
    ctx.shadowBlur = hot ? 18 + pulse * 14 : premium ? 15 : 9;

    const baseW = premium ? 60 : 50;
    const baseH = premium ? 15 : 12;
    const padGrad = ctx.createLinearGradient(-baseW / 2, -baseH, baseW / 2, baseH);
    padGrad.addColorStop(0, colourWithAlpha(colour, dark ? 0.08 : 0.14));
    padGrad.addColorStop(0.48, colourWithAlpha(colour, dark ? 0.18 : 0.28));
    padGrad.addColorStop(1, 'rgba(255,245,216,0.08)');
    ctx.fillStyle = padGrad;
    ctx.strokeStyle = colour;
    ctx.lineWidth = hot ? 2.2 : 1.3;
    roundedRect(-baseW / 2, -baseH, baseW, baseH, 4);
    ctx.fill();
    ctx.stroke();

    ctx.globalAlpha = dark ? 0.34 : 0.62;
    ctx.beginPath();
    ctx.ellipse(0, -16, premium ? 22 : 18, premium ? 10 : 8, 0, Math.PI, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-baseW * 0.32, -baseH);
    ctx.lineTo(-baseW * 0.18, -32);
    ctx.moveTo(baseW * 0.32, -baseH);
    ctx.lineTo(baseW * 0.18, -32);
    ctx.stroke();

    if (hot) {
      ctx.globalAlpha = 0.52 + pulse * 0.32;
      ctx.setLineDash(threat.label === 'TARGET' ? [3, 6] : []);
      ctx.beginPath();
      ctx.arc(0, -17, 27 + pulse * 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const side of [-1, 1] as const) {
      ctx.globalAlpha = dark ? 0.28 : 0.62;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(side * (baseW * 0.38), -baseH - 4, premium ? 3.8 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawLandscapePhotoOverlays(t: number): void {
  const viewport = visibleCanvasRect();
  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  const haze = ctx.createLinearGradient(0, GROUND_BASE - 110, 0, VIEW_H);
  haze.addColorStop(0, 'rgba(94,255,219,0)');
  haze.addColorStop(0.44, 'rgba(94,255,219,0.055)');
  haze.addColorStop(0.72, 'rgba(255,216,74,0.035)');
  haze.addColorStop(1, 'rgba(94,255,219,0)');
  ctx.fillStyle = haze;
  ctx.fillRect(viewport.x, GROUND_BASE - 118, viewport.w, 130);

  for (let x = Math.floor((cameraX - VIEW_W / 2) / 256) * 256; x < cameraX + VIEW_W / 2 + 300; x += 256) {
    const wx = wrapX(x);
    const sx = screenX(wx);
    if (sx < viewport.x - 80 || sx > viewport.x + viewport.w + 80) continue;
    const ground = terrainY(wx);
    const relay = relayColumnState(nearestRelayColumnX(wx));
    const premium = x % 768 === 0 || relay.highValue;
    if (!premium && relay.intensity < 0.12 && x % 512 !== 0) continue;
    const pulse = 0.5 + Math.sin(t * (premium ? 2.1 : 2.9) + wx * 0.021) * 0.5;
    const colour = relay.intensity > 0.12 ? relay.colour : premium ? '#ffd84a' : x % 384 === 0 ? '#ff4d8d' : '#5effdb';
    const alpha = relay.intensity > 0.12 ? 0.08 + relay.intensity * 0.13 + pulse * 0.08 : premium ? 0.11 + pulse * 0.1 : 0.04 + pulse * 0.045;

    ctx.globalAlpha = alpha;
    ctx.shadowColor = colour;
    ctx.shadowBlur = premium ? 14 + pulse * 10 : 8 + pulse * 6;
    ctx.fillStyle = colour;
    const lampY = ground - (premium ? 18 : 11);
    ctx.beginPath();
    ctx.ellipse(sx, lampY, premium ? 4.4 : 2.8, premium ? 2.4 : 1.7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = alpha * 0.55;
    ctx.strokeStyle = colour;
    ctx.lineWidth = premium ? 1.1 : 0.75;
    ctx.beginPath();
    ctx.moveTo(sx - (premium ? 26 : 16), ground - 5);
    ctx.lineTo(sx + (premium ? 26 : 16), ground - 5 + Math.sin(t * 1.2 + wx) * 2);
    ctx.stroke();

    if (premium) {
      ctx.globalAlpha = 0.12 + pulse * 0.08;
      ctx.beginPath();
      ctx.ellipse(sx, ground - 24, 36 + pulse * 8, 7 + pulse * 1.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  for (let i = 0; i < 18; i += 1) {
    const wx = wrapX(i * 341 + Math.sin(t * 0.17 + i) * 42);
    const sx = screenX(wx);
    if (sx < viewport.x - 20 || sx > viewport.x + viewport.w + 20) continue;
    const y = terrainY(wx) - 12 - (i % 5) * 5;
    const glint = 0.5 + Math.sin(t * 5.4 + i * 1.7) * 0.5;
    ctx.globalAlpha = 0.05 + glint * 0.12;
    ctx.strokeStyle = i % 4 === 0 ? '#ffd84a' : '#bdfcff';
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 7 + glint * 8;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(sx - 8 - glint * 5, y);
    ctx.lineTo(sx + 8 + glint * 5, y);
    ctx.moveTo(sx, y - 4 - glint * 3);
    ctx.lineTo(sx, y + 4 + glint * 3);
    ctx.stroke();
  }

  ctx.restore();
}

function drawMeshActionGrade(t: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const horizon = ctx.createLinearGradient(0, PLAY_TOP, VIEW_W, GROUND_BASE);
  horizon.addColorStop(0, 'rgba(95,124,255,0.07)');
  horizon.addColorStop(0.42, 'rgba(94,255,219,0.12)');
  horizon.addColorStop(0.72, 'rgba(255,58,255,0.08)');
  horizon.addColorStop(1, 'rgba(255,216,74,0.1)');
  ctx.fillStyle = horizon;
  ctx.fillRect(0, PLAY_TOP - 10, VIEW_W, GROUND_BASE - PLAY_TOP + 76);

  const speed = Math.abs(state.ship.vx);
  const alpha = clamp((speed - 760) / 900, 0, 0.032);
  if (alpha > 0) {
    const dir = state.ship.vx >= 0 ? -1 : 1;
    ctx.strokeStyle = `rgba(255,245,216,${alpha.toFixed(3)})`;
    ctx.lineWidth = 1.2;
    const drift = (t * speed * 0.8) % 240;
    for (let y = PLAY_TOP + 52; y < GROUND_BASE - 40; y += 84) {
      for (let x = -120 - drift; x < VIEW_W + 160; x += 360) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + dir * (52 + speed * 0.045), y + Math.sin(t * 4 + y) * 2);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function drawVelocityField(t: number): void {
  const speed = Math.abs(state.ship.vx);
  if (state.phase !== 'playing' || speed < 760) return;
  const alpha = clamp((speed - 760) / 900, 0, 0.055);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.strokeStyle = `rgba(94,255,219,${alpha.toFixed(3)})`;
  ctx.lineWidth = 0.9;
  const dir = state.ship.vx >= 0 ? -1 : 1;
  const drift = (t * speed * 0.58) % 180;
  for (let y = PLAY_TOP + 34; y < GROUND_BASE - 48; y += 86) {
    const wobble = Math.sin(y * 0.05 + t * 4) * 18;
    for (let x = -80 - drift; x < VIEW_W + 120; x += 420) {
      ctx.beginPath();
      ctx.moveTo(x + wobble, y);
      ctx.lineTo(x + wobble + dir * (34 + alpha * 90), y + Math.sin(t * 3 + y) * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawThreatOverlays(t: number): void {
  if (state.phase !== 'playing') return;
  const viewport = visibleCanvasRect();
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  drawPriorityGuide(t);
  drawLowAltitudeDanger(t);
  drawFallingRescueGuides(t);
  drawContactLifecycleRings(t);
  drawEnemyAimTelegraphs(t);
  for (const e of state.enemies) {
    const sx = screenX(e.x);
    const visible = sx > viewport.x - 70 && sx < viewport.x + viewport.w + 70;

    if (!visible) {
      drawEdgeThreat(e, t, viewport);
      continue;
    }

    if (e.type === 'carrier') {
      const hp = clamp(e.hp / Math.max(1, e.maxHp), 0, 1);
      ctx.fillStyle = 'rgba(255,245,216,0.22)';
      ctx.fillRect(sx - 58, e.y - 82, 116, 6);
      ctx.fillStyle = '#ff2f7a';
      ctx.fillRect(sx - 58, e.y - 82, 116 * hp, 6);
    }
  }
  ctx.restore();
}

function drawContactLifecycleRings(t: number): void {
  const viewport = visibleCanvasRect();
  for (const s of state.signals) {
    const threat = contactThreat(s);
    if (!threat.targeted || s.status === 'lost' || s.status === 'saved') continue;
    const sx = screenX(s.x);
    if (sx < viewport.x - 110 || sx > viewport.x + viewport.w + 110) continue;
    const hot = threat.label === 'LOCK' || threat.label === 'LIFT';
    const r = threat.label === 'LIFT'
      ? 42 + Math.sin(t * 17 + s.id) * 5
      : threat.label === 'FALL'
        ? 39 + Math.sin(t * 10 + s.id) * 4
        : 29 + threat.approach * 9 + Math.sin(t * 7 + s.id) * 2;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = hot ? 0.74 : 0.38 + threat.approach * 0.28;
    ctx.strokeStyle = threat.colour;
    ctx.fillStyle = threat.colour;
    ctx.shadowColor = threat.colour;
    ctx.shadowBlur = hot ? 15 : 9;
    ctx.lineWidth = hot ? 2.2 : 1.35;
    ctx.setLineDash(threat.label === 'TARGET' ? [3, 7] : []);
    ctx.beginPath();
    ctx.arc(sx, s.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    if (threat.label === 'LOCK') {
      ctx.strokeStyle = threat.capture > 0.72 ? '#ff4d5e' : '#ffd84a';
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.arc(sx, s.y, r + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * threat.capture);
      ctx.stroke();
    } else if (threat.label === 'LIFT') {
      const gate = 45 + Math.sin(t * 13 + s.id) * 4;
      ctx.strokeStyle = '#5effdb';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(sx - gate, s.y + 30);
      ctx.lineTo(sx - gate * 0.45, s.y + 47);
      ctx.lineTo(sx, s.y + 38);
      ctx.lineTo(sx + gate * 0.45, s.y + 47);
      ctx.lineTo(sx + gate, s.y + 30);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,245,216,0.72)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(sx - gate * 0.72, s.y + 15);
      ctx.lineTo(sx + gate * 0.72, s.y + 15);
      ctx.stroke();
    } else if (threat.label === 'TARGET') {
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(sx + side * (r + 8), s.y - 10);
        ctx.lineTo(sx + side * (r + 2), s.y);
        ctx.lineTo(sx + side * (r + 8), s.y + 10);
        ctx.stroke();
      }
    }

    ctx.shadowBlur = 6;
    ctx.font = `900 8px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    const label = threat.label === 'LOCK'
      ? `LOCK ${Math.round(threat.capture * 100)}`
      : threat.label === 'LIFT'
        ? 'SNATCH'
        : threat.label === 'FALL'
          ? 'CATCH'
          : 'TARGET';
    ctx.fillText(label, sx, s.y - r - 15);
    ctx.restore();
  }
}

function drawThreatBracket(x: number, y: number, r: number, colour: string, t: number): void {
  const arm = r * 0.54;
  const inset = Math.sin(t * 8) * 2;
  ctx.save();
  ctx.globalAlpha = 0.58;
  ctx.strokeStyle = colour;
  ctx.shadowColor = colour;
  ctx.shadowBlur = 7;
  ctx.lineWidth = 1.25;
  for (const sx of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(x + sx * r, y - arm);
    ctx.lineTo(x + sx * (r - 7 + inset), y);
    ctx.lineTo(x + sx * r, y + arm);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPriorityGuide(t: number): void {
  const signal = mostUrgentSignal();
  if (!signal) return;
  const viewport = visibleCanvasRect();
  const threat = contactThreat(signal);
  const urgency = threat.urgency;
  if (urgency < 0.95) return;
  if (threat.label === 'TARGET' && state.wave > 2) return;
  const colour = threat.colour;
  const shipX = screenX(state.ship.x);
  const signalX = screenX(signal.x);
  const signalVisible = signalX > viewport.x - 80 && signalX < viewport.x + viewport.w + 80;
  const edgeX = wrapDelta(signal.x, cameraX) < 0 ? viewport.x + 32 : viewport.x + viewport.w - 32;
  const targetX = signalVisible ? signalX : edgeX;
  const targetY = signalVisible ? signal.y : clamp(signal.y, PLAY_TOP + 24, GROUND_BASE - 52);
  const label = threat.label === 'FALL'
    ? 'CATCH'
    : threat.label === 'LIFT'
      ? 'SNATCH'
      : threat.label === 'TARGET'
        ? 'DEFEND'
        : 'LOCK';
  const dist = Math.round(Math.abs(wrapDelta(signal.x, state.ship.x)) / 10) * 10;

  ctx.save();
  ctx.globalAlpha = clamp(0.22 + urgency * 0.14 + Math.sin(t * 10) * 0.06, 0.22, 0.86);
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.shadowColor = colour;
  ctx.shadowBlur = 10;
  ctx.lineWidth = threat.label === 'LIFT' ? 2.2 : threat.label === 'LOCK' ? 1.8 + threat.capture * 1.1 : 1.35;
  ctx.setLineDash(threat.label === 'FALL' ? [4, 7] : [10, 8]);
  ctx.beginPath();
  ctx.moveTo(shipX, state.ship.y);
  ctx.lineTo(targetX, targetY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.moveTo(targetX, targetY);
  ctx.lineTo(targetX + (targetX < shipX ? 13 : -13), targetY - 7);
  ctx.lineTo(targetX + (targetX < shipX ? 13 : -13), targetY + 7);
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur = 6;
  ctx.font = `900 9px ${FONT_MONO}`;
  ctx.textAlign = targetX < shipX ? 'left' : 'right';
  ctx.fillText(`${label} ${dist}`, targetX + (targetX < shipX ? 18 : -18), targetY - 18);
  ctx.restore();
}

function drawLowAltitudeDanger(t: number): void {
  const camp = clamp(state.lowCamp / 2.4, 0, 1);
  if (camp <= 0.02) return;
  const viewport = visibleCanvasRect();
  const span = viewport.w * (0.34 + camp * 0.28);
  const start = state.ship.x - span / 2;
  const steps = 28;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.18 + camp * 0.38;
  ctx.strokeStyle = camp > 0.64 ? '#ff4d5e' : '#ff8a3a';
  ctx.fillStyle = ctx.strokeStyle;
  ctx.shadowColor = ctx.strokeStyle;
  ctx.shadowBlur = 10 + camp * 14;
  ctx.lineWidth = 1.2 + camp * 1.6;
  ctx.beginPath();
  for (let i = 0; i <= steps; i += 1) {
    const wx = wrapX(start + (i / steps) * span);
    const sx = screenX(wx);
    const y = terrainY(wx) - 10 - Math.sin(t * 16 + i * 0.7) * (2 + camp * 5);
    if (i === 0) ctx.moveTo(sx, y);
    else ctx.lineTo(sx, y);
  }
  ctx.stroke();
  for (let i = 0; i < 6; i += 1) {
    const wx = wrapX(state.ship.x + (i - 2.5) * span * 0.14 + Math.sin(t * 3.1 + i) * 34);
    const sx = screenX(wx);
    if (sx < viewport.x - 40 || sx > viewport.x + viewport.w + 40) continue;
    const y = terrainY(wx) - 15;
    const hot = Math.sin(t * 12 + i) * 0.5 + 0.5;
    ctx.globalAlpha = 0.12 + camp * (0.22 + hot * 0.24);
    ctx.beginPath();
    ctx.moveTo(sx - 13, y);
    ctx.lineTo(sx, y - 28 - hot * 16);
    ctx.lineTo(sx + 13, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFallingRescueGuides(t: number): void {
  const viewport = visibleCanvasRect();
  for (const s of state.signals) {
    if (s.status !== 'falling') continue;
    const sx = screenX(s.x);
    if (sx < viewport.x - 100 || sx > viewport.x + viewport.w + 100) continue;
    const ground = terrainY(s.x) - 22;
    const drop = clamp((ground - s.y) / 240, 0, 1);
    const hot = drop < 0.28;
    const rescue = fallingRescueWindow(s);
    const guided = rescue.magnet || rescue.catch;
    const colour = guided ? '#5effdb' : hot ? '#ff4d5e' : '#fff5d8';
    ctx.save();
    ctx.globalAlpha = guided ? 0.76 + Math.sin(t * 18) * 0.12 : hot ? 0.74 + Math.sin(t * 18) * 0.12 : 0.38;
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    ctx.shadowColor = colour;
    ctx.shadowBlur = guided ? 18 : hot ? 16 : 8;
    ctx.lineWidth = guided ? 2.6 : hot ? 2.4 : 1.4;
    ctx.beginPath();
    ctx.moveTo(sx - 18, ground);
    ctx.lineTo(sx, s.y);
    ctx.lineTo(sx + 18, ground);
    ctx.stroke();
    if (guided) {
      const shipX = screenX(state.ship.x);
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.moveTo(shipX - 54, state.ship.y - 8);
      ctx.lineTo(shipX + 54, state.ship.y - 8);
      ctx.moveTo(shipX - 42, state.ship.y + 16);
      ctx.lineTo(shipX + 42, state.ship.y + 16);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.arc(sx, s.y, (guided ? 52 : 46) + Math.sin(t * 9 + s.id) * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = `900 9px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText(guided ? 'SECURE' : hot ? 'LAST CATCH' : 'CATCH', sx, s.y - 56);
    ctx.restore();
  }
}

function drawEnemyAimTelegraphs(t: number): void {
  const viewport = visibleCanvasRect();
  for (const e of state.enemies) {
    if (!e.alive) continue;
    const kind = enemyShotKind(e);
    const telegraphWindow = kind ? enemyFireArmWindow(kind) : 0;
    if (!kind || e.shotCooldown <= 0 || e.shotCooldown > telegraphWindow || !enemyCanShoot(e, kind)) continue;
    const sx = screenX(e.x);
    if (sx < viewport.x - 100 || sx > viewport.x + viewport.w + 100) continue;
    const speed = enemyShotSpeed(e, kind);
    const aim = enemyAimPoint(e, speed);
    const tx = screenX(aim.x);
    const colour = enemyShotColour(kind);
    const alpha = clamp(1 - e.shotCooldown / telegraphWindow, 0.18, 0.78);
    ctx.save();
    ctx.globalAlpha = alpha;
    const shotColour = colour;
    ctx.strokeStyle = shotColour;
    ctx.fillStyle = shotColour;
    ctx.shadowColor = shotColour;
    ctx.shadowBlur = kind === 'jam' ? 10 : kind === 'barrage' ? 13 : 7;
    ctx.lineWidth = kind === 'jam' ? 1.4 : kind === 'barrage' ? 1.8 : 1.1;
    const dx = clamp(tx - sx, -28, 28);
    const dy = clamp(aim.y - e.y, -18, 18);
    ctx.beginPath();
    ctx.arc(sx, e.y, 8 + Math.sin(t * 16 + e.phase) * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx + dx, e.y + dy, kind === 'barrage' ? 4.8 : 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawEdgeThreat(e: Enemy, t: number, viewport = visibleCanvasRect()): void {
  const dx = wrapDelta(e.x, cameraX);
  const side = dx < 0 ? -1 : 1;
  const portrait = usePortraitHud(viewport);
  const x = side < 0 ? viewport.x + (portrait ? 23 : 28) : viewport.x + viewport.w - (portrait ? 23 : 28);
  const y = clamp(e.y, PLAY_TOP + 22, GROUND_BASE - 48);
  const colour = enemyColour(e.type);
  const boss = e.type === 'carrier';
  const hot = e.carryId !== null || boss;
  const hp = boss ? clamp(e.hp / Math.max(1, e.maxHp), 0, 1) : 0;
  const edgeScale = portrait ? (boss ? 0.66 : 0.78) : 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(side * edgeScale, edgeScale);
  ctx.shadowColor = boss ? '#ff2f7a' : hot ? '#ff4d5e' : colour;
  ctx.shadowBlur = (boss ? 28 : hot ? 22 : 12) * edgeScale;
  ctx.fillStyle = boss ? '#ff2f7a' : hot ? '#ff4d5e' : colour;
  ctx.strokeStyle = '#fff5d8';
  ctx.lineWidth = 1.6;
  const pulse = 1 + Math.sin(t * (hot ? 18 : 9) + e.phase) * (boss ? 0.16 : 0.12);
  ctx.scale(pulse, pulse);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(boss ? -31 : -20, boss ? -20 : -15);
  ctx.lineTo(boss ? -17 : -13, 0);
  ctx.lineTo(boss ? -31 : -20, boss ? 20 : 15);
  ctx.closePath();
  ctx.fill();
  if (hot) ctx.stroke();
  if (boss) {
    ctx.scale(side, 1);
    if (portrait) {
      ctx.font = `900 10px ${FONT_MONO}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffbdd2';
      ctx.shadowBlur = 8;
      ctx.fillText('C', -16, 4);
    } else {
      ctx.textAlign = side < 0 ? 'left' : 'right';
      ctx.font = `900 10px ${FONT_MONO}`;
      ctx.fillStyle = '#ffbdd2';
      ctx.shadowBlur = 10;
      ctx.fillText('CARRIER', side < 0 ? 22 : -22, -24);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,245,216,0.24)';
      const bx = side < 0 ? 22 : -82;
      ctx.fillRect(bx, 24, 60, 4);
      ctx.fillStyle = '#ff2f7a';
      ctx.fillRect(bx, 24, 60 * hp, 4);
    }
  }
  ctx.restore();
}

function drawRelayTowers(t: number): void {
  const viewport = visibleCanvasRect();
  const portrait = usePortraitHud(viewport);
  const towerScale = portrait ? 0.42 : 0.74;
  for (let x = 0; x < WORLD_W; x += 512) {
    const sx = screenX(x);
    if (sx < viewport.x - 120 || sx > viewport.x + viewport.w + 120) continue;
    const gy = terrainY(x);
    const pulse = 0.5 + Math.sin(t * 2.8 + x) * 0.5;
    ctx.save();
    ctx.translate(sx, gy);
    ctx.scale(towerScale, towerScale);
    ctx.strokeStyle = 'rgba(94,255,219,0.72)';
    ctx.shadowColor = '#5effdb';
    ctx.shadowBlur = 8 + pulse * 8;
    ctx.lineWidth = 1.45;
    ctx.fillStyle = 'rgba(7,52,58,0.52)';
    roundedRect(-31, -15, 62, 17, 4);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -78);
    ctx.moveTo(-25, -14);
    ctx.lineTo(0, -78);
    ctx.lineTo(25, -14);
    ctx.moveTo(-16, -49);
    ctx.lineTo(16, -49);
    ctx.stroke();
    ctx.globalAlpha = 0.5 + pulse * 0.28;
    ctx.fillStyle = '#5effdb';
    ctx.fillRect(-3.5, -65, 7, 20);
    ctx.strokeStyle = 'rgba(255,216,74,0.72)';
    ctx.beginPath();
    ctx.ellipse(0, -84, 27 + pulse * 8, 8 + pulse * 2.8, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.28 + pulse * 0.3;
    ctx.beginPath();
    ctx.arc(0, -78, 18 + pulse * 17, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawSignal(s: Signal, t: number): void {
  if (s.status === 'lost') return;
  const sx = screenX(s.x);
  if (sx < -70 || sx > VIEW_W + 70) return;
  const threat = contactThreat(s);
  const colour = relationColour(s.relation);
  const pulse = 0.5 + Math.sin(t * 5 + s.id) * 0.5;
  const scale = getTuning().contactScale;
  const alpha = s.status === 'saved' ? Math.max(0.3, s.flash) : 1;
  const danger = threat.label === 'LOCK' || threat.label === 'LIFT' || threat.label === 'FALL';
  const bodyRadius = s.relation === 'high-wot' ? 25 : s.relation === 'mutual' ? 23 : 22;
  const ringColour = threat.targeted ? threat.colour : colour;
  const rot = t * (1.45 + (s.id % 5) * 0.05) + s.id;
  ctx.save();
  ctx.translate(sx, s.y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  ctx.shadowColor = ringColour;
  ctx.shadowBlur = threat.targeted ? 24 + threat.urgency * 3 : 15;

  ctx.save();
  ctx.rotate(rot);
  const orb = ctx.createRadialGradient(-8, -10, 2, 0, 0, bodyRadius + 9);
  orb.addColorStop(0, '#fff5d8');
  orb.addColorStop(0.24, colourWithAlpha(colour, 0.88));
  orb.addColorStop(0.68, colourWithAlpha(danger ? threat.colour : colour, danger ? 0.58 : 0.36));
  orb.addColorStop(1, 'rgba(2,4,11,0.16)');
  ctx.fillStyle = orb;
  ctx.strokeStyle = ringColour;
  ctx.lineWidth = threat.label === 'LOCK' ? 2.8 : threat.targeted ? 2.35 : 1.85;
  ctx.beginPath();
  ctx.arc(0, 0, bodyRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = alpha * (0.5 + pulse * 0.28);
  ctx.strokeStyle = colourWithAlpha(ringColour, danger ? 0.9 : 0.66);
  ctx.lineWidth = danger ? 2.1 : 1.45;
  ctx.beginPath();
  ctx.ellipse(0, 0, bodyRadius + 7, 8.5 + pulse * 1.4, Math.PI * 0.16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.rotate(Math.PI * 0.5);
  ctx.globalAlpha = alpha * 0.42;
  ctx.beginPath();
  ctx.ellipse(0, 0, bodyRadius + 5, 7.5, -Math.PI * 0.12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  if (threat.targeted) {
    ctx.strokeStyle = threat.colour;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.lineWidth = threat.label === 'LOCK' ? 2.2 : 1.8;
    ctx.beginPath();
    ctx.arc(0, 0, (threat.label === 'TARGET' ? 31 : 34) + pulse * (threat.label === 'LIFT' ? 9 : 6), 0, Math.PI * 2);
    ctx.stroke();
    if (threat.label === 'LOCK') {
      ctx.strokeStyle = threat.capture > 0.72 ? '#ff4d5e' : '#ffd84a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 42, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * threat.capture);
      ctx.stroke();
    }
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = alpha;
  const profileImage = profileImageForSignal(s);
  if (profileImage) {
    drawProfileImageCircle(profileImage, 0, 0, bodyRadius * VECTOR_PROFILE_AVATAR_RADIUS_SCALE, ringColour);
  } else {
    ctx.fillStyle = 'rgba(2,4,11,0.66)';
    ctx.beginPath();
    ctx.arc(0, 0, bodyRadius * 0.52, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#02040b';
    ctx.strokeStyle = colourWithAlpha('#fff5d8', 0.8);
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = '#fff5d8';
    ctx.shadowColor = '#02040b';
    ctx.shadowBlur = 3;
    ctx.font = `900 12.5px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials(signalDisplayName(s)), 0, 0);
  }
  ctx.fillStyle = '#fff5d8';
  ctx.shadowColor = threat.targeted ? threat.colour : '#02040b';
  ctx.shadowBlur = threat.targeted ? 7 : 4;
  ctx.font = `800 10px ${FONT_MONO}`;
  // Alignment must not depend on the avatar/initials branch above; long
  // handles condense to fit rather than truncating mid-name.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitCanvasText(signalDisplayName(s).slice(0, 18), 0, 31, 92);
  ctx.restore();
}

/**
 * A forgery wears the identity it stole: the victim's avatar sits glitched at
 * the hull core with a FORGED tag beneath. Drawn over the sprite in vector
 * mode and under the mesh overlay (tag only reaches the mesh via the 2D
 * underlay's label pass; the 3D hull carries its own avatar orb).
 */
function drawForgedIdentity(e: Enemy, sx: number, t: number): void {
  const actorScale = getTuning().actorScale;
  const r = (e.forgedMember ? 15 : 13) * Math.max(0.72, actorScale / 0.48);
  const jitterX = Math.sin(t * 23 + e.phase) * 1.6;
  const entry = ensureProfileImageEntry(e.forgedPicture);
  ctx.save();
  ctx.translate(sx + jitterX, e.y - 2);
  if (entry?.loaded && entry.image) {
    drawProfileImageCircle(entry.image, 0, 0, r, '#ff3aff', 0.94);
    // Glitch slices: thin magenta/cyan interference bars sweeping the face.
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 3; i += 1) {
      const barY = ((t * (34 + i * 11) + i * 19 + e.phase * 8) % (r * 2)) - r;
      ctx.fillStyle = i === 1 ? 'rgba(94,255,219,0.4)' : 'rgba(255,58,255,0.48)';
      ctx.fillRect(-r, barY, r * 2, 1.6 + (i === 0 ? 1 : 0));
    }
    ctx.restore();
  } else {
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = '#ff3aff';
    ctx.shadowColor = '#ff3aff';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = e.forgedMember ? '#ffd84a' : '#ff9bff';
  ctx.shadowColor = '#ff3aff';
  ctx.shadowBlur = 6;
  ctx.font = `900 9px ${FONT_MONO}`;
  fitCanvasText(`FORGED ${e.forgedName!.toUpperCase()}`, 0, r + 8, 108);
  ctx.restore();
}

function drawMeshWorldLabels(t: number, showContactLayer: boolean): void {
  if (showContactLayer) drawMeshContactLabels(t);
  for (const b of state.beacons) {
    if (b.kind === 'life') continue;
    const sx = screenX(b.x);
    if (sx < -80 || sx > VIEW_W + 80) continue;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `900 10px ${FONT_MONO}`;
    ctx.shadowColor = beaconRingColour(b.kind);
    ctx.shadowBlur = 8;
    ctx.fillStyle = b.kind === 'rose' ? '#ffb3c7' : '#fff5d8';
    fitCanvasText(beaconLabel(b.kind), sx, b.y + 60, 96);
    ctx.restore();
  }
}

function drawMeshContactLabels(t: number): void {
  for (const s of state.signals) {
    if (s.status === 'lost' || s.status === 'saved') continue;
    const sx = screenX(s.x);
    if (sx < -80 || sx > VIEW_W + 80) continue;
    const colour = relationColour(s.relation);
    const threat = contactThreat(s);
    const danger = threat.label === 'LIFT' || threat.label === 'FALL' || threat.label === 'LOCK';
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `900 10px ${FONT_MONO}`;
    ctx.shadowColor = threat.targeted ? threat.colour : colour;
    ctx.shadowBlur = danger ? 12 : 7;
    ctx.fillStyle = danger && Math.floor(t * 8) % 2 === 0 ? threat.colour : '#fff5d8';
    // These labels live on the 2D canvas beneath the mesh overlay, so grounded
    // contacts put their name in the clear sky above the sphere (the habitat
    // stand covers the space below); airborne contacts hang below instead,
    // clear of the abductor hull above them.
    const grounded = s.status === 'ground';
    const nameY = grounded ? s.y - 62 : s.y + 30;
    fitCanvasText(signalDisplayName(s).slice(0, 18), sx, nameY, 96);
    if (threat.targeted) {
      ctx.fillStyle = threat.colour;
      ctx.font = `900 9px ${FONT_MONO}`;
      const label = threat.label === 'LOCK'
        ? `LOCK ${Math.round(threat.capture * 100)}`
        : threat.label === 'LIFT'
          ? 'LIFTED'
          : threat.label === 'FALL'
            ? 'FALLING'
            : 'TARGETED';
      ctx.fillText(label, sx, nameY + 13);
    }
    ctx.restore();
  }
  for (const e of state.enemies) {
    if (!e.alive || e.type !== 'forgery' || !e.forgedName) continue;
    const sx = screenX(e.x);
    if (sx < -80 || sx > VIEW_W + 80) continue;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `900 9px ${FONT_MONO}`;
    ctx.fillStyle = e.forgedMember ? '#ffd84a' : '#ff9bff';
    ctx.shadowColor = '#ff3aff';
    ctx.shadowBlur = 8;
    fitCanvasText(`FORGED ${e.forgedName.toUpperCase()}`, sx, e.y + 34, 108);
    ctx.restore();
  }
}

// The troll's last-quarter-health "about to pop" telegraph: a fast rainbow-
// cycling screen-blended glow laid over the (already baked, static) sprite,
// rather than tinting the sprite itself — keeps the donkey/bankster art
// intact while still reading as an unmistakable warning flash.
function drawTrollPopFlash(e: Enemy, sx: number, scale: number, dir: -1 | 1, bank: number, t: number): void {
  const pop = trollPopFlash(e);
  if (pop <= 0) return;
  const hue = (t * 540) % 360;
  const flicker = 0.55 + Math.sin(t * 26 + e.phase) * 0.45;
  ctx.save();
  ctx.translate(sx, e.y);
  ctx.rotate(bank);
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = pop * (0.35 + flicker * 0.35);
  ctx.fillStyle = `hsl(${hue}, 100%, 58%)`;
  ctx.shadowColor = ctx.fillStyle;
  ctx.shadowBlur = 26;
  ctx.beginPath();
  ctx.ellipse(dir * 6, 0, 82 * scale, 58 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEnemy(e: Enemy, t: number): void {
  const sx = screenX(e.x);
  const viewport = visibleCanvasRect();
  if (sx < viewport.x - 110 || sx > viewport.x + viewport.w + 110) return;
  const colour = enemyColour(e.type);
  const actorScale = getTuning().actorScale;
  const spriteScale = actorScale * (e.type === 'carrier' ? 0.48 : e.type === 'hunter' ? 0.62 : e.type === 'jammer' ? 0.62 : e.type === 'forgery' ? 0.58 : e.type === 'spammer' ? 0.6 : e.type === 'sybil' ? (e.maxHp > 1 ? 0.6 : 0.38) : e.type === 'troll' ? 0.8 : 0.6) * trollGrowthScale(e);
  const face = e.face;
  const turn = clamp(e.turnCue, 0, 1);
  const turnPhase = 1 - turn;
  const renderFace: -1 | 1 = turn > 0.52 ? (face === 1 ? -1 : 1) : face;
  const bank = clamp(e.vy / 760, -0.18, 0.18) + renderFace * Math.sin(turnPhase * Math.PI) * (e.type === 'carrier' ? 0.1 : 0.24);
  if (HI_DPI_SPRITE_ACTORS) {
    drawEnemySprite({
      ctx,
      type: e.type,
      x: sx,
      y: e.y,
      dir: renderFace,
      scale: spriteScale,
      bank,
      turn,
      intent: e.intent,
      muzzle: e.muzzle,
      phase: e.phase,
      hp: e.hp,
      maxHp: e.maxHp,
      t,
      hot: e.carryId !== null || e.captureCharge > 0.02 || e.intent > 0.56,
    });
    if (e.type === 'troll') drawTrollPopFlash(e, sx, spriteScale, renderFace, bank, t);
    if (e.type === 'forgery' && e.forgedName) drawForgedIdentity(e, sx, t);
    return;
  }
  const visualScale = e.type === 'carrier' ? 1.04 : e.type === 'jammer' ? 1.12 : e.type === 'hunter' ? 1.18 : e.type === 'forgery' ? 1.08 : 1.12;
  const flipNarrow = turn > 0.02 ? 0.42 + Math.abs(turnPhase - 0.5) * 1.16 : 1;
  const pulse = 0.5 + Math.sin(t * 7 + e.phase) * 0.5;
  const squash = (1 - turn * (e.type === 'carrier' ? 0.04 : 0.06)) * flipNarrow;
  ctx.save();
  ctx.translate(sx, e.y);
  ctx.scale(renderFace * visualScale * actorScale * squash, visualScale * actorScale * (1 + Math.sin(turnPhase * Math.PI) * 0.18));
  ctx.rotate(bank);
  ctx.shadowColor = colour;
  ctx.shadowBlur = (e.type === 'carrier' ? 22 : 15) + turn * 7;
  ctx.fillStyle = colourWithAlpha(colour, 0.2);
  ctx.strokeStyle = colour;
  ctx.lineWidth = e.type === 'carrier' ? 2.2 : 2.4;

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const wake = ctx.createLinearGradient(-22, 0, e.type === 'carrier' ? -128 : -88, 0);
  wake.addColorStop(0, colourWithAlpha(colour, e.type === 'hunter' ? 0.46 : 0.32));
  wake.addColorStop(0.52, colourWithAlpha(e.type === 'jammer' ? '#5f7cff' : e.type === 'hunter' ? '#ffd84a' : colour, 0.16));
  wake.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = wake;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.moveTo(-22, -10);
  ctx.lineTo(e.type === 'carrier' ? -130 : -92, 0);
  ctx.lineTo(-22, 10);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  if (e.type === 'jammer') {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.22 + pulse * 0.18;
    ctx.fillStyle = '#5f7cff';
    for (let i = 0; i < 3; i += 1) {
      ctx.fillRect(-52 + i * 13, -29 + i * 29, 86 - i * 8, 3);
    }
    ctx.restore();

    const body = ctx.createLinearGradient(-32, -22, 32, 22);
    body.addColorStop(0, '#05091f');
    body.addColorStop(0.46, '#2336a0');
    body.addColorStop(1, '#b6c7ff');
    ctx.fillStyle = body;
    roundedRect(-31, -21, 62, 42, 5);
    ctx.fill();
    ctx.stroke();

    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(-8, side * 18);
      ctx.lineTo(-46, side * (36 + pulse * 5));
      ctx.lineTo(-36, side * 10);
      ctx.closePath();
      ctx.fillStyle = side < 0 ? 'rgba(94,255,219,0.42)' : 'rgba(95,124,255,0.54)';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(20, side * 14);
      ctx.lineTo(50, side * 23);
      ctx.lineTo(31, side * 4);
      ctx.stroke();
    }
    ctx.fillStyle = '#00d8ff';
    ctx.fillRect(-23, -3, 46, 6);
    ctx.fillStyle = '#fff5d8';
    ctx.fillRect(-4, -18, 8, 36);
    ctx.fillStyle = '#ffd84a';
    ctx.beginPath();
    ctx.ellipse(18, 0, 7 + pulse * 2, 12, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.type === 'carrier') {
    const hull = ctx.createLinearGradient(-70, -40, 72, 40);
    hull.addColorStop(0, '#1b0618');
    hull.addColorStop(0.45, '#621235');
    hull.addColorStop(0.82, '#ff2f7a');
    hull.addColorStop(1, '#ffd5e5');
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.moveTo(76, 0);
    ctx.lineTo(35, -42);
    ctx.lineTo(-42, -35);
    ctx.lineTo(-78, 0);
    ctx.lineTo(-42, 35);
    ctx.lineTo(35, 42);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(5,8,17,0.68)';
    roundedRect(-52, -31, 82, 18, 3);
    ctx.fill();
    roundedRect(-52, 13, 82, 18, 3);
    ctx.fill();
    ctx.fillStyle = '#5effdb';
    ctx.fillRect(-47, -2, 94, 4);
    ctx.fillStyle = '#ffd84a';
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < 3; i += 1) {
        ctx.beginPath();
        ctx.arc(-38 + i * 36, side * 43, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillRect(22, side * 27 - 3, 42, 6);
    }
    ctx.fillStyle = '#b6c7ff';
    ctx.beginPath();
    ctx.ellipse(43, 0, 14, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff8a3a';
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.ellipse(-76, side * 21, 8 + pulse * 3, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(-56, -27);
    ctx.lineTo(57, 0);
    ctx.lineTo(-56, 27);
    ctx.stroke();
    const hp = clamp(e.hp / Math.max(1, e.maxHp), 0, 1);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,245,216,0.22)';
    ctx.fillRect(-54, -50, 108, 5);
    ctx.fillStyle = '#ff2f7a';
    ctx.fillRect(-54, -50, 108 * hp, 5);
  } else if (e.type === 'hunter') {
    const body = ctx.createLinearGradient(-36, -24, 42, 22);
    body.addColorStop(0, '#2b1205');
    body.addColorStop(0.46, '#ff8a3a');
    body.addColorStop(1, '#fff5d8');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(48, 0);
    ctx.lineTo(-32, -23);
    ctx.lineTo(-12, 0);
    ctx.lineTo(-32, 23);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,216,74,0.55)';
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(-21, side * 12);
      ctx.lineTo(-51, side * (33 + pulse * 5));
      ctx.lineTo(-34, side * 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = '#ffd84a';
    ctx.fillRect(-31, -3, 44, 6);
    ctx.fillStyle = '#5effdb';
    ctx.beginPath();
    ctx.ellipse(13, 0, 7, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff5d8';
    ctx.beginPath();
    ctx.moveTo(45, 0);
    ctx.lineTo(26, -7);
    ctx.lineTo(26, 7);
    ctx.closePath();
    ctx.fill();
  } else if (e.type === 'forgery') {
    const glitch = Math.sin(t * 13 + e.phase) * 5;
    ctx.rotate(Math.sin(t * 5 + e.phase) * 0.1);
    ctx.strokeStyle = '#ff3aff';
    ctx.fillStyle = 'rgba(255,58,255,0.3)';
    ctx.beginPath();
    ctx.moveTo(41 + glitch, -2);
    ctx.lineTo(15, -28);
    ctx.lineTo(-16 + glitch * 0.4, -19);
    ctx.lineTo(-44, -3);
    ctx.lineTo(-15, 16);
    ctx.lineTo(8 - glitch, 28);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (let i = 0; i < 6; i += 1) {
      const y = -22 + (i % 3) * 22;
      const x = -36 + i * 14 + Math.sin(t * 9 + e.phase + i) * 4;
      ctx.fillStyle = i % 3 === 0 ? '#ffd84a' : i % 2 === 0 ? '#5effdb' : '#ff3aff';
      ctx.globalAlpha = 0.72;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t * (0.5 + i * 0.12) + i);
      ctx.fillRect(-9, -2, 18, 4);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff5d8';
    ctx.beginPath();
    ctx.ellipse(12 + glitch * 0.3, 0, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const wobble = Math.sin(t * 7 + e.phase) * 3;
    const body = ctx.createLinearGradient(-42, -27, 39, 25);
    body.addColorStop(0, '#2a080f');
    body.addColorStop(0.48, '#ff4d5e');
    body.addColorStop(1, '#ffd84a');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(37, 0);
    ctx.lineTo(16, -22 - wobble * 0.2);
    ctx.lineTo(-18, -28 - wobble);
    ctx.lineTo(-42, -8);
    ctx.lineTo(-22, 0);
    ctx.lineTo(-42, 8);
    ctx.lineTo(-18, 28 + wobble);
    ctx.lineTo(16, 22 + wobble * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,216,74,0.62)';
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(13, side * 17);
      ctx.lineTo(-16, side * (38 + pulse * 4));
      ctx.lineTo(-3, side * 13);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = '#ffd84a';
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.arc(side * 18, 0, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#fff5d8';
    ctx.beginPath();
    ctx.moveTo(-24, -12);
    ctx.lineTo(0, 4);
    ctx.lineTo(24, -12);
    ctx.stroke();
    ctx.fillStyle = '#ff4d5e';
    ctx.fillRect(-13, -4, 27, 8);
  }

  drawEnemyArmorAccents(e, t, pulse);
  drawEnemySignatureLights(e, t, pulse);
  drawEnemyPremiumDetails(e, t, pulse, turn, turnPhase);

  if (e.muzzle > 0.02) {
    const m = clamp(e.muzzle, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.38 + m * 0.32;
    const muzzleColour = e.type === 'jammer' ? '#b6c7ff' : e.type === 'hunter' ? '#ffd84a' : '#ffd5e5';
    ctx.fillStyle = muzzleColour;
    ctx.shadowColor = muzzleColour;
    ctx.shadowBlur = 14 * m;
    ctx.beginPath();
    ctx.ellipse(e.type === 'carrier' ? 72 : 42, 0, 6 + m * 9, 3 + m * 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawEnemyPremiumDetails(e: Enemy, t: number, pulse: number, turn: number, turnPhase: number): void {
  const colour = enemyColour(e.type);
  const hot = e.carryId !== null || e.captureCharge > 0.02 || e.intent > 0.5 || e.muzzle > 0.08;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (turn > 0.035) {
    const blade = Math.sin(turnPhase * Math.PI);
    ctx.globalAlpha = 0.28 + blade * 0.72;
    ctx.shadowColor = '#fff5d8';
    ctx.shadowBlur = 18 + blade * 18;
    ctx.strokeStyle = '#fff5d8';
    ctx.lineWidth = e.type === 'carrier' ? 3.8 : 3.1;
    ctx.beginPath();
    ctx.moveTo(-6, e.type === 'carrier' ? -46 : -34);
    ctx.lineTo(8, e.type === 'carrier' ? 46 : 34);
    ctx.stroke();
    ctx.strokeStyle = '#5effdb';
    ctx.lineWidth = e.type === 'carrier' ? 1.8 : 1.35;
    ctx.beginPath();
    ctx.moveTo(12, e.type === 'carrier' ? -38 : -28);
    ctx.lineTo(-12, e.type === 'carrier' ? 38 : 28);
    ctx.stroke();
  }

  ctx.globalAlpha = 0.9;
  if (e.type === 'carrier') {
    ctx.shadowColor = '#ff2f7a';
    ctx.shadowBlur = 18;
    ctx.strokeStyle = 'rgba(255,245,216,0.74)';
    ctx.lineWidth = 1.35;
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(-62, side * 18);
      ctx.bezierCurveTo(-24, side * 30, 28, side * 30, 68, side * 6);
      ctx.stroke();
      ctx.strokeStyle = side < 0 ? '#ffd84a' : '#5effdb';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-34, side * 31);
      ctx.lineTo(46, side * 34);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,245,216,0.74)';
      ctx.lineWidth = 1.35;
    }
    ctx.fillStyle = 'rgba(255,245,216,0.62)';
    for (let i = 0; i < 9; i += 1) {
      const x = -54 + i * 13.5;
      ctx.fillRect(x, -4.2, 5.4, 8.4);
    }
  } else {
    const glass = e.type === 'jammer' ? '#b6c7ff' : e.type === 'hunter' ? '#fff5d8' : e.type === 'forgery' ? '#ffb8ff' : '#fff2a8';
    const accent = e.type === 'jammer' ? '#5effdb' : e.type === 'hunter' ? '#ff4d5e' : e.type === 'forgery' ? '#5effdb' : '#ffd84a';
    const engine = e.type === 'hunter' ? '#ff8a3a' : e.type === 'jammer' ? '#5f7cff' : e.type === 'forgery' ? '#ff3aff' : '#ff4d5e';
    ctx.shadowColor = glass;
    ctx.shadowBlur = hot ? 18 : 12;
    ctx.fillStyle = colourWithAlpha(glass, hot ? 0.82 : 0.62);
    ctx.beginPath();
    ctx.ellipse(e.type === 'hunter' ? 18 : 12, -6, e.type === 'jammer' ? 18 : 15, 5.2, -0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colourWithAlpha('#fff5d8', 0.55);
    ctx.lineWidth = 1.05;
    ctx.beginPath();
    ctx.moveTo(-30, -12);
    ctx.quadraticCurveTo(-4, -24, 34, -6);
    ctx.moveTo(-30, 12);
    ctx.quadraticCurveTo(-4, 24, 34, 6);
    ctx.stroke();

    ctx.shadowColor = accent;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(-22, side * 7);
      ctx.lineTo(24, side * (12 + pulse * 1.8));
      ctx.stroke();
      ctx.fillStyle = side < 0 ? accent : colourWithAlpha('#fff5d8', 0.86);
      ctx.beginPath();
      ctx.arc(-34, side * (13 + pulse * 1.5), 2.9, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.shadowColor = engine;
    ctx.shadowBlur = 16;
    ctx.fillStyle = engine;
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.ellipse(-43, side * (10 + pulse * 2), 5.5 + pulse * 2.5, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (e.type === 'jammer') {
      ctx.strokeStyle = '#b6c7ff';
      ctx.lineWidth = 1.15;
      for (let i = 0; i < 3; i += 1) {
        const yy = -20 + i * 20;
        ctx.beginPath();
        ctx.moveTo(-58, yy + Math.sin(t * 12 + i) * 2);
        ctx.lineTo(58, yy + Math.sin(t * 13 + i) * 2);
        ctx.stroke();
      }
    } else if (e.type === 'hunter') {
      ctx.fillStyle = '#ffd84a';
      ctx.shadowColor = '#ffd84a';
      for (let i = 0; i < 4; i += 1) {
        ctx.beginPath();
        ctx.arc(-24 + i * 11, -1 + Math.sin(t * 18 + i) * 1.2, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (e.type === 'abductor') {
      ctx.strokeStyle = hot ? '#ff4d5e' : '#ffd84a';
      ctx.lineWidth = 1.35;
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(10, side * 18);
        ctx.quadraticCurveTo(24 + pulse * 4, side * 29, 41, side * 20);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function drawEnemyIdentityBadge(e: Enemy, sx: number, y: number, t: number, colour: string): void {
  const pulse = 0.5 + Math.sin(t * 8 + e.phase) * 0.5;
  const r = e.type === 'carrier' ? 15 : 10;
  const by = y - (e.type === 'carrier' ? 60 : 34);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.translate(sx, by);
  ctx.strokeStyle = colour;
  ctx.fillStyle = colourWithAlpha(colour, 0.22 + pulse * 0.08);
  ctx.shadowColor = colour;
  ctx.shadowBlur = e.carryId !== null || e.type === 'carrier' ? 12 : 7;
  ctx.lineWidth = e.type === 'carrier' ? 1.8 : 1.35;
  ctx.beginPath();
  if (e.type === 'hunter') {
    ctx.moveTo(0, -r - 1);
    ctx.lineTo(r + 2, r);
    ctx.lineTo(-r - 2, r);
    ctx.closePath();
  } else if (e.type === 'jammer') {
    ctx.rect(-r, -r, r * 2, r * 2);
  } else if (e.type === 'carrier') {
    for (let i = 0; i < 6; i += 1) {
      const a = -Math.PI / 2 + (i / 6) * Math.PI * 2;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else if (e.type === 'forgery') {
    ctx.moveTo(-r, -r);
    ctx.lineTo(r, r);
    ctx.moveTo(r, -r);
    ctx.lineTo(-r, r);
  } else {
    ctx.moveTo(0, -r - 1);
    ctx.lineTo(r + 1, 0);
    ctx.lineTo(0, r + 1);
    ctx.lineTo(-r - 1, 0);
    ctx.closePath();
  }
  if (e.type === 'forgery') ctx.stroke();
  else {
    ctx.fill();
    ctx.stroke();
  }
  if (e.intent > 0.08) {
    ctx.strokeStyle = e.intent > 0.72 ? '#fff5d8' : colour;
    ctx.lineWidth = e.type === 'carrier' ? 2.2 : 1.8;
    ctx.beginPath();
    ctx.arc(0, 0, r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(e.intent, 0, 1));
    ctx.stroke();
  }
  ctx.fillStyle = '#fff5d8';
  ctx.shadowColor = '#fff5d8';
  ctx.shadowBlur = 4;
  ctx.font = `900 ${e.type === 'carrier' ? 10 : 7.5}px ${FONT_MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(enemyRadarCode(e.type), 0, 0.8);
  ctx.restore();
}

function drawEnemyArmorAccents(e: Enemy, t: number, pulse: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.shadowBlur = 8;
  if (e.type === 'abductor') {
    ctx.strokeStyle = '#ffd84a';
    ctx.fillStyle = '#ffd84a';
    ctx.shadowColor = '#ffd84a';
    ctx.lineWidth = 2;
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(-6, side * 11);
      ctx.lineTo(17, side * (22 + pulse * 3));
      ctx.lineTo(31, side * (15 + pulse * 2));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(28, side * (15 + pulse * 2), 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,77,94,0.72)';
    ctx.shadowColor = '#ff4d5e';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 3; i += 1) {
      const y = -12 + i * 12;
      ctx.beginPath();
      ctx.moveTo(-32, y);
      ctx.lineTo(-12 + pulse * 4, y + Math.sin(t * 5 + i) * 1.4);
      ctx.stroke();
    }
  } else if (e.type === 'hunter') {
    ctx.strokeStyle = '#fff5d8';
    ctx.fillStyle = '#ffd84a';
    ctx.shadowColor = '#ffd84a';
    ctx.lineWidth = 1.9;
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(34, 0);
      ctx.lineTo(-19, side * (18 + pulse * 3));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-42, side * 24);
      ctx.lineTo(-63 - pulse * 7, side * (29 + pulse * 3));
      ctx.stroke();
    }
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.arc(-34 + i * 13, 0, 2.7 + pulse, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (e.type === 'jammer') {
    ctx.strokeStyle = '#b6c7ff';
    ctx.fillStyle = '#5effdb';
    ctx.shadowColor = '#5f7cff';
    ctx.lineWidth = 1.8;
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(-29, side * 16);
      ctx.lineTo(-62, side * (23 + pulse * 5));
      ctx.moveTo(27, side * 13);
      ctx.lineTo(58, side * (18 + pulse * 4));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-65, side * (23 + pulse * 5), 4, 0, Math.PI * 2);
      ctx.arc(61, side * (18 + pulse * 4), 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,58,255,0.68)';
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(-43 + i * 25, -26 + i * 4);
      ctx.lineTo(-22 + i * 25, -22 + i * 4 + Math.sin(t * 10 + i) * 3);
      ctx.stroke();
    }
  } else if (e.type === 'carrier') {
    ctx.strokeStyle = '#ffd84a';
    ctx.fillStyle = '#ffd84a';
    ctx.shadowColor = '#ff2f7a';
    ctx.lineWidth = 1.6;
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < 4; i += 1) {
        const x = -54 + i * 33;
        ctx.beginPath();
        ctx.moveTo(x, side * 35);
        ctx.lineTo(x + 16, side * (48 + pulse * 4));
        ctx.stroke();
      }
      ctx.fillRect(18, side * 21 - 2, 50, 4);
    }
    ctx.strokeStyle = '#5effdb';
    ctx.shadowColor = '#5effdb';
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      ctx.moveTo(-50 + i * 25, -6);
      ctx.lineTo(-38 + i * 25, 6);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawEnemySignatureLights(e: Enemy, t: number, pulse: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (e.type === 'abductor') {
    const hot = e.carryId !== null || e.captureCharge > 0.01;
    ctx.shadowColor = hot ? '#ff4d5e' : '#ffd84a';
    ctx.shadowBlur = hot ? 18 : 12;
    ctx.fillStyle = hot ? 'rgba(255,77,94,0.28)' : 'rgba(255,216,74,0.24)';
    ctx.strokeStyle = hot ? '#ff4d5e' : '#ffd84a';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(-5, -8, 35, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff5d8';
    ctx.beginPath();
    ctx.ellipse(13, -9, 9 + pulse * 1.8, 4.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5effdb';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-29, 4);
    ctx.lineTo(29, 4);
    ctx.stroke();
    for (let i = 0; i < 5; i += 1) {
      const x = -27 + i * 13.5;
      ctx.fillStyle = i % 2 === 0 ? '#5effdb' : '#ffd84a';
      ctx.shadowColor = ctx.fillStyle;
      ctx.beginPath();
      ctx.arc(x, 16 + Math.sin(t * 8 + e.phase + i) * 1.2, 2.2 + pulse * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (e.type === 'hunter') {
    ctx.shadowColor = '#ffd84a';
    ctx.shadowBlur = 12;
    ctx.strokeStyle = '#fff5d8';
    ctx.lineWidth = 1.4;
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(34, 0);
      ctx.lineTo(-10, side * 13);
      ctx.lineTo(-47, side * (28 + pulse * 4));
      ctx.stroke();
    }
    ctx.fillStyle = '#ff4d5e';
    ctx.shadowColor = '#ff4d5e';
    ctx.beginPath();
    ctx.ellipse(-38, 0, 8 + pulse * 2, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5effdb';
    ctx.shadowColor = '#5effdb';
    ctx.beginPath();
    ctx.ellipse(19, 0, 5.5, 3.3, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.type === 'jammer') {
    ctx.shadowColor = '#5f7cff';
    ctx.shadowBlur = 15;
    ctx.strokeStyle = '#b6c7ff';
    ctx.lineWidth = 1.5;
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(-42, side * 27);
      ctx.lineTo(-65 - pulse * 6, side * (34 + pulse * 3));
      ctx.moveTo(38, side * 20);
      ctx.lineTo(62 + pulse * 5, side * (25 + pulse * 3));
      ctx.stroke();
      ctx.fillStyle = side < 0 ? '#ffd84a' : '#5effdb';
      ctx.shadowColor = ctx.fillStyle;
      ctx.beginPath();
      ctx.arc(-67 - pulse * 5, side * (34 + pulse * 3), 4, 0, Math.PI * 2);
      ctx.arc(64 + pulse * 4, side * (25 + pulse * 3), 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(95,124,255,0.34)';
    roundedRect(-24, -10, 48, 20, 4);
    ctx.fill();
  } else if (e.type === 'carrier') {
    ctx.shadowColor = '#ff2f7a';
    ctx.shadowBlur = 18;
    ctx.strokeStyle = '#ffd84a';
    ctx.fillStyle = '#ffd84a';
    ctx.lineWidth = 1.4;
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < 4; i += 1) {
        const x = -50 + i * 32;
        ctx.beginPath();
        ctx.moveTo(x, side * 29);
        ctx.lineTo(x + 18, side * (39 + pulse * 2));
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + 18, side * (39 + pulse * 2), 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = '#5effdb';
    ctx.shadowColor = '#5effdb';
    for (let i = 0; i < 6; i += 1) ctx.fillRect(-42 + i * 17, -3, 7, 6);
    ctx.strokeStyle = '#fff5d8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-66, 0);
    ctx.lineTo(66, 0);
    ctx.stroke();
  } else {
    ctx.shadowColor = '#ff3aff';
    ctx.shadowBlur = 12;
    for (let i = 0; i < 5; i += 1) {
      const x = -34 + i * 17 + Math.sin(t * 10 + i + e.phase) * 3;
      const y = -16 + (i % 3) * 15;
      ctx.fillStyle = i % 2 === 0 ? '#5effdb' : '#ffd84a';
      ctx.fillRect(x, y, 10 + pulse * 4, 2.5);
    }
  }

  ctx.restore();
}

function drawShip(t: number): void {
  const ship = state.ship;
  if (state.shipDestroyed) return;
  if (ship.invuln > 0 && Math.floor(t * 16) % 2 === 0) return;
  const sx = screenX(ship.x);
  const speed = Math.hypot(ship.vx, ship.vy);
  const bank = clamp(ship.vy / shipSpec(state.shipClass).maxY, -1, 1);
  const scale = getTuning().actorScale;
  const turn = clamp(ship.turnCue, 0, 1);
  const heat = clamp(ship.heat, 0, 1);
  if (HI_DPI_SPRITE_ACTORS) {
    drawShipSprite({
      ctx,
      shipClass: state.shipClass,
      x: sx,
      y: ship.y,
      dir: ship.dir,
      scale: scale * 0.69,
      bank,
      turn,
      thrust: clamp(speed / 1040, 0, 1),
      heat,
      t,
    });
    if (ship.shieldHits > 0) drawShipShieldHalo(sx, ship.y, ship.shieldHits, t, scale);
    return;
  }
  ctx.save();
  ctx.translate(sx, ship.y);
  if (ship.shieldHits > 0) drawShipShieldHalo(0, 0, ship.shieldHits, t, scale, true);
  ctx.scale(ship.dir * 0.4 * scale * PLAYER_VISUAL_SCALE, 0.4 * scale * PLAYER_VISUAL_SCALE);
  ctx.rotate(bank * 0.05);
  if (turn > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = turn;
    const brake = ctx.createLinearGradient(36, 0, -54, 0);
    brake.addColorStop(0, 'rgba(255,255,255,0.9)');
    brake.addColorStop(0.34, 'rgba(94,255,219,0.58)');
    brake.addColorStop(1, 'rgba(94,255,219,0)');
    ctx.fillStyle = brake;
    ctx.shadowColor = '#5effdb';
    ctx.shadowBlur = 18;
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(24, side * 16);
      ctx.lineTo(-46 - turn * 30, side * (30 + turn * 8));
      ctx.lineTo(-18, side * 8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  if (speed > 70) {
    const flame = 24 + Math.min(70, speed * 0.085) + Math.sin(t * 50) * 5;
    const plume = ctx.createLinearGradient(-28, 0, -48 - flame, 0);
    plume.addColorStop(0, 'rgba(255,255,255,0.95)');
    plume.addColorStop(0.28, 'rgba(255,216,74,0.85)');
    plume.addColorStop(0.75, 'rgba(255,77,94,0.25)');
    plume.addColorStop(1, 'rgba(255,77,94,0)');
    ctx.fillStyle = plume;
    ctx.shadowColor = '#ff8a3a';
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.moveTo(-28, -8);
    ctx.lineTo(-48 - flame, 0);
    ctx.lineTo(-28, 8);
    ctx.closePath();
    ctx.fill();
  }
  ctx.shadowColor = '#5effdb';
  ctx.shadowBlur = 16;
  const hull = ctx.createLinearGradient(-42, -20, 54, 20);
  hull.addColorStop(0, '#08131b');
  hull.addColorStop(0.38, '#18596a');
  hull.addColorStop(0.72, '#efffff');
  hull.addColorStop(1, '#ffd84a');
  ctx.fillStyle = hull;
  ctx.strokeStyle = '#f6ffff';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(52, 0);
  ctx.lineTo(15, -18);
  ctx.lineTo(-30, -19);
  ctx.lineTo(-44, -8);
  ctx.lineTo(-18, 0);
  ctx.lineTo(-44, 8);
  ctx.lineTo(-30, 19);
  ctx.lineTo(15, 18);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.shadowColor = '#5effdb';
  ctx.shadowBlur = 18;
  ctx.strokeStyle = 'rgba(255,245,216,0.82)';
  ctx.lineWidth = 1.5;
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(-34, side * 14);
    ctx.quadraticCurveTo(0, side * 29, 42, side * 7);
    ctx.stroke();
    ctx.strokeStyle = side < 0 ? '#ffd84a' : '#5effdb';
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.moveTo(-24, side * 18);
    ctx.lineTo(28, side * 13);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,245,216,0.82)';
    ctx.lineWidth = 1.5;
  }
  ctx.fillStyle = '#fff5d8';
  ctx.shadowColor = '#fff5d8';
  for (let i = 0; i < 6; i += 1) {
    ctx.fillRect(-22 + i * 9.5, -2.2, 4.5, 4.4);
  }
  if (turn > 0.03) {
    const blade = Math.sin((1 - turn) * Math.PI);
    ctx.globalAlpha = 0.28 + blade * 0.52;
    ctx.shadowBlur = 24;
    ctx.strokeStyle = '#fff5d8';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(-3, -25);
    ctx.lineTo(6, 25);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(2,4,11,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-20, -11);
  ctx.lineTo(20, 0);
  ctx.lineTo(-20, 11);
  ctx.moveTo(-33, -7);
  ctx.lineTo(-15, 0);
  ctx.lineTo(-33, 7);
  ctx.stroke();
  ctx.fillStyle = '#7dfff2';
  ctx.shadowColor = '#5effdb';
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.ellipse(10, -4, 15, 7, -0.14, 0, Math.PI * 2);
  ctx.fill();
  if (heat > 0.05) {
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.32 + heat * 0.38;
    const heatColour = heat > 0.72 ? '#ff4d5e' : '#ffd84a';
    ctx.fillStyle = heatColour;
    ctx.shadowColor = heatColour;
    ctx.shadowBlur = 14 + heat * 18;
    ctx.beginPath();
    ctx.ellipse(53, 0, 8 + heat * 6, 4 + heat * 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawShipShieldHalo(x: number, y: number, hits: number, t: number, scale: number, local = false): void {
  const pulse = 0.5 + Math.sin(t * 7.2) * 0.5;
  const radius = 56 * scale + hits * 4 + pulse * 3;
  ctx.save();
  if (!local) ctx.translate(x, y);
  ctx.globalCompositeOperation = 'screen';
  ctx.strokeStyle = hits >= 2 ? '#ffd84a' : '#5effdb';
  ctx.shadowColor = ctx.strokeStyle;
  ctx.shadowBlur = 18;
  ctx.lineWidth = 2.3;
  ctx.globalAlpha = 0.42 + pulse * 0.22;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.22 + pulse * 0.12;
  for (let i = 0; i < hits; i += 1) {
    const a = t * 1.7 + i * (Math.PI * 2 / Math.max(1, hits));
    ctx.beginPath();
    ctx.arc(Math.cos(a) * radius * 0.62, Math.sin(a) * radius * 0.62, 4, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  }
  ctx.restore();
}

function drawLowAltitudeWarning(t: number): void {
  if (state.lowAltitudeWarning <= 0 || state.phase !== 'playing' || state.shipDestroyed) return;
  const life = clamp(state.lowAltitudeWarning, 0, 1);
  const sx = screenX(state.ship.x);
  const floorY = terrainY(state.ship.x) - 58;
  const y = clamp(floorY + 28, PLAY_TOP + 70, GROUND_BASE - 10);
  const hot = state.lowCamp > 0.62;
  const pulse = 0.5 + Math.sin(t * 18) * 0.5;
  ctx.save();
  ctx.globalAlpha = life * (hot ? 0.9 : 0.62);
  ctx.globalCompositeOperation = 'screen';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${hot ? 11 : 9}px ${FONT_MONO}`;
  ctx.shadowColor = hot ? '#ff8a3a' : '#ffd84a';
  ctx.shadowBlur = hot ? 18 : 11;
  ctx.strokeStyle = hot ? '#ff8a3a' : '#ffd84a';
  ctx.fillStyle = hot ? '#ffd84a' : 'rgba(255,245,216,0.84)';
  ctx.lineWidth = hot ? 2 : 1.3;
  for (const side of [-1, 1] as const) {
    const x = sx + side * (46 + pulse * 8);
    ctx.beginPath();
    ctx.moveTo(x, y - 12);
    ctx.lineTo(x + side * 18, y);
    ctx.lineTo(x, y + 12);
    ctx.stroke();
  }
  ctx.fillText(hot ? 'LOW ALTITUDE FLAK' : 'LOW ALTITUDE', sx, y);
  ctx.restore();
}

function drawDamageCue(t: number): void {
  if (state.damageCue <= 0) return;
  const sx = screenX(state.ship.x);
  const life = clamp(state.damageCue, 0, 1);
  const ring = 34 + (1 - life) * 58;
  const side = state.ship.vx >= 0 ? -1 : 1;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = life;
  ctx.strokeStyle = '#ff4d5e';
  ctx.fillStyle = '#ff4d5e';
  ctx.shadowColor = '#ff4d5e';
  ctx.shadowBlur = 18 * life;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(sx, state.ship.y, ring, -0.78 * Math.PI, 0.78 * Math.PI);
  ctx.stroke();

  ctx.lineWidth = 3.2;
  for (const yoff of [-18, 18] as const) {
    ctx.beginPath();
    ctx.moveTo(sx + side * (36 + (1 - life) * 20), state.ship.y + yoff);
    ctx.lineTo(sx + side * (12 + (1 - life) * 9), state.ship.y + yoff * 0.42);
    ctx.stroke();
  }

  ctx.font = `900 ${Math.round(9 + life * 2)}px ${FONT_MONO}`;
  ctx.textAlign = 'center';
  ctx.fillText('HULL', sx, state.ship.y - 50 - Math.sin(t * 18) * 2);
  ctx.restore();
}

function drawJamCue(t: number): void {
  if (state.jamCue <= 0) return;
  const sx = screenX(state.ship.x);
  const life = clamp(state.jamCue, 0, 1);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = life * 0.82;
  ctx.strokeStyle = '#5f7cff';
  ctx.fillStyle = '#5f7cff';
  ctx.shadowColor = '#5f7cff';
  ctx.shadowBlur = 12 * life;
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 3; i += 1) {
    const r = 34 + i * 12 + Math.sin(t * 12 + i) * 3;
    ctx.beginPath();
    ctx.arc(sx, state.ship.y, r, 0.1 * Math.PI + i * 0.45, 1.72 * Math.PI + i * 0.45);
    ctx.stroke();
  }
  ctx.font = `900 9px ${FONT_MONO}`;
  ctx.textAlign = 'center';
  ctx.fillText('JAM', sx, state.ship.y + 52);
  ctx.restore();
}

function drawEnemyFireIntents(t: number): void {
  if (state.phase !== 'playing' || state.shipDestroyed) return;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.lineCap = 'round';
  for (const e of state.enemies) {
    if (!e.alive || e.carryId !== null) continue;
    const kind = enemyShotKind(e);
    if (!kind || !enemyCanShoot(e, kind)) continue;
    const ready = enemyFireReadiness(e, kind);
    if (ready <= 0.035) continue;
    const colour = enemyShotColour(kind);
    const speed = enemyShotSpeed(e, kind);
    const muzzle = enemyMuzzlePoint(e);
    const aim = enemyAimPoint(e, speed);
    const dx = wrapDelta(aim.x, muzzle.x);
    const dy = aim.y - muzzle.y;
    const d = Math.hypot(dx, dy) || 1;
    const sx = screenX(muzzle.x);
    if (sx < -220 || sx > VIEW_W + 220) continue;
    const baseLen = kind === 'barrage' ? 690 : kind === 'jam' ? 560 : 500;
    const len = Math.min(baseLen, Math.max(220, d + (kind === 'barrage' ? 240 : 140)));
    const ex = sx + (dx / d) * len;
    const ey = muzzle.y + (dy / d) * len;
    const alpha = ready * (kind === 'barrage' ? 0.32 : kind === 'jam' ? 0.28 : 0.23);
    const core = ready * (kind === 'barrage' ? 0.46 : 0.36);
    ctx.setLineDash(kind === 'jam' ? [4, 8] : kind === 'barrage' ? [16, 12] : [10, 10]);
    ctx.strokeStyle = colourWithAlpha(colour, alpha);
    ctx.shadowColor = colour;
    ctx.shadowBlur = 8 + ready * 10;
    ctx.lineWidth = kind === 'barrage' ? 2.1 : kind === 'jam' ? 1.55 : 1.1;
    ctx.beginPath();
    ctx.moveTo(sx, muzzle.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = colourWithAlpha('#fff5d8', core);
    ctx.shadowBlur = 3 + ready * 5;
    ctx.lineWidth = kind === 'barrage' ? 0.85 : 0.55;
    ctx.beginPath();
    ctx.moveTo(sx, muzzle.y);
    ctx.lineTo(sx + (dx / d) * len * 0.44, muzzle.y + (dy / d) * len * 0.44);
    ctx.stroke();
    if (ready > 0.62) {
      ctx.globalAlpha = Math.min(0.9, ready);
      ctx.fillStyle = kind === 'jam' ? '#b6c7ff' : '#fff5d8';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.ellipse(sx, muzzle.y, kind === 'barrage' ? 6 : 4.4, kind === 'barrage' ? 3 : 2.2, Math.atan2(dy, dx), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

function drawEnemyShot(shot: EnemyShot, t: number): void {
  const sx = screenX(shot.x);
  if (sx < -80 || sx > VIEW_W + 80) return;
  const colour = enemyShotColour(shot.kind);
  if (shot.kind === 'spam') {
    drawSpamMine(shot, sx, t, colour);
    return;
  }
  const angle = Math.atan2(shot.vy, shot.vx);
  const tailLen = shot.kind === 'barrage' ? 48 : shot.kind === 'jam' ? 42 : 38;
  const headLen = shot.kind === 'barrage' ? 10 : shot.kind === 'jam' ? 8 : 6;
  const half = shot.kind === 'barrage' ? 2.8 : shot.kind === 'jam' ? 2.3 : 1.35;
  const pulse = 0.5 + Math.sin(t * (shot.kind === 'jam' ? 15 : shot.kind === 'barrage' ? 18 : 24) + shot.age * 8) * 0.5;
  const armed = shot.age >= (shot.armTime ?? 0);
  ctx.save();
  ctx.translate(sx, shot.y);
  ctx.rotate(angle);
  ctx.globalCompositeOperation = 'screen';
  ctx.shadowColor = colour;
  ctx.shadowBlur = (shot.kind === 'jam' ? 10 : shot.kind === 'barrage' ? 12 : 7) * (armed ? 1 : 0.55);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  const trail = ctx.createLinearGradient(-tailLen, 0, headLen, 0);
  trail.addColorStop(0, 'rgba(0,0,0,0)');
  trail.addColorStop(0.38, colourWithAlpha(colour, shot.kind === 'barrage' ? 0.28 : 0.22));
  trail.addColorStop(0.86, colour);
  trail.addColorStop(1, '#fff5d8');
  ctx.globalAlpha = (shot.kind === 'jam' ? 0.82 : shot.kind === 'barrage' ? 0.88 : 0.86) * (armed ? 1 : 0.46);
  ctx.strokeStyle = trail;
  ctx.lineWidth = shot.kind === 'barrage' ? 1.35 : shot.kind === 'jam' ? 1.15 : 0.72;
  ctx.beginPath();
  ctx.moveTo(-tailLen, 0);
  ctx.lineTo(headLen * 0.65, 0);
  ctx.stroke();

  ctx.globalAlpha = armed ? 0.82 : 0.38;
  ctx.strokeStyle = shot.kind === 'jam' ? '#e7edff' : shot.kind === 'barrage' ? '#fff0f7' : '#fff5d8';
  ctx.lineWidth = shot.kind === 'barrage' ? 0.55 : 0.42;
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.moveTo(-tailLen * 0.48, 0);
  ctx.lineTo(headLen * 0.78, 0);
  ctx.stroke();

  ctx.globalAlpha = armed ? 0.96 : 0.52;
  ctx.fillStyle = shot.kind === 'jam' ? '#b6c7ff' : shot.kind === 'barrage' ? '#ffd5e5' : '#fff5d8';
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.shadowBlur = shot.kind === 'barrage' ? 14 : 9;
  ctx.beginPath();
  ctx.moveTo(headLen + pulse * 1.5, 0);
  ctx.lineTo(0, -half);
  ctx.lineTo(-headLen * 0.42, 0);
  ctx.lineTo(0, half);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  if (shot.kind === 'barrage') {
    ctx.globalAlpha = 0.72;
    ctx.strokeStyle = '#fff0f7';
    ctx.lineWidth = 1.1;
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(-8, side * 1.8);
      ctx.lineTo(-24 - pulse * 5, side * (8 + pulse * 2));
      ctx.stroke();
    }
  } else if (shot.kind === 'jam') {
    ctx.globalAlpha = 0.68;
    ctx.strokeStyle = '#5effdb';
    ctx.lineWidth = 0.9;
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(-4, side * 1.4);
      ctx.lineTo(-22 - pulse * 4, side * (7 + pulse * 2));
      ctx.lineTo(-31 - pulse * 3, side * (2 + pulse));
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawSpamMine(shot: EnemyShot, sx: number, t: number, colour: string): void {
  const armed = shot.age >= (shot.armTime ?? 0);
  const pulse = 0.5 + Math.sin(t * 9 + shot.age * 6) * 0.5;
  const fade = Math.min(1, shot.ttl / 0.6);
  const r = (armed ? 13 : 9) + pulse * 2.4;
  ctx.save();
  ctx.translate(sx, shot.y);
  ctx.rotate(t * 1.6 + shot.age);
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = (armed ? 0.92 : 0.5) * fade;
  ctx.shadowColor = colour;
  ctx.shadowBlur = armed ? 14 + pulse * 8 : 8;

  ctx.strokeStyle = colour;
  ctx.fillStyle = colourWithAlpha(colour, 0.26);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = armed ? '#e8d4ff' : colourWithAlpha('#e8d4ff', 0.6);
  ctx.lineWidth = 1.1;
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    ctx.lineTo(Math.cos(a) * (r + 5 + pulse * 3), Math.sin(a) * (r + 5 + pulse * 3));
    ctx.stroke();
  }

  ctx.fillStyle = armed ? '#fff5d8' : '#c9a8ff';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(0, 0, 3 + pulse * 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLaser(laser: Laser): void {
  const sx = screenX(laser.x);
  const ex = sx + laser.dir * laser.length;
  const alpha = clamp(laser.ttl / LASER_TTL, 0, 1);
  const heat = clamp(laser.heat, 0, 1);
  const ix = laser.impact ? screenX(laser.impactX) : ex;
  const iy = laser.impact ? laser.impactY : laser.y;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  const beam = ctx.createLinearGradient(sx, laser.y, ex, laser.y);
  beam.addColorStop(0, '#ffffff');
  beam.addColorStop(0.22, '#5effdb');
  beam.addColorStop(0.72, '#fff5d8');
  beam.addColorStop(1, 'rgba(255,245,216,0)');
  ctx.globalAlpha = alpha * 0.82;
  ctx.strokeStyle = beam;
  ctx.shadowColor = heat > 0.68 ? '#ff4d5e' : '#5effdb';
  ctx.shadowBlur = 7 + heat * 5;
  ctx.lineWidth = 1.55 - heat * 0.28;
  ctx.beginPath();
  ctx.moveTo(sx, laser.y);
  ctx.lineTo(ex, laser.y);
  ctx.stroke();

  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#ffffff';
  ctx.shadowBlur = 2;
  ctx.lineWidth = 0.68;
  ctx.beginPath();
  ctx.moveTo(sx, laser.y);
  ctx.lineTo(ex, laser.y);
  ctx.stroke();

  // The first frames of each shot carry a wider white-hot core, so held fire
  // strobes like a cabinet gun instead of drawing a steady line.
  const flash = clamp((alpha - 0.55) / 0.45, 0, 1);
  if (flash > 0) {
    ctx.globalAlpha = flash * 0.85;
    ctx.lineWidth = 1.9 + heat * 0.8;
    ctx.beginPath();
    ctx.moveTo(sx, laser.y);
    ctx.lineTo(ex, laser.y);
    ctx.stroke();
  }

  ctx.globalAlpha = alpha * 0.52;
  ctx.strokeStyle = heat > 0.65 ? '#ff8a3a' : '#ffd84a';
  ctx.shadowColor = ctx.strokeStyle;
  ctx.shadowBlur = 5;
  ctx.lineWidth = 0.52;
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(sx + laser.dir * 16, laser.y + side * 2.2);
    ctx.lineTo(sx + laser.dir * laser.length * 0.78, laser.y + side * 1.2);
    ctx.stroke();
  }

  ctx.globalAlpha = alpha * 0.85;
  ctx.fillStyle = '#fff5d8';
  ctx.shadowColor = '#5effdb';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(sx + laser.dir * 16, laser.y);
  ctx.lineTo(sx + laser.dir * 4, laser.y - 4);
  ctx.lineTo(sx - laser.dir * 3, laser.y);
  ctx.lineTo(sx + laser.dir * 4, laser.y + 4);
  ctx.closePath();
  ctx.fill();

  if (heat > 0.25) {
    ctx.globalAlpha = alpha * heat * 0.5;
    ctx.strokeStyle = '#ff4d5e';
    ctx.shadowColor = '#ff4d5e';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(sx + laser.dir * laser.length * 0.2, laser.y + 4);
    ctx.lineTo(ex, laser.y + Math.sin(laser.x * 0.03 + laser.ttl * 90) * 1.2);
    ctx.stroke();
  }
  if (laser.impact) {
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle = heat > 0.68 ? '#ff8a3a' : '#fff5d8';
    ctx.strokeStyle = '#5effdb';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 16 + heat * 12;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.ellipse(ix, iy, 9 + heat * 5, 3.4 + heat * 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = alpha * 0.54;
    ctx.beginPath();
    ctx.arc(ix, iy, 18 + heat * 8, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBeacon(b: Beacon, t: number): void {
  const sx = screenX(b.x);
  if (sx < -80 || sx > VIEW_W + 80) return;
  const rot = t * 3.8 + b.age * 2;
  const sprite = beaconSprite(b);
  const pulse = Math.sin(t * 7 + b.age) * 0.5 + 0.5;
  const life = b.kind === 'life';
  const colour = beaconColour(b.kind);
  const scale = vectorBeaconScale(b);
  ctx.save();
  ctx.translate(sx, b.y);
  ctx.scale(scale, scale);
  ctx.shadowColor = colour;
  ctx.shadowBlur = (life ? 24 : 34) + pulse * (life ? 8 : 12);
  ctx.strokeStyle = beaconRingColour(b.kind);
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(0, 0, (life ? 35 : 48) + pulse * (life ? 3 : 5), 0, Math.PI * 2);
  ctx.stroke();

  if (life) {
    drawLifeBeacon(rot, pulse);
  } else if (sprite && sprite.complete && sprite.naturalWidth > 0) {
    const size = vectorBeaconSpriteSize(b.kind);
    ctx.save();
    ctx.rotate(Math.sin(rot * 0.54) * 0.16);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.2 + pulse * 0.1;
    ctx.fillStyle = b.kind === 'rose' ? '#ff4d8d' : '#f47316';
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.48, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
    ctx.restore();
  } else if (b.kind === 'shield') {
    drawShieldBeacon(rot, pulse, ctx);
  } else if (isStandardBeaconKind(b.kind)) {
    drawStandardBeacon(b.kind, rot, pulse);
  } else if (b.kind === 'zap') {
    drawZapBeacon(rot, pulse);
  } else if (b.kind === 'net') {
    drawNetBeacon(rot, pulse, ctx);
  } else if (b.kind === 'cult') {
    drawCultBeacon(rot, pulse, ctx);
  } else if (b.kind === 'fourtwenty') {
    drawFourTwentyBeacon(rot, pulse, ctx);
  } else if (b.kind === 'timelock') {
    drawTimeLockBeacon(rot, pulse, ctx);
  } else if (b.kind === 'scooter') {
    drawScooterBeacon(rot, pulse, ctx);
  } else if (b.kind === 'multi') {
    drawFanoutBeacon(rot, pulse);
  } else {
    draw600bMedallion(rot, ctx);
  }

  ctx.shadowBlur = 8;
  ctx.fillStyle = life ? '#d7ffe1' : b.kind === 'rose' ? '#ffb3c7' : '#fff5d8';
  ctx.font = `900 10px ${FONT_MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (!life) ctx.fillText(beaconLabel(b.kind), 0, 54);
  ctx.restore();
}

function beaconSprite(b: Beacon): HTMLImageElement | null {
  if (b.kind === 'rose') return ROSE_PICKUP;
  if (b.kind === 'whole-cake') return WHOLE_CAKE_PICKUP;
  if (b.kind === 'cake-piece') return CAKE_PICKUPS[b.spriteIndex % CAKE_PICKUPS.length] ?? CAKE_PICKUPS[0] ?? null;
  return null;
}

function vectorBeaconScale(b: Beacon): number {
  if (b.kind === 'life') return 0.72;
  const base = b.kind === 'rose' || b.kind === 'cake-piece' || b.kind === 'whole-cake' ? 0.98 : 0.9;
  return base + Math.min(0.28, (b.value - 1) * 0.1);
}

function vectorBeaconSpriteSize(kind: BeaconKind): number {
  if (kind === 'rose') return 92;
  if (kind === 'cake-piece') return 94;
  if (kind === 'whole-cake') return 116;
  return 72;
}

function beaconColour(kind: BeaconKind): string {
  if (kind === 'life') return '#8cffb4';
  if (kind === 'rose') return '#ff4d8d';
  if (kind === 'shield') return '#5effdb';
  if (kind === 'relay') return '#8cffb4';
  if (kind === 'charge') return '#ffd84a';
  if (kind === 'zap') return '#ffe14a';
  if (kind === 'net') return '#8cffb4';
  if (kind === 'cult') return '#c58bff';
  if (kind === 'fourtwenty') return '#8cff5a';
  if (kind === 'scooter') return '#7dcfff';
  if (kind === 'multi') return '#ffb03a';
  if (kind === 'timelock') return '#ff4d5e';
  return '#ffd84a';
}

function beaconRingColour(kind: BeaconKind): string {
  if (kind === 'timelock') return '#ff9aa4';
  if (kind === 'cult') return '#e2c8ff';
  if (kind === 'fourtwenty') return '#c9ffb2';
  if (kind === 'scooter') return '#c3e9ff';
  if (kind === 'multi') return '#ffd9a0';
  if (kind === 'rose') return '#ff9ab9';
  if (kind === 'shield') return '#5effdb';
  if (kind === 'relay') return '#8cffb4';
  if (kind === 'charge') return '#fff2a8';
  if (kind === 'zap') return '#fff2a8';
  if (kind === 'net') return '#c4ffdd';
  return beaconColour(kind);
}

function beaconLabel(kind: BeaconKind): string {
  if (kind === 'timelock') return 'TIME LOCK';
  if (kind === 'cult') return 'NOT A CULT';
  if (kind === 'fourtwenty') return '4:20';
  if (kind === 'scooter') return 'DNI SCOOTER';
  if (kind === 'multi') return 'FANOUT x3';
  if (kind === 'rose') return 'VALUE';
  if (kind === 'cake-piece' || kind === 'whole-cake' || kind === '600b') return '600B';
  if (kind === 'shield') return 'SHIELD';
  if (kind === 'relay') return 'RELAY';
  if (kind === 'charge') return 'CHARGE';
  if (kind === 'zap') return 'ZAP x2';
  if (kind === 'net') return 'NET';
  return '+TIME';
}

function isStandardBeaconKind(kind: BeaconKind): kind is 'relay' | 'charge' {
  return kind === 'relay' || kind === 'charge';
}

function drawStandardBeacon(kind: 'relay' | 'charge', rot: number, pulse: number): void {
  const colour = beaconColour(kind);
  const face = Math.abs(Math.cos(rot));
  const bodyW = 18 + face * 46;
  ctx.save();
  ctx.rotate(Math.sin(rot * 0.45) * 0.14);
  ctx.globalCompositeOperation = 'screen';
  const body = ctx.createRadialGradient(-bodyW * 0.18, -12, 4, 0, 0, 34);
  body.addColorStop(0, '#fffdf4');
  body.addColorStop(0.24, colour);
  body.addColorStop(0.7, kind === 'charge' ? '#8d5f00' : '#07532b');
  body.addColorStop(1, '#02040b');
  ctx.fillStyle = body;
  ctx.strokeStyle = '#fff5d8';
  ctx.lineWidth = 2.2;

  if (kind === 'relay') {
    ctx.beginPath();
    ctx.ellipse(0, 0, bodyW / 2, 30 + pulse, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,245,216,0.72)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 3; i += 1) {
      const r = 9 + i * 9 + pulse * 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, r, -Math.PI * 0.72, Math.PI * 0.72);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r, Math.PI * 0.28, Math.PI * 1.72);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff5d8';
    ctx.beginPath();
    ctx.arc(0, 0, 5 + pulse * 1.4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    roundedRect(-bodyW / 2, -29, bodyW, 58, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff5d8';
    ctx.beginPath();
    ctx.moveTo(6, -23);
    ctx.lineTo(-10, 2);
    ctx.lineTo(3, 2);
    ctx.lineTo(-7, 24);
    ctx.lineTo(15, -7);
    ctx.lineTo(2, -7);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawZapBeacon(rot: number, pulse: number): void {
  const face = Math.abs(Math.cos(rot));
  const bodyW = 16 + face * 44;
  ctx.save();
  ctx.rotate(Math.sin(rot * 0.45) * 0.14);
  ctx.globalCompositeOperation = 'screen';
  const body = ctx.createRadialGradient(-bodyW * 0.18, -12, 4, 0, 0, 34);
  body.addColorStop(0, '#fffdf0');
  body.addColorStop(0.26, '#ffe14a');
  body.addColorStop(0.7, '#8d5f00');
  body.addColorStop(1, '#02040b');
  ctx.fillStyle = body;
  ctx.strokeStyle = '#fff5d8';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(0, -36 - pulse * 2);
  ctx.lineTo(bodyW / 2, 0);
  ctx.lineTo(0, 36 + pulse * 2);
  ctx.lineTo(-bodyW / 2, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fff5d8';
  ctx.shadowColor = '#ffe14a';
  ctx.shadowBlur = 16 + pulse * 8;
  ctx.beginPath();
  ctx.moveTo(7, -24);
  ctx.lineTo(-11, 3);
  ctx.lineTo(2, 3);
  ctx.lineTo(-8, 25);
  ctx.lineTo(14, -6);
  ctx.lineTo(2, -6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFanoutBeacon(rot: number, pulse: number): void {
  // Relay fanout: one feed node splitting into three beam lanes, each capped
  // with an arrowhead — the weapon pickup wears the network diagram.
  const face = Math.abs(Math.cos(rot));
  const bodyW = 16 + face * 44;
  ctx.save();
  ctx.rotate(Math.sin(rot * 0.45) * 0.14);
  ctx.globalCompositeOperation = 'screen';
  const body = ctx.createRadialGradient(-bodyW * 0.18, -12, 4, 0, 0, 34);
  body.addColorStop(0, '#fffdf0');
  body.addColorStop(0.26, '#ffb03a');
  body.addColorStop(0.7, '#7a4a05');
  body.addColorStop(1, '#02040b');
  ctx.fillStyle = body;
  ctx.strokeStyle = '#fff5d8';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.ellipse(0, 0, bodyW / 2, 32 + pulse, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#fff5d8';
  ctx.fillStyle = '#fff5d8';
  ctx.shadowColor = '#ffb03a';
  ctx.shadowBlur = 14 + pulse * 8;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(-15, 0, 4.4, 0, Math.PI * 2);
  ctx.fill();
  for (const lane of [-1, 0, 1] as const) {
    const ty = lane * 16;
    ctx.beginPath();
    ctx.moveTo(-11, 0);
    ctx.quadraticCurveTo(2, ty * 0.62, 13, ty);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(21, ty);
    ctx.lineTo(12, ty - 4.4);
    ctx.lineTo(12, ty + 4.4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawLifeBeacon(rot: number, pulse: number): void {
  const face = Math.abs(Math.cos(rot));
  const coinW = 12 + face * 42;
  ctx.save();
  ctx.rotate(Math.sin(rot * 0.42) * 0.16);
  ctx.globalCompositeOperation = 'screen';
  const body = ctx.createRadialGradient(-coinW * 0.2, -10, 3, 0, 0, 29);
  body.addColorStop(0, '#f2fff5');
  body.addColorStop(0.2, '#8cffb4');
  body.addColorStop(0.58, '#20c878');
  body.addColorStop(1, '#06351e');
  ctx.fillStyle = body;
  ctx.strokeStyle = '#d7ffe1';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.ellipse(0, 0, coinW / 2, 24 + pulse, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,245,216,0.72)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.ellipse(0, 0, Math.max(4, coinW / 2 - 6), 17 + pulse, 0, 0, Math.PI * 2);
  ctx.stroke();
  const glintX = -coinW * 0.18 + Math.sin(rot) * coinW * 0.14;
  ctx.fillStyle = 'rgba(255,255,255,0.48)';
  ctx.beginPath();
  ctx.ellipse(glintX, -10, Math.max(2.5, coinW * 0.12), 3.8, -0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff5d8';
  ctx.shadowColor = '#052816';
  ctx.shadowBlur = 4;
  ctx.font = `900 ${coinW > 25 ? 12 : 8}px ${FONT_MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (coinW > 18) ctx.fillText('TIME', 0, 1);
  ctx.restore();
}

function drawParticle(p: Particle): void {
  const sx = screenX(p.x);
  if (sx < -340 || sx > VIEW_W + 340) return;
  const life = clamp(p.ttl / Math.max(0.001, p.ttl + p.age), 0, 1);
  const load = particleLoad();
  if (load > PARTICLE_CRITICAL_LOAD && (p.kind === 'spark' || p.kind === 'beam') && life < 0.3) return;
  // Canvas shadows cost a full offscreen blur pass per shadowed draw, and
  // particles are by far the most numerous draws (the 2026-07 desktop jitter
  // profiled at ~3x frame cost from shadows alone). Gradient kinds bloom on
  // their own, high-count kinds fake glow with an oversized low-alpha halo,
  // and only the few low-count stroke kinds keep a true shadow.
  ctx.save();
  ctx.globalAlpha = life;
  if (p.kind === 'ring' || p.kind === 'starflare' || p.kind === 'text') {
    const blurScale = load > PARTICLE_PRESSURE_LOAD ? clamp(1 - (load - PARTICLE_PRESSURE_LOAD) * 1.15, 0.46, 1) : 1;
    ctx.shadowColor = p.colour;
    ctx.shadowBlur = (p.kind === 'text' ? 10 : 18) * blurScale;
  }
  if (p.kind === 'flash') {
    const radius = p.size * (0.48 + p.age * 0.9);
    const flareW = radius * (2.1 + (1 - life) * 0.45);
    const flareH = Math.max(7, radius * 0.16);
    ctx.globalCompositeOperation = 'screen';
    const bloom = ctx.createRadialGradient(sx, p.y, 2, sx, p.y, radius);
    bloom.addColorStop(0, 'rgba(255,255,255,0.98)');
    bloom.addColorStop(0.16, colourWithAlpha('#fff5d8', 0.8 * life));
    bloom.addColorStop(0.46, colourWithAlpha(p.colour, 0.32 * life));
    bloom.addColorStop(1, colourWithAlpha(p.colour, 0));
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(sx, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
    const flare = ctx.createLinearGradient(sx - flareW, p.y, sx + flareW, p.y);
    flare.addColorStop(0, colourWithAlpha(p.colour, 0));
    flare.addColorStop(0.42, colourWithAlpha(p.colour, 0.26 * life));
    flare.addColorStop(0.5, colourWithAlpha('#fff5d8', 0.82 * life));
    flare.addColorStop(0.58, colourWithAlpha(p.colour, 0.26 * life));
    flare.addColorStop(1, colourWithAlpha(p.colour, 0));
    ctx.fillStyle = flare;
    ctx.beginPath();
    ctx.ellipse(sx, p.y, flareW, flareH, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.kind === 'shockwave') {
    const radius = p.size * (0.34 + p.age * 2.55);
    ctx.globalCompositeOperation = 'screen';
    const rich = load < PARTICLE_CRITICAL_LOAD || p.size > 170 || life > 0.58;
    if (rich) {
      const haze = ctx.createRadialGradient(sx, p.y, Math.max(4, radius * 0.18), sx, p.y, radius);
      haze.addColorStop(0, colourWithAlpha(p.colour, 0));
      haze.addColorStop(0.68, colourWithAlpha(p.colour, 0.08 * life));
      haze.addColorStop(1, colourWithAlpha(p.colour, 0));
      ctx.fillStyle = haze;
      ctx.beginPath();
      ctx.arc(sx, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = colourWithAlpha(p.colour, 0.82);
    ctx.lineWidth = Math.max(2.5, p.size * (0.012 + life * 0.018));
    ctx.beginPath();
    ctx.arc(sx, p.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    if (rich) {
      ctx.strokeStyle = 'rgba(255,245,216,0.62)';
      ctx.lineWidth = Math.max(1, p.size * 0.006);
      ctx.beginPath();
      ctx.arc(sx, p.y, radius * 0.72, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (p.kind === 'ring') {
    ctx.strokeStyle = p.colour;
    ctx.lineWidth = Math.max(2, p.size / 72);
    ctx.beginPath();
    ctx.arc(sx, p.y, p.size * (1 + p.age * 1.85), 0, Math.PI * 2);
    ctx.stroke();
  } else if (p.kind === 'text') {
    const punch = p.punch ? 1 + Math.max(0, 1 - p.age * 5.2) * 0.85 : 1;
    ctx.fillStyle = p.colour;
    ctx.font = `900 ${(13 * punch * Math.max(1, p.size)).toFixed(1)}px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    fitCanvasText(p.text ?? '', sx, p.y, 260);
  } else if (p.kind === 'fireball') {
    const heat = 1 - life;
    const radius = p.size * (0.5 + heat * 1.75);
    const ramp = p.ramp ?? ['#ffffff', p.colour];
    const idx = Math.min(ramp.length - 1, Math.floor(heat * ramp.length));
    const inner = ramp[idx] ?? p.colour;
    const outer = ramp[Math.min(ramp.length - 1, idx + 1)] ?? p.colour;
    ctx.globalCompositeOperation = 'screen';
    const ball = ctx.createRadialGradient(sx, p.y, Math.max(1, radius * 0.08), sx, p.y, radius);
    ball.addColorStop(0, colourWithAlpha('#ffffff', Math.min(1, 0.45 + life * 0.55)));
    ball.addColorStop(0.34, colourWithAlpha(inner, Math.min(1, 0.16 + 0.82 * life)));
    ball.addColorStop(0.72, colourWithAlpha(outer, 0.42 * life));
    ball.addColorStop(1, colourWithAlpha(outer, 0));
    ctx.fillStyle = ball;
    ctx.beginPath();
    ctx.arc(sx, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.kind === 'starflare') {
    const reach = p.size * (0.38 + (1 - life) * 0.85);
    ctx.translate(sx, p.y);
    ctx.rotate(p.rot ?? 0);
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    const cross = (len: number, width: number, style: string): void => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.lineTo(len, 0);
      ctx.moveTo(0, -len);
      ctx.lineTo(0, len);
      ctx.stroke();
    };
    cross(reach, 3 * (0.4 + life), colourWithAlpha(p.colour, Math.min(1, 0.85 * life + 0.1)));
    cross(reach * 0.62, 1.4, `rgba(255,245,216,${(0.9 * life).toFixed(3)})`);
    ctx.rotate(Math.PI / 4);
    cross(reach * 0.52, 1.8 * (0.4 + life), colourWithAlpha(p.colour, 0.55 * life));
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.arc(0, 0, 2.2 + 3 * life, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.kind === 'core') {
    const radius = p.size * (0.72 + p.age * 1.18);
    const core = ctx.createRadialGradient(sx, p.y, 2, sx, p.y, radius);
    core.addColorStop(0, 'rgba(255,255,255,0.96)');
    core.addColorStop(0.26, colourWithAlpha(p.colour, 0.82));
    core.addColorStop(0.62, colourWithAlpha(p.colour, 0.24));
    core.addColorStop(1, colourWithAlpha(p.colour, 0));
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(sx, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.kind === 'debris') {
    ctx.translate(sx, p.y);
    ctx.rotate(p.rot ?? Math.atan2(p.vy, p.vx));
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    const half = (p.length ?? p.size * 8) * (0.5 + (1 - life) * 0.08);
    ctx.strokeStyle = colourWithAlpha(p.colour, 0.3);
    ctx.lineWidth = (p.width ?? 2) * 3.2;
    ctx.beginPath();
    ctx.moveTo(-half, 0);
    ctx.lineTo(half, 0);
    ctx.stroke();
    ctx.lineWidth = p.width ?? 2;
    ctx.strokeStyle = p.colour;
    ctx.beginPath();
    ctx.moveTo(-half, 0);
    ctx.lineTo(half, 0);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,245,216,0.72)';
    ctx.lineWidth = Math.max(0.7, (p.width ?? 2) * 0.32);
    ctx.beginPath();
    ctx.moveTo(-half * 0.72, 0);
    ctx.lineTo(half * 0.72, 0);
    ctx.stroke();
  } else if (p.kind === 'chunk') {
    const side = p.size * (1.3 + (1 - life) * 0.16);
    ctx.translate(sx, p.y);
    ctx.rotate(p.rot ?? 0);
    ctx.globalCompositeOperation = 'screen';
    const haloSide = side * 1.7;
    ctx.fillStyle = colourWithAlpha(p.colour, 0.28);
    ctx.fillRect(-haloSide / 2, -haloSide / 2, haloSide, haloSide);
    ctx.fillStyle = p.colour;
    ctx.strokeStyle = 'rgba(255,245,216,0.74)';
    ctx.lineWidth = Math.max(0.8, side * 0.08);
    ctx.fillRect(-side / 2, -side / 2, side, side);
    if (side > 5) ctx.strokeRect(-side / 2, -side / 2, side, side);
    ctx.globalAlpha *= 0.42;
    ctx.fillStyle = '#fff5d8';
    ctx.fillRect(-side * 0.18, -side * 0.18, side * 0.36, side * 0.36);
  } else if (p.kind === 'beam') {
    const half = (p.length ?? p.size * 14) * (0.5 + (1 - life) * 0.12);
    ctx.translate(sx, p.y);
    ctx.rotate(p.rot ?? Math.atan2(p.vy, p.vx));
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    const width = (p.width ?? 3) * (0.7 + life * 0.45);
    ctx.strokeStyle = colourWithAlpha(p.colour, 0.3);
    ctx.lineWidth = width * 3;
    ctx.beginPath();
    ctx.moveTo(-half, 0);
    ctx.lineTo(half, 0);
    ctx.stroke();
    ctx.strokeStyle = p.colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(-half, 0);
    ctx.lineTo(half, 0);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,245,216,0.82)';
    ctx.lineWidth = Math.max(0.75, (p.width ?? 3) * 0.28);
    ctx.beginPath();
    ctx.moveTo(-half * 0.72, 0);
    ctx.lineTo(half * 0.72, 0);
    ctx.stroke();
  } else {
    if (p.twinkle && Math.sin((p.age + (p.rot ?? 0)) * 30) < -0.25) ctx.globalAlpha = life * 0.22;
    const radius = p.size * (0.5 + life);
    ctx.fillStyle = colourWithAlpha(p.colour, 0.3);
    ctx.beginPath();
    ctx.arc(sx, p.y, radius * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.colour;
    ctx.beginPath();
    ctx.arc(sx, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHud(t: number): void {
  // The final screens own the whole canvas: score, board, and support ask
  // replace the HUD and radar rather than squeezing in beneath them.
  if (state.phase === 'gameover') return;
  if (state.phase === 'title') return;
  const viewport = visibleCanvasRect();
  if (usePortraitHud(viewport)) {
    drawPortraitHud(t, viewport);
    if (DEBUG_TUNING) drawPlaytestDebug(t, viewport);
    return;
  }
  ctx.save();
  ctx.fillStyle = 'rgba(1, 4, 9, 0.9)';
  ctx.fillRect(0, 0, VIEW_W, RADAR_Y - 3);
  ctx.strokeStyle = 'rgba(94,255,219,0.18)';
  ctx.beginPath();
  ctx.moveTo(0, RADAR_Y - 3.5);
  ctx.lineTo(VIEW_W, RADAR_Y - 3.5);
  ctx.stroke();
  ctx.fillStyle = '#fff5d8';
  ctx.font = `900 15px ${FONT_MONO}`;
  ctx.textBaseline = 'top';
  ctx.fillText(BRAND_NAME, 22, 13);
  drawStat('SCORE', state.score, 164, 10, '#fff5d8');
  if (state.scoreSurge > 0) drawScoreSurgeTag(t, 164, 44);
  if (state.fanout > 0) drawFanoutTag(t, 216, 44);
  drawStat('WAVE', state.wave, 318, 10, '#5effdb');
  drawStat('CRED', state.sats, 426, 10, '#ffd84a');
  drawTimeStat(526, 10, t);
  drawStat('SHIELD', state.ship.shieldHits, 636, 10, '#5effdb');
  drawStat('BURST', state.burstCharges, 756, 10, '#ffd84a');
  drawStat('SAVED', state.rescued, 876, 10, '#8cffb4');
  drawStat('LOST', state.lost, 998, 10, '#ff4d5e');
  // The y=34 strip between the stat row and the radar frame: daily chip on
  // the left (under the brand), rival chase right-aligned under the chain.
  if (state.daily) {
    ctx.fillStyle = '#ffd84a';
    ctx.font = `900 10px ${FONT_MONO}`;
    ctx.textBaseline = 'top';
    ctx.fillText('DAILY GAUNTLET', 22, 33);
  }
  drawRivalHud(t);
  drawComboHud(t);
  drawBossHud(t);
  drawRadar(t, radarHudArea(viewport));
  if (DEBUG_TUNING) {
    drawTuningDebug();
    drawPlaytestDebug(t, viewport);
  }
  ctx.restore();
}

function drawRivalHud(t: number): void {
  if (state.demo) return;
  const x = VIEW_W - 48;
  const y = 33;
  const target = nextRivalRung();
  ctx.save();
  ctx.font = `900 10px ${FONT_MONO}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  if (!target) {
    if (rivalLadder.length > 0) {
      // Everyone on the board is behind you — say so, gloriously.
      const pulse = 0.5 + Math.sin(t * 7) * 0.5;
      ctx.fillStyle = '#ffd84a';
      ctx.shadowColor = '#ffd84a';
      ctx.shadowBlur = 6 + pulse * 7;
      ctx.fillText('TOP OF THE BOARD', x, y);
    }
    ctx.restore();
    return;
  }
  const gap = target.score - state.score;
  const close = gap <= 5000;
  const colour = close ? '#ffd84a' : 'rgba(255,245,216,0.62)';
  ctx.fillStyle = colour;
  if (close) {
    ctx.shadowColor = '#ffd84a';
    ctx.shadowBlur = 5 + Math.sin(t * 9) * 3;
  }
  const name = target.own ? 'YOUR BEST' : target.name.toUpperCase().slice(0, 12);
  ctx.fillText(`NEXT ▲ ${target.score.toLocaleString('en-GB')} ${name}`, x, y);
  ctx.restore();
}

function drawScoreSurgeTag(t: number, x: number, y: number): void {
  const pulse = 0.5 + Math.sin(t * 9) * 0.5;
  const fading = state.scoreSurge < 2 && Math.sin(t * 16) < 0;
  ctx.save();
  ctx.font = `900 10px ${FONT_MONO}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = fading ? 'rgba(255,225,74,0.4)' : '#ffe14a';
  ctx.shadowColor = '#ffe14a';
  ctx.shadowBlur = 8 + pulse * 8;
  ctx.fillText(`x2 ${Math.ceil(state.scoreSurge)}s`, x, y);
  ctx.restore();
}

function drawFanoutTag(t: number, x: number, y: number): void {
  const pulse = 0.5 + Math.sin(t * 9) * 0.5;
  const fading = state.fanout < 2 && Math.sin(t * 16) < 0;
  ctx.save();
  ctx.font = `900 10px ${FONT_MONO}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = fading ? 'rgba(255,176,58,0.4)' : '#ffb03a';
  ctx.shadowColor = '#ffb03a';
  ctx.shadowBlur = 8 + pulse * 8;
  ctx.fillText(`x3 ${Math.ceil(state.fanout)}s`, x, y);
  ctx.restore();
}

function drawPortraitHud(t: number, viewport: VisibleCanvasRect): void {
  const pad = Math.max(8, Math.min(14, viewport.w * 0.032));
  const x = viewport.x + pad;
  const w = Math.max(1, viewport.w - pad * 2);
  const radar = radarHudArea(viewport);

  ctx.save();
  const panel = ctx.createLinearGradient(viewport.x, 0, viewport.x, PLAY_TOP);
  panel.addColorStop(0, 'rgba(1,4,9,0.96)');
  panel.addColorStop(0.72, 'rgba(2,8,15,0.9)');
  panel.addColorStop(1, 'rgba(2,8,15,0.12)');
  ctx.fillStyle = panel;
  ctx.fillRect(viewport.x, 0, viewport.w, PLAY_TOP - 6);
  ctx.strokeStyle = 'rgba(94,255,219,0.22)';
  ctx.beginPath();
  ctx.moveTo(viewport.x, PLAY_TOP - 8.5);
  ctx.lineTo(viewport.x + viewport.w, PLAY_TOP - 8.5);
  ctx.stroke();

  ctx.fillStyle = '#fff5d8';
  ctx.font = `900 11px ${FONT_MONO}`;
  ctx.textBaseline = 'top';
  ctx.fillText(BRAND_NAME, x, 7);
  if (state.daily) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffd84a';
    ctx.font = `900 8px ${FONT_MONO}`;
    ctx.fillText('DAILY', x + w, 9);
    ctx.textAlign = 'left';
  }

  const colW = w / 4;
  drawMicroStat('SCORE', String(state.score).padStart(6, '0'), x, 26, colW, '#fff5d8');
  if (state.scoreSurge > 0) drawScoreSurgeTag(t, x, 52);
  if (state.fanout > 0) drawFanoutTag(t, x + 54, 52);
  drawMicroStat('WAVE', String(state.wave).padStart(2, '0'), x + colW, 26, colW, '#5effdb');
  drawMicroStat('TIME', formatClock(state.timeLeft), x + colW * 2, 26, colW, timeHudColour(t));
  drawMicroStat('CRED', String(state.sats).padStart(2, '0'), x + colW * 3, 26, colW, '#ffd84a');

  drawRadar(t, radar);
  drawPortraitThreatLine(t, radar.x, radar.y + radar.h + 12, radar.w);
  ctx.restore();
}

function drawMicroStat(label: string, value: string, x: number, y: number, w: number, colour: string): void {
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,245,216,0.48)';
  ctx.font = `800 6.5px ${FONT_MONO}`;
  ctx.fillText(label, x, y);
  const pop = label === 'SCORE' ? state.scorePop : label === 'TIME' ? state.timePop : 0;
  ctx.fillStyle = colour;
  ctx.shadowColor = colour;
  ctx.shadowBlur = 4 + pop * 11;
  ctx.font = `900 12px ${FONT_MONO}`;
  if (pop > 0.01) {
    const s = 1 + pop * 0.38;
    const cy = y + 16;
    ctx.translate(x, cy);
    ctx.scale(s, s);
    ctx.translate(-x, -cy);
  }
  ctx.fillText(value.slice(0, Math.max(2, Math.floor(w / 7))), x, y + 10);
  ctx.restore();
}

function drawPortraitThreatLine(t: number, x: number, y: number, w: number): void {
  const carrier = activeCarrier();
  ctx.save();
  ctx.textBaseline = 'top';
  if (carrier) {
    const hp = clamp(carrier.hp / Math.max(1, carrier.maxHp), 0, 1);
    const cooldown = clamp(1 - carrier.shotCooldown / 2.8, 0, 1);
    const pulse = 0.5 + Math.sin(t * 9 + carrier.phase) * 0.5;
    ctx.fillStyle = '#ff9ab9';
    ctx.shadowColor = '#ff2f7a';
    ctx.shadowBlur = 6 + pulse * 5;
    ctx.font = `900 8px ${FONT_MONO}`;
    ctx.fillText('CARRIER', x, y - 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,245,216,0.16)';
    ctx.fillRect(x + 58, y + 1, w - 58, 5);
    ctx.fillStyle = '#ff2f7a';
    ctx.fillRect(x + 58, y + 1, (w - 58) * hp, 5);
    ctx.fillStyle = 'rgba(255,216,74,0.88)';
    ctx.fillRect(x + 58, y + 8, (w - 58) * cooldown, 2);
    ctx.restore();
    return;
  }

  const combo = state.combo > 1 && state.comboUntil > 0 ? `${state.combo}X` : '--';
  ctx.fillStyle = 'rgba(255,245,216,0.48)';
  ctx.font = `800 7px ${FONT_MONO}`;
  ctx.fillText(`SAVE ${String(state.rescued).padStart(2, '0')}  LOST ${String(state.lost).padStart(2, '0')}  SHIELD ${String(state.ship.shieldHits).padStart(2, '0')}  BURST ${String(state.burstCharges).padStart(2, '0')}  CHAIN ${combo}`, x, y);
  const target = state.demo ? null : nextRivalRung();
  if (target) {
    const compactScore = target.score >= 100_000
      ? `${Math.floor(target.score / 1000)}K`
      : target.score.toLocaleString('en-GB');
    const name = target.own ? 'YOUR BEST' : target.name.toUpperCase().slice(0, 9);
    ctx.fillStyle = target.score - state.score <= 5000 ? '#ffd84a' : 'rgba(255,216,74,0.6)';
    ctx.fillText(`NEXT ▲ ${compactScore} ${name}`, x, y + 10);
  }
  ctx.restore();
}

function drawComboHud(t: number): void {
  if (state.combo <= 1 && state.comboUntil <= 0) return;
  const x = 1118;
  const y = 10;
  const life = clamp(state.comboUntil / 3, 0, 1);
  const colour = state.combo >= 10 ? '#ffd84a' : state.combo >= 5 ? '#8cffb4' : '#5effdb';
  ctx.save();
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,245,216,0.58)';
  ctx.font = `700 9px ${FONT_MONO}`;
  ctx.fillText('CHAIN', x, y);
  ctx.shadowColor = colour;
  ctx.shadowBlur = 5 + Math.sin(t * 11) * 1.5;
  ctx.fillStyle = colour;
  ctx.font = `900 14px ${FONT_MONO}`;
  ctx.fillText(`${state.combo}X`, x, y + 15);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,245,216,0.18)';
  ctx.fillRect(x + 40, y + 20, 74, 3);
  ctx.fillStyle = colour;
  ctx.fillRect(x + 40, y + 20, 74 * life, 3);
  ctx.restore();
}

function drawBossHud(t: number): void {
  const carrier = activeCarrier();
  if (!carrier) return;
  const x = VIEW_W / 2 - 136;
  const y = 34;
  const w = 272;
  const hp = clamp(carrier.hp / Math.max(1, carrier.maxHp), 0, 1);
  const cooldown = clamp(1 - carrier.shotCooldown / 2.8, 0, 1);
  const pulse = 0.5 + Math.sin(t * 9 + carrier.phase) * 0.5;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `900 8px ${FONT_MONO}`;
  ctx.fillStyle = '#ff9ab9';
  ctx.shadowColor = '#ff2f7a';
  ctx.shadowBlur = 6 + pulse * 5;
  ctx.fillText('CARRIER', VIEW_W / 2, y - 10);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,245,216,0.16)';
  ctx.fillRect(x, y, w, 5);
  ctx.fillStyle = '#ff2f7a';
  ctx.fillRect(x, y, w * hp, 5);
  ctx.fillStyle = 'rgba(255,216,74,0.88)';
  ctx.fillRect(x, y + 7, w * cooldown, 2);
  ctx.strokeStyle = 'rgba(255,154,185,0.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 0.5, y - 0.5, w + 1, 6);
  ctx.restore();
}

function drawTuningDebug(): void {
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(94,255,219,0.72)';
  ctx.font = `800 9px ${FONT_MONO}`;
  ctx.fillText(getTuningReadout(), VIEW_W - 56, 34);
  ctx.restore();
}

function drawPlaytestDebug(t: number, viewport: VisibleCanvasRect): void {
  const portrait = usePortraitHud(viewport);
  const lines = playtestDebugLines();
  const width = portrait ? Math.min(252, viewport.w - 24) : 356;
  const lineH = portrait ? 9 : 10;
  const height = 18 + lines.length * lineH;
  const x = portrait ? viewport.x + viewport.w - width - 10 : VIEW_W - width - 18;
  const y = portrait ? PLAY_TOP + 76 : RADAR_Y + RADAR_H + 12;
  const pulse = 0.5 + Math.sin(t * 6) * 0.5;

  ctx.save();
  ctx.globalAlpha = portrait ? 0.86 : 0.9;
  ctx.fillStyle = 'rgba(1,4,10,0.78)';
  ctx.strokeStyle = `rgba(94,255,219,${(0.32 + pulse * 0.12).toFixed(3)})`;
  ctx.lineWidth = 1;
  roundedRect(x, y, width, height, 4);
  ctx.fill();
  ctx.stroke();
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#5effdb';
  ctx.shadowColor = '#5effdb';
  ctx.shadowBlur = 5;
  ctx.font = `900 ${portrait ? 7.5 : 9}px ${FONT_MONO}`;
  ctx.fillText('PLAYTEST TRACE', x + 8, y + 6);
  ctx.shadowBlur = 0;
  ctx.font = `800 ${portrait ? 6.5 : 8}px ${FONT_MONO}`;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    ctx.fillStyle = line.hot ? line.colour : 'rgba(255,245,216,0.72)';
    ctx.fillText(line.text, x + 8, y + 19 + i * lineH);
  }
  ctx.restore();
}

function playtestDebugLines(): Array<{ text: string; colour: string; hot?: boolean }> {
  const trace = state.trace;
  const counts = enemyCounts();
  const threat = mostUrgentSignal();
  const threatInfo = threat ? contactThreat(threat) : null;
  const hitPct = trace.shotsFired > 0 ? Math.round((trace.shotsHit / trace.shotsFired) * 100) : 0;
  const avgRescue = trace.rescueResponseCount > 0 ? trace.rescueResponseTotal / trace.rescueResponseCount : 0;
  const topDamage = topDamageSource();
  const speed = Math.round(Math.hypot(state.ship.vx, state.ship.vy));
  const beam = Math.round(heatedLaserLength());
  const clearedWaves = trace.waveDurations.filter(item => item.cleared);
  const waveAvg = clearedWaves.length > 0
    ? clearedWaves.reduce((sum, item) => sum + item.seconds, 0) / clearedWaves.length
    : 0;
  const threatText = threat && threatInfo
    ? `${threatInfo.label}:${signalDisplayName(threat).slice(0, 9)} ${Math.round(Math.abs(wrapDelta(threat.x, state.ship.x)))}`
    : 'NONE';
  return [
    { text: `TIME ${fmtTime(trace.elapsed)}  WAVE ${fmtTime(state.waveTimer)}  SPAWN ${state.spawnLeft}/${state.nextSpawn.toFixed(1)}`, colour: '#5effdb' },
    { text: `SHIP v${speed} heat ${(state.ship.heat * 100).toFixed(0)} shield ${state.ship.shieldHits} turn ${(state.ship.turnCue * 100).toFixed(0)} beam ${beam}`, colour: state.ship.heat > 0.72 ? '#ff8a3a' : '#ffd84a', hot: state.ship.heat > 0.72 },
    { text: `ENEMY A${counts.abductor} H${counts.hunter} J${counts.jammer} F${counts.forgery} C${counts.carrier}`, colour: '#ff8a3a', hot: counts.hunter + counts.jammer > 3 },
    { text: `THREAT ${threatText}`, colour: threatInfo?.colour ?? '#8cffb4', hot: (threatInfo?.urgency ?? 0) > 2.4 },
    { text: `FIRE ${trace.shotsFired} hit ${hitPct}% graze ${trace.shotsGrazed} burst ${trace.burstUses}`, colour: hitPct < 28 && trace.shotsFired > 10 ? '#ff4d5e' : '#fff5d8', hot: hitPct < 28 && trace.shotsFired > 10 },
    { text: `CONTACT lift ${trace.contactsLifted} save ${trace.contactsSaved} forge ${trace.contactsForged} drop ${trace.contactsDropped}`, colour: trace.contactsForged > 0 ? '#ff3aff' : '#8cffb4', hot: trace.contactsForged > 0 },
    { text: `RESCUE avg ${avgRescue ? avgRescue.toFixed(1) : '--'}s slow ${trace.rescueResponseSlowest ? trace.rescueResponseSlowest.toFixed(1) : '--'}s`, colour: avgRescue > 7 ? '#ffd84a' : '#8cffb4', hot: avgRescue > 7 },
    { text: `WAVES clear ${clearedWaves.length} avg ${waveAvg ? waveAvg.toFixed(1) : '--'}s current ${(trace.elapsed - trace.currentWaveStartedAt).toFixed(1)}s`, colour: waveAvg > 70 ? '#ffd84a' : '#fff5d8', hot: waveAvg > 70 },
    { text: `GROUND ${trace.nearGroundSeconds.toFixed(1)}s lowcamp ${trace.lowCampSeconds.toFixed(1)}s`, colour: trace.lowCampSeconds > 5 ? '#ff8a3a' : '#fff5d8', hot: trace.lowCampSeconds > 5 },
    { text: `DAMAGE ${trace.livesLost} by ${topDamage}`, colour: trace.livesLost > 0 ? '#ff4d5e' : '#fff5d8', hot: trace.livesLost > 0 },
  ];
}

function enemyCounts(): Record<EnemyType, number> {
  const counts: Record<EnemyType, number> = { abductor: 0, forgery: 0, jammer: 0, hunter: 0, carrier: 0, spammer: 0, sybil: 0, troll: 0 };
  for (const e of state.enemies) if (e.alive) counts[e.type] += 1;
  return counts;
}

function killerLabel(source: string): string {
  if (!source || source === 'unknown') return 'UNKNOWN CONTACT';
  if (source === 'network-loss') return 'TOTAL CONTACT LOSS';
  if (source === 'ground-flak') return 'GROUND FLAK';
  if (source === 'dart') return 'HUNTER DART';
  if (source === 'jam') return 'JAMMER BURST';
  if (source === 'barrage') return 'CARRIER BARRAGE';
  if (source.startsWith('collision:')) {
    return `${source.slice('collision:'.length).replace(/[-_]/g, ' ').toUpperCase()} IMPACT`;
  }
  return source.replace(/[-_:]/g, ' ').toUpperCase();
}

function drawControlHints(viewport: VisibleCanvasRect): void {
  if (state.wave !== 1 || state.shipDestroyed) return;
  const elapsed = state.trace.elapsed;
  const urgent = mostUrgentSignal();
  const urgentThreat = urgent ? contactThreat(urgent) : null;
  const activeLesson = urgentThreat?.label === 'FALL' || urgentThreat?.label === 'LIFT' || urgentThreat?.label === 'LOCK';
  const done = (hintMoved && hintFired && !activeLesson && elapsed > 5.5) || elapsed > 18;
  if (done && hintDoneAt < 0) hintDoneAt = elapsed;
  const alpha = hintDoneAt >= 0 ? Math.max(0, 1 - (elapsed - hintDoneAt) / 0.7) : Math.min(1, elapsed * 1.6);
  if (alpha <= 0) return;
  const portrait = usePortraitHud(viewport);
  const cx = portrait ? viewport.centerX : VIEW_W / 2;
  const y = portrait ? viewport.y + viewport.h * 0.52 : 508;
  const controls = COARSE_POINTER
    ? 'STICK MOVE · ◆ FIRE · ₿ BURST'
    : 'ARROWS / WASD MOVE · SPACE FIRE · SHIFT BURST';
  const goal = firstRunCoachGoal(urgentThreat);
  const w = portrait ? Math.min(330, viewport.w - 24) : 470;
  ctx.save();
  ctx.globalAlpha = alpha * 0.92;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(2,6,14,0.66)';
  ctx.strokeStyle = 'rgba(94,255,219,0.4)';
  ctx.lineWidth = 1;
  roundedRect(cx - w / 2, y - 16, w, portrait ? 40 : 44, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#5effdb';
  ctx.font = `900 ${portrait ? 8 : 11}px ${FONT_MONO}`;
  fitCanvasText(controls, cx, y - 2, w - 20);
  ctx.fillStyle = 'rgba(255,245,216,0.85)';
  ctx.font = `900 ${portrait ? 6.5 : 8.5}px ${FONT_MONO}`;
  fitCanvasText(goal, cx, y + (portrait ? 12 : 15), w - 20);
  ctx.restore();
}

function firstRunCoachGoal(threat: ContactThreat | null): string {
  if (threat?.label === 'FALL') return 'CATCH FALLING KEYS BEFORE THEY HIT GROUND';
  if (threat?.label === 'LIFT') return 'KEY SNATCHED · SHOOT CAPTOR THEN CATCH';
  if (threat?.label === 'LOCK') return 'YELLOW LOCK MEANS SHOOT NOW';
  if (threat?.label === 'TARGET') return 'RED RING IS THE NEXT ABDUCTION';
  if (!hintMoved) return 'PATROL THE WHOLE RADAR · MOVE FAST';
  if (!hintFired) return 'LINE UP HORIZONTALLY · FIRE THROUGH THREATS';
  return 'STOP ABDUCTIONS · CATCH FALLING KEYS';
}

interface PillRect { x: number; y: number; w: number; h: number }

function gameOverPillRects(viewport: VisibleCanvasRect): { support: PillRect; menu: PillRect } {
  const portrait = usePortraitHud(viewport);
  const w = 96;
  const h = 28;
  if (portrait) {
    // Portrait sits both pills side by side beneath the leaderboard panel,
    // clear of the RELAY DOWN header and the DOM support bar.
    const y = 600;
    const gap = 14;
    return {
      support: { x: viewport.centerX - w - gap / 2, y, w, h },
      menu: { x: viewport.centerX + gap / 2, y, w, h },
    };
  }
  const y = viewport.y + 62;
  const right = viewport.x + viewport.w - 20;
  return {
    support: { x: right - w * 2 - 12, y, w, h },
    menu: { x: right - w, y, w, h },
  };
}

function drawGameOverPills(viewport: VisibleCanvasRect, portrait: boolean): void {
  const pills = gameOverPillRects(viewport);
  drawGameOverPill(pills.support, 'SUPPORT', '#ffd84a', portrait);
  drawGameOverPill(pills.menu, 'MENU', '#5effdb', portrait);
}

function drawGameOverPill(rect: PillRect, label: string, colour: string, portrait: boolean): void {
  ctx.save();
  ctx.fillStyle = 'rgba(2,8,17,0.82)';
  ctx.strokeStyle = colourWithAlpha(colour, 0.62);
  ctx.lineWidth = 1.2;
  roundedRect(rect.x, rect.y, rect.w, rect.h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colour;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${portrait ? 9 : 10}px ${FONT_DISPLAY}`;
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
  ctx.restore();
}

// Arcade name entry keyboard (Pallasite-style QWERTY): the same rects feed
// both the draw pass and pointer hit-testing.
interface NameKeyRect extends PillRect {
  label: string;
  act: 'char' | 'space' | 'backspace' | 'skip' | 'done';
  char?: string;
}

const NAME_KEY_ROWS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'] as const;

function gameOverNameKeyRects(viewport: VisibleCanvasRect): NameKeyRect[] {
  const portrait = usePortraitHud(viewport);
  const cx = portrait ? viewport.centerX : VIEW_W / 2;
  const gap = portrait ? 5 : 7;
  const keyW = portrait ? Math.min(30, Math.floor((Math.min(370, viewport.w - 14) - gap * 9) / 10)) : 48;
  const keyH = portrait ? 38 : 46;
  const topY = portrait ? 300 : 268;
  const rects: NameKeyRect[] = [];
  NAME_KEY_ROWS.forEach((row, rowIndex) => {
    const rowW = row.length * keyW + (row.length - 1) * gap;
    let x = cx - rowW / 2;
    const y = topY + rowIndex * (keyH + gap);
    for (const ch of row) {
      rects.push({ label: ch, act: 'char', char: ch, x, y, w: keyW, h: keyH });
      x += keyW + gap;
    }
  });
  const actionsY = topY + NAME_KEY_ROWS.length * (keyH + gap) + (portrait ? 4 : 6);
  const topRowW = NAME_KEY_ROWS[0]!.length * keyW + (NAME_KEY_ROWS[0]!.length - 1) * gap;
  const actionW = (topRowW - gap * 3) / 4;
  let ax = cx - topRowW / 2;
  for (const action of [
    { label: 'SPACE', act: 'space' },
    { label: 'BKSP', act: 'backspace' },
    { label: 'SKIP', act: 'skip' },
    { label: 'DONE', act: 'done' },
  ] as const) {
    rects.push({ label: action.label, act: action.act, x: ax, y: actionsY, w: actionW, h: keyH });
    ax += actionW + gap;
  }
  return rects;
}

function nameEntryKeyAt(x: number, y: number): NameKeyRect | null {
  for (const key of gameOverNameKeyRects(visibleCanvasRect())) {
    if (pointInRect(x, y, key)) return key;
  }
  return null;
}

function drawGameOverNameEntry(cx: number, portrait: boolean, viewport: VisibleCanvasRect, t: number): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#5effdb';
  ctx.shadowColor = '#5effdb';
  ctx.shadowBlur = portrait ? 8 : 12;
  ctx.font = `950 ${portrait ? 14 : 20}px ${FONT_DISPLAY}`;
  ctx.fillText('ENTER YOUR CALLSIGN', cx, portrait ? 212 : 210);
  ctx.shadowBlur = 0;

  const boxW = portrait ? Math.min(320, viewport.w - 36) : 420;
  const boxH = portrait ? 36 : 46;
  const boxY = portrait ? 228 : 224;
  ctx.fillStyle = 'rgba(2,8,17,0.88)';
  ctx.strokeStyle = 'rgba(255,216,74,0.85)';
  ctx.lineWidth = 1.6;
  roundedRect(cx - boxW / 2, boxY, boxW, boxH, 6);
  ctx.fill();
  ctx.stroke();
  const caret = Math.floor(t * 2) % 2 === 0 && nameEntryValue.length < GUEST_NAME_MAX ? '_' : '';
  ctx.fillStyle = '#ffd84a';
  ctx.shadowColor = '#ffd84a';
  ctx.shadowBlur = 7;
  ctx.font = `900 ${portrait ? 15 : 20}px ${FONT_MONO}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(nameEntryValue + caret || '_', cx, boxY + boxH / 2 + 1);
  ctx.shadowBlur = 0;

  for (const key of gameOverNameKeyRects(viewport)) {
    const accent = key.act === 'done' ? '#5effdb' : key.act === 'backspace' ? '#ff8a8a' : key.act === 'skip' ? '#9fb2c8' : '#fff5d8';
    ctx.fillStyle = key.act === 'done' ? 'rgba(94,255,219,0.14)' : key.act === 'backspace' ? 'rgba(255,120,120,0.12)' : key.act === 'skip' ? 'rgba(159,178,200,0.12)' : 'rgba(2,8,17,0.82)';
    ctx.strokeStyle = colourWithAlpha(accent, key.act === 'char' ? 0.4 : 0.7);
    ctx.lineWidth = 1.2;
    roundedRect(key.x, key.y, key.w, key.h, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.font = key.act === 'char'
      ? `900 ${portrait ? 13 : 17}px ${FONT_MONO}`
      : `900 ${portrait ? 9 : 11}px ${FONT_DISPLAY}`;
    ctx.fillText(key.label, key.x + key.w / 2, key.y + key.h / 2 + 1);
  }

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255,245,216,0.6)';
  ctx.font = `800 ${portrait ? 6.5 : 8}px ${FONT_MONO}`;
  const keys = gameOverNameKeyRects(viewport);
  const hintY = keys[keys.length - 1]!.y + keys[keys.length - 1]!.h + (portrait ? 16 : 20);
  ctx.fillText('TYPE OR TAP · DONE SIGNS YOUR SCORE · SKIP KEEPS IT UNSIGNED', cx, hintY);
  ctx.restore();
}

function gameOverLeaderboardRect(viewport: VisibleCanvasRect): PillRect {
  const portrait = usePortraitHud(viewport);
  const cx = portrait ? viewport.centerX : VIEW_W / 2;
  const w = portrait ? Math.min(354, Math.max(286, viewport.w - 18)) : 620;
  // With the HUD and radar gone on the final screens the board can start
  // higher and show far more of the all-time table.
  const h = portrait ? 356 : 400;
  const x = clampWithinVisible(cx - w / 2, w, viewport, portrait ? 12 : 42);
  const y = portrait ? 228 : 222;
  return { x, y, w, h };
}

function drawLeaderboardPanel(cx: number, portrait: boolean, viewport: VisibleCanvasRect, t: number): void {
  const { x, y, w: panelW, h: panelH } = gameOverLeaderboardRect(viewport);
  const dailyView = state.daily;
  const rowH = portrait ? 20 : 23;
  const headerBaseH = portrait ? 30 : 34;
  const dailyCardH = dailyView ? (portrait ? 64 : 70) : 0;
  const headerH = headerBaseH + dailyCardH;
  const pinnedH = portrait ? 24 : 27;
  const listTop = y + headerH;
  const listH = panelH - headerH - pinnedH - 8;
  const visibleRows = Math.floor(listH / rowH);

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(1,4,10,0.92)';
  ctx.strokeStyle = 'rgba(94,255,219,0.5)';
  ctx.lineWidth = 1.3;
  ctx.shadowColor = 'rgba(94,255,219,0.3)';
  ctx.shadowBlur = portrait ? 12 : 18;
  roundedRect(x, y, panelW, panelH, 8);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  const board = gameOverBoard;
  // A daily-gauntlet run shows today's shared board, not the all-time table.
  const boardEntries = (dailyView ? board?.daily : board?.entries) ?? [];
  const sourceLabel = !board
    ? 'CONTACTING RELAYS'
    : board.source === 'relays'
      ? `LIVE · ${boardEntries.length} SENTINELS`
      : board.source === 'cache'
        ? `CACHED · ${boardEntries.length} SENTINELS`
        : 'LOCAL RUNS ONLY';

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#5effdb';
  ctx.font = `950 ${portrait ? 10 : 13}px ${FONT_DISPLAY}`;
  ctx.fillText(dailyView ? `DAILY GAUNTLET · ${dailyStamp()}` : 'ALL-TIME SENTINELS', x + 16, y + (portrait ? 20 : 23));
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,245,216,0.6)';
  ctx.font = `800 ${portrait ? 6.5 : 8}px ${FONT_MONO}`;
  ctx.fillText(sourceLabel, x + panelW - 16, y + (portrait ? 20 : 23));

  if (dailyView) {
    drawDailyResultCard(x + 12, y + headerBaseH - 1, panelW - 24, dailyCardH - 8, portrait, boardEntries, board);
  }

  const entries = boardEntries;
  if (entries.length === 0) {
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,245,216,0.7)';
    ctx.font = `900 ${portrait ? 8 : 10}px ${FONT_MONO}`;
    const emptyLabel = board
      ? dailyView ? 'FIRST GAUNTLET RUN OF THE DAY' : 'NO SIGNED SCORES YET · BE THE FIRST'
      : 'CONTACTING RELAYS…';
    ctx.fillText(emptyLabel, cx, listTop + listH / 2);
  } else {
    // Auto-scroll when the table is longer than the window; loop seamlessly.
    const scrollable = entries.length > visibleRows;
    const offset = scrollable ? (t * 0.6) % entries.length : 0;
    const firstRow = Math.floor(offset);
    const frac = offset - firstRow;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 2, listTop, panelW - 4, listH);
    ctx.clip();
    const playerPubkey = activePlayerSession?.pubkey ?? null;
    const rows = scrollable ? visibleRows + 1 : Math.min(visibleRows, entries.length);
    for (let i = 0; i < rows; i += 1) {
      const idx = scrollable ? (firstRow + i) % entries.length : i;
      const entry = entries[idx]!;
      const rowY = listTop + (i - frac) * rowH + rowH * 0.72;
      const mine = playerPubkey !== null && entry.playerPubkey === playerPubkey;
      if (mine) {
        ctx.fillStyle = 'rgba(94,255,219,0.12)';
        ctx.fillRect(x + 4, rowY - rowH * 0.72 + 2, panelW - 8, rowH - 2);
      }
      ctx.textAlign = 'right';
      ctx.fillStyle = idx < 3 ? '#ffd84a' : 'rgba(255,245,216,0.62)';
      ctx.font = `900 ${portrait ? 7.5 : 9}px ${FONT_MONO}`;
      ctx.fillText(`#${idx + 1}`, x + (portrait ? 34 : 46), rowY);
      ctx.textAlign = 'left';
      ctx.fillStyle = mine ? '#5effdb' : '#fff5d8';
      const rowName = entry.playerName.toUpperCase();
      const nameX = x + (portrait ? 42 : 58);
      ctx.fillText(rowName, nameX, rowY);
      if (sixHundredHandle(entry.playerPubkey)) {
        drawSixHundredChip(nameX + ctx.measureText(rowName).width + (portrait ? 4 : 6), rowY, portrait);
      }
      ctx.textAlign = 'right';
      ctx.fillStyle = mine ? '#5effdb' : '#ffd84a';
      ctx.fillText(entry.score.toLocaleString('en-GB'), x + panelW - (portrait ? 52 : 78), rowY);
      ctx.fillStyle = 'rgba(255,245,216,0.55)';
      ctx.fillText(`W${entry.wave}`, x + panelW - 16, rowY);
    }
    ctx.restore();

    // Pinned strip: where this run landed.
    const rank = rankForScore(entries, state.score);
    const pinnedY = y + panelH - pinnedH;
    ctx.strokeStyle = 'rgba(94,255,219,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 10, pinnedY);
    ctx.lineTo(x + panelW - 10, pinnedY);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd84a';
    ctx.font = `900 ${portrait ? 7.5 : 9.5}px ${FONT_MONO}`;
    const rankLabel = board?.source === 'local'
      ? `THIS RUN · ${state.score.toLocaleString('en-GB')} · LOCAL #${rank}`
      : `THIS RUN · ${state.score.toLocaleString('en-GB')} · RANK #${rank}`;
    ctx.fillText(rankLabel, cx, pinnedY + pinnedH * 0.68);
  }
  ctx.restore();
}

function drawDailyResultCard(
  x: number,
  y: number,
  w: number,
  h: number,
  portrait: boolean,
  entries: readonly LeaderboardEntry[],
  board: LeaderboardSnapshot | null,
): void {
  const rank = board ? rankForScore(entries, state.score) : 1;
  const topScore = entries[0]?.score ?? 0;
  const gap = Math.max(0, topScore - state.score);
  const duration = lastRunSummary
    ? Math.max(1, Math.round(lastRunSummary.durationMs / 1000))
    : Math.max(1, Math.round(state.trace.elapsed));
  const stamp = dailyStamp();

  ctx.save();
  ctx.fillStyle = 'rgba(255,216,74,0.08)';
  ctx.strokeStyle = 'rgba(255,216,74,0.4)';
  ctx.lineWidth = 1;
  roundedRect(x, y, w, h, 6);
  ctx.fill();
  ctx.stroke();

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffd84a';
  ctx.font = `950 ${portrait ? 8 : 10}px ${FONT_DISPLAY}`;
  ctx.fillText(rank === 1 && gap === 0 ? 'TODAY\'S PACESETTER' : `DAILY #${rank}`, x + 10, y + (portrait ? 16 : 18));

  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,245,216,0.72)';
  ctx.font = `900 ${portrait ? 6.5 : 8}px ${FONT_MONO}`;
  const chase = gap > 0 ? `NEXT ${gap.toLocaleString('en-GB')}` : 'TOP RUN';
  ctx.fillText(chase, x + w - 10, y + (portrait ? 16 : 18));

  const metricY = y + (portrait ? 39 : 43);
  const metrics = [
    `SCORE ${state.score.toLocaleString('en-GB')}`,
    `WAVE ${state.wave}`,
    `${state.rescued} SAVED`,
    `${duration}S`,
  ];
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff5d8';
  ctx.font = `900 ${portrait ? 7.2 : 9.5}px ${FONT_MONO}`;
  const gapW = w / metrics.length;
  metrics.forEach((text, index) => {
    fitCanvasText(text, x + gapW * (index + 0.5), metricY, gapW - 10);
  });

  ctx.fillStyle = 'rgba(94,255,219,0.72)';
  ctx.font = `850 ${portrait ? 6.5 : 8}px ${FONT_MONO}`;
  const chain = state.maxCombo > 1 ? ` · CHAIN ${state.maxCombo}X` : '';
  fitCanvasText(`SAME SEED ${stamp} · R RETRY DAILY${chain}`, x + w / 2, y + h - (portrait ? 8 : 9), w - 18);
  ctx.restore();
}

// Gold chip marking a verified member of the 600 billion (pubkey listed in
// the 600.wtf NIP-05 registry). Drawn hanging off a leaderboard row name;
// xLeft/baselineY are the name's end and text baseline.
function drawSixHundredChip(xLeft: number, baselineY: number, portrait: boolean): void {
  const label = '600B';
  const fontPx = portrait ? 5 : 6;
  ctx.save();
  ctx.font = `900 ${fontPx}px ${FONT_MONO}`;
  ctx.textAlign = 'left';
  const w = ctx.measureText(label).width + 8;
  const h = fontPx + 5;
  roundedRect(xLeft, baselineY - fontPx - 3.5, w, h, 3);
  ctx.fillStyle = 'rgba(255,216,74,0.14)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,216,74,0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#ffd84a';
  ctx.fillText(label, xLeft + 4, baselineY - 1);
  ctx.restore();
}

function gameOverSupportPanelY(viewport: VisibleCanvasRect, portrait: boolean): number {
  const panelH = portrait ? VALUE_PANEL_H_PORTRAIT : VALUE_PANEL_H_DESKTOP;
  if (portrait) return viewport.y + Math.max(12, (viewport.h - panelH) / 2);
  return Math.max(24, (VIEW_H - panelH) / 2);
}

type ValueConfirmAction = 'paid' | 'later';

function valueConfirmRects(x: number, y: number, panelW: number, panelH: number, portrait: boolean): { paid: PillRect; later: PillRect } {
  const rowW = portrait ? Math.min(panelW - 38, 300) : 320;
  const h = portrait ? 26 : 28;
  const gap = 10;
  const bw = (rowW - gap) / 2;
  const cx = x + panelW / 2;
  const rowY = y + panelH - (portrait ? 52 : 58);
  return {
    paid: { x: cx - rowW / 2, y: rowY, w: bw, h },
    later: { x: cx - rowW / 2 + bw + gap, y: rowY, w: bw, h },
  };
}

function valueConfirmButtons(viewport: VisibleCanvasRect = visibleCanvasRect()): Array<{ id: ValueConfirmAction } & PillRect> {
  if (!VALUE_FOR_VALUE.configured || valueThanksVisible || !gameOverSupportOpen) return [];
  const portrait = usePortraitHud(viewport);
  const cx = portrait ? viewport.centerX : VIEW_W / 2;
  const panelW = portrait ? Math.min(354, Math.max(286, viewport.w - 18)) : Math.min(900, viewport.w - 76);
  const panelX = clampWithinVisible(cx - panelW / 2, panelW, viewport, portrait ? 12 : 42);
  const panelY = gameOverSupportPanelY(viewport, portrait);
  const panelH = portrait ? VALUE_PANEL_H_PORTRAIT : VALUE_PANEL_H_DESKTOP;
  const rects = valueConfirmRects(panelX, panelY, panelW, panelH, portrait);
  return [{ id: 'paid', ...rects.paid }, { id: 'later', ...rects.later }];
}

function valueConfirmActionAt(x: number, y: number): ValueConfirmAction | null {
  for (const button of valueConfirmButtons()) {
    if (pointInRect(x, y, button)) return button.id;
  }
  return null;
}

function drawGameOverSupportModal(viewport: VisibleCanvasRect): void {
  const portrait = usePortraitHud(viewport);
  const cx = portrait ? viewport.centerX : VIEW_W / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(0,2,7,0.66)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.restore();
  const panelBottom = drawValueForValuePanel(cx, portrait, viewport, gameOverSupportPanelY(viewport, portrait));
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Dark backing so the hints stay readable over whatever sits behind the dim.
  ctx.fillStyle = 'rgba(0,2,7,0.78)';
  const hintW = portrait ? 300 : 380;
  const lineStep = portrait ? 12 : 14;
  const hintH = (portrait ? 28 : 32) + (supportActionStatus ? lineStep : 0);
  roundedRect(cx - hintW / 2, panelBottom + (portrait ? 6 : 8), hintW, hintH, 5);
  ctx.fill();
  let hintY = panelBottom + (portrait ? 16 : 20);
  if (supportActionStatus) {
    ctx.fillStyle = '#5effdb';
    ctx.font = `900 ${portrait ? 6.5 : 8}px ${FONT_MONO}`;
    fitCanvasText(supportActionStatus, cx, hintY, hintW - 24);
    hintY += lineStep;
  }
  ctx.fillStyle = 'rgba(255,245,216,0.66)';
  ctx.font = `800 ${portrait ? 6.5 : 8}px ${FONT_MONO}`;
  ctx.fillText('YOU PLAYED FREE. IF THIS HAD VALUE, GIVE VALUE BACK.', cx, hintY);
  // On the staged flow the only exits are the two pills; the reopened modal
  // (from the score screen's SUPPORT pill) still dismisses on an outside tap.
  ctx.fillText(gameOverStage === 'support'
    ? 'I PAID OR NEXT TIME TO CONTINUE'
    : portrait ? 'TAP OUTSIDE TO CLOSE' : 'ESC OR CLICK OUTSIDE TO CLOSE', cx, hintY + lineStep);
  ctx.restore();
}

function topDamageSource(): string {
  let best = '--';
  let bestCount = 0;
  for (const [source, count] of Object.entries(state.trace.damageBy)) {
    if (count > bestCount) {
      best = `${source}:${count}`;
      bestCount = count;
    }
  }
  return best;
}

function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

const PLAYTIME_KEY = 'neonsentinel:playtime:v1';

function lifetimePlaySeconds(): number {
  try {
    const raw = Number(localStorage.getItem(PLAYTIME_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  } catch {
    return 0;
  }
}

function addLifetimePlaySeconds(seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  try {
    localStorage.setItem(PLAYTIME_KEY, String(Math.round(lifetimePlaySeconds() + seconds)));
  } catch { /* storage may be blocked; the pitch falls back to this run only */ }
}

function fmtLongPlayTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}H ${String(m).padStart(2, '0')}M`;
  return `${Math.max(1, m)}M`;
}

/**
 * The value-for-value pitch anchors the ask to something concrete: coin-op
 * arcades charge a credit for roughly three minutes of play, and a credit is
 * about a thousand sats. The number is a comparison, not an invoice.
 */
function valueTimeMath(): { runSeconds: number; lifetimeSeconds: number; credits: number; sats: number } {
  const runSeconds = lastRunSummary
    ? lastRunSummary.durationMs / 1000
    : Math.max(0, (state.finishedAt - state.startedAt) / 1000);
  const credits = Math.max(1, Math.round(runSeconds / 180));
  return {
    runSeconds,
    lifetimeSeconds: lifetimePlaySeconds(),
    credits,
    sats: credits * 1000,
  };
}

function drawStat(label: string, value: number, x: number, y: number, colour: string): void {
  ctx.fillStyle = 'rgba(255,245,216,0.58)';
  ctx.font = `700 9px ${FONT_MONO}`;
  ctx.fillText(label, x, y);
  const pop = label === 'SCORE' ? state.scorePop : 0;
  ctx.save();
  ctx.fillStyle = colour;
  ctx.shadowColor = colour;
  ctx.shadowBlur = 5 + pop * 14;
  ctx.font = `900 14px ${FONT_MONO}`;
  if (pop > 0.01) {
    // Punch the number about its own centre so a big score chunk visibly lands.
    const s = 1 + pop * 0.4;
    const cy = y + 22;
    ctx.translate(x, cy);
    ctx.scale(s, s);
    ctx.translate(-x, -cy);
  }
  ctx.fillText(String(value).padStart(label === 'SCORE' ? 6 : 2, '0'), x, y + 15);
  ctx.restore();
}

/** Countdown as M:SS (or 0:SS under a minute). */
function formatClock(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** TIME readout colour: cyan normally, amber when getting short, and a fast
 *  red flash once the clock is critical so the player feels the pressure. */
function timeHudColour(t: number): string {
  if (state.timePop > 0.02) return state.timePopGain ? '#8cffb4' : '#ff4d5e';
  if (state.timeLeft < 12) return Math.sin(t * 12) > 0 ? '#ff4d5e' : '#ffd0a0';
  if (state.timeLeft < 25) return '#ff8a3a';
  return '#5effdb';
}

/** Desktop TIME stat — the clock, punched on gain/loss like the score readout. */
function drawTimeStat(x: number, y: number, t: number): void {
  const colour = timeHudColour(t);
  ctx.fillStyle = 'rgba(255,245,216,0.58)';
  ctx.font = `700 9px ${FONT_MONO}`;
  ctx.fillText('TIME', x, y);
  const pop = state.timePop;
  ctx.save();
  ctx.fillStyle = colour;
  ctx.shadowColor = colour;
  ctx.shadowBlur = 5 + pop * 16;
  ctx.font = `900 14px ${FONT_MONO}`;
  if (pop > 0.01) {
    const s = 1 + pop * 0.42;
    const cy = y + 22;
    ctx.translate(x, cy);
    ctx.scale(s, s);
    ctx.translate(-x, -cy);
  }
  ctx.fillText(formatClock(state.timeLeft), x, y + 15);
  ctx.restore();
}

function radarHudArea(viewport: VisibleCanvasRect = visibleCanvasRect()): RadarArea {
  if (!usePortraitHud(viewport)) {
    return {
      x: 18,
      y: RADAR_Y,
      w: VIEW_W - 36,
      h: RADAR_H,
      compact: false,
      viewW: VIEW_W,
    };
  }
  const pad = Math.max(8, Math.min(14, viewport.w * 0.032));
  return {
    x: viewport.x + pad,
    y: 61,
    w: Math.max(1, viewport.w - pad * 2),
    h: 78,
    compact: true,
    viewW: viewport.w,
  };
}

function radarX(area: RadarArea, worldX: number): number {
  return area.x + (wrapX(worldX) / WORLD_W) * area.w;
}

function radarY(area: RadarArea, worldY: number): number {
  return area.y + clamp(worldY / VIEW_H, 0, 1) * area.h;
}

function drawRadar(t: number, area: RadarArea = radarHudArea()): void {
  const x = area.x;
  const y = area.y;
  const w = area.w;
  const h = area.h;
  const compact = area.compact;
  const radarViewW = area.viewW;
  ctx.save();
  ctx.fillStyle = 'rgba(1, 4, 10, 0.97)';
  ctx.strokeStyle = 'rgba(255, 245, 216, 0.46)';
  ctx.lineWidth = 1;
  roundedRect(x, y, w, h, 3);
  ctx.fill();
  ctx.stroke();
  if (state.threatPulse > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = clamp(state.threatPulse, 0, 1);
    ctx.strokeStyle = '#ff4d5e';
    ctx.shadowColor = '#ff4d5e';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2.2;
    roundedRect(x, y, w, h, 3);
    ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const rx = (wx: number): number => radarX(area, wx);
  const ry = (wy: number): number => radarY(area, wy);
  const jam = radarJammerStrength();
  const jitter = (seed: number, amp: number): number => {
    if (jam <= 0) return 0;
    return (
      Math.sin(t * (17.3 + (seed % 5)) + seed * 0.217) +
      Math.sin(t * 7.9 + seed * 1.913) * 0.55
    ) * amp * jam;
  };
  const jx = (wx: number, seed: number, amp = 5): number => rx(wx) + jitter(seed, amp);
  const jy = (wy: number, seed: number, amp = 3): number => ry(wy) + jitter(seed + 97, amp);

  ctx.fillStyle = 'rgba(94,255,219,0.08)';
  for (let i = 0; i <= 32; i += 1) ctx.fillRect(x + i * (w / 32), y, 1, h);
  for (let i = 1; i < 6; i += 1) ctx.fillRect(x, y + i * (h / 6), w, 1);

  ctx.save();
  ctx.strokeStyle = 'rgba(94,255,219,0.44)';
  ctx.lineWidth = 1.4;
  ctx.shadowColor = '#5effdb';
  ctx.shadowBlur = 5;
  ctx.beginPath();
  for (let i = 0; i <= 192; i += 1) {
    const wx = (i / 192) * WORLD_W;
    const px = rx(wx);
    const py = ry(terrainY(wx));
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.globalAlpha = 0.12;
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fillStyle = '#5effdb';
  ctx.fill();
  ctx.restore();

  if (jam > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = `rgba(95,124,255,${(0.05 + jam * 0.1).toFixed(3)})`;
    for (let i = 0; i < Math.ceil(jam * 34); i += 1) {
      const n = Math.sin(i * 37.7 + t * 21.3);
      const yy = y + ((i * 19 + t * 92) % h);
      const xx = x + ((n * 0.5 + 0.5) * w);
      ctx.fillRect(xx - 80 * jam, yy, 160 * jam, 1);
    }
    ctx.strokeStyle = `rgba(255,58,255,${(0.1 + jam * 0.22).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + h * (0.18 + Math.sin(t * 7) * 0.08));
    ctx.lineTo(x + w, y + h * (0.18 + Math.sin(t * 7 + 1.2) * 0.08));
    ctx.stroke();
    ctx.restore();
  }

  const boxW = (radarViewW / WORLD_W) * w;
  const boxX = x + (wrapX(cameraX - radarViewW / 2) / WORLD_W) * w;
  ctx.strokeStyle = 'rgba(255, 240, 180, 0.96)';
  ctx.lineWidth = 1.2;
  if (boxX + boxW <= x + w) {
    ctx.strokeRect(boxX, y + 2, boxW, h - 4);
  } else {
    const first = x + w - boxX;
    ctx.strokeRect(boxX, y + 2, first, h - 4);
    ctx.strokeRect(x, y + 2, boxW - first, h - 4);
  }

  ctx.fillStyle = 'rgba(94,255,219,0.28)';
  for (let tx = 0; tx < WORLD_W; tx += 512) ctx.fillRect(rx(tx) - 1.5, y + h - 18, 3, 16);

  const urgent = mostUrgentSignal();
  if (urgent) {
    const threat = contactThreat(urgent);
    const ux = jx(urgent.x, urgent.id * 19, 4);
    const uy = jy(urgent.y, urgent.id * 23, 2);
    const urgency = threat.urgency;
    const colour = threat.colour;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = urgency >= 3 ? 0.72 + Math.sin(t * 16) * 0.12 : 0.38;
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    ctx.shadowColor = colour;
    ctx.shadowBlur = urgency >= 3 ? 10 : 5;
    ctx.lineWidth = urgency >= 3 ? 1.8 : 1.1;
    ctx.beginPath();
    ctx.arc(ux, uy, urgency >= 3 ? 9 + Math.sin(t * 14) * 1.6 : 6.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  const carrier = activeCarrier();
  if (carrier) {
    const cx = jx(carrier.x, carrier.id, 5);
    const cy = jy(carrier.y, carrier.id, 3);
    const hp = clamp(carrier.hp / Math.max(1, carrier.maxHp), 0, 1);
    const pulse = 0.5 + Math.sin(t * 8 + carrier.phase) * 0.5;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.68 + pulse * 0.18;
    ctx.strokeStyle = '#ff2f7a';
    ctx.fillStyle = '#ff2f7a';
    ctx.shadowColor = '#ff2f7a';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    ctx.arc(cx, cy, compact ? 5.2 : 6.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, compact ? 8.4 + pulse : 10.2 + pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.86;
    ctx.fillRect(cx - 9, cy + (compact ? 10 : 12), 18 * hp, 2.4);
    ctx.restore();
  }

  if (DEBUG_TUNING) drawRadarThreatQueue(t, x, y, w, h, compact);

  const camp = clamp(state.lowCamp / 2.6, 0, 1);
  if (camp > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = camp > 0.7 ? '#ff4d5e' : '#ff8a3a';
    ctx.globalAlpha = 0.26 + camp * 0.45;
    ctx.fillRect(x, y + h - 3, w * camp, 3);
    ctx.restore();
  }

  for (const s of state.signals) {
    if (s.status === 'lost' || s.status === 'saved') continue;
    const threat = contactThreat(s);
    const sx = jx(s.x, s.id * 13, threat.label === 'LIFT' ? 6 : threat.targeted ? 4.5 : 3);
    const sy = jy(s.y, s.id * 17, threat.label === 'LIFT' ? 4 : threat.targeted ? 3 : 2);
    const colour = threat.targeted
      ? (Math.floor(t * (threat.label === 'TARGET' ? 4 : 8)) % 2 ? threat.colour : relationColour(s.relation))
      : relationColour(s.relation);
    const r = s.relation === 'high-wot' ? 4.3 : s.relation === 'mutual' ? 3.7 : 3.1;
    if (s.status === 'falling') {
      const rescue = fallingRescueWindow(s);
      const gateColour = rescue.magnet || rescue.catch ? '#5effdb' : '#fff5d8';
      const groundY = ry(terrainY(s.x) - 22);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = rescue.magnet || rescue.catch ? 0.72 : 0.42;
      ctx.strokeStyle = gateColour;
      ctx.fillStyle = gateColour;
      ctx.shadowColor = gateColour;
      ctx.shadowBlur = rescue.magnet || rescue.catch ? 8 : 4;
      ctx.lineWidth = rescue.magnet || rescue.catch ? 1.45 : 1.05;
      ctx.setLineDash(rescue.magnet || rescue.catch ? [] : [4, 5]);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx, groundY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(sx - 12, sy + 7);
      ctx.lineTo(sx, sy + 13);
      ctx.lineTo(sx + 12, sy + 7);
      ctx.stroke();
      if (rescue.magnet || rescue.catch) {
        const shipRx = rx(state.ship.x);
        const shipRy = ry(state.ship.y);
        ctx.beginPath();
        ctx.moveTo(shipRx - 13, shipRy - 3);
        ctx.lineTo(shipRx + 13, shipRy - 3);
        ctx.moveTo(shipRx - 9, shipRy + 5);
        ctx.lineTo(shipRx + 9, shipRy + 5);
        ctx.stroke();
        ctx.font = `900 ${compact ? 5.8 : 6.8}px ${FONT_MONO}`;
        ctx.textAlign = 'center';
        ctx.fillText('CATCH GATE', shipRx, Math.max(y + 10, shipRy - 12));
      }
      ctx.restore();
    }
    ctx.fillStyle = colour;
    ctx.strokeStyle = colour;
    ctx.lineWidth = threat.label === 'LIFT' ? 2.1 : threat.targeted ? 1.8 : 1.4;
    ctx.beginPath();
    if (threat.label === 'LIFT') {
      ctx.arc(sx, sy, r + 4 + Math.sin(t * 18) * 1.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, sy, 2.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (threat.label === 'FALL') {
      ctx.arc(sx, sy, r + 1.4, 0, Math.PI * 2);
      ctx.stroke();
    } else if (threat.label === 'LOCK') {
      ctx.arc(sx, sy, r + 2.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, sy, r + 4.6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * threat.capture);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (threat.label === 'TARGET') {
      ctx.arc(sx, sy, r + 1.4, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const b of state.beacons) {
    const bx = jx(b.x, Math.floor(b.x), 3);
    const by = jy(b.y, Math.floor(b.y), 2);
    ctx.strokeStyle = beaconColour(b.kind);
    ctx.lineWidth = 2.3;
    ctx.beginPath();
    ctx.arc(bx, by, 6 + Math.sin(t * 7) * 1.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx - 6, by);
    ctx.lineTo(bx + 6, by);
    ctx.moveTo(bx, by - 6);
    ctx.lineTo(bx, by + 6);
    ctx.stroke();
  }

  for (const shot of state.enemyShots) {
    const px = jx(shot.x, Math.floor(shot.x + shot.age * 1000), shot.kind === 'jam' ? 2 : 3);
    const py = jy(shot.y, Math.floor(shot.y + shot.age * 1000), shot.kind === 'jam' ? 1.5 : 2);
    const colour = enemyShotColour(shot.kind);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = colour;
    ctx.shadowColor = colour;
    ctx.shadowBlur = shot.kind === 'barrage' ? 5 : 3.5;
    ctx.globalAlpha = shot.kind === 'jam' ? 0.58 : 0.72;
    ctx.beginPath();
    ctx.arc(px, py, shot.kind === 'barrage' ? 3 : shot.kind === 'jam' ? 2.6 : 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (const e of state.enemies) {
    const ex = jx(e.x, e.id, e.type === 'jammer' ? 2 : 6);
    const ey = jy(e.y, e.id, e.type === 'jammer' ? 1.5 : 4);
    const eColour = enemyColour(e.type);
    const fireKind = enemyShotKind(e);
    const fireReady = fireKind && enemyCanShoot(e, fireKind) ? enemyFireReadiness(e, fireKind) : 0;
    const capture = e.type === 'abductor' ? clamp(e.captureCharge / tunedCaptureLockTime(), 0, 1) : 0;
    const hot = e.carryId !== null || e.type === 'carrier' || capture > 0.01 || fireReady > 0.12 || e.intent > 0.35;
    const radius = e.type === 'carrier'
      ? (compact ? 4.2 : 5.0)
      : e.type === 'hunter'
        ? 3.4
        : e.type === 'jammer'
          ? 3.2
          : e.type === 'forgery'
            ? 2.8
            : 3.1;
    const ringColour = e.carryId !== null
      ? '#ff4d5e'
      : capture > 0
        ? (capture > 0.72 ? '#ff4d5e' : '#ffd84a')
        : fireReady > 0.62
          ? '#fff5d8'
          : e.type === 'carrier'
            ? '#ff2f7a'
            : eColour;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = eColour;
    ctx.strokeStyle = ringColour;
    ctx.shadowColor = ringColour;
    ctx.shadowBlur = hot ? (e.type === 'carrier' ? 6 : 3.6) : 1.6;
    ctx.globalAlpha = e.type === 'forgery' ? 0.7 : 0.94;
    ctx.beginPath();
    ctx.arc(ex, ey, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = hot ? 0.96 : 0.62;
    ctx.lineWidth = hot ? 1.05 : 0.65;
    ctx.beginPath();
    ctx.arc(ex, ey, radius + (hot ? 1.2 + Math.sin(t * 8 + e.phase) * 0.45 : 0.72), 0, Math.PI * 2);
    ctx.stroke();

    if (e.type === 'jammer') {
      const jamRadius = Math.max(compact ? 5.5 : 7, (96 / WORLD_W) * w);
      ctx.globalAlpha = compact ? 0.1 : 0.14;
      ctx.lineWidth = compact ? 0.65 : 0.8;
      ctx.beginPath();
      ctx.arc(ex, ey, jamRadius + Math.sin(t * 5.2 + e.phase) * 1.2, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (capture > 0.01) {
      ctx.globalAlpha = 0.88;
      ctx.lineWidth = 1.35;
      ctx.beginPath();
      ctx.arc(ex, ey, radius + 2.9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * capture);
      ctx.stroke();
    }

    if (fireReady > 0.12) {
      ctx.globalAlpha = 0.28 + fireReady * 0.36;
      ctx.lineWidth = fireReady > 0.72 ? 1.45 : 0.95;
      ctx.beginPath();
      ctx.arc(ex, ey, radius + 3.5 + fireReady, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (e.type === 'carrier') {
      const hp = clamp(e.hp / Math.max(1, e.maxHp), 0, 1);
      ctx.globalAlpha = 0.92;
      ctx.strokeStyle = '#ff2f7a';
      ctx.lineWidth = 1.45;
      ctx.beginPath();
      ctx.arc(ex, ey, radius + 4.2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hp);
      ctx.stroke();
    } else if (e.type === 'forgery') {
      ctx.fillStyle = 'rgba(255,58,255,0.34)';
      for (let i = 0; i < 2; i += 1) {
        const fx = jx(wrapX(e.x + Math.sin(t * 1.8 + e.phase + i) * 210), e.id + i * 71, 5);
        const fy = jy(e.y + Math.cos(t * 2.2 + e.phase + i) * 15, e.id + i * 43, 3);
        ctx.beginPath();
        ctx.arc(fx, fy, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  for (const l of state.lasers) {
    const lx = rx(l.x);
    const ly = ry(l.y);
    const ex = lx + l.dir * (l.length / WORLD_W) * w;
    ctx.strokeStyle = 'rgba(255,216,74,0.76)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(ex, ly);
    ctx.stroke();
  }

  const shipX = rx(state.ship.x);
  const shipY = ry(state.ship.y);
  const sd = state.ship.dir;
  ctx.fillStyle = '#fff5d8';
  ctx.strokeStyle = '#ffd84a';
  ctx.shadowColor = '#fff5d8';
  ctx.shadowBlur = 6;
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  ctx.arc(shipX, shipY, compact ? 3.4 : 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#5effdb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(shipX + sd * 4, shipY);
  ctx.lineTo(shipX + sd * 8, shipY);
  ctx.stroke();

  ctx.restore();
  ctx.save();
  ctx.fillStyle = 'rgba(255,245,216,0.76)';
  ctx.font = `800 ${compact ? 6.5 : 9}px ${FONT_MONO}`;
  ctx.textAlign = 'left';
  const radarField = state.skill === '600b' ? '600B RELAY FIELD' : 'RELAY DEFENSE FIELD';
  ctx.fillText(compact ? radarField : `PRIMARY RADAR · ${radarField}`, x + 10, y - (compact ? 7 : 9));
  if (!compact) {
    ctx.textAlign = 'right';
    ctx.fillText('WHITE=YOU · RED=CAPTURE · BLUE=JAMMER · GOLD=WOT', x + w - 10, y - 9);
  }
  ctx.restore();
}

function drawRadarThreatQueue(t: number, x: number, y: number, w: number, h: number, compact: boolean): void {
  const rows = radarThreatQueue(compact ? 2 : 3);
  if (rows.length === 0) return;
  const rowH = compact ? 10 : 13;
  const boxW = Math.min(compact ? 126 : 220, w * (compact ? 0.42 : 0.28));
  const boxH = 8 + rows.length * rowH;
  const bx = x + w - boxW - 7;
  const by = y + 7;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(1,4,10,0.74)';
  roundedRect(bx, by, boxW, boxH, 3);
  ctx.fill();
  ctx.globalCompositeOperation = 'screen';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.font = `900 ${compact ? 6.2 : 7.5}px ${FONT_MONO}`;
  for (let i = 0; i < rows.length; i += 1) {
    const s = rows[i]!;
    const threat = contactThreat(s);
    const hot = threat.urgency > 3.1;
    const colour = hot && Math.floor(t * 10) % 2 === 0 ? '#fff5d8' : threat.colour;
    const yy = by + 5 + i * rowH;
    ctx.fillStyle = colour;
    ctx.shadowColor = threat.colour;
    ctx.shadowBlur = hot ? 7 : 3;
    ctx.fillText(contactThreatEtaText(s, threat), bx + 6, yy);
    ctx.textAlign = 'right';
    ctx.fillStyle = hot ? '#ff4d5e' : 'rgba(255,245,216,0.78)';
    ctx.fillText(signalDisplayName(s).slice(0, compact ? 7 : 12).toUpperCase(), bx + boxW - 6, yy);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}

function drawMessages(t: number, meshMode: boolean): void {
  const viewport = visibleCanvasRect();
  const cx = usePortraitHud(viewport) ? viewport.centerX : VIEW_W / 2;
  if (state.phase === 'title') {
    ctx.save();
    ctx.textAlign = 'center';
    const portrait = usePortraitHud(viewport);
    if (!meshMode) drawTitleKeyArt(viewport);
    drawTitleLowerMask(portrait);
    const layout = drawTitleLoadout(viewport, t, meshMode);
    // Portrait hangs the wordmark off the auth dock so it tracks the device
    // safe area; desktop keeps its fixed masthead position.
    const titleY = portrait ? layout.authDock.y + layout.authDock.h + 46 : 128;
    const grad = ctx.createLinearGradient(cx - 260, titleY - 44, cx + 260, titleY + 24);
    grad.addColorStop(0, '#f9fbff');
    grad.addColorStop(0.45, '#66fff1');
    grad.addColorStop(1, '#ffd84a');
    ctx.shadowColor = '#5effdb';
    ctx.shadowBlur = portrait ? 18 : 26;
    ctx.fillStyle = grad;
    ctx.font = `950 ${portrait ? 39 : 72}px ${FONT_DISPLAY}`;
    ctx.fillText(BRAND_NAME, cx, titleY);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(2,4,11,0.8)';
    ctx.lineWidth = portrait ? 2 : 3;
    ctx.strokeText(BRAND_NAME, cx, titleY);
    ctx.fillStyle = '#f4fff9';
    ctx.font = `900 ${portrait ? 10 : 15}px ${FONT_DISPLAY}`;
    ctx.fillText(TAGLINE, cx, titleY + (portrait ? 34 : 48));
    if (!portrait) {
      // Keyboard hints mean nothing on a touch screen — desktop only.
      ctx.fillStyle = '#ffd84a';
      ctx.font = `900 12px ${FONT_DISPLAY}`;
      ctx.fillText('ARROWS CHOOSE · ENTER SELECT · 1-6 QUICK PICK', cx, layout.hintY);
    }
    ctx.fillStyle = 'rgba(94,255,219,0.8)';
    ctx.font = `900 ${portrait ? 6.5 : 8.5}px ${FONT_MONO}`;
    fitCanvasText(titleStatus, cx, layout.hintY + (portrait ? 0 : 18), Math.min(viewport.w - 34, 520));
    if (titlePaymentModalOpen) drawTitlePaymentModal(viewport, t);
    ctx.restore();
    return;
  }
  if (state.phase === 'paused') {
    drawPauseOverlay(t, viewport);
    return;
  }
  if (state.phase === 'gameover') {
    ctx.save();
    ctx.textAlign = 'center';
    const portrait = usePortraitHud(viewport);
    if (lastRunNewBest) {
      // A record on the death screen — the reason to hit retry. Sits above the
      // RELAY DOWN header in the otherwise-empty top strip, pulsing gold.
      const pulse = 0.6 + Math.sin(t * 6) * 0.4;
      ctx.save();
      ctx.fillStyle = '#ffd84a';
      ctx.shadowColor = '#ffd84a';
      ctx.shadowBlur = (portrait ? 8 : 12) + pulse * 8;
      ctx.font = `950 ${portrait ? 12 : 16}px ${FONT_DISPLAY}`;
      ctx.fillText('★ NEW PERSONAL BEST ★', cx, portrait ? 60 : 52);
      ctx.restore();
    }
    const timeLock = lastDeathSource === 'time-lock';
    ctx.shadowColor = timeLock ? '#ffd84a' : '#ff4d5e';
    ctx.shadowBlur = portrait ? 14 : 18;
    ctx.fillStyle = '#fff5d8';
    ctx.font = `900 ${portrait ? 28 : 44}px ${FONT_DISPLAY}`;
    ctx.fillText(timeLock ? 'TIME LOCKED!' : 'RELAY DOWN', cx, portrait ? 96 : 92);
    ctx.shadowBlur = 0;
    if (lastDeathSource) {
      ctx.fillStyle = '#ff8a3a';
      ctx.font = `900 ${portrait ? 8.5 : 12}px ${FONT_MONO}`;
      ctx.fillText(timeLock ? 'THE CLOCK RAN OUT' : `DOWNED BY ${killerLabel(lastDeathSource)}`, cx, portrait ? 117 : 116);
    }
    // The player's own result always comes first; the support ask follows it.
    const statsY = portrait ? 142 : 142;
    ctx.fillStyle = '#ffd84a';
    ctx.font = `900 ${portrait ? 8 : 11}px ${FONT_MONO}`;
    ctx.fillText(`${state.score} SCORE · ${state.sats} CRED · ${state.rescued} SAVED · WAVE ${state.wave}`, cx, statsY);
    if (gameOverStage === 'name') {
      drawGameOverNameEntry(cx, portrait, viewport, t);
      ctx.restore();
      return;
    }
    ctx.fillStyle = 'rgba(94,255,219,0.86)';
    ctx.font = `900 ${portrait ? 6.5 : 8.5}px ${FONT_MONO}`;
    ctx.fillText(scoreStatus, cx, statsY + (portrait ? 14 : 16));
    ctx.fillStyle = scorePublished ? '#ffd84a' : 'rgba(255,245,216,0.82)';
    ctx.font = `900 ${portrait ? 6.5 : 8}px ${FONT_MONO}`;
    ctx.fillText(scoreSubmitHint(portrait), cx, statsY + (portrait ? 27 : 30));
    const report = lastFeelReport ?? buildFeelReport(true);
    ctx.fillStyle = report.grade === 'LEGENDARY' ? '#ffd84a' : report.grade === 'SHARP' ? '#5effdb' : '#fff5d8';
    ctx.font = `900 ${portrait ? 6.3 : 8}px ${FONT_MONO}`;
    ctx.fillText(`RUN FEEL · ${report.grade} · ${report.flags[0] ?? 'RUN FEEL STABLE'}`, cx, statsY + (portrait ? 42 : 46));
    if (supportNudgeLine && !gameOverSupportOpen) {
      ctx.fillStyle = '#ffd84a';
      ctx.font = `900 ${portrait ? 6.5 : 8.5}px ${FONT_MONO}`;
      fitCanvasText(supportNudgeLine, cx, statsY + (portrait ? 56 : 62), Math.min(viewport.w - 40, 560));
    }
    drawLeaderboardPanel(cx, portrait, viewport, t);
    drawGameOverPills(viewport, portrait);
    if (gameOverSupportOpen) drawGameOverSupportModal(viewport);
    ctx.restore();
    return;
  }
  if (state.phase === 'playing') drawControlHints(viewport);
  if (state.phase === 'playing' && state.timeLock > 0) {
    // TIME LOCKED trap: the headline plus a live millisecond countdown from
    // 2.100 — the player should feel every thousandth they can't move.
    const portrait = usePortraitHud(viewport);
    const shiver = Math.sin(t * 42) * 1.4;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.shadowColor = '#ff4d5e';
    ctx.shadowBlur = portrait ? 12 : 18;
    ctx.fillStyle = '#fff5d8';
    ctx.font = `900 ${portrait ? 26 : 42}px ${FONT_DISPLAY}`;
    ctx.fillText('TIME LOCKED', cx + shiver, PLAY_TOP + (portrait ? 84 : 108));
    ctx.fillStyle = '#ff4d5e';
    ctx.font = `900 ${portrait ? 22 : 34}px ${FONT_MONO}`;
    ctx.fillText(state.timeLock.toFixed(3), cx, PLAY_TOP + (portrait ? 116 : 152));
    ctx.restore();
    return;
  }
  if (state.messageUntil > 0) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.globalAlpha = Math.min(1, state.messageUntil);
    ctx.shadowColor = state.message.includes('MUTATED') || state.message.includes('BREACH') || state.message.includes('LOST') ? '#ff4d5e' : '#5effdb';
    ctx.shadowBlur = 10;
    ctx.fillStyle = state.message.includes('CRED') ? '#ffd84a' : '#fff5d8';
    ctx.font = `900 ${usePortraitHud(viewport) ? 18 : 26}px ${FONT_DISPLAY}`;
    fitCanvasText(state.message, cx, PLAY_TOP + 30, viewport.w - 42);
    ctx.restore();
  }
}

function drawTitleLowerMask(portrait: boolean): void {
  ctx.save();
  const mask = ctx.createLinearGradient(0, VIEW_H * 0.55, 0, VIEW_H);
  mask.addColorStop(0, 'rgba(2,4,11,0)');
  mask.addColorStop(0.42, `rgba(2,4,11,${portrait ? 0.58 : 0.44})`);
  mask.addColorStop(1, `rgba(2,4,11,${portrait ? 0.9 : 0.78})`);
  ctx.fillStyle = mask;
  ctx.fillRect(0, VIEW_H * 0.55, VIEW_W, VIEW_H * 0.45);
  ctx.restore();
}

function drawPauseOverlay(t: number, viewport: VisibleCanvasRect): void {
  const portrait = usePortraitHud(viewport);
  const cx = portrait ? viewport.centerX : VIEW_W / 2;
  const buttons = pauseMenuButtons(viewport);
  const firstButton = buttons[0]!;
  const lastButton = buttons[buttons.length - 1]!;
  const panelW = Math.min(portrait ? 326 : 456, Math.max(firstButton.w + 58, viewport.w - (portrait ? 30 : 0)));
  const panelH = lastButton.y + lastButton.h - firstButton.y + (portrait ? 150 : 174);
  const panelX = clampWithinVisible(cx - panelW / 2, panelW, viewport, portrait ? 12 : 28);
  const panelY = firstButton.y - (portrait ? 124 : 144);
  const pulse = 0.5 + Math.sin(t * 5.2) * 0.5;

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(0, 2, 7, 0.58)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.fillStyle = 'rgba(2, 8, 17, 0.9)';
  ctx.strokeStyle = `rgba(94, 255, 219, ${(0.38 + pulse * 0.16).toFixed(3)})`;
  ctx.lineWidth = 1.4;
  ctx.shadowColor = 'rgba(94, 255, 219, 0.36)';
  ctx.shadowBlur = 18;
  roundedRect(panelX, panelY, panelW, panelH, 6);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#fff5d8';
  ctx.shadowColor = '#5effdb';
  ctx.shadowBlur = portrait ? 10 : 16;
  ctx.font = `950 ${portrait ? 32 : 48}px ${FONT_DISPLAY}`;
  ctx.fillText('PAUSED', cx, panelY + (portrait ? 24 : 30));
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,245,216,0.76)';
  ctx.font = `900 ${portrait ? 8 : 11}px ${FONT_MONO}`;
  ctx.fillText(`WAVE ${String(state.wave).padStart(2, '0')} · SCORE ${String(state.score).padStart(6, '0')}`, cx, panelY + (portrait ? 68 : 88));

  for (const button of buttons) drawPauseButton(button);
  ctx.restore();
}

function drawPauseButton(button: PauseMenuButton): void {
  const active = button.action === pauseMenuChoice;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = active ? 'rgba(94,255,219,0.18)' : 'rgba(255,255,255,0.045)';
  ctx.strokeStyle = active ? 'rgba(94,255,219,0.9)' : 'rgba(255,245,216,0.26)';
  ctx.lineWidth = active ? 1.6 : 1;
  ctx.shadowColor = active ? '#5effdb' : 'transparent';
  ctx.shadowBlur = active ? 12 : 0;
  roundedRect(button.x, button.y, button.w, button.h, 5);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = active ? '#fff5d8' : 'rgba(255,245,216,0.74)';
  ctx.font = `950 ${button.h > 44 ? 15 : 13}px ${FONT_MONO}`;
  ctx.fillText(button.label, button.x + button.w / 2, button.y + button.h / 2 + 0.5);
  ctx.restore();
}

function pauseMenuButtons(viewport: VisibleCanvasRect = visibleCanvasRect()): PauseMenuButton[] {
  const portrait = usePortraitHud(viewport);
  const cx = portrait ? viewport.centerX : VIEW_W / 2;
  const buttonW = Math.min(portrait ? 232 : 276, Math.max(176, viewport.w - 74));
  const buttonH = portrait ? 40 : 48;
  const gap = portrait ? 12 : 14;
  const totalH = buttonH * 2 + gap;
  const minY = PLAY_TOP + (portrait ? 102 : 132);
  const maxY = viewport.y + viewport.h - totalH - (portrait ? 42 : 54);
  const firstY = maxY >= minY ? clamp(viewport.centerY + (portrait ? 20 : 36), minY, maxY) : Math.max(PLAY_TOP + 82, viewport.centerY - totalH / 2);
  const x = clampWithinVisible(cx - buttonW / 2, buttonW, viewport, portrait ? 18 : 32);
  return [
    { action: 'resume', label: 'RESUME', x, y: firstY, w: buttonW, h: buttonH },
    { action: 'quit', label: 'QUIT TO MENU', x, y: firstY + buttonH + gap, w: buttonW, h: buttonH },
  ];
}

function clampWithinVisible(x: number, width: number, viewport: VisibleCanvasRect, pad: number): number {
  const minX = viewport.x + pad;
  const maxX = viewport.x + viewport.w - width - pad;
  if (maxX < minX) return viewport.centerX - width / 2;
  return clamp(x, minX, maxX);
}

function pauseMenuActionAt(x: number, y: number): PauseMenuChoice | null {
  for (const button of pauseMenuButtons()) {
    if (x >= button.x && x <= button.x + button.w && y >= button.y && y <= button.y + button.h) return button.action;
  }
  return null;
}

function canvasPointFromPointer(ev: PointerEvent): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: ((ev.clientX - rect.left) / rect.width) * VIEW_W,
    y: ((ev.clientY - rect.top) / rect.height) * VIEW_H,
  };
}

function drawValueForValuePanel(cx: number, portrait: boolean, viewport: VisibleCanvasRect, panelY: number): number {
  if (!VALUE_FOR_VALUE.configured) return 0;
  const method = activeSupportMethod(scoreSupportMethod);
  if (!method) return 0;
  const qr = getValueForValueQrCanvas(method.qrValue);
  if (!qr) return 0;

  const panelW = portrait ? Math.min(354, Math.max(286, viewport.w - 18)) : Math.min(900, viewport.w - 76);
  const panelH = portrait ? VALUE_PANEL_H_PORTRAIT : VALUE_PANEL_H_DESKTOP;
  const x = clampWithinVisible(cx - panelW / 2, panelW, viewport, portrait ? 12 : 42);
  const y = panelY;
  const qrSize = portrait ? 126 : 196;
  const qrX = portrait ? x + 24 : x + 34;
  const qrY = portrait ? y + 112 : y + 76;
  const textX = portrait ? qrX + qrSize + 16 : qrX + qrSize + 34;
  const textW = portrait ? Math.max(132, x + panelW - textX - 18) : Math.max(210, x + panelW - textX - 28);

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(1,4,10,0.94)';
  ctx.strokeStyle = 'rgba(255,216,74,0.86)';
  ctx.lineWidth = portrait ? 1.4 : 1.8;
  ctx.shadowColor = 'rgba(255,216,74,0.46)';
  ctx.shadowBlur = portrait ? 18 : 28;
  roundedRect(x, y, panelW, panelH, 8);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd84a';
  ctx.shadowColor = '#ffd84a';
  ctx.shadowBlur = portrait ? 14 : 24;
  ctx.font = `950 ${portrait ? 31 : 64}px ${FONT_DISPLAY}`;
  fitCanvasText('VALUE MY TIME', cx, y + (portrait ? 13 : 10), panelW - 34);
  ctx.shadowBlur = 0;

  if (valueThanksVisible) {
    // They paid — the QR and the pitch make way for the thank-you sticker.
    drawValueThankYouMeme(x, y, panelW, panelH, portrait);
  } else {
    ctx.drawImage(qr, qrX, qrY, qrSize, qrSize);
    ctx.strokeStyle = 'rgba(255,245,216,0.48)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(qrX - 1, qrY - 1, qrSize + 2, qrSize + 2);

    const copyY = portrait ? y + 86 : qrY + 8;
    const math = valueTimeMath();
    const creditsLabel = `${math.credits} CREDIT${math.credits === 1 ? '' : 'S'}`;
    const satsLabel = `${math.sats.toLocaleString('en-GB')} SATS`;
    const lines = portrait
      ? [
        `THIS RUN ${fmtTime(math.runSeconds)} · ALL TIME ${fmtLongPlayTime(math.lifetimeSeconds)}`,
        `ARCADE MATH: ${creditsLabel} ≈ ${satsLabel}`,
        'FAIR? ZAP IT. SKINT? PLAY ON.',
      ]
      : [
        `YOU PLAYED ${fmtTime(math.runSeconds)} THIS RUN · ${fmtLongPlayTime(math.lifetimeSeconds)} ALL TIME`,
        `ARCADE MATH: ${creditsLabel} AT 3 MIN A PLAY ≈ ${satsLabel}`,
        'FAIR? ZAP IT. GENEROUS? LEGEND. SKINT? PLAY ON.',
      ];
    ctx.textAlign = portrait ? 'left' : 'left';
    ctx.fillStyle = 'rgba(255,245,216,0.92)';
    ctx.font = `900 ${portrait ? 8.3 : 13}px ${FONT_MONO}`;
    for (let i = 0; i < lines.length; i += 1) {
      const lineY = copyY + i * (portrait ? 13 : 19);
      fitCanvasText(lines[i]!, textX, lineY, textW);
    }

    ctx.fillStyle = '#ffd84a';
    ctx.shadowColor = '#ffd84a';
    ctx.shadowBlur = portrait ? 5 : 8;
    ctx.font = `950 ${portrait ? 10 : 18}px ${FONT_DISPLAY}`;
    const methodY = portrait ? qrY + qrSize + 24 : copyY + 94;
    drawValueMethodGroup(
      portrait ? x + panelW / 2 : textX + textW / 2,
      methodY,
      portrait ? panelW - 38 : Math.min(430, textW),
      portrait,
    );
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(94,255,219,0.82)';
    ctx.font = `900 ${portrait ? 7 : 10}px ${FONT_MONO}`;
    const targetLines = splitPaymentDisplay(method.display, Math.max(10, Math.floor(textW / (portrait ? 5.6 : 6.6))));
    const startY = portrait ? y + panelH - 80 : methodY + 28;
    for (let i = 0; i < Math.min(portrait ? 1 : 2, targetLines.length); i += 1) {
      if (portrait) {
        ctx.textAlign = 'center';
        fitCanvasText(targetLines[i]!, x + panelW / 2, startY + i * 11, textW);
      } else {
        ctx.textAlign = 'left';
        fitCanvasText(targetLines[i]!, textX, startY + i * 14, textW);
      }
    }
  }

  if (!valueThanksVisible) {
    // Honest confirmation: we cannot detect a lightning payment, so the
    // player tells us — or defers without the screen pretending otherwise.
    const rects = valueConfirmRects(x, y, panelW, panelH, portrait);
    drawGameOverPill(rects.paid, 'I PAID', '#5effdb', portrait);
    drawGameOverPill(rects.later, 'NEXT TIME', '#fff5d8', portrait);
  }

  ctx.fillStyle = 'rgba(255,245,216,0.54)';
  ctx.font = `800 ${portrait ? 5.8 : 7.4}px ${FONT_MONO}`;
  ctx.textAlign = portrait ? 'center' : 'left';
  if (portrait) {
    ctx.fillText('OPTIONAL SUPPORT · NO PAYOUT CLAIM', x + panelW / 2, y + panelH - 13);
  } else {
    ctx.fillText('OPTIONAL SUPPORT · NO PAYOUT CLAIM', textX, y + panelH - 18);
  }
  ctx.restore();
  return y + panelH;
}

// Single source of truth for the game-over support row — valueMethodButtons
// (hit-testing) and drawValueMethodGroup (labels) must agree on order.
const SCORE_VALUE_METHOD_IDS: readonly ValueLinkId[] = ['lightning', 'onchain', 'silent', 'geyser', 'kofi'];

function drawValueMethodGroup(cx: number, y: number, w: number, portrait: boolean): void {
  const h = portrait ? 25 : 34;
  const ids = SCORE_VALUE_METHOD_IDS.filter(id => VALUE_FOR_VALUE.links.some(link => link.id === id));
  const labels = ids.map(id => titleValueLinkLabel(id));
  const x = cx - w / 2;
  const segmentW = w / labels.length;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(255,216,74,0.16)';
  ctx.strokeStyle = 'rgba(255,216,74,0.86)';
  ctx.lineWidth = 1.2;
  roundedRect(x, y - h / 2, w, h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffd84a';
  ctx.shadowColor = '#ffd84a';
  ctx.shadowBlur = portrait ? 5 : 9;
  ctx.font = `950 ${portrait ? 9 : 14}px ${FONT_DISPLAY}`;
  for (let i = 0; i < labels.length; i += 1) {
    if (i > 0) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,216,74,0.45)';
      ctx.beginPath();
      ctx.moveTo(x + segmentW * i, y - h / 2 + 5);
      ctx.lineTo(x + segmentW * i, y + h / 2 - 5);
      ctx.stroke();
      ctx.shadowBlur = portrait ? 5 : 9;
    }
    // The QR-carrying method currently on display reads teal, matching the
    // active-state accent used across the title menu.
    const selected = ids[i] === scoreSupportMethod;
    ctx.fillStyle = selected ? '#5effdb' : '#ffd84a';
    ctx.shadowColor = selected ? '#5effdb' : '#ffd84a';
    fitCanvasText(labels[i]!, x + segmentW * (i + 0.5), y + 1, segmentW - 12);
  }
  ctx.restore();
}

function valueMethodButtons(viewport: VisibleCanvasRect = visibleCanvasRect()): ValueMethodButton[] {
  if (!VALUE_FOR_VALUE.configured || valueThanksVisible) return [];
  // The panel only exists inside the game-over support modal now.
  if (!gameOverSupportOpen) return [];
  const portrait = usePortraitHud(viewport);
  const cx = portrait ? viewport.centerX : VIEW_W / 2;
  const panelW = portrait ? Math.min(354, Math.max(286, viewport.w - 18)) : Math.min(900, viewport.w - 76);
  const panelX = clampWithinVisible(cx - panelW / 2, panelW, viewport, portrait ? 12 : 42);
  const panelY = gameOverSupportPanelY(viewport, portrait);
  const qrSize = portrait ? 126 : 196;
  const qrX = portrait ? panelX + 24 : panelX + 34;
  const qrY = portrait ? panelY + 112 : panelY + 76;
  const textX = portrait ? qrX + qrSize + 16 : qrX + qrSize + 34;
  const textW = portrait ? Math.max(132, panelX + panelW - textX - 18) : Math.max(210, panelX + panelW - textX - 28);
  const copyY = portrait ? panelY + 86 : qrY + 8;
  const groupY = portrait ? qrY + qrSize + 24 : copyY + 94;
  const groupW = portrait ? panelW - 38 : Math.min(430, textW);
  const groupH = portrait ? 25 : 34;
  const groupCx = portrait ? panelX + panelW / 2 : textX + textW / 2;
  const groupX = groupCx - groupW / 2;
  const ids = SCORE_VALUE_METHOD_IDS.filter(id => VALUE_FOR_VALUE.links.some(link => link.id === id));
  const segmentW = groupW / ids.length;
  return ids.map((id, index) => ({
    id,
    x: groupX + segmentW * index,
    y: groupY - groupH / 2,
    w: segmentW,
    h: groupH,
  }));
}

function valueMethodActionAt(x: number, y: number): ValueLinkId | null {
  for (const button of valueMethodButtons()) {
    const configured = VALUE_FOR_VALUE.links.some(link => link.id === button.id);
    if (!configured) continue;
    if (x >= button.x && x <= button.x + button.w && y >= button.y && y <= button.y + button.h) return button.id;
  }
  return null;
}

/** The paying player's thank-you sticker: rose fren for 600.wtf members, the crypto donkey for everyone else. */
function activeThankYouImage(): { image: HTMLImageElement; member: boolean } {
  const member = isSixHundredMember(activePlayerSession?.pubkey);
  const preferred = member ? valueThankYouImage : valueThankYouDonkeyImage;
  const fallback = member ? valueThankYouDonkeyImage : valueThankYouImage;
  const ready = (img: HTMLImageElement): boolean => img.complete && img.naturalWidth > 0;
  return { image: ready(preferred) || !ready(fallback) ? preferred : fallback, member };
}

// Fills the support panel once the player confirms payment: the sticker
// scales with the panel (which scales with the device) instead of the old
// fixed thumbnail. Portrait stacks sticker over caption; desktop sits the
// sticker where the QR lived with the caption alongside.
function drawValueThankYouMeme(panelX: number, panelY: number, panelW: number, panelH: number, portrait: boolean): void {
  const { image, member } = activeThankYouImage();
  const size = portrait
    ? Math.max(96, Math.min(panelW - 64, panelH - 54 - 34 - 42))
    : panelH - 76 - 26;
  const ix = portrait ? panelX + (panelW - size) / 2 : panelX + 34;
  const iy = panelY + (portrait ? 54 : 76);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  if (image.complete && image.naturalWidth > 0) {
    ctx.shadowColor = 'rgba(0,0,0,0.72)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = 'rgba(13,13,13,0.92)';
    roundedRect(ix - 6, iy - 6, size + 12, size + 12, 8);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.drawImage(image, ix, iy, size, size);
    ctx.strokeStyle = 'rgba(255,216,74,0.66)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(ix - 0.5, iy - 0.5, size + 1, size + 1);
  }

  const captionX = portrait ? panelX + panelW / 2 : ix + size + (panelX + panelW - 28 - ix - size) / 2;
  const captionY = portrait ? iy + size + 10 : panelY + panelH * 0.42;
  ctx.fillStyle = '#ffd84a';
  ctx.shadowColor = '#ffd84a';
  ctx.shadowBlur = 8;
  ctx.font = `900 ${portrait ? 10 : 19}px ${FONT_MONO}`;
  ctx.fillText('THANK YOU', captionX, captionY);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,245,216,0.76)';
  ctx.font = `800 ${portrait ? 7 : 11}px ${FONT_MONO}`;
  ctx.fillText(member ? 'FREN OF THE 600 BILLION' : 'FOR THE SATS', captionX, captionY + (portrait ? 14 : 26));
  ctx.restore();
}

function splitPaymentDisplay(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const lines: string[] = [];
  for (let i = 0; i < text.length && lines.length < 3; i += maxChars) {
    lines.push(text.slice(i, i + maxChars));
  }
  return lines;
}

function drawTitleKeyArt(viewport: VisibleCanvasRect): void {
  if (!brandKeyArt.complete || brandKeyArt.naturalWidth <= 0) return;
  const target = usePortraitHud(viewport)
    ? { x: viewport.x, y: 0, w: viewport.w, h: VIEW_H }
    : { x: 0, y: 0, w: VIEW_W, h: VIEW_H };
  const imgRatio = brandKeyArt.naturalWidth / brandKeyArt.naturalHeight;
  const targetRatio = target.w / target.h;
  let sw = brandKeyArt.naturalWidth;
  let sh = brandKeyArt.naturalHeight;
  let sx = 0;
  let sy = 0;
  if (imgRatio > targetRatio) {
    sw = sh * targetRatio;
    sx = (brandKeyArt.naturalWidth - sw) * 0.5;
  } else {
    sh = sw / targetRatio;
    sy = (brandKeyArt.naturalHeight - sh) * 0.45;
  }
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = usePortraitHud(viewport) ? 0.42 : 0.5;
  ctx.drawImage(brandKeyArt, sx, sy, sw, sh, target.x, target.y, target.w, target.h);
  ctx.globalCompositeOperation = 'source-over';
  const veil = ctx.createLinearGradient(target.x, 0, target.x, VIEW_H);
  veil.addColorStop(0, 'rgba(2,4,11,0.36)');
  veil.addColorStop(0.48, 'rgba(2,4,11,0.08)');
  veil.addColorStop(1, 'rgba(2,4,11,0.64)');
  ctx.fillStyle = veil;
  ctx.fillRect(target.x, target.y, target.w, target.h);
  ctx.restore();
}

function drawTitleStickers(viewport: VisibleCanvasRect, t: number): void {
  const portrait = usePortraitHud(viewport);
  const cx = portrait ? viewport.centerX : VIEW_W / 2;
  const cakeImage = WHOLE_CAKE_PICKUP.complete && WHOLE_CAKE_PICKUP.naturalWidth > 0
    ? WHOLE_CAKE_PICKUP
    : CAKE_PICKUPS.find(image => image.complete && image.naturalWidth > 0);
  const stickers: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    rot: number;
    lines: readonly string[];
    tag: string;
    accent: string;
    image?: HTMLImageElement;
    imageSide?: 'left' | 'right' | 'center';
  }> = portrait
    ? [
        { x: cx - 104, y: 166, w: 130, h: 58, rot: -0.16, lines: ['4.20AM', 'GM'], tag: '@600.WTF', accent: '#f5a623' },
        { x: cx + 108, y: 188, w: 120, h: 62, rot: 0.12, lines: ['ROSE', 'FOR VALUE'], tag: '@SAT', accent: '#ff4d8d', image: ROSE_PICKUP, imageSide: 'center' },
        { x: cx, y: 596, w: 164, h: 62, rot: -0.05, lines: ['CAKE', 'STACKED'], tag: '@DARREN', accent: '#ffd84a', image: cakeImage, imageSide: 'left' },
      ]
    : [
        { x: cx - 420, y: 176, w: 172, h: 64, rot: -0.13, lines: ['4.20AM', 'GM'], tag: '@600.WTF', accent: '#f5a623' },
        { x: cx + 420, y: 200, w: 160, h: 70, rot: 0.14, lines: ['ROSE', 'FOR VALUE'], tag: '@SAT', accent: '#ff4d8d', image: ROSE_PICKUP, imageSide: 'center' },
        { x: cx - 370, y: 590, w: 190, h: 66, rot: 0.08, lines: ['CAKE', 'STACKED'], tag: '@DNI', accent: '#ffd84a', image: cakeImage, imageSide: 'left' },
        { x: cx + 360, y: 582, w: 190, h: 62, rot: -0.09, lines: ['$600B', 'MEME RELAY'], tag: '@DARREN', accent: '#5effdb' },
      ];
  for (let i = 0; i < stickers.length; i += 1) {
    const sticker = stickers[i]!;
    drawTitleSticker(
      sticker.x,
      sticker.y,
      sticker.w,
      sticker.h,
      sticker.rot + Math.sin(t * 0.8 + i) * 0.012,
      sticker.lines,
      sticker.tag,
      sticker.accent,
      i,
      sticker.image,
      sticker.imageSide,
    );
  }
}

function drawTitleSticker(
  x: number,
  y: number,
  w: number,
  h: number,
  rot: number,
  lines: readonly string[],
  tag: string,
  accent: string,
  seed: number,
  image?: HTMLImageElement,
  imageSide: 'left' | 'right' | 'center' = 'right',
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha = 0.86;
  ctx.shadowColor = 'rgba(0,0,0,0.72)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 8;

  ctx.fillStyle = 'rgba(10,10,10,0.9)';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.2;
  roundedRect(-w / 2, -h / 2, w, h, 4);
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = 'rgba(255,245,216,0.34)';
  ctx.fillRect(-w * 0.28, -h / 2 - 5, w * 0.18, 9);
  ctx.fillRect(w * 0.11, h / 2 - 4, w * 0.2, 8);

  ctx.globalCompositeOperation = 'screen';
  ctx.strokeStyle = 'rgba(255,216,74,0.18)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 4; i += 1) {
    const yy = -h / 2 + 11 + i * 10 + ((seed + i) % 2) * 1.5;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 9, yy);
    ctx.lineTo(w / 2 - 9, yy + Math.sin(seed + i) * 2.4);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';

  const hasImage = Boolean(image?.complete && image.naturalWidth > 0);
  if (hasImage && image) {
    const imageSize = Math.min(h * 0.72, imageSide === 'center' ? w * 0.34 : w * 0.3);
    const imageX = imageSide === 'left'
      ? -w / 2 + imageSize * 0.72
      : imageSide === 'center'
        ? -w * 0.24
        : w / 2 - imageSize * 0.72;
    const imageY = -h * 0.08;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(imageX, imageY, imageSize * 0.58, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.drawImage(image, imageX - imageSize / 2, imageY - imageSize / 2, imageSize, imageSize);
  }

  const textX = hasImage
    ? imageSide === 'left'
      ? w * 0.16
      : imageSide === 'center'
        ? w * 0.18
        : -w * 0.15
    : 0;
  const textMax = hasImage ? w * 0.58 : w * 0.84;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = accent;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 8;
  ctx.font = `950 ${Math.max(13, h * 0.31)}px ${FONT_DISPLAY}`;
  fitCanvasText(lines[0] ?? '$600B', textX, -h * 0.12, textMax);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,245,216,0.88)';
  ctx.font = `900 ${Math.max(7, h * 0.18)}px ${FONT_MONO}`;
  fitCanvasText(lines[1] ?? 'MEME RELAY', textX, h * 0.19, textMax);

  ctx.fillStyle = 'rgba(13,13,13,0.92)';
  ctx.fillRect(-w / 2, h / 2 - 15, w, 15);
  ctx.fillStyle = 'rgba(255,245,216,0.58)';
  ctx.font = `800 ${Math.max(5.8, h * 0.12)}px ${FONT_MONO}`;
  ctx.textAlign = 'left';
  ctx.fillText(tag, -w / 2 + 8, h / 2 - 7);
  ctx.textAlign = 'right';
  ctx.fillText('6/27/26', w / 2 - 8, h / 2 - 7);
  ctx.restore();
}

function fitCanvasText(text: string, x: number, y: number, maxWidth: number): void {
  const measured = ctx.measureText(text).width;
  if (measured <= maxWidth || measured <= 0) {
    ctx.fillText(text, x, y);
    return;
  }
  const scale = Math.max(0.52, maxWidth / measured);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function drawTitleLoadout(viewport: VisibleCanvasRect, t: number, meshMode: boolean): TitleMenuLayout {
  const layout = titleMenuLayout(viewport);
  const compact = usePortraitHud(viewport);
  drawTitleValuePanel(layout.valuePanel, layout.valueButtons, compact);
  drawTitleAuthDock(layout, t, compact);
  drawTitleSectionLabel('CHOOSE YOUR SHIP', titleMenuField === 'ship' ? 'LEFT / RIGHT' : 'TOP TO PLAY', layout.shipCard, layout.shipLabelY, titleMenuField === 'ship', compact, true);
  drawTitleChoiceCard(layout.shipCard, t, compact, meshMode);
  drawTitleArrow(layout.shipPrev, titleMenuField === 'ship', compact);
  drawTitleArrow(layout.shipNext, titleMenuField === 'ship', compact);
  drawTitleSectionLabel('CHOOSE PRESSURE', titleMenuField === 'pressure' ? 'LEFT / RIGHT' : 'DOWN TO PLAY', layout.pressureCard, layout.pressureLabelY, titleMenuField === 'pressure', compact);
  drawTitleChoiceCard(layout.pressureCard, t, compact, meshMode);
  drawTitleArrow(layout.pressurePrev, titleMenuField === 'pressure', compact);
  drawTitleArrow(layout.pressureNext, titleMenuField === 'pressure', compact);
  drawTitleStartButton(layout.startButton, t, compact, titleMenuField === 'start');
  drawTitleDailyButton(layout.dailyButton, t, compact, titleMenuField === 'daily');
  return layout;
}

// The daily gauntlet toggle: an outline pill that lights up gold when armed.
// Arming locks the loadout (interceptor / NORMAL) and seeds the day's run.
function drawTitleDailyButton(button: TitleMenuButton, t: number, compact: boolean, active: boolean): void {
  const pulse = 0.5 + Math.sin(t * 4.8) * 0.5;
  const accent = '#ffd84a';
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = dailyArmed
    ? colourWithAlpha(accent, 0.3 + pulse * 0.08)
    : colourWithAlpha(accent, active ? 0.12 : 0.05);
  ctx.strokeStyle = dailyArmed ? accent : colourWithAlpha(accent, active ? 0.9 : 0.5);
  ctx.lineWidth = active || dailyArmed ? 2 : 1.2;
  if (dailyArmed || active) {
    ctx.shadowColor = accent;
    ctx.shadowBlur = dailyArmed ? 14 + pulse * 7 : 8;
  }
  roundedRect(button.x, button.y, button.w, button.h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = dailyArmed ? '#fff5d8' : colourWithAlpha('#fff5d8', 0.82);
  ctx.font = `950 ${compact ? 10 : 12}px ${FONT_DISPLAY}`;
  fitCanvasText('DAILY', button.x + button.w / 2, button.y + button.h * 0.34, button.w - 14);
  ctx.fillStyle = colourWithAlpha(dailyArmed ? '#fff5d8' : '#ffd84a', 0.72);
  ctx.font = `850 ${compact ? 5 : 6}px ${FONT_MONO}`;
  fitCanvasText(dailyArmed ? 'ARMED · SHARED SEED' : 'ONE RUN · ONE BOARD', button.x + button.w / 2, button.y + button.h * 0.68, button.w - 12);
  ctx.restore();
}

function toggleDailyGauntlet(): void {
  dailyArmed = !dailyArmed;
  playAudio('lock', dailyArmed ? 0.62 : 0.4);
  titleStatus = dailyArmed
    ? `DAILY GAUNTLET ${dailyStamp()} · SAME SEED FOR EVERYONE · INTERCEPTOR / NORMAL`
    : titleReadyStatus();
}

function titleMenuLayout(viewport: VisibleCanvasRect = visibleCanvasRect()): TitleMenuLayout {
  const portrait = usePortraitHud(viewport);
  const cx = portrait ? viewport.centerX : VIEW_W / 2;
  const arrowW = portrait ? 34 : 44;
  const arrowGap = portrait ? 7 : 10;
  const railPad = portrait ? 8 : 28;
  const maxCardW = Math.max(portrait ? 236 : 450, viewport.w - 2 * (arrowW + arrowGap) - railPad * 2);
  const cardW = portrait
    ? Math.min(318, maxCardW)
    : Math.min(680, maxCardW);
  const shipH = portrait ? 124 : 152;
  const pressureH = portrait ? 96 : 90;
  const valueH = portrait ? 74 : 72;
  // Portrait anchors the whole column to the auth dock, which itself sits
  // below the device safe area — on notched iPhones the status bar used to
  // overlap GUEST/NOSTR and the column overflowed into the home indicator.
  const authTop = viewport.y + (portrait ? Math.max(14, viewport.safeTop + 6) : 20);
  const minShipY = portrait ? authTop + 142 : 226;
  let shipY = portrait ? authTop + 150 : 246;
  let pressureY = shipY + shipH + (portrait ? 28 : 34);
  const startH = portrait ? 44 : 48;
  let startY = pressureY + pressureH + (portrait ? 20 : 20);
  let valueY = startY + startH + (portrait ? 14 : 14);
  let hintY = valueY + valueH + (portrait ? 16 : 22);
  const bottomLimit = viewport.y + viewport.h - (portrait ? Math.max(26, viewport.safeBottom + 10) : 36);
  const shift = Math.min(Math.max(0, hintY + (portrait ? 8 : 22) - bottomLimit), Math.max(0, shipY - minShipY));
  if (shift > 0) {
    shipY -= shift;
    pressureY -= shift;
    valueY -= shift;
    startY -= shift;
    hintY -= shift;
  }
  const railW = cardW + 2 * (arrowW + arrowGap);
  const railX = clampWithinVisible(cx - railW / 2, railW, viewport, railPad);
  const cardX = railX + arrowW + arrowGap;
  const leftArrowX = railX;
  const rightArrowX = cardX + cardW + arrowGap;
  const shipArrowH = portrait ? 58 : 66;
  const pressureArrowH = portrait ? 54 : 62;
  const authPad = portrait ? 16 : 24;
  const authGap = portrait ? 5 : 6;
  const authH = portrait ? 40 : 42;
  const signedIn = !!activeNostrSession();
  const authDockW = signedIn
    ? (portrait ? Math.min(viewport.w - authPad * 2, 328) : 480)
    : (portrait ? Math.min(viewport.w - authPad * 2, 300) : 340);
  const authX = clampWithinVisible(cx - authDockW / 2, authDockW, viewport, authPad);
  const authY = authTop;
  const authDock = { x: authX, y: authY, w: authDockW, h: authH };
  const inner = portrait ? 4 : 5;
  const buttonY = authY + inner;
  const buttonH = authH - inner * 2;
  let authCursor = authX + inner;
  const guestW = signedIn ? (portrait ? 64 : 84) : (authDockW - inner * 2 - authGap) / 2;
  const logoutW = signedIn ? (portrait ? 78 : 100) : 0;
  const loginW = signedIn
    ? authDockW - inner * 2 - authGap * 2 - guestW - logoutW
    : (authDockW - inner * 2 - authGap) / 2;
  const guestButton: TitleMenuButton = { action: 'guest', label: 'GUEST', x: authCursor, y: buttonY, w: guestW, h: buttonH };
  authCursor += guestW + authGap;
  const loginButton: TitleMenuButton = { action: 'login', label: signedIn ? 'NOSTR' : 'NOSTR', x: authCursor, y: buttonY, w: loginW, h: buttonH };
  authCursor += loginW + authGap;
  const logoutButton: TitleMenuButton | null = signedIn
    ? { action: 'logout', label: 'SIGN OUT', x: authCursor, y: buttonY, w: logoutW, h: buttonH }
    : null;
  let identityChip: TitleMenuLayout['identityChip'] = null;
  const valuePanel = {
    x: cardX,
    y: valueY,
    w: cardW,
    h: valueH,
  };
  const valueButtons = titleValueButtons(valuePanel, portrait);
  // START and the DAILY gauntlet toggle share a centred row.
  const startW = portrait ? Math.min(200, cardW * 0.58) : Math.min(300, cardW * 0.46);
  const dailyW = portrait ? Math.min(92, cardW * 0.28) : Math.min(124, cardW * 0.2);
  const startRowGap = portrait ? 8 : 10;
  const startRowX = cardX + cardW / 2 - (startW + startRowGap + dailyW) / 2;
  const startButton: TitleMenuButton = {
    action: 'start',
    label: dailyArmed ? 'START DAILY' : 'START GAME',
    x: startRowX,
    y: startY,
    w: startW,
    h: startH,
  };
  const dailyButton: TitleMenuButton = {
    action: 'daily',
    label: 'DAILY',
    x: startRowX + startW + startRowGap,
    y: startY,
    w: dailyW,
    h: startH,
  };
  return {
    shipCard: { action: 'ship-card', label: shipSpec(selectedShip).label, ship: selectedShip, x: cardX, y: shipY, w: cardW, h: shipH },
    shipPrev: { action: 'ship-prev', label: '<', x: leftArrowX, y: shipY + shipH / 2 - shipArrowH / 2, w: arrowW, h: shipArrowH },
    shipNext: { action: 'ship-next', label: '>', x: rightArrowX, y: shipY + shipH / 2 - shipArrowH / 2, w: arrowW, h: shipArrowH },
    pressureCard: { action: 'pressure-card', label: skillSpec(selectedSkill).label, skill: selectedSkill, x: cardX, y: pressureY, w: cardW, h: pressureH },
    pressurePrev: { action: 'pressure-prev', label: '<', x: leftArrowX, y: pressureY + pressureH / 2 - pressureArrowH / 2, w: arrowW, h: pressureArrowH },
    pressureNext: { action: 'pressure-next', label: '>', x: rightArrowX, y: pressureY + pressureH / 2 - pressureArrowH / 2, w: arrowW, h: pressureArrowH },
    guestButton,
    loginButton,
    logoutButton,
    startButton,
    dailyButton,
    authDock,
    identityChip,
    valueButtons,
    shipLabelY: shipY - (portrait ? 15 : 18),
    pressureLabelY: pressureY - (portrait ? 15 : 18),
    valuePanel,
    hintY,
  };
}

function titleValueButtons(panel: { x: number; y: number; w: number; h: number }, compact: boolean): TitleMenuButton[] {
  const links = VALUE_FOR_VALUE.links;
  if (links.length === 0) return [];
  const gap = compact ? 5 : 8;
  const buttonH = compact ? 28 : 26;
  const buttonY = panel.y + panel.h - buttonH - 8;
  const totalGap = gap * Math.max(0, links.length - 1);
  const buttonW = (panel.w - (compact ? 20 : 28) - totalGap) / links.length;
  let x = panel.x + (compact ? 10 : 14);
  return links.map(link => {
    const button: TitleMenuButton = {
      action: valueActionForLink(link.id),
      label: titleValueLinkLabel(link.id),
      x,
      y: buttonY,
      w: buttonW,
      h: buttonH,
    };
    x += buttonW + gap;
    return button;
  });
}

function valueActionForLink(id: ValueLinkId): TitleValueField {
  if (id === 'lightning') return 'value-lightning';
  if (id === 'onchain') return 'value-onchain';
  if (id === 'silent') return 'value-silent';
  if (id === 'geyser') return 'value-geyser';
  return 'value-kofi';
}

function titleValueLinkLabel(id: ValueLinkId): string {
  if (id === 'lightning') return 'SATS';
  if (id === 'onchain') return 'BTC';
  if (id === 'silent') return 'SILENT';
  if (id === 'geyser') return 'GEYSER';
  return 'KO-FI';
}

function drawTitleSectionLabel(label: string, hint: string, card: TitleMenuButton, y: number, active: boolean, compact: boolean, hero = false): void {
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = hero ? 'center' : 'left';
  ctx.fillStyle = active ? '#5effdb' : 'rgba(255,245,216,0.68)';
  ctx.shadowColor = active ? '#5effdb' : 'transparent';
  ctx.shadowBlur = active ? (hero ? 12 : 7) : 0;
  ctx.font = `950 ${hero ? (compact ? 12 : 19) : (compact ? 8 : 11)}px ${hero ? FONT_DISPLAY : FONT_MONO}`;
  fitCanvasText(label, hero ? card.x + card.w / 2 : card.x, y, hero ? card.w - 20 : card.w * 0.62);
  ctx.shadowBlur = 0;
  ctx.textAlign = 'right';
  ctx.fillStyle = active ? 'rgba(94,255,219,0.78)' : 'rgba(255,245,216,0.42)';
  ctx.font = `800 ${compact ? 6.2 : 8.5}px ${FONT_MONO}`;
  if (!hero) ctx.fillText(hint, card.x + card.w, y);
  ctx.restore();
}

function drawTitleChoiceCard(button: TitleMenuButton, t: number, compact: boolean, meshMode: boolean): void {
  if (button.action === 'pressure-card') {
    drawTitlePressureCard(button, t, compact);
    return;
  }
  const shipMode = button.action === 'ship-card';
  const active = shipMode ? titleMenuField === 'ship' : titleMenuField === 'pressure';
  const accent = shipMode ? titleShipAccent(button.ship ?? selectedShip) : titlePressureAccent(button.skill ?? selectedSkill);
  const copy = shipMode ? titleShipCopy(button.ship ?? selectedShip) : titlePressureCopy(button.skill ?? selectedSkill);
  const pulse = active ? 0.5 + Math.sin(t * 5.4) * 0.5 : 0;
  ctx.save();
  ctx.fillStyle = active ? colourWithAlpha(accent, 0.2) : 'rgba(2,4,11,0.7)';
  ctx.strokeStyle = active ? accent : 'rgba(255,245,216,0.24)';
  ctx.lineWidth = active ? 1.8 : 1;
  ctx.shadowColor = active ? accent : 'transparent';
  ctx.shadowBlur = active ? 10 + pulse * 7 : 0;
  roundedRect(button.x, button.y, button.w, button.h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  roundedRect(button.x + 1, button.y + 1, button.w - 2, button.h - 2, 5);
  ctx.clip();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const textCenterX = shipMode
    ? button.x + button.w / 2
    : button.x + button.w * (compact ? 0.64 : 0.56);
  const textMax = shipMode
    ? button.w - (compact ? 52 : 84)
    : button.w * (compact ? 0.48 : 0.52);
  ctx.fillStyle = '#fff5d8';
  ctx.font = `950 ${shipMode ? (compact ? 19 : 28) : (compact ? 13 : 18)}px ${FONT_DISPLAY}`;
  fitCanvasText(button.label, textCenterX, button.y + (shipMode ? (compact ? 25 : 32) : (compact ? 20 : 24)), textMax);
  ctx.fillStyle = accent;
  ctx.font = `900 ${shipMode ? (compact ? 8.2 : 12) : (compact ? 6.6 : 9)}px ${FONT_MONO}`;
  fitCanvasText(copy.summary, textCenterX, button.y + (shipMode ? (compact ? 47 : 58) : (compact ? 36 : 43)), textMax);
  ctx.fillStyle = 'rgba(255,245,216,0.64)';
  ctx.font = `800 ${shipMode ? (compact ? 6.7 : 9.2) : (compact ? 5.8 : 8)}px ${FONT_MONO}`;
  fitCanvasText(copy.detail, textCenterX, button.y + (shipMode ? (compact ? 62 : 75) : (compact ? 48 : 57)), textMax);

  if (shipMode) {
    if (!meshMode) drawTitleShipPreview(button.ship ?? selectedShip, button, t, compact);
  } else {
    drawTitlePressureGlyph(button.skill ?? selectedSkill, button, t, compact);
  }

  const stats = shipMode ? titleShipStats(button.ship ?? selectedShip) : titlePressureStats(button.skill ?? selectedSkill);
  const statsX = shipMode
    ? button.x + button.w * (compact ? 0.46 : 0.45)
    : button.x + button.w * (compact ? 0.52 : 0.46);
  const statsY = button.y + (compact ? (shipMode ? 65 : 58) : (shipMode ? 70 : 64));
  const statsTop = shipMode ? button.y + (compact ? 79 : 96) : statsY;
  const statsW = button.x + button.w - statsX - (compact ? 20 : 34);
  drawTitleStatRows(stats, statsX, statsTop, statsW, accent, compact);
  ctx.restore();
}

function drawTitleShipPreview(shipClass: ShipClass, button: TitleMenuButton, t: number, compact: boolean): void {
  const x = compact ? button.x + button.w * 0.23 : button.x + button.w * 0.23;
  const y = button.y + button.h * (compact ? 0.76 : 0.74);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = titleShipAccent(shipClass);
  ctx.beginPath();
  ctx.ellipse(x, y + (compact ? 25 : 33), compact ? 64 : 96, compact ? 14 : 20, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  drawShipSprite({
    ctx,
    shipClass,
    x,
    y,
    dir: 1,
    scale: compact ? 0.56 : 0.78,
    bank: Math.sin(t * 1.8) * 0.45,
    turn: titleMenuField === 'ship' ? 0.42 : 0.18,
    thrust: titleMenuField === 'ship' ? 0.55 : 0.28,
    heat: 0.08,
    t,
  });
}

function drawTitlePressureCard(button: TitleMenuButton, t: number, compact: boolean): void {
  const selected = button.skill ?? selectedSkill;
  const active = titleMenuField === 'pressure';
  const accent = titlePressureAccent(selected);
  const copy = titlePressureCopy(selected);
  const pulse = active ? 0.5 + Math.sin(t * 5.4) * 0.5 : 0;
  ctx.save();
  ctx.fillStyle = active ? colourWithAlpha(accent, 0.18) : 'rgba(2,4,11,0.68)';
  ctx.strokeStyle = active ? accent : 'rgba(255,245,216,0.24)';
  ctx.lineWidth = active ? 1.7 : 1;
  ctx.shadowColor = active ? accent : 'transparent';
  ctx.shadowBlur = active ? 9 + pulse * 6 : 0;
  roundedRect(button.x, button.y, button.w, button.h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff5d8';
  ctx.font = `950 ${compact ? 17 : 22}px ${FONT_DISPLAY}`;
  fitCanvasText(skillSpec(selected).label, button.x + button.w / 2, button.y + (compact ? 19 : 22), button.w - 40);
  ctx.fillStyle = accent;
  ctx.font = `900 ${compact ? 6.5 : 8.2}px ${FONT_MONO}`;
  fitCanvasText(`${copy.summary} · ${copy.detail}`, button.x + button.w / 2, button.y + (compact ? 38 : 43), button.w - 42);

  const margin = compact ? 13 : 18;
  const gap = compact ? 6 : 8;
  const pillY = button.y + (compact ? 57 : 55);
  const pillH = compact ? 26 : 28;
  const pillW = (button.w - margin * 2 - gap * (SKILLS.length - 1)) / SKILLS.length;
  for (let i = 0; i < SKILLS.length; i += 1) {
    const spec = SKILLS[i]!;
    const rect = titlePressureChoiceRects(button, compact)[i]!;
    drawTitlePressurePill(spec, rect.x, rect.y, rect.w, rect.h, spec.id === selected, compact);
  }
  ctx.restore();
}

function drawTitlePressurePill(spec: SkillSpec, x: number, y: number, w: number, h: number, selected: boolean, compact: boolean): void {
  const accent = titlePressureAccent(spec.id);
  ctx.save();
  ctx.fillStyle = selected ? colourWithAlpha(accent, 0.86) : 'rgba(255,245,216,0.06)';
  ctx.strokeStyle = selected ? accent : 'rgba(255,245,216,0.22)';
  ctx.lineWidth = selected ? 1.4 : 1;
  ctx.shadowColor = selected ? accent : 'transparent';
  ctx.shadowBlur = selected ? 8 : 0;
  roundedRect(x, y, w, h, 5);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = selected ? '#02040b' : 'rgba(255,245,216,0.78)';
  ctx.font = `950 ${compact ? 8.2 : 10}px ${FONT_DISPLAY}`;
  fitCanvasText(spec.label, x + w / 2, y + h / 2 - (compact ? 3 : 4), w - 8);
  ctx.fillStyle = selected ? 'rgba(2,4,11,0.74)' : colourWithAlpha(accent, 0.72);
  ctx.font = `850 ${compact ? 4.8 : 5.8}px ${FONT_MONO}`;
  fitCanvasText(`${formatClock(spec.startTime)} CLOCK`, x + w / 2, y + h / 2 + (compact ? 8 : 9), w - 8);
  ctx.restore();
}

function drawTitlePressureGlyph(skill: Skill, button: TitleMenuButton, t: number, compact: boolean): void {
  const accent = titlePressureAccent(skill);
  const spec = skillSpec(skill);
  const x = compact ? button.x + button.w * 0.2 : button.x + button.w * 0.22;
  const y = button.y + (compact ? 74 : 75);
  const r = compact ? 24 : 32;
  const pressure = clamp((spec.spawnScale + spec.enemySpeed - 1.2) / 0.78, 0, 1);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.strokeStyle = colourWithAlpha(accent, 0.32);
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.arc(x, y, r - i * 9 + Math.sin(t * 2.4 + i) * 1.8, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = accent;
  ctx.lineWidth = compact ? 4 : 5;
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pressure);
  ctx.stroke();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 12;
  ctx.fillStyle = colourWithAlpha(accent, 0.18);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.68, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff5d8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `950 ${compact ? 15 : 18}px ${FONT_DISPLAY}`;
  ctx.fillText(spec.label, x, y + 1);
  ctx.restore();
}

function drawTitleStatRows(rows: Array<{ label: string; value: string; metric: number }>, x: number, y: number, w: number, accent: string, compact: boolean): void {
  const gap = compact ? 10 : 11.4;
  const barY = compact ? 3.8 : 4.6;
  const barH = compact ? 2.4 : 3;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const yy = y + i * gap;
    const valueW = Math.min(compact ? 54 : 76, Math.max(36, w * 0.38));
    const labelW = Math.max(52, w - valueW - 8);
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,245,216,0.54)';
    ctx.font = `800 ${compact ? 5.6 : 7.2}px ${FONT_MONO}`;
    fitCanvasText(row.label, x, yy, labelW);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff5d8';
    ctx.font = `900 ${compact ? 5.8 : 7.4}px ${FONT_MONO}`;
    fitCanvasText(row.value, x + w, yy, valueW);
    ctx.fillStyle = 'rgba(255,245,216,0.13)';
    ctx.fillRect(x, yy + barY, w, barH);
    ctx.fillStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = compact ? 4 : 6;
    ctx.fillRect(x, yy + barY, w * clamp(row.metric, 0.06, 1), barH);
    ctx.restore();
  }
}

function drawTitleArrow(button: TitleMenuButton, active: boolean, compact: boolean): void {
  ctx.save();
  ctx.fillStyle = active ? 'rgba(2,4,11,0.82)' : 'rgba(2,4,11,0.5)';
  ctx.strokeStyle = active ? 'rgba(94,255,219,0.74)' : 'rgba(255,245,216,0.2)';
  ctx.lineWidth = active ? 1.4 : 1;
  ctx.shadowColor = active ? 'rgba(94,255,219,0.52)' : 'transparent';
  ctx.shadowBlur = active ? 10 : 0;
  roundedRect(button.x, button.y, button.w, button.h, compact ? 5 : 6);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = active ? 'rgba(255,245,216,0.92)' : 'rgba(255,245,216,0.3)';
  ctx.shadowColor = active ? '#5effdb' : 'transparent';
  ctx.shadowBlur = active ? 6 : 0;
  ctx.font = `950 ${compact ? 22 : 28}px ${FONT_MONO}`;
  ctx.fillText(button.label, button.x + button.w / 2, button.y + button.h / 2);
  ctx.restore();
}

function drawTitleValuePanel(panel: { x: number; y: number; w: number; h: number }, buttons: readonly TitleMenuButton[], compact: boolean): void {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(1,4,10,0.82)';
  ctx.strokeStyle = 'rgba(255,216,74,0.72)';
  ctx.lineWidth = compact ? 1.1 : 1.3;
  ctx.shadowColor = 'rgba(255,216,74,0.24)';
  ctx.shadowBlur = compact ? 9 : 14;
  roundedRect(panel.x, panel.y, panel.w, panel.h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffd84a';
  ctx.shadowColor = '#ffd84a';
  ctx.shadowBlur = compact ? 6 : 9;
  ctx.font = `950 ${compact ? 12 : 15}px ${FONT_DISPLAY}`;
  fitCanvasText('VALUE FOR VALUE', panel.x + panel.w / 2, panel.y + (compact ? 12 : 14), panel.w - 24);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,245,216,0.76)';
  ctx.font = `850 ${compact ? 6.1 : 8.2}px ${FONT_MONO}`;
  fitCanvasText(titleValuePanelLine(compact), panel.x + panel.w / 2, panel.y + (compact ? 28 : 30), panel.w - 26);
  for (const button of buttons) drawTitleValueButton(button, compact, titleMenuField === button.action);
  ctx.restore();
}

function titleValuePanelLine(compact: boolean): string {
  if (titleValueStatus) return titleValueStatus;
  if (titleMenuField === 'value-lightning') return compact ? 'ENTER SHOWS SATS QR' : 'ENTER SHOWS QR + LIGHTNING ADDRESS';
  if (titleMenuField === 'value-onchain') return compact ? 'ENTER SHOWS BTC QR' : 'ENTER SHOWS QR + BITCOIN ADDRESS';
  if (titleMenuField === 'value-silent') return compact ? 'ENTER SHOWS SILENT QR' : 'ENTER SHOWS QR + SILENT PAYMENT CODE';
  if (titleMenuField === 'value-geyser') return 'ENTER OPENS GEYSER · COPIES LINK';
  if (titleMenuField === 'value-kofi') return 'ENTER OPENS KO-FI · COPIES LINK';
  return compact ? 'GOT VALUE? GIVE BACK.' : 'PLAY FREE. IF THIS GIVES VALUE, GIVE BACK.';
}

function drawTitleValueButton(button: TitleMenuButton, compact: boolean, active: boolean): void {
  // Outline style keeps START GAME as the only solid-gold call to action on the title.
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = active ? colourWithAlpha('#ffd84a', 0.88) : 'rgba(255,216,74,0.08)';
  ctx.strokeStyle = active ? '#ffd84a' : 'rgba(255,216,74,0.62)';
  ctx.lineWidth = active ? 1.8 : 1.1;
  ctx.shadowColor = active ? '#ffd84a' : 'transparent';
  ctx.shadowBlur = active ? (compact ? 12 : 16) : 0;
  roundedRect(button.x, button.y, button.w, button.h, 4);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = active ? '#02040b' : 'rgba(255,232,150,0.92)';
  ctx.font = `950 ${compact ? 9 : 12}px ${FONT_DISPLAY}`;
  fitCanvasText(button.label, button.x + button.w / 2, button.y + button.h / 2 + 1, button.w - 10);
  ctx.restore();
}

function titlePaymentModalLayout(viewport: VisibleCanvasRect = visibleCanvasRect()): {
  panel: { x: number; y: number; w: number; h: number };
  qr: { x: number; y: number; size: number };
  copyButton: TitlePaymentButton;
  closeButton: TitlePaymentButton;
  textX: number;
  textY: number;
  textW: number;
  portrait: boolean;
} {
  const portrait = usePortraitHud(viewport);
  const cx = portrait ? viewport.centerX : VIEW_W / 2;
  const panelW = portrait ? Math.min(354, Math.max(300, viewport.w - 24)) : Math.min(720, viewport.w - 86);
  const panelH = portrait ? 424 : 420;
  const panelX = clampWithinVisible(cx - panelW / 2, panelW, viewport, portrait ? 12 : 42);
  const panelY = clamp(viewport.centerY - panelH / 2 + (portrait ? 12 : 20), viewport.y + 78, viewport.y + viewport.h - panelH - 22);
  const qrSize = portrait ? 150 : 220;
  const qrX = portrait ? panelX + panelW / 2 - qrSize / 2 : panelX + 34;
  const qrY = portrait ? panelY + 92 : panelY + 114;
  const textX = portrait ? panelX + 24 : qrX + qrSize + 34;
  const textY = portrait ? qrY + qrSize + 24 : panelY + 116;
  const textW = portrait ? panelW - 48 : panelX + panelW - textX - 34;
  const buttonGap = portrait ? 10 : 14;
  const buttonH = portrait ? 38 : 42;
  const buttonY = panelY + panelH - buttonH - 24;
  const buttonW = (panelW - (portrait ? 48 : 68) - buttonGap) / 2;
  const copyButton = {
    action: 'copy' as const,
    label: portrait ? 'COPY' : 'COPY ADDRESS',
    x: panelX + (portrait ? 24 : 34),
    y: buttonY,
    w: buttonW,
    h: buttonH,
  };
  const closeButton = {
    action: 'close' as const,
    label: 'CLOSE',
    x: copyButton.x + buttonW + buttonGap,
    y: buttonY,
    w: buttonW,
    h: buttonH,
  };
  return {
    panel: { x: panelX, y: panelY, w: panelW, h: panelH },
    qr: { x: qrX, y: qrY, size: qrSize },
    copyButton,
    closeButton,
    textX,
    textY,
    textW,
    portrait,
  };
}

function drawTitlePaymentModal(viewport: VisibleCanvasRect, t: number): void {
  const method = activeSupportMethod(titlePaymentMethod);
  const qr = method ? getValueForValueQrCanvas(method.qrValue) : null;
  if (!VALUE_FOR_VALUE.configured || !method || !qr) return;
  const layout = titlePaymentModalLayout(viewport);
  const { panel, portrait } = layout;
  const pulse = 0.5 + Math.sin(t * 4.6) * 0.5;

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(0,2,8,0.68)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  ctx.fillStyle = 'rgba(1,4,10,0.96)';
  ctx.strokeStyle = `rgba(255,216,74,${(0.78 + pulse * 0.18).toFixed(3)})`;
  ctx.lineWidth = portrait ? 1.5 : 1.8;
  ctx.shadowColor = 'rgba(255,216,74,0.52)';
  ctx.shadowBlur = portrait ? 20 : 30;
  roundedRect(panel.x, panel.y, panel.w, panel.h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffd84a';
  ctx.shadowColor = '#ffd84a';
  ctx.shadowBlur = portrait ? 14 : 22;
  ctx.font = `950 ${portrait ? 32 : 52}px ${FONT_DISPLAY}`;
  fitCanvasText('VALUE MY TIME', panel.x + panel.w / 2, panel.y + (portrait ? 20 : 18), panel.w - 34);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,245,216,0.84)';
  ctx.font = `900 ${portrait ? 7.2 : 10}px ${FONT_MONO}`;
  fitCanvasText(`SCAN THE QR OR COPY THE ${method.addressLabel}`, panel.x + panel.w / 2, panel.y + (portrait ? 62 : 78), panel.w - 40);

  ctx.drawImage(qr, layout.qr.x, layout.qr.y, layout.qr.size, layout.qr.size);
  ctx.strokeStyle = 'rgba(255,245,216,0.58)';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(layout.qr.x - 1, layout.qr.y - 1, layout.qr.size + 2, layout.qr.size + 2);

  ctx.textAlign = portrait ? 'center' : 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#5effdb';
  ctx.font = `950 ${portrait ? 9 : 13}px ${FONT_DISPLAY}`;
  fitCanvasText(method.addressLabel, portrait ? panel.x + panel.w / 2 : layout.textX, layout.textY, layout.textW);
  ctx.fillStyle = 'rgba(255,245,216,0.94)';
  ctx.font = `900 ${portrait ? 9 : 13}px ${FONT_MONO}`;
  const addressLines = splitPaymentDisplay(method.display, Math.max(12, Math.floor(layout.textW / (portrait ? 6.2 : 7.2))));
  for (let i = 0; i < Math.min(3, addressLines.length); i += 1) {
    fitCanvasText(addressLines[i]!, portrait ? panel.x + panel.w / 2 : layout.textX, layout.textY + (portrait ? 23 : 30) + i * (portrait ? 13 : 18), layout.textW);
  }
  ctx.fillStyle = titleValueStatus.includes('COPIED') ? '#8cffb4' : 'rgba(255,245,216,0.64)';
  ctx.font = `850 ${portrait ? 6.4 : 8.2}px ${FONT_MONO}`;
  fitCanvasText(titleValueStatus || 'ENTER COPIES · ESC CLOSES', portrait ? panel.x + panel.w / 2 : layout.textX, layout.copyButton.y - (portrait ? 25 : 30), layout.textW);

  drawTitlePaymentButton(layout.copyButton, titlePaymentAction === 'copy', portrait);
  drawTitlePaymentButton(layout.closeButton, titlePaymentAction === 'close', portrait);
  ctx.restore();
}

function drawTitlePaymentButton(button: TitlePaymentButton, active: boolean, compact: boolean): void {
  const accent = button.action === 'copy' ? '#ffd84a' : '#5effdb';
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = active ? colourWithAlpha(accent, 0.86) : 'rgba(255,245,216,0.07)';
  ctx.strokeStyle = active ? accent : 'rgba(255,245,216,0.32)';
  ctx.lineWidth = active ? 1.8 : 1.1;
  ctx.shadowColor = active ? accent : 'transparent';
  ctx.shadowBlur = active ? (compact ? 12 : 16) : 0;
  roundedRect(button.x, button.y, button.w, button.h, 5);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = active ? '#02040b' : 'rgba(255,245,216,0.84)';
  ctx.font = `950 ${compact ? 10 : 13}px ${FONT_DISPLAY}`;
  fitCanvasText(button.label, button.x + button.w / 2, button.y + button.h / 2 + 1, button.w - 14);
  ctx.restore();
}

function titleLaunchDisplayProgress(now = performance.now()): number {
  if (!titleStartInFlight) return 0;
  if (titleStartFinalStartedAt > 0) {
    const u = clamp((now - titleStartFinalStartedAt) / 160, 0, 1);
    const eased = 1 - Math.pow(1 - u, 3);
    titleStartDisplayProgress = titleStartFinalFrom + (1 - titleStartFinalFrom) * eased;
    return clamp(titleStartDisplayProgress, 0, 1);
  }
  const elapsed = Math.max(0, now - titleStartStartedAt);
  const waitingCap = 0.84;
  const timeFloor = clamp((elapsed / 620) * waitingCap, 0, waitingCap);
  const target = clamp(Math.max(titleStartProgress, timeFloor), 0, waitingCap);
  const last = titleStartDisplayUpdatedAt || now;
  const dt = clamp((now - last) / 1000, 0, 0.08);
  titleStartDisplayUpdatedAt = now;
  const rate = 8.5;
  titleStartDisplayProgress += (target - titleStartDisplayProgress) * (1 - Math.exp(-rate * dt));
  return clamp(titleStartDisplayProgress, 0, 1);
}

function drawTitleLaunchBar(button: TitleMenuButton, progress: number, t: number, compact: boolean): void {
  const x = button.x + (compact ? 10 : 12);
  const w = button.w - (compact ? 20 : 24);
  const h = compact ? 10 : 12;
  const y = button.y + button.h - h - (compact ? 6 : 7);
  const fillW = Math.max(0, Math.min(w, w * progress));
  ctx.save();
  roundedRect(x, y, w, h, 5);
  ctx.fillStyle = 'rgba(1,4,10,0.76)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,245,216,0.32)';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (fillW > 0.5) {
    ctx.save();
    roundedRect(x, y, w, h, 5);
    ctx.clip();
    const rainbow = ctx.createLinearGradient(x, y, x + w, y);
    rainbow.addColorStop(0, '#ff4d8d');
    rainbow.addColorStop(0.18, '#ff8a3a');
    rainbow.addColorStop(0.34, '#ffd84a');
    rainbow.addColorStop(0.52, '#8cffb4');
    rainbow.addColorStop(0.68, '#5effdb');
    rainbow.addColorStop(0.84, '#5f7cff');
    rainbow.addColorStop(1, '#ff4dff');
    ctx.fillStyle = rainbow;
    ctx.shadowColor = '#fff5d8';
    ctx.shadowBlur = compact ? 7 : 10;
    ctx.fillRect(x, y, fillW, h);
    const sheenX = x + ((t * 110) % (w + 48)) - 48;
    const sheen = ctx.createLinearGradient(sheenX, y, sheenX + 48, y);
    sheen.addColorStop(0, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0.48)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(Math.max(x, sheenX), y, Math.min(fillW, 48), h);
    ctx.restore();
  }

  const percent = `${Math.round(progress * 100).toString().padStart(3, '0')}%`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `950 ${compact ? 6.2 : 8}px ${FONT_MONO}`;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(2,4,11,0.82)';
  ctx.strokeText(percent, x + w / 2, y + h / 2 + 0.5);
  ctx.fillStyle = '#fffdf4';
  fitCanvasText(percent, x + w / 2, y + h / 2 + 0.5, w - 12);
  ctx.restore();
}

function drawTitleStartButton(button: TitleMenuButton, t: number, compact: boolean, active: boolean): void {
  const nostr = !!activeNostrSession();
  const accent = nostr ? '#5effdb' : '#ffd84a';
  const pulse = 0.5 + Math.sin(t * 4.8) * 0.5;
  const launchProgress = titleLaunchDisplayProgress();
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colourWithAlpha(accent, active ? 0.28 + pulse * 0.06 : 0.18 + pulse * 0.03);
  ctx.strokeStyle = accent;
  ctx.lineWidth = active ? 2 : 1.5;
  ctx.shadowColor = accent;
  ctx.shadowBlur = active ? 18 + pulse * 8 : 10 + pulse * 4;
  roundedRect(button.x, button.y, button.w, button.h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff5d8';
  ctx.font = `950 ${compact ? 13 : 17}px ${FONT_DISPLAY}`;
  fitCanvasText(titleStartInFlight ? 'LAUNCHING' : button.label, button.x + button.w / 2, button.y + (titleStartInFlight ? button.h * 0.31 : button.h * 0.42), button.w - 22);
  ctx.fillStyle = colourWithAlpha('#fff5d8', 0.72);
  ctx.font = `850 ${compact ? 5.4 : 6.8}px ${FONT_MONO}`;
  fitCanvasText(titleStartInFlight ? titleStatus : nostr ? 'NOSTR FOLLOWERS' : 'GUEST RUN', button.x + button.w / 2, button.y + (titleStartInFlight ? button.h * 0.55 : button.h * 0.68), button.w - 22);
  if (launchProgress > 0) drawTitleLaunchBar(button, launchProgress, t, compact);
  ctx.restore();
}

function drawTitleAuthDock(layout: TitleMenuLayout, t: number, compact: boolean): void {
  const dock = layout.authDock;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(1,4,10,0.58)';
  ctx.strokeStyle = 'rgba(255,245,216,0.18)';
  ctx.lineWidth = 1;
  ctx.shadowColor = 'rgba(94,255,219,0.12)';
  ctx.shadowBlur = compact ? 10 : 14;
  roundedRect(dock.x, dock.y, dock.w, dock.h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();

  drawTitleActionButton(layout.guestButton, t, compact, titleMenuField === 'guest');
  drawTitleActionButton(layout.loginButton, t, compact, titleMenuField === 'login');
  if (layout.logoutButton) drawTitleActionButton(layout.logoutButton, t, compact, titleMenuField === 'logout');
}

function drawTitleActionButton(button: TitleMenuButton, t: number, compact: boolean, active: boolean): void {
  if (button.action === 'login' && activeNostrSession()) {
    drawTitleNostrIdentityButton(button, t, compact, active);
    return;
  }
  const pulse = 0.5 + Math.sin(t * 4.6) * 0.5;
  const guest = button.action === 'guest';
  const logout = button.action === 'logout';
  const accent = guest ? '#ffd84a' : logout ? '#ff8a3a' : '#5effdb';
  const subline = guest
    ? 'LOCAL'
    : logout
      ? 'SESSION'
      : 'SIGNET';
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colourWithAlpha(accent, active ? 0.23 + pulse * 0.03 : 0.09);
  ctx.strokeStyle = active ? accent : colourWithAlpha(accent, 0.45);
  ctx.lineWidth = active ? 1.6 : 1;
  ctx.shadowColor = accent;
  ctx.shadowBlur = active ? 12 + pulse * 5 : 4;
  roundedRect(button.x, button.y, button.w, button.h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff5d8';
  ctx.font = `950 ${compact ? 11 : 13.5}px ${FONT_DISPLAY}`;
  fitCanvasText(button.label, button.x + button.w / 2, button.y + button.h / 2 - (compact ? 4 : 5), button.w - 12);
  ctx.fillStyle = colourWithAlpha('#fff5d8', logout ? 0.58 : 0.66);
  ctx.font = `850 ${compact ? 5.5 : 6.7}px ${FONT_MONO}`;
  fitCanvasText(subline, button.x + button.w / 2, button.y + button.h / 2 + (compact ? 10 : 11), button.w - 12);
  ctx.restore();
}

function drawTitleNostrIdentityButton(button: TitleMenuButton, t: number, compact: boolean, active: boolean): void {
  const session = activeNostrSession();
  if (!session) return;
  const identity = activePlayerIdentity();
  const image = profileImageForActivePlayer();
  const pulse = 0.5 + Math.sin(t * 4.6) * 0.5;
  const radius = Math.min(button.h * 0.34, compact ? 11 : 13);
  const avatarX = button.x + (compact ? 17 : 19);
  const avatarY = button.y + button.h / 2;
  ctx.save();
  ctx.fillStyle = active ? colourWithAlpha('#5effdb', 0.18 + pulse * 0.03) : 'rgba(94,255,219,0.09)';
  ctx.strokeStyle = active ? '#5effdb' : 'rgba(94,255,219,0.46)';
  ctx.lineWidth = active ? 1.6 : 1;
  ctx.shadowColor = '#5effdb';
  ctx.shadowBlur = active ? 11 + pulse * 4 : 4;
  roundedRect(button.x, button.y, button.w, button.h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();
  if (image) {
    drawProfileImageCircle(image, avatarX, avatarY, radius, '#5effdb', 0.96);
  } else {
    ctx.save();
    ctx.fillStyle = 'rgba(94,255,219,0.16)';
    ctx.strokeStyle = 'rgba(94,255,219,0.72)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff5d8';
    ctx.font = `950 ${compact ? 8 : 9}px ${FONT_DISPLAY}`;
    fitCanvasText(identity.name.slice(0, 2).toUpperCase(), avatarX, avatarY + 1, radius * 1.45);
    ctx.restore();
  }
  const textX = button.x + (compact ? 35 : 40);
  const textW = button.x + button.w - textX - (compact ? 7 : 9);
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff5d8';
  ctx.font = `950 ${compact ? 8.5 : 10.5}px ${FONT_DISPLAY}`;
  fitCanvasText(identity.name.toUpperCase(), textX, button.y + button.h * 0.42, textW);
  ctx.fillStyle = 'rgba(94,255,219,0.72)';
  ctx.font = `800 ${compact ? 5.2 : 6.5}px ${FONT_MONO}`;
  fitCanvasText('KIND 0 · PLAY FOLLOWERS', textX, button.y + button.h * 0.72, textW);
  ctx.restore();
}

function profileImageForActivePlayer(): CanvasImageSource | null {
  const entry = ensureProfileImageEntry(activePlayerProfile?.picture);
  if (entry?.loaded && entry.image) return entry.image;
  return null;
}

function titleMenuButtons(viewport: VisibleCanvasRect = visibleCanvasRect()): TitleMenuButton[] {
  const layout = titleMenuLayout(viewport);
  return [
    layout.shipPrev,
    layout.shipNext,
    layout.pressurePrev,
    layout.pressureNext,
    layout.shipCard,
    layout.pressureCard,
    layout.guestButton,
    layout.loginButton,
    ...(layout.logoutButton ? [layout.logoutButton] : []),
    layout.startButton,
    layout.dailyButton,
    ...layout.valueButtons,
  ];
}

function titleMenuActionAt(x: number, y: number): TitleMenuButton | null {
  for (const button of titleMenuButtons()) {
    if (x >= button.x && x <= button.x + button.w && y >= button.y && y <= button.y + button.h) return button;
  }
  return null;
}

function titlePressureChoiceRects(button: TitleMenuButton, compact: boolean): Array<{ skill: Skill; x: number; y: number; w: number; h: number }> {
  const margin = compact ? 13 : 18;
  const gap = compact ? 6 : 8;
  const pillY = button.y + (compact ? 57 : 55);
  const pillH = compact ? 26 : 28;
  const pillW = (button.w - margin * 2 - gap * (SKILLS.length - 1)) / SKILLS.length;
  return SKILLS.map((spec, i) => ({
    skill: spec.id,
    x: button.x + margin + i * (pillW + gap),
    y: pillY,
    w: pillW,
    h: pillH,
  }));
}

function titlePressureSkillAt(button: TitleMenuButton, x: number, y: number, compact: boolean): Skill | null {
  for (const rect of titlePressureChoiceRects(button, compact)) {
    if (pointInRect(x, y, rect, compact ? 8 : 4)) return rect.skill;
  }
  return null;
}

function pointInRect(
  x: number,
  y: number,
  rect: { x: number; y: number; w: number; h: number },
  pad = 0,
): boolean {
  return x >= rect.x - pad && x <= rect.x + rect.w + pad && y >= rect.y - pad && y <= rect.y + rect.h + pad;
}

function titlePaymentActionAt(x: number, y: number): TitlePaymentAction | 'panel' | 'outside' {
  const layout = titlePaymentModalLayout();
  for (const button of [layout.copyButton, layout.closeButton]) {
    if (x >= button.x && x <= button.x + button.w && y >= button.y && y <= button.y + button.h) return button.action;
  }
  const { panel } = layout;
  if (x >= panel.x && x <= panel.x + panel.w && y >= panel.y && y <= panel.y + panel.h) return 'panel';
  return 'outside';
}

function handleTitlePaymentPointerAction(x: number, y: number): boolean {
  if (!titlePaymentModalOpen) return false;
  const action = titlePaymentActionAt(x, y);
  if (action === 'copy') {
    titlePaymentAction = 'copy';
    copyTitlePaymentTarget();
  } else if (action === 'close' || action === 'outside') {
    closeTitlePaymentModal();
  }
  return true;
}

function handleTitlePointerAction(x: number, y: number): boolean {
  if (handleTitlePaymentPointerAction(x, y)) return true;
  const button = titleMenuActionAt(x, y);
  if (!button) return false;
  if (button.action === 'guest') {
    void startGuestRunFromTitle();
    return true;
  }
  if (button.action === 'login') {
    void startNostrRunFromTitle();
    return true;
  }
  if (button.action === 'logout') {
    void logoutFromTitle();
    return true;
  }
  if (button.action === 'start') {
    void startSelectedRunFromTitle();
    return true;
  }
  if (button.action === 'daily') {
    titleMenuField = 'daily';
    toggleDailyGauntlet();
    return true;
  }
  if (isTitleValueField(button.action)) {
    titleMenuField = button.action;
    activateTitleValueLink(button.action);
    return true;
  }
  if (button.action === 'ship-card') {
    titleMenuField = 'ship';
    playAudio('lock', 0.36);
    return true;
  }
  if (button.action === 'pressure-card') {
    titleMenuField = 'pressure';
    const skill = titlePressureSkillAt(button, x, y, usePortraitHud(visibleCanvasRect()));
    if (skill) selectedSkill = skill;
    playAudio('lock', 0.36);
    return true;
  }
  if (button.action === 'ship-prev' || button.action === 'ship-next') {
    titleMenuField = 'ship';
    cycleTitleMenuChoiceFor('ship', button.action === 'ship-next' ? 1 : -1);
    playAudio('lock', 0.44);
    return true;
  }
  if (button.action === 'pressure-prev' || button.action === 'pressure-next') {
    titleMenuField = 'pressure';
    cycleTitleMenuChoiceFor('pressure', button.action === 'pressure-next' ? 1 : -1);
    playAudio('lock', 0.44);
    return true;
  }
  return false;
}

async function startSelectedRunFromTitle(): Promise<void> {
  titleMenuField = 'start';
  if (activeNostrSession()) {
    await startNostrRunFromTitle();
    return;
  }
  await startGuestRunFromTitle();
}

function activateTitleValueLink(action: TitleValueField): void {
  const id: ValueLinkId = action === 'value-lightning' ? 'lightning'
    : action === 'value-onchain' ? 'onchain'
      : action === 'value-silent' ? 'silent'
        : action === 'value-geyser' ? 'geyser' : 'kofi';
  const link = VALUE_FOR_VALUE.links.find(item => item.id === id);
  if (!link) return;
  playAudio('lock', 0.42);
  if (isSupportQrMethod(id)) {
    openTitlePaymentModal(id);
    return;
  }
  const copyText = valueCopyTextForLink(id, link.href);
  const opened = openTitleValueLink(link.href, id);
  titleValueStatus = `${titleValueLinkLabel(id)} ${opened ? 'TAB OPENED' : 'OPEN BLOCKED'} · COPYING LINK`;
  void copyTitleValueTarget(copyText, id, opened);
}

function openTitlePaymentModal(method: SupportQrMethod = 'lightning'): void {
  titlePaymentMethod = method;
  titlePaymentModalOpen = true;
  titlePaymentAction = 'copy';
  const details = supportMethodDetails(method);
  titleValueStatus = `SCAN QR · COPY ${details?.addressLabel ?? 'ADDRESS'}`;
  titleStatus = titleValueStatus;
}

function closeTitlePaymentModal(): void {
  titlePaymentModalOpen = false;
  titlePaymentAction = 'copy';
  titleValueStatus = '';
  titleStatus = titleReadyStatus();
  playAudio('lock', 0.34);
}

interface SupportMethodDetails {
  qrValue: string;
  display: string;
  addressLabel: string;
  copyText: string;
}

/** QR + copy material for the address-carrying methods. Returns null when the
 *  method has no configured link, so callers can fall back to lightning. */
function supportMethodDetails(method: SupportQrMethod): SupportMethodDetails | null {
  const link = VALUE_FOR_VALUE.links.find(item => item.id === method);
  if (!link) return null;
  if (method === 'onchain') {
    return {
      qrValue: link.href,
      display: VALUE_FOR_VALUE.onchainAddress,
      addressLabel: 'BITCOIN ADDRESS',
      copyText: VALUE_FOR_VALUE.onchainAddress,
    };
  }
  if (method === 'silent') {
    return {
      qrValue: link.href,
      display: link.display,
      addressLabel: 'SILENT PAYMENT CODE',
      copyText: link.href,
    };
  }
  return {
    qrValue: VALUE_FOR_VALUE.qrValue,
    display: VALUE_FOR_VALUE.display,
    addressLabel: 'LIGHTNING ADDRESS',
    copyText: VALUE_FOR_VALUE.qrValue.replace(/^lightning:/i, ''),
  };
}

function activeSupportMethod(method: SupportQrMethod): SupportMethodDetails | null {
  return supportMethodDetails(method) ?? supportMethodDetails('lightning');
}

function isSupportQrMethod(id: ValueLinkId): id is SupportQrMethod {
  return id === 'lightning' || id === 'onchain' || id === 'silent';
}

function copyTitlePaymentTarget(): void {
  const details = supportMethodDetails(titlePaymentMethod);
  if (!details) return;
  titleValueStatus = `COPYING ${details.addressLabel}`;
  void copyTitleValueTarget(details.copyText, titlePaymentMethod);
}

function valueCopyTextForLink(id: ValueLinkId, href: string): string {
  if (isSupportQrMethod(id)) return supportMethodDetails(id)?.copyText ?? href;
  return href;
}

async function copyTitleValueTarget(text: string, id: ValueLinkId, opened = false): Promise<void> {
  const label = titleValueLinkLabel(id);
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
    titleValueStatus = isSupportQrMethod(id)
      ? `${supportMethodDetails(id)?.addressLabel ?? label} COPIED`
      : `${label} ${opened ? 'TAB OPENED · ' : ''}LINK COPIED`;
    titleStatus = titleValueStatus;
  } catch {
    titleValueStatus = isSupportQrMethod(id)
      ? 'COPY BLOCKED · ADDRESS VISIBLE'
      : `${label} ${opened ? 'TAB OPENED · ' : 'OPEN BLOCKED · '}COPY BLOCKED`;
    titleStatus = titleValueStatus;
  }
}

/**
 * Open an external page from a canvas gesture. window.open is refused in
 * installed PWAs (iOS standalone returns null even inside a tap), so fall
 * back to clicking a real anchor — Safari routes that to the in-app browser.
 */
function openExternalTab(href: string): boolean {
  try {
    const opened = window.open(href, '_blank', 'noopener');
    if (opened) {
      try {
        opened.opener = null;
      } catch {
        // Some browsers make opener read-only; the new tab has already been opened.
      }
      return true;
    }
  } catch {
    // Fall through to the anchor path.
  }
  try {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } catch {
    return false;
  }
}

function openTitleValueLink(href: string, id: ValueLinkId): boolean {
  const label = titleValueLinkLabel(id);
  const opened = openExternalTab(href);
  titleValueStatus = `${label} ${opened ? 'TAB OPENED' : 'OPEN BLOCKED'} · COPYING LINK`;
  titleStatus = titleValueStatus;
  return opened;
}

function openGameOverSupport(): void {
  gameOverSupportOpen = true;
  supportActionStatus = null;
  playAudio('lock', 0.5);
}

/**
 * Leave the support screen: on the staged game-over flow this moves to the
 * guest name entry (or straight to the score table); when the modal was
 * merely reopened from the score screen it just closes.
 */
function advanceGameOverSupport(): void {
  gameOverSupportOpen = false;
  if (gameOverStage !== 'support') return;
  recordSupportDecline();
  gameOverStage = gameOverNamePending ? 'name' : 'score';
  if (gameOverStage === 'name') beginGameOverNameEntry();
  syncScoreActions();
}

const V4V_DECLINE_KEY = 'neonsentinel:v4v-declines:v1';

/**
 * Walking past the tip jar earns a wink, not a lecture: each decline picks a
 * cheekier line, anchored to how much free play the arcade has clocked up.
 */
function recordSupportDecline(): void {
  let declines = 1;
  try {
    const prior = Number(localStorage.getItem(V4V_DECLINE_KEY));
    declines = (Number.isFinite(prior) && prior > 0 ? prior : 0) + 1;
    localStorage.setItem(V4V_DECLINE_KEY, String(declines));
  } catch { /* counter is decorative */ }
  const math = valueTimeMath();
  const played = fmtLongPlayTime(math.lifetimeSeconds);
  const lines = [
    'NO WORRIES · THE RELAY RUNS ON GOODWILL',
    `FREE RUN #${declines} BANKED · THE DONKEY IS COUNTING`,
    `${played} OF FREE PLAY · ONE CREDIT WOULD BE POETIC`,
    `STILL FREE · STILL HOPING · ${math.sats.toLocaleString('en-GB')} SATS SAYS THANKS`,
    `${played} PLAYED · AN ARCADE WOULD HAVE YOUR POCKET MONEY BY NOW`,
  ];
  supportNudgeLine = declines <= 1 ? lines[0]! : lines[(declines - 1) % lines.length]!;
}

const GUEST_NAME_MAX = 16;

function beginGameOverNameEntry(): void {
  const current = state.playerName.trim();
  nameEntryValue = current && current.toLowerCase() !== 'guest'
    ? current.toUpperCase().slice(0, GUEST_NAME_MAX)
    : '';
}

function nameEntryAppend(ch: string): void {
  if (gameOverStage !== 'name' || nameEntryValue.length >= GUEST_NAME_MAX) return;
  nameEntryValue += ch.toUpperCase();
  playAudio('lock', 0.28);
}

function nameEntryBackspace(): void {
  if (gameOverStage !== 'name' || nameEntryValue.length === 0) return;
  nameEntryValue = nameEntryValue.slice(0, -1);
  playAudio('lock', 0.2);
}

// Skip name entry entirely: the run stays on the local score screen without
// being signed or published. SIGN SCORE remains available for a manual claim.
function skipGameOverName(): void {
  if (gameOverStage !== 'name') return;
  gameOverStage = 'score';
  gameOverNamePending = false;
  playAudio('lock', 0.4);
  syncScoreActions();
}

function commitGameOverName(): void {
  if (gameOverStage !== 'name') return;
  const name = cleanGuestName(nameEntryValue);
  gameOverStage = 'score';
  gameOverNamePending = false;
  state.playerName = name;
  if (activePlayerSession && isGuestSession(activePlayerSession)) {
    activePlayerSession.displayName = renameGuest(name);
  } else {
    renameGuest(name);
  }
  if (lastRunSummary && lastRunSummary.runId === state.runId) {
    lastRunSummary.playerName = name;
    // The deferred claim from recordFinishedRun: publish now, name attached.
    void claimAndPublishScore(lastRunSummary, false);
  }
  playAudio('rescue', 0.6);
  syncScoreActions();
}

function setSupportStatus(status: string): void {
  supportActionStatus = status;
  setScoreStatus(status);
}

function activateScoreValueLink(id: ValueLinkId): void {
  const link = VALUE_FOR_VALUE.links.find(item => item.id === id);
  if (!link) return;
  // Address-carrying methods also swap the panel's QR to match the tap.
  if (isSupportQrMethod(id)) scoreSupportMethod = id;
  const launched = openScoreValueLink(link.href, id);
  markScoreValueLinkActivated(id, launched);
  // Phones dead-end here silently — lightning: has no handler without a
  // wallet installed, and iOS Safari refuses window.open from pointerdown.
  // Copying the target inside the same gesture leaves the player a way to
  // pay from whatever wallet or browser they choose.
  void copyScoreValueTarget(valueCopyTextForLink(id, link.href), id, launched);
}

async function copyScoreValueTarget(text: string, id: ValueLinkId, launched: boolean): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
  } catch {
    return; // markScoreValueLinkActivated's status stands.
  }
  if (id === 'lightning' || id === 'onchain') {
    setSupportStatus(launched
      ? 'WALLET PROMPTED · ADDRESS COPIED · TAP I PAID IF YOU DID'
      : 'ADDRESS COPIED · PASTE IN YOUR WALLET · TAP I PAID');
  } else if (id === 'silent') {
    setSupportStatus('SILENT CODE COPIED · PASTE IN A SILENT-PAYMENTS WALLET');
  } else if (!launched) {
    setSupportStatus(`${titleValueLinkLabel(id)} BLOCKED · LINK COPIED · PASTE IN BROWSER`);
  }
}

// A plain lightning address gives us no payment callback, so opening a
// wallet (or a Geyser/Ko-fi tab) must never be treated as payment — the
// player confirms themselves via the I PAID button.
function markScoreValueLinkActivated(id: ValueLinkId, launched: boolean): void {
  const label = titleValueLinkLabel(id);
  if (id === 'silent') {
    setSupportStatus('SILENT PAYMENT · SCAN THE QR OR COPY THE CODE');
    return;
  }
  setSupportStatus(id === 'lightning' || id === 'onchain'
    ? launched ? 'WALLET PROMPTED · TAP I PAID IF YOU DID' : `${label} LINK BLOCKED · SCAN THE QR`
    : launched ? `${label} OPENED · TAP I PAID IF YOU DID` : `${label} POPUP BLOCKED`);
}

function markNativeScoreValueLinkActivated(id: ValueLinkId): void {
  const label = titleValueLinkLabel(id);
  setSupportStatus(id === 'lightning' ? 'WALLET PROMPTED · TAP I PAID IF YOU DID' : `${label} OPENED · TAP I PAID IF YOU DID`);
}

function openScoreValueLink(href: string, id: ValueLinkId): boolean {
  // Silent payment codes have no URI scheme to launch — copy/scan only.
  if (id === 'silent') return false;
  if (id === 'lightning' || id === 'onchain') {
    try {
      window.location.href = href;
      return true;
    } catch {
      return false;
    }
  }
  return openExternalTab(href);
}

function isTitleValueField(value: string): value is TitleValueField {
  return value === 'value-lightning' || value === 'value-onchain' || value === 'value-silent'
    || value === 'value-geyser' || value === 'value-kofi';
}

function titleShipAccent(ship: ShipClass): string {
  if (ship === 'interceptor') return '#5effdb';
  if (ship === 'guardian') return '#8cffb4';
  return '#ff8a3a';
}

function titlePressureAccent(skill: Skill): string {
  if (skill === 'cadet') return '#8cffb4';
  if (skill === 'normal') return '#ffd84a';
  return '#ff4d8d';
}

function titleShipCopy(ship: ShipClass): { summary: string; detail: string } {
  if (ship === 'interceptor') return { summary: 'FAST RESPONSE', detail: 'TOP SPEED / FAST FIRE / LOW BURST' };
  if (ship === 'guardian') return { summary: 'BALANCED RESCUE', detail: 'GOOD CONTROL / SOLID POWER' };
  return { summary: 'HEAVY CONTROL', detail: 'HIGH DAMAGE / SLOWER FRAME' };
}

function titlePressureCopy(skill: Skill): { summary: string; detail: string } {
  if (skill === 'cadet') return { summary: 'LOW PRESSURE', detail: 'SOFTER WAVES / WIDER RESCUE' };
  if (skill === 'normal') return { summary: 'ARCADE BASELINE', detail: 'QUICK LIFTS / STANDARD RESCUE' };
  return { summary: 'FULL 600B PRESSURE', detail: 'MORE BADDIES / FAST LIFTS' };
}

function titleShipStats(shipId: ShipClass): Array<{ label: string; value: string; metric: number }> {
  const ship = shipSpec(shipId);
  const fireRate = 1 / ship.fireInterval;
  const copy = shipId === 'interceptor'
    ? { speed: 'FAST', fire: 'FAST', damage: 'LIGHT' }
    : shipId === 'guardian'
      ? { speed: 'BALANCED', fire: 'STEADY', damage: 'MEDIUM' }
      : { speed: 'HEAVY', fire: 'SLOW', damage: 'HIGH' };
  return [
    { label: 'SPEED', value: copy.speed, metric: relativeMetric(ship.maxX, SHIPS.map(item => item.maxX)) },
    { label: 'FIRE RATE', value: copy.fire, metric: relativeMetric(fireRate, SHIPS.map(item => 1 / item.fireInterval)) },
    { label: 'DAMAGE', value: copy.damage, metric: relativeMetric(ship.laserDamage, SHIPS.map(item => item.laserDamage)) },
    { label: 'BURST', value: String(ship.burstCap), metric: relativeMetric(ship.burstCap, SHIPS.map(item => item.burstCap)) },
  ];
}

function titlePressureStats(skillId: Skill): Array<{ label: string; value: string; metric: number }> {
  const skill = skillSpec(skillId);
  const copy = skillId === 'cadet'
    ? { waves: 'GENTLE', enemy: 'SLOW', lift: 'SOFTER', rescue: 'WIDE' }
    : skillId === 'normal'
      ? { waves: 'NORMAL', enemy: 'NORMAL', lift: 'QUICK', rescue: 'NORMAL' }
      : { waves: 'DENSE', enemy: 'FAST', lift: 'FAST', rescue: 'TIGHT' };
  return [
    { label: 'WAVES', value: copy.waves, metric: relativeMetric(skill.spawnScale, SKILLS.map(item => item.spawnScale)) },
    { label: 'ENEMY SPEED', value: copy.enemy, metric: relativeMetric(skill.enemySpeed, SKILLS.map(item => item.enemySpeed)) },
    { label: 'LIFT', value: copy.lift, metric: 1 - relativeMetric(skill.liftLockScale, SKILLS.map(item => item.liftLockScale)) },
    { label: 'RESCUE', value: copy.rescue, metric: relativeMetric(skill.rescueWindowScale, SKILLS.map(item => item.rescueWindowScale)) },
    { label: 'CLOCK', value: formatClock(skill.startTime), metric: relativeMetric(skill.startTime, SKILLS.map(item => item.startTime)) },
  ];
}

function relativeMetric(value: number, values: readonly number[]): number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 1;
  return (value - min) / (max - min);
}

// Cabinet attract dressing over the bot's demo run: brand, flashing call to
// action, and the top of the all-time board so passers-by see real names.
function drawAttractOverlay(t: number): void {
  const viewport = visibleCanvasRect();
  const cx = viewport.x + viewport.w / 2;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,245,216,0.55)';
  ctx.font = `900 11px ${FONT_MONO}`;
  ctx.fillText('ATTRACT MODE · DEMO PILOT', viewport.x + 18, PLAY_TOP + 26);
  ctx.textAlign = 'center';

  const bannerBottomY = viewport.y + viewport.h - Math.max(64, viewport.safeBottom + 44);
  const groundClearY = Math.min(GROUND_BASE - 86, terrainY(cameraX) - 88);
  const bannerY = Math.min(bannerBottomY, groundClearY);
  if (Math.sin(t * 4.2) > -0.25) {
    ctx.fillStyle = '#ffd84a';
    ctx.shadowColor = '#ffd84a';
    ctx.shadowBlur = 16;
    ctx.font = `950 ${usePortraitHud(viewport) ? 17 : 24}px ${FONT_DISPLAY}`;
    ctx.fillText(COARSE_POINTER ? 'TAP TO PLAY' : 'PRESS ANY KEY TO PLAY', cx, bannerY);
    ctx.shadowBlur = 0;
  }
  // Browsers only unlock audio on a real gesture, so an untouched page demos
  // in silence — say so plainly instead of looking broken. Steady, not
  // blinking: it is information, not a call to action.
  if (!isAudioUnlocked()) {
    ctx.fillStyle = 'rgba(255,245,216,0.6)';
    ctx.font = `800 ${usePortraitHud(viewport) ? 8 : 10}px ${FONT_MONO}`;
    ctx.fillText(COARSE_POINTER ? 'FIRST TAP TURNS ON THE SOUND' : 'FIRST KEY TURNS ON THE SOUND', cx, bannerY + (usePortraitHud(viewport) ? 16 : 20));
  }

  const board = getCachedLeaderboard();
  const top = (board?.entries ?? []).slice(0, 5);
  if (top.length > 0) {
    const panelW = 240;
    const rowH = 17;
    const panelH = 34 + top.length * rowH;
    const px = viewport.x + viewport.w - panelW - 18;
    const py = PLAY_TOP + 44;
    ctx.fillStyle = 'rgba(1,4,10,0.72)';
    ctx.strokeStyle = 'rgba(94,255,219,0.4)';
    ctx.lineWidth = 1;
    roundedRect(px, py, panelW, panelH, 7);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#5effdb';
    ctx.font = `950 10px ${FONT_DISPLAY}`;
    ctx.fillText('ALL-TIME SENTINELS', px + 12, py + 19);
    ctx.font = `900 9px ${FONT_MONO}`;
    top.forEach((entry, i) => {
      const rowY = py + 34 + i * rowH;
      ctx.fillStyle = i === 0 ? '#ffd84a' : 'rgba(255,245,216,0.78)';
      ctx.textAlign = 'left';
      ctx.fillText(`${i + 1}. ${entry.playerName.toUpperCase().slice(0, 14)}`, px + 12, rowY);
      ctx.textAlign = 'right';
      ctx.fillText(entry.score.toLocaleString('en-GB'), px + panelW - 12, rowY);
    });
  }
  ctx.restore();
}

function drawFlash(): void {
  if (state.flash <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const calm = getReducedEffects() ? 0.35 : 1;
  ctx.globalAlpha = Math.min(state.shipDestroyed ? 0.72 : 0.42, state.flash) * calm;
  const flash = ctx.createRadialGradient(VIEW_W / 2, VIEW_H * 0.45, 20, VIEW_W / 2, VIEW_H * 0.45, VIEW_H * 0.84);
  flash.addColorStop(0, 'rgba(255,245,216,0.75)');
  flash.addColorStop(0.34, state.shipDestroyed ? 'rgba(94,255,219,0.36)' : 'rgba(255,216,74,0.2)');
  flash.addColorStop(0.62, state.shipDestroyed ? 'rgba(255,77,141,0.2)' : 'rgba(255,216,74,0.12)');
  flash.addColorStop(1, 'rgba(255,77,94,0)');
  ctx.fillStyle = flash;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.restore();
}

function recordFinishedRun(): void {
  if (state.demo) return;
  if (state.scoreRecorded || state.startedAt <= 0 || state.finishedAt <= 0) return;
  state.scoreRecorded = true;
  recordWaveDuration(false);
  publishPlaytestTrace(true);
  const summary: RelaykeepRunSummary = {
    runId: state.runId,
    playerName: state.playerName,
    playerMode: state.playerMode,
    score: state.score,
    wave: state.wave,
    sats: state.sats,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    durationMs: Math.max(0, state.finishedAt - state.startedAt),
    rescues: state.rescued,
    knownRescues: state.rescued,
    lost: state.lost,
    maxCombo: state.maxCombo,
    metrics: scoreRunMetrics(),
  };
  lastRunSummary = summary;
  addLifetimePlaySeconds(summary.durationMs / 1000);
  scorePublished = false;
  setScoreStatus('SIGN SCORE READY · NO PAYOUT');
  // Did this run beat the stored local best? Read it BEFORE finaliseLocalRun
  // banks this score. Matches the mid-run ladder's "YOUR BEST" notion (local
  // best, daily runs excluded — the daily is its own board). A triumphant
  // fanfare lands on the death screen: you fell, but you set a record.
  const prevBest = getLocalScores().reduce((best, entry) => Math.max(best, entry.score), 0);
  lastRunNewBest = !state.daily && state.score > 0 && state.score > prevBest;
  if (lastRunNewBest) {
    playAudio('extend', 1.3);
    playAudio('oneUp', 1.15);
    playAudio('musicSurge', 0.7);
  }
  finaliseLocalRun(summary);
  // Guests rename themselves on the arcade name entry screen; hold the claim
  // back until then so the published score carries the chosen name.
  if (!gameOverNamePending) void claimAndPublishScore(summary, false);
  // Paint whatever board we already have, refresh now, then refresh again
  // once the just-published score has had time to reach the relays.
  gameOverBoard = getCachedLeaderboard();
  void fetchLeaderboard(true).then(snapshot => { gameOverBoard = snapshot; });
  window.setTimeout(() => {
    if (state.phase !== 'gameover') return;
    void fetchLeaderboard(true).then(snapshot => { gameOverBoard = snapshot; });
  }, 6500);
}

async function claimAndPublishLastScore(): Promise<ScoreSubmitResult | null> {
  if (!lastRunSummary) return null;
  return claimAndPublishScore(lastRunSummary, true);
}

async function claimAndPublishScore(summary: RelaykeepRunSummary, prompt: boolean): Promise<ScoreSubmitResult | null> {
  if (scoreSubmitInFlight) return null;
  const signet = window.Signet;
  if (!activePlayerSession && !signet) {
    setScoreStatus(prompt ? 'SIGNET UNAVAILABLE' : 'SIGN SCORE READY · NO PAYOUT');
    return null;
  }

  try {
    const session = activePlayerSession
      ?? await signet?.restoreSession?.({ reconnectBunker: false })
      ?? (prompt && signet?.login ? await signet.login({
        appName: SIGNET_APP_NAME,
        relayUrl: 'wss://relay.trotters.cc',
        theme: 'dark',
      }) : null);
    if (!session) {
      setScoreStatus(prompt ? 'SIGNING CANCELLED' : 'SIGN SCORE READY · NO PAYOUT');
      return null;
    }
    if (!session.signer || typeof session.signer.signEvent !== 'function') {
      setScoreStatus(prompt ? 'SIGNER NOT READY' : 'SIGN SCORE READY · NO PAYOUT');
      return null;
    }
    activePlayerSession = session;

    scoreSubmitInFlight = true;
    setScoreStatus('SIGNING NIP-98 CLAIM');
    const claim = await submitScoreClaim(session, summary);
    if (claim.ok) {
      scorePublished = true;
      setScoreStatus(`GAME 30762 ${shortId(claim.score_event_id)}`);
      return { kind: 'claim', result: claim };
    }

    if (shouldClientPublishFallback(claim)) {
      const fallback = await publishClientScore(summary, session, scoreClaimErrorLabel(claim));
      if (fallback) return fallback;
    }

    setScoreStatus(scoreClaimErrorLabel(claim));
    return { kind: 'claim', result: claim };
  } catch (err) {
    setScoreStatus(err instanceof Error ? `SIGN FAIL ${err.message.slice(0, 26)}` : 'SIGN FAIL');
    return null;
  } finally {
    scoreSubmitInFlight = false;
    syncScoreActions();
  }
}

function shouldClientPublishFallback(result: ClaimResult): boolean {
  if (result.ok) return false;
  return DIRECT_CLIENT_SCORE;
}

async function publishClientScore(
  summary: RelaykeepRunSummary,
  session: SignetSession,
  reason = 'CLAIM API OFFLINE',
): Promise<ScoreSubmitResult | null> {
  setScoreStatus(`${reason} · SIGNING 30762`);
  const draft = buildScoreEvent(summary, session.pubkey);
  const signed = await session.signer.signEvent(draft as unknown as Record<string, unknown>);
  const results = await publishSignedScore(signed);
  const ok = results.filter(result => result.ok).length;
  const total = results.length;
  const published = ok > 0;
  scorePublished = published;
  setScoreStatus(published
    ? `KIND 30762 RELAY ${ok}/${total}`
    : total > 0
      ? `KIND 30762 SIGNED · RELAY 0/${total}`
      : 'KIND 30762 SIGNED · NO RELAY SOCKET');
  return { kind: 'client-event', event: signed };
}

function scoreClaimErrorLabel(result: ClaimResult): string {
  if (result.ok) return 'GAME 30762 PUBLISHED';
  if (result.status === 404 || result.error === 'bad_response') return 'CLAIM API OFFLINE';
  if (result.error === 'signer_unavailable') return 'CLAIM SIGNER OFFLINE';
  if (result.error === 'network_error') return 'CLAIM NETWORK ERROR';
  if (result.error === 'sign_failed') return `SIGN FAIL ${result.detail?.slice(0, 20) ?? ''}`.trim();
  return `CLAIM ${result.error.slice(0, 24)}`;
}

function setScoreStatus(status: string): void {
  scoreStatus = status;
  window.relaykeepScoreStatus = status;
  window.neonSentinelScoreStatus = status;
  syncScoreActions();
}

function syncScoreActions(): void {
  document.body.dataset.neonPhase = state.phase;
  if (!(scoreActions instanceof HTMLElement)) return;
  // The sign bar belongs to the score stage; keep it out of the support ask
  // and the arcade name entry.
  const show = state.phase === 'gameover' && lastRunSummary !== null && gameOverStage === 'score';
  scoreActions.hidden = !show;
  // Support links moved into the canvas SUPPORT overlay; the DOM bar keeps
  // just the sign action and status to reduce game-over clutter.
  syncSupportLink(valueSupportLink, 'lightning', false);
  syncSupportLink(geyserSupportLink, 'geyser', false);
  syncSupportLink(kofiSupportLink, 'kofi', false);
  if (!show) return;
  if (scoreActionStatus) scoreActionStatus.textContent = scoreStatus;
  if (scorePublishButton instanceof HTMLButtonElement) {
    scorePublishButton.disabled = scoreSubmitInFlight || scorePublished;
    scorePublishButton.textContent = scoreSubmitInFlight ? 'SIGNING' : scorePublished ? 'PUBLISHED' : 'SIGN SCORE';
  }
}

function syncSupportLink(element: Element | null, id: 'lightning' | 'geyser' | 'kofi', show: boolean, labelOverride?: string): void {
  if (!(element instanceof HTMLAnchorElement)) return;
  const link = VALUE_FOR_VALUE.links.find(item => item.id === id);
  element.hidden = !show || !link;
  if (!show || !link) return;
  element.href = link.href;
  if (id === 'lightning') {
    element.removeAttribute('target');
    element.rel = 'noopener';
  } else {
    element.target = '_blank';
    element.rel = 'noopener noreferrer';
  }
  element.textContent = labelOverride ?? link.label;
  element.title = link.display;
}

function scoreSubmitHint(portrait: boolean): string {
  if (scoreSubmitInFlight) return 'SIGNING CLAIM';
  if (scorePublished) {
    return portrait ? 'PUBLISHED · TAP TO RETRY' : 'PUBLISHED · R INSTANT RETRY · V SUPPORT · ESC MENU';
  }
  return portrait ? 'SIGN SCORE · TAP TO RETRY' : 'S SIGN · R INSTANT RETRY · ENTER RETRY · V SUPPORT · ESC MENU';
}

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

function publishPlaytestTrace(finished = false): void {
  // Bot runs would overwrite the last real playtest trace — skip them.
  if (state.demo) return;
  const host = window;
  const summary = playtestTraceSummary(finished);
  const report = buildFeelReport(finished);
  host.neonSentinelTrace = state.trace;
  host.neonSentinelTraceSummary = summary;
  host.neonSentinelFeelReport = report;
  host.relaykeepTrace = host.neonSentinelTrace;
  host.relaykeepTraceSummary = host.neonSentinelTraceSummary;
  host.relaykeepFeelReport = report;
  if (finished) lastFeelReport = report;
  try {
    localStorage.setItem('neonsentinel:last-playtest-trace', JSON.stringify(summary));
    localStorage.setItem('neonsentinel:last-feel-report', JSON.stringify(report));
  } catch {
    // Debug telemetry is best-effort local state.
  }
}

function playtestTraceSummary(finished = false): {
  finished: boolean;
  runId: string;
  score: number;
  wave: number;
  elapsed: number;
  shotsFired: number;
  shotsHit: number;
  hitRate: number;
  contactsLifted: number;
  contactsSaved: number;
  contactsForged: number;
  contactsDropped: number;
  averageRescueSeconds: number | null;
  fastestRescueSeconds: number | null;
  slowestRescueSeconds: number | null;
  livesLost: number;
  damageEvents: number;
  topDamageSource: string;
  lowCampSeconds: number;
  lowCampRatio: number;
  nearGroundSeconds: number;
  heatPeak: number;
  turnEvents: number;
  kills: Record<EnemyType, number>;
  waveDurations: PlaytestWaveDuration[];
  waveAverageSeconds: number | null;
} {
  const trace = state.trace;
  const waveDurations = playtestWaveDurations(true);
  const clearedDurations = waveDurations.filter(item => item.seconds > 0 && item.cleared);
  const waveAverageSeconds = clearedDurations.length > 0
    ? clearedDurations.reduce((sum, item) => sum + item.seconds, 0) / clearedDurations.length
    : null;
  return {
    finished,
    runId: state.runId,
    score: state.score,
    wave: state.wave,
    elapsed: trace.elapsed,
    shotsFired: trace.shotsFired,
    shotsHit: trace.shotsHit,
    hitRate: trace.shotsFired > 0 ? trace.shotsHit / trace.shotsFired : 0,
    contactsLifted: trace.contactsLifted,
    contactsSaved: trace.contactsSaved,
    contactsForged: trace.contactsForged,
    contactsDropped: trace.contactsDropped,
    averageRescueSeconds: trace.rescueResponseCount > 0 ? trace.rescueResponseTotal / trace.rescueResponseCount : null,
    fastestRescueSeconds: Number.isFinite(trace.rescueResponseFastest) ? trace.rescueResponseFastest : null,
    slowestRescueSeconds: trace.rescueResponseSlowest || null,
    livesLost: trace.livesLost,
    damageEvents: trace.damageEvents,
    topDamageSource: topDamageSource(),
    lowCampSeconds: trace.lowCampSeconds,
    lowCampRatio: trace.elapsed > 0 ? trace.lowCampSeconds / trace.elapsed : 0,
    nearGroundSeconds: trace.nearGroundSeconds,
    heatPeak: trace.heatPeak,
    turnEvents: trace.turnEvents,
    kills: { ...trace.kills },
    waveDurations,
    waveAverageSeconds,
  };
}

function playtestWaveDurations(includeActive: boolean): PlaytestWaveDuration[] {
  const durations = state.trace.waveDurations.map(item => ({ ...item }));
  if (includeActive && state.wave > 0) {
    const last = durations[durations.length - 1];
    if (!last || last.wave !== state.wave) {
      durations.push({
        wave: state.wave,
        seconds: Math.max(0, state.trace.elapsed - state.trace.currentWaveStartedAt),
        cleared: false,
      });
    }
  }
  return durations;
}

function scoreRunMetrics(): ScoreRunMetrics {
  const summary = playtestTraceSummary(true);
  return {
    deaths: summary.livesLost,
    damageEvents: summary.damageEvents,
    shotHitRate: summary.hitRate,
    shotsFired: summary.shotsFired,
    shotsHit: summary.shotsHit,
    rescueAverageSeconds: summary.averageRescueSeconds,
    rescueSlowestSeconds: summary.slowestRescueSeconds,
    lowCampSeconds: summary.lowCampSeconds,
    lowCampRatio: summary.lowCampRatio,
    contactsLifted: summary.contactsLifted,
    contactsDropped: summary.contactsDropped,
    contactsForged: summary.contactsForged,
    topDamageSource: summary.topDamageSource,
    waveDurations: summary.waveDurations.map(item => ({ ...item })),
  };
}

function buildFeelReport(finished = false): FeelReport {
  const summary = playtestTraceSummary(finished);
  const hitPct = Math.round(summary.hitRate * 100);
  const rescue = summary.averageRescueSeconds;
  const lowPct = Math.round(summary.lowCampRatio * 100);
  const waveAvg = summary.waveAverageSeconds;
  let score = 100;
  if (summary.shotsFired >= 12) score -= clamp((0.34 - summary.hitRate) * 85, 0, 24);
  score -= clamp(summary.livesLost * 12, 0, 34);
  score -= clamp(summary.contactsDropped * 7 + summary.contactsForged * 12, 0, 32);
  if (rescue !== null) score -= clamp((rescue - 5.5) * 3.6, 0, 18);
  score -= clamp((summary.lowCampRatio - 0.08) * 120, 0, 18);
  const grade = score >= 90 ? 'LEGENDARY'
    : score >= 78 ? 'SHARP'
      : score >= 64 ? 'TUNING'
        : 'ROUGH';
  const rescueText = rescue === null ? '--' : `${rescue.toFixed(1)}S`;
  const waveText = waveAvg === null ? '--' : `${waveAvg.toFixed(1)}S`;
  const flags: string[] = [];
  if (summary.shotsFired >= 12 && summary.hitRate < 0.28) flags.push('FIRE WINDOW TOO TIGHT');
  if (summary.contactsDropped + summary.contactsForged > 0) flags.push('RESCUE PRESSURE HIGH');
  if (summary.lowCampRatio > 0.12) flags.push('LOW CAMP LOOP DETECTED');
  if ((summary.averageRescueSeconds ?? 0) > 7) flags.push('ABDUCTION READ TOO LATE');
  if (summary.livesLost >= 2) flags.push(`DAMAGE SPIKE ${summary.topDamageSource}`);
  if (flags.length === 0) flags.push('RUN FEEL STABLE');
  return {
    grade,
    summary: `${grade} · FIRE ${hitPct}% · RESCUE ${rescueText}`,
    lines: [
      `FIRE ${hitPct}% · ${summary.shotsHit}/${summary.shotsFired} HITS`,
      `RESCUE ${rescueText} AVG · LOST ${state.lost}`,
      `LOW CAMP ${lowPct}% · DEATHS ${summary.livesLost}`,
      `WAVE AVG ${waveText} · CLEARED ${summary.waveDurations.filter(item => item.cleared).length}`,
    ],
    flags: flags.slice(0, 3),
    metrics: {
      hitRate: summary.hitRate,
      averageRescueSeconds: summary.averageRescueSeconds,
      lowCampRatio: summary.lowCampRatio,
      waveAverageSeconds: summary.waveAverageSeconds,
      deaths: summary.livesLost,
      contactsLost: state.lost,
    },
  };
}

function spawnBurst(x: number, y: number, colour: string, count: number, power: number): void {
  const effective = particleSpawnCount(count, 'burst');
  for (let i = 0; i < effective; i += 1) {
    const a = rand() * Math.PI * 2;
    const speed = power * (0.25 + rand() * 0.9);
    emitParticle({
      x,
      y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      ttl: 0.32 + rand() * 0.58,
      age: 0,
      size: 1.2 + rand() * 3.2,
      colour,
      kind: 'spark',
    });
  }
}

function spawnDetailedExplosion(x: number, y: number, colours: readonly string[], scale: number, carryVx = 0, carryVy = 0): void {
  spawnExplosionRibs(x, y, colours, scale, carryVx, carryVy);
  const beamCount = particleSpawnCount(Math.round(8 + scale * 7), 'detail');
  const fragmentCount = particleSpawnCount(Math.round(12 + scale * 16), 'detail');
  for (let i = 0; i < beamCount; i += 1) {
    const a = rand() * Math.PI * 2;
    const speed = (180 + rand() * 430) * scale;
    const colour = colours[i % colours.length] ?? '#fff5d8';
    emitParticle({
      x: wrapX(x + (rand() - 0.5) * 18 * scale),
      y: y + (rand() - 0.5) * 14 * scale,
      vx: Math.cos(a) * speed + carryVx * 0.22,
      vy: Math.sin(a) * speed * 0.78 + carryVy * 0.12,
      ttl: 0.18 + rand() * 0.28,
      age: 0,
      size: 1,
      colour,
      kind: 'beam',
      rot: a,
      length: (24 + rand() * 64) * scale,
      width: 1.4 + rand() * 2.4,
    });
  }
  for (let i = 0; i < fragmentCount; i += 1) {
    const a = rand() * Math.PI * 2;
    const speed = (120 + rand() * 380) * scale;
    const colour = colours[(i + beamCount) % colours.length] ?? '#fff5d8';
    const line = i % 5 === 0;
    const block = !line && i % 2 === 0;
    emitParticle({
      x: wrapX(x + (rand() - 0.5) * 34 * scale),
      y: y + (rand() - 0.5) * 24 * scale,
      vx: Math.cos(a) * speed + carryVx * 0.18,
      vy: Math.sin(a) * speed * 0.72 + carryVy * 0.14 - rand() * 44,
      ttl: line ? 0.58 + rand() * 0.9 : block ? 0.68 + rand() * 0.88 : 0.4 + rand() * 0.42,
      age: 0,
      size: line ? 1 : block ? (2.2 + rand() * (5.2 + scale * 2.4)) * Math.min(1.32, scale) : 1.2 + rand() * (2.8 + scale * 1.2),
      colour,
      kind: line ? 'debris' : block ? 'chunk' : 'spark',
      rot: a,
      spin: block ? (rand() - 0.5) * 10 : undefined,
      length: line ? (12 + rand() * 32) * scale : undefined,
      width: line ? 1.2 + rand() * 2.2 : undefined,
    });
  }
}

function spawnExplosionRibs(x: number, y: number, colours: readonly string[], scale: number, carryVx = 0, carryVy = 0): void {
  const count = particleSpawnCount(Math.round(5 + scale * 5), 'detail');
  for (let i = 0; i < count; i += 1) {
    const a = (i / Math.max(1, count)) * Math.PI * 2 + (rand() - 0.5) * 0.18;
    const speed = (230 + rand() * 360) * scale;
    const colour = colours[(i * 2) % colours.length] ?? '#fff5d8';
    const long = i % 3 === 0;
    emitParticle({
      x: wrapX(x + Math.cos(a) * 10 * scale),
      y: y + Math.sin(a) * 8 * scale,
      vx: Math.cos(a) * speed + carryVx * 0.2,
      vy: Math.sin(a) * speed * 0.74 + carryVy * 0.13,
      ttl: long ? 0.52 + rand() * 0.46 : 0.26 + rand() * 0.24,
      age: 0,
      size: 1,
      colour: i % 4 === 0 ? '#fff5d8' : colour,
      kind: long ? 'debris' : 'beam',
      rot: a,
      spin: long ? (rand() - 0.5) * 7 : undefined,
      length: (long ? 36 + rand() * 62 : 44 + rand() * 88) * scale,
      width: (long ? 2.1 + rand() * 1.8 : 2.6 + rand() * 2.2) * Math.min(1.35, scale),
    });
  }
}

function spawnExplosionCore(x: number, y: number, colour: string, size: number, ttl: number): void {
  emitParticle({
    x: wrapX(x),
    y,
    vx: (rand() - 0.5) * 18,
    vy: (rand() - 0.5) * 16,
    ttl,
    age: 0,
    size,
    colour,
    kind: 'core',
  }, true);
}

function spawnShockwave(x: number, y: number, colour: string, size: number, ttl: number): void {
  emitParticle({
    x: wrapX(x),
    y,
    vx: 0,
    vy: 0,
    ttl,
    age: 0,
    size,
    colour,
    kind: 'shockwave',
  }, true);
}

function spawnExplosionFlash(x: number, y: number, colour: string, size: number, ttl: number): void {
  emitParticle({
    x: wrapX(x),
    y,
    vx: 0,
    vy: 0,
    ttl,
    age: 0,
    size,
    colour,
    kind: 'flash',
  }, true);
}

function spawnShipArcadeDots(x: number, y: number, count: number, scale: number): void {
  const colours = ['#fff5d8', '#5effdb', '#ff4d8d', '#ffd84a', '#7dfff2', '#f47316'];
  const effective = particleSpawnCount(count, 'burst');
  for (let i = 0; i < effective; i += 1) {
    const a = rand() * Math.PI * 2;
    const speed = (120 + rand() * 520) * scale;
    const size = (1.4 + rand() ** 1.7 * 7.4) * scale;
    const colour = colours[(i + Math.floor(rand() * 2)) % colours.length]!;
    emitParticle({
      x: wrapX(x + (rand() - 0.5) * 46),
      y: y + (rand() - 0.5) * 34,
      vx: Math.cos(a) * speed + state.ship.vx * 0.22,
      vy: Math.sin(a) * speed * 0.82 + state.ship.vy * 0.12 - 58,
      ttl: 0.72 + rand() * 1.4,
      age: 0,
      size,
      colour,
      kind: 'spark',
    });
  }
}

function spawnShipSquareChunks(x: number, y: number, count: number, scale: number): void {
  const colours = ['#fff5d8', '#5effdb', '#ff4d8d', '#ffd84a', '#7dfff2', '#f47316'];
  const effective = particleSpawnCount(count, 'detail');
  for (let i = 0; i < effective; i += 1) {
    const a = rand() * Math.PI * 2;
    const speed = (95 + rand() * 470) * scale;
    const band = rand();
    const size = (band > 0.76
      ? 13 + rand() * 14
      : band > 0.42
        ? 6.5 + rand() * 8.5
        : 2.4 + rand() * 5.2) * scale;
    const colour = colours[i % colours.length]!;
    emitParticle({
      x: wrapX(x + (rand() - 0.5) * 54),
      y: y + (rand() - 0.5) * 36,
      vx: Math.cos(a) * speed + state.ship.vx * 0.28,
      vy: Math.sin(a) * speed * 0.82 + state.ship.vy * 0.16 - 64,
      ttl: DEBUG_EXPLOSION ? 9 + rand() * 9 : 1.35 + rand() * 1.55,
      age: 0,
      size,
      colour,
      kind: 'chunk',
      rot: rand() * Math.PI * 2,
      spin: (rand() - 0.5) * 12,
    }, i < 26);
  }
}

function spawnTrail(x: number, y: number, colour: string, count: number): void {
  const effective = particleSpawnCount(count, 'trail');
  for (let i = 0; i < effective; i += 1) {
    emitParticle({
      x: wrapX(x + (rand() - 0.5) * 12),
      y: y + (rand() - 0.5) * 10,
      vx: (rand() - 0.5) * 40,
      vy: (rand() - 0.5) * 40,
      ttl: 0.16 + rand() * 0.18,
      age: 0,
      size: 1 + rand() * 2,
      colour,
      kind: 'spark',
    });
  }
}

function spawnRing(x: number, y: number, colour: string, size: number): void {
  emitParticle({ x, y, vx: 0, vy: 0, ttl: 0.5, age: 0, size, colour, kind: 'ring' }, true);
}

// Subtitle for a spoken voice clip: the words float at the pickup, larger
// and longer-lived than score popups, so the line reads even when the centre
// message slot is stomped by GM / cult / extend / overtake callouts.
function spawnVoiceLine(x: number, y: number, line: string, colour: string): void {
  emitParticle({
    x,
    y,
    vx: 0,
    vy: -26,
    ttl: 1.7,
    age: 0,
    size: 1.3,
    colour,
    kind: 'text',
    text: line,
    punch: true,
  }, true);
}

function spawnText(x: number, y: number, text: string, colour: string, punch = true, scale = 1): void {
  emitParticle({
    x,
    y,
    vx: (rand() - 0.5) * 22,
    vy: -56 - rand() * 22,
    ttl: 0.74,
    age: 0,
    size: scale,
    colour,
    kind: 'text',
    text,
    punch,
  }, true);
}

function spawnStarFlare(x: number, y: number, colour: string, size: number, ttl: number, spin = 0): void {
  emitParticle({
    x: wrapX(x),
    y,
    vx: 0,
    vy: 0,
    ttl,
    age: 0,
    size,
    colour,
    kind: 'starflare',
    rot: rand() * Math.PI * 2,
    spin,
  }, true);
}

function spawnFireball(x: number, y: number, ramp: readonly string[], size: number, ttl: number): void {
  emitParticle({
    x: wrapX(x),
    y,
    vx: (rand() - 0.5) * 14,
    vy: (rand() - 0.5) * 12,
    ttl,
    age: 0,
    size,
    colour: ramp[ramp.length - 1] ?? '#fff5d8',
    kind: 'fireball',
    ramp,
  }, true);
}

function spawnSparkleBurst(x: number, y: number, colours: readonly string[], count: number, power: number): void {
  const effective = particleSpawnCount(count, 'burst');
  for (let i = 0; i < effective; i += 1) {
    const a = rand() * Math.PI * 2;
    const speed = power * (0.2 + rand() * 0.95);
    emitParticle({
      x,
      y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed - 30,
      ttl: 0.45 + rand() * 0.55,
      age: 0,
      size: 1.8 + rand() * 3.1,
      colour: colours[i % colours.length] ?? '#fff5d8',
      kind: 'spark',
      rot: rand() * Math.PI * 2,
      twinkle: true,
      grav: 70,
    });
  }
}

function spawnRisingMotes(x: number, y: number, colour: string, count: number): void {
  const effective = particleSpawnCount(count, 'detail');
  for (let i = 0; i < effective; i += 1) {
    emitParticle({
      x: wrapX(x + (rand() - 0.5) * 44),
      y: y + (rand() - 0.5) * 22,
      vx: (rand() - 0.5) * 52,
      vy: -34 - rand() * 26,
      ttl: 0.85 + rand() * 0.55,
      age: 0,
      size: 1.1 + rand() * 1.6,
      colour: i % 2 === 0 ? colour : '#fff5d8',
      kind: 'spark',
      rot: rand() * Math.PI * 2,
      twinkle: true,
      grav: -30,
    });
  }
}

function spawnSuckStreaks(x: number, y: number, colour: string, count: number, radius: number): void {
  const effective = particleSpawnCount(count, 'detail');
  for (let i = 0; i < effective; i += 1) {
    const a = (i / Math.max(1, effective)) * Math.PI * 2 + rand() * 0.7;
    const r = radius * (0.85 + rand() * 0.5);
    const speed = 340 + rand() * 220;
    emitParticle({
      x: wrapX(x + Math.cos(a) * r),
      y: y + Math.sin(a) * r,
      vx: -Math.cos(a) * speed,
      vy: -Math.sin(a) * speed,
      ttl: 0.12 + rand() * 0.08,
      age: 0,
      size: 1,
      colour: i % 3 === 0 ? '#fff5d8' : colour,
      kind: 'beam',
      rot: a,
      length: 14 + rand() * 16,
      width: 1.5 + rand() * 1.1,
    });
  }
}

// A proper confetti shower — small tumbling squares (the existing 'chunk'
// kind already falls under gravity with drag, see updateParticles) flung
// wide and given a longer hangtime than debris chunks so they flutter down
// like party confetti instead of a quick explosion burst.
function spawnConfetti(x: number, y: number, colours: readonly string[], count: number, power: number): void {
  const effective = particleSpawnCount(count, 'detail');
  for (let i = 0; i < effective; i += 1) {
    const a = rand() * Math.PI * 2;
    const speed = power * (0.35 + rand() * 0.85);
    emitParticle({
      x: wrapX(x + (rand() - 0.5) * 22),
      y: y + (rand() - 0.5) * 18,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed * 0.62 - 60,
      ttl: 1.15 + rand() * 1.2,
      age: 0,
      size: 2.2 + rand() * 4,
      colour: colours[i % colours.length] ?? '#fff5d8',
      kind: 'chunk',
      rot: rand() * Math.PI * 2,
      spin: (rand() - 0.5) * 11,
    });
  }
}

function spawnEmbers(x: number, y: number, colours: readonly string[], count: number, power: number): void {
  const effective = particleSpawnCount(count, 'detail');
  for (let i = 0; i < effective; i += 1) {
    const a = rand() * Math.PI * 2;
    const speed = power * (0.25 + rand() * 0.8);
    emitParticle({
      x: wrapX(x + (rand() - 0.5) * 16),
      y: y + (rand() - 0.5) * 12,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed * 0.7 - 40,
      ttl: 0.8 + rand() * 0.75,
      age: 0,
      size: 1.2 + rand() * 2.2,
      colour: colours[i % colours.length] ?? '#ffd84a',
      kind: 'spark',
      rot: rand() * Math.PI * 2,
      twinkle: true,
      grav: 150,
    });
  }
}

function spawnPickupFx(x: number, y: number, colour: string, big: boolean): void {
  // Arcade collect: absorb streaks into a white-hot pop, a rotating star
  // flare, staggered twin rings, then twinkling confetti and rising motes.
  spawnSuckStreaks(x, y, colour, big ? 9 : 7, big ? 92 : 74);
  spawnExplosionFlash(x, y, colour, big ? 64 : 48, 0.1);
  spawnFireball(x, y, ['#ffffff', '#fff5d8', colour], big ? 34 : 26, big ? 0.3 : 0.24);
  spawnStarFlare(x, y, '#fff5d8', big ? 88 : 64, 0.3, 2.6);
  spawnStarFlare(x, y, colour, big ? 56 : 40, 0.24, -3.4);
  spawnRing(x, y, colour, big ? 72 : 58);
  spawnRing(x, y, '#fff5d8', big ? 104 : 84);
  spawnSparkleBurst(x, y, [colour, '#fff5d8', '#ffd84a'], big ? 36 : 26, big ? 240 : 200);
  spawnRisingMotes(x, y, colour, big ? 10 : 7);
  if (big) {
    spawnShockwave(x, y, colour, 118, 0.3);
    state.shake = Math.max(state.shake, 0.08);
  }
}

function spawnEnemyKillFx(x: number, y: number, vx: number, vy: number, type: EnemyType): void {
  const colours = enemyDeathColours(type);
  const colour = enemyColour(type);
  const carrier = type === 'carrier';
  spawnBurst(x, y, colour, carrier ? 74 : type === 'abductor' ? 18 : 30, type === 'hunter' ? 250 : carrier ? 330 : 180);
  spawnDetailedExplosion(x, y, colours, carrier ? 1.55 : type === 'hunter' ? 0.95 : 0.76, vx, vy);
  const blast = carrier ? 1.5 : type === 'hunter' ? 0.92 : type === 'jammer' ? 0.86 : 0.78;
  // Hue-ramping fireball (white -> amber -> enemy colour), star flare,
  // tighter flash, then flickering embers raining out.
  spawnFireball(x, y, ['#ffffff', '#ffe9a8', '#ff9a3a', colours[0] ?? colour], carrier ? 168 : 58 + blast * 26, carrier ? 0.58 : 0.42);
  spawnStarFlare(x, y, '#fff5d8', carrier ? 240 : 96 + blast * 44, carrier ? 0.36 : 0.28, 1.8);
  spawnExplosionFlash(x, y, colours[0] ?? colour, carrier ? 224 : 70 + blast * 46, carrier ? 0.2 : 0.13);
  spawnShockwave(x, y, colour, carrier ? 190 : 80 + blast * 40, carrier ? 0.4 : 0.26);
  spawnRing(x, y, '#fff5d8', carrier ? 150 : 64 + blast * 30);
  spawnEmbers(x, y, colours, carrier ? 30 : 14 + Math.round(blast * 8), carrier ? 320 : 190 + blast * 70);
  // The donkey/bankster troll gets its own rainbow party-popper send-off
  // rather than the type-coloured confetti every other kill gets. It needs
  // to visibly out-do the normal type-coloured shower it's competing with
  // amid the rest of the kill FX above, or it just reads as "slightly more
  // confetti" — so it gets its own, much larger, higher-power burst rather
  // than a share of the same scale used for every other kill.
  const confettiColours = type === 'troll' ? RAINBOW_CONFETTI_COLOURS : colours;
  const confettiCount = carrier ? 46 : type === 'troll' ? 90 : 18 + Math.round(blast * 10);
  const confettiPower = carrier ? 300 : type === 'troll' ? 280 : 220 + blast * 60;
  spawnConfetti(x, y, confettiColours, confettiCount, confettiPower);
  if (type === 'troll') {
    // A joyful glitter-bomb pop rather than a violent blast: twinkling
    // sparks plus glitter that drifts *up* (spawnRisingMotes' negative
    // gravity) instead of falling debris, so the send-off reads as
    // celebratory, not destructive.
    spawnSparkleBurst(x, y, RAINBOW_CONFETTI_COLOURS, 70, 260);
    for (let i = 0; i < 3; i += 1) {
      spawnRisingMotes(x, y, RAINBOW_CONFETTI_COLOURS[(i * 3) % RAINBOW_CONFETTI_COLOURS.length] ?? '#fff5d8', 12);
    }
  }
  scheduleEnemyExplosionAftershock(state.runId, x, y, colours, blast, type);
  spawnEnemyDeathDebris(x, y, vx, vy, type, false);
  spawnRing(x, y, colour, carrier ? 104 : type === 'forgery' ? 54 : 38);
}

function signalById(id: number): Signal | null {
  return state.signals.find(s => s.id === id) ?? null;
}

function shipSpec(id: ShipClass = state.shipClass ?? selectedShip): ShipSpec {
  return SHIPS.find(ship => ship.id === id) ?? SHIPS[1]!;
}

function skillSpec(id: Skill = state.skill ?? selectedSkill): SkillSpec {
  return SKILLS.find(skill => skill.id === id) ?? SKILLS[1]!;
}

function relationWeight(s: Signal): number {
  return s.relation === 'high-wot' ? 3 : s.relation === 'mutual' ? 2 : 1;
}

function contactThreat(s: Signal): ContactThreat {
  const safeColour = relationColour(s.relation);
  const base: ContactThreat = {
    label: 'SAFE',
    enemy: null,
    capture: 0,
    approach: 0,
    urgency: 0,
    targeted: false,
    locking: false,
    colour: safeColour,
  };
  if (s.status === 'lost') return { ...base, label: 'LOST', colour: '#ff3aff' };
  if (s.status === 'saved') return { ...base, label: 'SAVED', colour: '#fff5d8' };
  if (s.status === 'returning') return { ...base, label: 'RETURN', colour: '#5effdb' };
  if (s.status === 'falling') {
    const groundGap = terrainY(s.x) - 22 - s.y;
    const impact = clamp(1 - groundGap / 270, 0, 1);
    const speedDanger = clamp(s.vy / 560, 0, 0.72);
    return {
      ...base,
      label: 'FALL',
      urgency: 3.15 + impact * 1.15 + speedDanger,
      targeted: true,
      colour: impact > 0.66 ? '#ff4d5e' : '#fff5d8',
    };
  }

  const carrier = state.enemies.find(e => e.alive && (e.id === s.carriedBy || e.carryId === s.id)) ?? null;
  if (s.status === 'carried' || carrier) {
    const climbDanger = clamp((PLAY_TOP + 128 - s.y) / 160, 0, 1);
    return {
      ...base,
      label: 'LIFT',
      enemy: carrier,
      capture: 1,
      urgency: 4.05 + climbDanger * 0.85 + relationWeight(s) * 0.08,
      targeted: true,
      locking: true,
      colour: '#ff4d5e',
    };
  }

  let bestEnemy: Enemy | null = null;
  let bestCapture = 0;
  let bestApproach = 0;
  let bestScore = 0;
  const lockTime = tunedCaptureLockTime();
  for (const e of state.enemies) {
    if (!e.alive || e.type !== 'abductor' || e.targetId !== s.id) continue;
    const dx = Math.abs(wrapDelta(e.x, s.x));
    const dy = Math.abs(e.y - (s.y - 82));
    const capture = clamp(e.captureCharge / Math.max(0.1, lockTime), 0, 1);
    const lateral = clamp(1 - Math.max(0, dx - 48) / 420, 0, 1);
    const vertical = clamp(1 - Math.max(0, dy - 34) / 240, 0, 1);
    const approach = clamp(lateral * 0.78 + vertical * 0.34, 0, 1);
    const score = capture * 3.2 + approach + relationWeight(s) * 0.08;
    if (score > bestScore) {
      bestEnemy = e;
      bestCapture = capture;
      bestApproach = approach;
      bestScore = score;
    }
  }

  if (!bestEnemy) return base;
  const locking = bestCapture > 0.03;
  const hot = bestCapture > 0.68;
  const urgency = locking
    ? 1.35 + bestCapture * 2.3 + relationWeight(s) * 0.12
    : 0.58 + bestApproach * 1.1 + relationWeight(s) * 0.1;
  return {
    label: locking ? 'LOCK' : 'TARGET',
    enemy: bestEnemy,
    capture: bestCapture,
    approach: bestApproach,
    urgency,
    targeted: true,
    locking,
    colour: hot ? '#ff4d5e' : locking ? '#ffd84a' : safeColour,
  };
}

function mostUrgentSignal(): Signal | null {
  let best: Signal | null = null;
  let bestScore = 0;
  for (const s of state.signals) {
    if (s.status === 'lost' || s.status === 'saved') continue;
    const urgency = signalUrgency(s);
    if (urgency <= 0) continue;
    const distancePenalty = Math.min(1.6, Math.abs(wrapDelta(s.x, state.ship.x)) / 1800);
    const score = urgency * 100 + relationWeight(s) * 9 - distancePenalty;
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

function radarThreatQueue(limit: number): Signal[] {
  return state.signals
    .filter(s => s.status !== 'lost' && s.status !== 'saved')
    .map(s => ({ signal: s, threat: contactThreat(s) }))
    .filter(item => item.threat.urgency > 0.55 || item.threat.targeted)
    .sort((a, b) => {
      const au = a.threat.urgency + relationWeight(a.signal) * 0.08;
      const bu = b.threat.urgency + relationWeight(b.signal) * 0.08;
      return bu - au;
    })
    .slice(0, limit)
    .map(item => item.signal);
}

function signalUrgency(s: Signal): number {
  return contactThreat(s).urgency;
}

function contactThreatEtaText(s: Signal, threat = contactThreat(s)): string {
  if (threat.label === 'FALL') {
    const groundGap = Math.max(0, terrainY(s.x) - 22 - s.y);
    const g = 410;
    const impactSeconds = (-s.vy + Math.sqrt(Math.max(0, s.vy * s.vy + 2 * g * groundGap))) / g;
    return `CATCH ${Math.max(1, Math.ceil(impactSeconds))}S`;
  }
  if (threat.label === 'LIFT') {
    const e = threat.enemy;
    const climbSpeed = e ? Math.max(90, Math.abs(e.vy || 150)) : 150 * carriedLiftSpeedScale();
    const forgeSeconds = Math.max(0.5, (s.y - (PLAY_TOP + 18)) / climbSpeed);
    return `SNATCH ${Math.max(1, Math.ceil(forgeSeconds))}S`;
  }
  if (threat.label === 'LOCK') {
    const remaining = (1 - threat.capture) * tunedCaptureLockTime() / 0.42;
    return `LIFT ${Math.max(1, Math.ceil(remaining))}S`;
  }
  if (threat.label === 'TARGET') return 'DEFEND';
  if (threat.label === 'LOST') return 'LOST';
  if (threat.label === 'SAVED') return 'SAVED';
  return 'SAFE';
}

function shipProtected(): boolean {
  // A TIME LOCKED ship can't dodge, so the aliens don't get to shoot it or
  // crash into it either — the lock costs clock and abduction ground, not hits.
  return state.ship.invuln > 0 || state.waveGrace > 0 || state.timeLock > 0;
}

function signalDisplayName(s: Signal): string {
  return profileDisplayName(s.profile, s.name);
}

function savedCalloutName(s: Signal): string {
  const name = signalDisplayName(s).trim() || 'Signal';
  return name === name.toLowerCase() ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

/**
 * Profile picture a signal is allowed to show. In 600B mode the roll of the
 * 600 billion is the guest list: only verified 600.wtf members get their
 * avatar; everyone else falls back to initials.
 */
function signalAvatarPicture(s: Signal): string | undefined {
  if (state.skill === '600b' && !isSixHundredMember(s.pubkey)) return undefined;
  return s.profile?.picture;
}

function profileImageForSignal(s: Signal): CanvasImageSource | null {
  const entry = ensureProfileImageEntry(signalAvatarPicture(s));
  if (entry?.loaded && entry.image) return entry.image;
  return null;
}

function ensureProfileImageEntry(picture: string | null | undefined): ProfileImageEntry | null {
  const candidates = profilePictureCandidates(picture);
  if (candidates.length === 0) return null;
  const cacheKey = candidates.join('|');
  const now = Date.now();
  const existing = profileImageCache.get(cacheKey);
  if (existing && existing.expiresAt > now) {
    return existing;
  }
  const entry: ProfileImageEntry = {
    image: null,
    loaded: false,
    failed: false,
    candidates,
    index: 0,
    expiresAt: now + PROFILE_IMAGE_TTL_MS,
  };
  profileImageCache.set(cacheKey, entry);
  enqueueProfileImageLoad(entry);
  return entry;
}

function enqueueProfileImageLoad(entry: ProfileImageEntry): void {
  pendingProfileImageLoads.push(entry);
  pumpProfileImageLoads();
}

function pumpProfileImageLoads(): void {
  while (activeProfileImageLoads < PROFILE_IMAGE_LOAD_LIMIT && pendingProfileImageLoads.length > 0) {
    const entry = pendingProfileImageLoads.shift()!;
    if (entry.loaded || entry.failed) continue;
    activeProfileImageLoads += 1;
    loadProfileImageCandidate(entry, () => {
      activeProfileImageLoads = Math.max(0, activeProfileImageLoads - 1);
      pumpProfileImageLoads();
    });
  }
}

function loadProfileImageCandidate(entry: ProfileImageEntry, done: () => void): void {
  const url = entry.candidates[entry.index];
  if (!url) {
    entry.failed = true;
    entry.expiresAt = Date.now() + PROFILE_IMAGE_FAILURE_RETRY_MS;
    done();
    return;
  }
  if (canUseCachedProfileImage(url)) {
    void loadCachedProfileImageSource(url)
      .then(source => {
        entry.image = source;
        entry.loaded = true;
        entry.failed = false;
        done();
      })
      .catch(() => advanceProfileImageCandidate(entry, done));
    return;
  }
  const image = new Image();
  image.decoding = 'async';
  image.loading = 'eager';
  image.referrerPolicy = 'no-referrer';
  image.onload = () => {
    const finish = () => {
      entry.image = rasterizeProfileImage(image);
      entry.loaded = true;
      entry.failed = false;
      done();
    };
    if (typeof image.decode === 'function') void image.decode().catch(() => undefined).finally(finish);
    else finish();
  };
  image.onerror = () => {
    advanceProfileImageCandidate(entry, done);
  };
  image.src = url;
}

function advanceProfileImageCandidate(entry: ProfileImageEntry, done: () => void): void {
  entry.index += 1;
  if (entry.index < entry.candidates.length) {
    loadProfileImageCandidate(entry, done);
    return;
  }
  entry.failed = true;
  entry.expiresAt = Date.now() + PROFILE_IMAGE_FAILURE_RETRY_MS;
  done();
}

function canUseCachedProfileImage(url: string): boolean {
  return url.startsWith('/api/profile-image') && typeof window.caches !== 'undefined' && typeof window.fetch === 'function';
}

async function loadCachedProfileImageSource(url: string): Promise<CanvasImageSource> {
  const request = new Request(url, { credentials: 'same-origin' });
  const cache = await window.caches.open(PROFILE_IMAGE_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached && cachedProfileImageFresh(cached)) {
    return imageSourceFromBlob(await cached.blob());
  }
  if (cached) await cache.delete(request);

  const response = await fetch(request);
  if (!response.ok) throw new Error('profile_image_fetch_failed');
  const type = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!type.startsWith('image/')) throw new Error('profile_image_not_image');
  const blob = await response.blob();
  const headers = new Headers(response.headers);
  headers.set(PROFILE_IMAGE_CACHED_AT, String(Date.now()));
  await cache.put(request, new Response(blob, {
    status: 200,
    statusText: 'OK',
    headers,
  })).catch(() => undefined);
  return imageSourceFromBlob(blob);
}

function cachedProfileImageFresh(response: Response): boolean {
  const cachedAt = Number(response.headers.get(PROFILE_IMAGE_CACHED_AT));
  return Number.isFinite(cachedAt) && Date.now() - cachedAt < PROFILE_IMAGE_TTL_MS;
}

function imageSourceFromBlob(blob: Blob): Promise<CanvasImageSource> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      try {
        resolve(rasterizeProfileImage(image));
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('profile_image_decode_failed'));
    };
    image.src = objectUrl;
  });
}

function rasterizeProfileImage(image: HTMLImageElement): CanvasImageSource {
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return image;
  try {
    const sprite = document.createElement('canvas');
    sprite.width = PROFILE_IMAGE_SPRITE_SIZE;
    sprite.height = PROFILE_IMAGE_SPRITE_SIZE;
    const spriteCtx = sprite.getContext('2d');
    if (!spriteCtx) return image;
    const sourceSide = Math.min(image.naturalWidth, image.naturalHeight);
    const sx = Math.max(0, (image.naturalWidth - sourceSide) * 0.5);
    const sy = Math.max(0, (image.naturalHeight - sourceSide) * 0.5);
    spriteCtx.imageSmoothingEnabled = true;
    spriteCtx.imageSmoothingQuality = 'medium';
    spriteCtx.drawImage(image, sx, sy, sourceSide, sourceSide, 0, 0, PROFILE_IMAGE_SPRITE_SIZE, PROFILE_IMAGE_SPRITE_SIZE);
    return sprite;
  } catch {
    return image;
  }
}

function drawProfileImageCircle(image: CanvasImageSource, x: number, y: number, radius: number, ringColour: string, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();
  const side = radius * 2;
  ctx.drawImage(image, x - radius, y - radius, side, side);
  const shade = ctx.createRadialGradient(x - radius * 0.28, y - radius * 0.34, radius * 0.12, x, y, radius);
  shade.addColorStop(0, 'rgba(255,255,255,0.18)');
  shade.addColorStop(0.62, 'rgba(255,255,255,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = shade;
  ctx.fillRect(x - radius, y - radius, side, side);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.strokeStyle = ringColour;
  ctx.shadowColor = ringColour;
  ctx.shadowBlur = 8;
  ctx.lineWidth = Math.max(1.2, radius * 0.09);
  ctx.beginPath();
  ctx.arc(x, y, radius + 1.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function relationColour(relation: Relation): string {
  if (relation === 'high-wot') return '#ffd84a';
  if (relation === 'mutual') return '#8cffb4';
  return '#5effdb';
}

function radarJammerStrength(): number {
  let strength = 0;
  for (const e of state.enemies) {
    if (!e.alive || e.type !== 'jammer') continue;
    const distance = distWrapped(e.x, e.y, state.ship.x, state.ship.y);
    const local = clamp(1 - distance / 1850, 0, 1);
    strength = Math.max(strength, 0.08 + local * (0.34 + e.captureCharge * 0.18));
  }
  return clamp(strength, 0, 0.62);
}

function enemyColour(type: EnemyType): string {
  if (type === 'carrier') return '#ff2f7a';
  if (type === 'forgery') return '#ff3aff';
  if (type === 'jammer') return '#5f7cff';
  if (type === 'hunter') return '#ff8a3a';
  if (type === 'spammer') return '#8f5bff';
  if (type === 'sybil') return '#ff5ad1';
  if (type === 'troll') return '#96ff3c';
  return '#ff4d5e';
}

function enemyShotColour(kind: EnemyShotKind): string {
  if (kind === 'jam') return '#5f7cff';
  if (kind === 'barrage') return '#ff2f7a';
  if (kind === 'spam') return '#b14dff';
  return '#ff334e';
}

function enemyRadarCode(type: EnemyType): string {
  if (type === 'carrier') return 'C';
  if (type === 'forgery') return 'F';
  if (type === 'jammer') return 'J';
  if (type === 'hunter') return 'H';
  if (type === 'spammer') return 'S';
  if (type === 'sybil') return 'Y';
  if (type === 'troll') return 'T';
  return 'A';
}

function relayColumnState(worldX: number): RelayColumnState {
  let best = 0;
  let colour = '#5effdb';
  let highValue = false;
  let contactCount = 0;
  for (const s of state.signals) {
    const delta = Math.abs(wrapDelta(s.homeX, worldX));
    if (delta > RELAY_COLUMN_HALF * 0.82) continue;
    contactCount += 1;
    highValue ||= s.relation === 'high-wot';
    const threat = contactThreat(s);
    const relationBoost = relationWeight(s) * 0.055;
    const statusBoost = s.status === 'falling' ? 0.74 : s.status === 'carried' ? 0.92 : s.status === 'lost' ? 0.28 : 0;
    const homeBoost = clamp(1 - delta / Math.max(1, RELAY_COLUMN_HALF * 0.82), 0, 1) * 0.18;
    const score = threat.urgency * 0.24 + statusBoost + relationBoost + homeBoost;
    if (score > best) {
      best = score;
      colour = threat.targeted ? threat.colour : relationColour(s.relation);
    }
  }
  const lowCampTower = state.lowCamp > 0.18 && Math.abs(wrapDelta(worldX, state.ship.x)) < 430;
  if (lowCampTower) {
    const camp = clamp(state.lowCamp / 2.6, 0, 1);
    if (camp > best) {
      best = camp;
      colour = camp > 0.58 ? '#ff2f7a' : '#ff8a3a';
    }
  }
  const intensity = clamp(best, 0, 1);
  return {
    active: intensity > 0.16 || lowCampTower,
    highValue,
    intensity,
    colour: highValue && intensity < 0.18 ? '#ffd84a' : colour,
    contactCount,
  };
}

function nearestRelayColumnX(x: number): number {
  return wrapX(Math.round(x / RELAY_COLUMN_SPACING) * RELAY_COLUMN_SPACING);
}

function terrainY(x: number): number {
  const basin = Math.sin(x * 0.0022 + 0.4) * 18;
  const ridge = Math.sin(x * 0.0067 + 1.2) * 16;
  const serration = Math.sin(x * 0.019 + Math.sin(x * 0.003) * 1.6) * 7;
  const teeth = (Math.abs(Math.sin(x * 0.043 + 0.8)) - 0.5) * 5.5;
  const mesa = -(Math.max(0, Math.sin(x * 0.0048 - 0.7)) ** 3) * 34;
  const crater = Math.max(0, Math.sin(x * 0.0079 + 2.1)) ** 5 * 13;
  return clamp(GROUND_BASE + basin + ridge + serration + teeth + mesa + crater, GROUND_BASE - 78, GROUND_BASE + 20);
}

function screenX(worldX: number): number {
  return VIEW_W / 2 + wrapDelta(worldX, cameraX);
}

function screenShake(t: number): { x: number; y: number } {
  if (state.shake <= 0) return { x: 0, y: 0 };
  const calm = getReducedEffects() ? 0.3 : 1;
  const a = Math.min(state.shipDestroyed ? 26 : 16, state.shake * (state.shipDestroyed ? 22 : 18)) * calm;
  return { x: Math.sin(t * 91) * a, y: Math.cos(t * 83) * a * 0.65 };
}

function fitCanvas(): void {
  const dpr = renderPixelRatio();
  const wantW = Math.floor(VIEW_W * dpr);
  const wantH = Math.floor(VIEW_H * dpr);
  if (canvas.width !== wantW || canvas.height !== wantH) {
    canvas.width = wantW;
    canvas.height = wantH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function renderPixelRatio(): number {
  const raw = window.devicePixelRatio || 1;
  const cap = MAX_RENDER_DPR;
  return Math.max(1, Math.min(cap, raw));
}

function lowCostRender(): boolean {
  return renderQualityLow;
}

function isPortraitViewport(): boolean {
  return window.innerHeight > window.innerWidth;
}

// The PWA renders under the notch and home indicator (viewport-fit=cover), so
// canvas layouts need the safe-area insets. env() is CSS-only; measuring
// hidden probe elements is the reliable way to read it from script. Probes are
// created once and re-measured only after resize/rotation.
let safeAreaProbeTop: HTMLDivElement | null = null;
let safeAreaProbeBottom: HTMLDivElement | null = null;
let safeAreaCssPx = { top: 0, bottom: 0 };
let safeAreaDirty = true;

function safeAreaCssInsets(): { top: number; bottom: number } {
  if (!safeAreaDirty) return safeAreaCssPx;
  if (!safeAreaProbeTop || !safeAreaProbeBottom) {
    const makeProbe = (edge: 'top' | 'bottom'): HTMLDivElement => {
      const el = document.createElement('div');
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = `position:fixed;left:0;width:1px;visibility:hidden;pointer-events:none;${edge}:0;height:env(safe-area-inset-${edge},0px);`;
      document.body.appendChild(el);
      return el;
    };
    safeAreaProbeTop = makeProbe('top');
    safeAreaProbeBottom = makeProbe('bottom');
    window.addEventListener('resize', () => { safeAreaDirty = true; });
    window.addEventListener('orientationchange', () => { safeAreaDirty = true; });
  }
  safeAreaCssPx = { top: safeAreaProbeTop.offsetHeight, bottom: safeAreaProbeBottom.offsetHeight };
  safeAreaDirty = false;
  return safeAreaCssPx;
}

function visibleCanvasRect(): VisibleCanvasRect {
  const rect = canvas.getBoundingClientRect();
  const visual = window.visualViewport;
  const vpX = visual?.offsetLeft ?? 0;
  const vpY = visual?.offsetTop ?? 0;
  const vpW = visual?.width ?? window.innerWidth;
  const vpH = visual?.height ?? window.innerHeight;
  const sx = rect.width / VIEW_W || 1;
  const sy = rect.height / VIEW_H || 1;
  const x1 = clamp((vpX - rect.left) / sx, 0, VIEW_W);
  const y1 = clamp((vpY - rect.top) / sy, 0, VIEW_H);
  const x2 = clamp((vpX + vpW - rect.left) / sx, 0, VIEW_W);
  const y2 = clamp((vpY + vpH - rect.top) / sy, 0, VIEW_H);
  const w = Math.max(1, x2 - x1);
  const h = Math.max(1, y2 - y1);
  const insets = safeAreaCssInsets();
  return {
    x: x1,
    y: y1,
    w,
    h,
    centerX: x1 + w / 2,
    centerY: y1 + h / 2,
    portrait: vpH > vpW,
    cropped: w < VIEW_W * 0.84 || h < VIEW_H * 0.84,
    safeTop: clamp(insets.top / sy, 0, 120),
    safeBottom: clamp(insets.bottom / sy, 0, 90),
  };
}

function usePortraitHud(viewport: VisibleCanvasRect): boolean {
  return viewport.portrait && viewport.cropped;
}

function viewportPaceMultiplier(): number {
  const viewport = visibleCanvasRect();
  if (usePortraitHud(viewport)) return 0.92;
  return viewport.cropped ? 0.98 : 1.0;
}

function shipViewportFeel(viewport: VisibleCanvasRect): {
  touchMul: number;
  xDrag: number;
  yDrag: number;
  yAccel: number;
  reverseBrake: number;
  maxX: number;
  maxY: number;
  lookAhead: number;
  maxLookAhead: number;
  cameraLag: number;
} {
  if (usePortraitHud(viewport)) {
    return {
      touchMul: 1.08,
      xDrag: 1.02,
      yDrag: 0.86,
      yAccel: 1.5,
      reverseBrake: 1.12,
      maxX: 0.64,
      maxY: 0.89,
      lookAhead: 0.11,
      maxLookAhead: 56,
      cameraLag: 0.009,
    };
  }
  if (viewport.cropped) {
    return {
      touchMul: 1.06,
      xDrag: 1.01,
      yDrag: 0.9,
      yAccel: 1.48,
      reverseBrake: 1.14,
      maxX: 0.7,
      maxY: 0.93,
      lookAhead: 0.18,
      maxLookAhead: 114,
      cameraLag: 0.008,
    };
  }
  return {
    touchMul: 1.04,
    xDrag: 1,
    yDrag: 0.86,
    yAccel: 1.54,
    reverseBrake: 1.2,
    maxX: 0.78,
    maxY: 0.98,
    lookAhead: 0.22,
    maxLookAhead: 154,
    cameraLag: 0.006,
  };
}

function axis(pos: string, alt: string): number {
  return keys.has(pos) || keys.has(alt) ? 1 : 0;
}

function consume(code: string): boolean {
  if (!pressedOnce.has(code)) return false;
  pressedOnce.delete(code);
  return true;
}

function consumeStart(): boolean {
  return consume('Enter') || consume('Space') || consume('PointerStart');
}

function shouldBufferKeyPress(code: string): boolean {
  if (state.phase === 'playing') {
    return code === 'KeyX' || code === 'KeyK' || code === 'ShiftLeft' || code === 'ShiftRight';
  }
  if (state.phase === 'gameover') {
    return code === 'Enter' || code === 'Space' || code === 'KeyS' || code === 'KeyP'
      || code === 'Escape' || code === 'KeyQ' || code === 'Backspace' || code === 'KeyV'
      || code === 'KeyR';
  }
  return code === 'Enter' || code === 'Space';
}

function handleTitlePaymentModalKey(code: string): boolean {
  if (!titlePaymentModalOpen) return false;
  if (code === 'Escape' || code === 'Backspace') {
    closeTitlePaymentModal();
    return true;
  }
  if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown' || code === 'Tab') {
    titlePaymentAction = titlePaymentAction === 'copy' ? 'close' : 'copy';
    playAudio('lock', 0.42);
    return true;
  }
  if (code === 'Enter' || code === 'Space') {
    if (titlePaymentAction === 'copy') copyTitlePaymentTarget();
    else closeTitlePaymentModal();
    return true;
  }
  if (code === 'KeyC') {
    titlePaymentAction = 'copy';
    copyTitlePaymentTarget();
    return true;
  }
  return true;
}

function handleTitleMenuKey(code: string): boolean {
  if (handleTitlePaymentModalKey(code)) return true;
  if (code === 'ArrowUp') {
    moveTitleMenuField(-1);
    return true;
  }
  if (code === 'ArrowDown') {
    moveTitleMenuField(1);
    return true;
  }
  if (code === 'Enter' || code === 'Space') {
    if (titleMenuField === 'guest') void startGuestRunFromTitle();
    else if (titleMenuField === 'login') void startNostrRunFromTitle();
    else if (titleMenuField === 'logout') void logoutFromTitle();
    else if (titleMenuField === 'start') void startSelectedRunFromTitle();
    else if (titleMenuField === 'daily') toggleDailyGauntlet();
    else if (isTitleValueField(titleMenuField)) activateTitleValueLink(titleMenuField);
    else moveTitleMenuField(1);
    return true;
  }
  if (code === 'ArrowLeft' || code === 'ArrowRight') {
    const authFields = titleAuthMenuFields();
    const valueFields = titleValueMenuFields();
    if (authFields.includes(titleMenuField)) {
      const index = authFields.indexOf(titleMenuField);
      titleMenuField = authFields[clamp(index + (code === 'ArrowRight' ? 1 : -1), 0, authFields.length - 1)] ?? titleMenuField;
      playAudio('lock', 0.48);
    } else if (isTitleValueField(titleMenuField) && valueFields.includes(titleMenuField)) {
      const index = valueFields.indexOf(titleMenuField);
      titleMenuField = valueFields[clamp(index + (code === 'ArrowRight' ? 1 : -1), 0, valueFields.length - 1)] ?? titleMenuField;
      playAudio('lock', 0.48);
    } else {
      cycleTitleMenuChoice(code === 'ArrowRight' ? 1 : -1);
      playAudio('lock', 0.48);
    }
    return true;
  }
  return false;
}

function handlePauseMenuKey(code: string): boolean {
  if (code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight') {
    pauseMenuChoice = pauseMenuChoice === 'resume' ? 'quit' : 'resume';
    playAudio('lock', 0.42);
    return true;
  }
  if (code === 'Enter' || code === 'Space') {
    if (pauseMenuChoice === 'resume') resumeRun();
    else quitPausedRunToTitle();
    return true;
  }
  if (code === 'KeyQ' || code === 'Backspace') {
    pauseMenuChoice = 'quit';
    quitPausedRunToTitle();
    return true;
  }
  return false;
}

function cycleTitleMenuChoice(delta: number): void {
  cycleTitleMenuChoiceFor(titleMenuField, delta);
}

function cycleTitleMenuChoiceFor(field: TitleMenuField, delta: number): void {
  if (field === 'ship') {
    const index = SHIPS.findIndex(ship => ship.id === selectedShip);
    selectedShip = SHIPS[wrapIndex(index + delta, SHIPS.length)]?.id ?? selectedShip;
  } else if (field === 'pressure') {
    const index = SKILLS.findIndex(skill => skill.id === selectedSkill);
    selectedSkill = SKILLS[wrapIndex(index + delta, SKILLS.length)]?.id ?? selectedSkill;
  }
}

function moveTitleMenuField(delta: number): void {
  const fields: readonly TitleMenuField[] = [...titleAuthMenuFields(), 'ship', 'pressure', 'start', 'daily', ...titleValueMenuFields()];
  const index = fields.indexOf(titleMenuField);
  const next = fields[clamp(index + delta, 0, fields.length - 1)] ?? titleMenuField;
  if (next !== titleMenuField) {
    titleMenuField = next;
    playAudio('lock', 0.42);
  }
}

function titleAuthMenuFields(): readonly TitleMenuField[] {
  return activeNostrSession() ? ['guest', 'login', 'logout'] : ['guest', 'login'];
}

function titleValueMenuFields(): readonly TitleValueField[] {
  return VALUE_FOR_VALUE.links.map(link => valueActionForLink(link.id));
}

function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

function wrapX(x: number): number {
  let v = x % WORLD_W;
  if (v < 0) v += WORLD_W;
  return v;
}

function wrapDelta(a: number, b: number): number {
  let d = a - b;
  if (d > WORLD_W / 2) d -= WORLD_W;
  if (d < -WORLD_W / 2) d += WORLD_W;
  return d;
}

function distWrapped(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(wrapDelta(ax, bx), ay - by);
}

function lerpWrap(from: number, to: number, t: number): number {
  return wrapX(from + wrapDelta(to, from) * t);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function colourWithAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function initials(name: string): string {
  return name
    .split(/[-_\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function unlockGameAudio(): void {
  unlockAudio();
  if (!musicGesturePrimed) {
    musicGesturePrimed = true;
    musicResetElements();
    preloadCriticalTracks();
    musicWarmUpAll(currentTrackId() ?? undefined);
    musicForceRefresh();
    playAudio('wave', 0.42);
  }
  syncMusicToState();
  refreshAudioPanel?.();
  refreshMusicPanel?.();
}

function setupAudioControls(): void {
  const root = document.getElementById('audio-controls');
  if (!root) return;
  root.textContent = '';
  const sliders: Array<{ input: HTMLInputElement; output: HTMLOutputElement; get: () => number }> = [];
  const addSlider = (label: string, get: () => number, set: (value: number) => void): void => {
    const wrap = document.createElement('label');
    wrap.className = 'audio-slider';
    const text = document.createElement('span');
    text.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '1';
    input.value = String(Math.round(get() * 100));
    const output = document.createElement('output');
    output.textContent = input.value;
    input.addEventListener('input', () => {
      unlockGameAudio();
      const value = clamp(input.valueAsNumber / 100, 0, 1);
      set(value);
      output.textContent = String(Math.round(value * 100));
      refreshAudioPanel?.();
    });
    wrap.append(text, input, output);
    root.append(wrap);
    sliders.push({ input, output, get });
  };

  addSlider('MASTER', getMasterVolume, setMasterVolume);
  addSlider('MUSIC', getMusicVolume, setMusicVolume);
  addSlider('SFX', getSfxVolume, setSfxVolume);

  const mute = document.createElement('button');
  mute.type = 'button';
  mute.className = 'audio-mute';
  mute.addEventListener('click', () => {
    unlockGameAudio();
    setMuted(!isMuted());
    refreshAudioPanel?.();
  });
  root.append(mute);

  const test = document.createElement('button');
  test.type = 'button';
  test.className = 'audio-test';
  test.textContent = 'TEST';
  test.addEventListener('click', () => {
    unlockGameAudio();
    playAudio('laserArcade', 0.72);
    window.setTimeout(() => playAudio('enemyBoom', 0.82), 95);
    window.setTimeout(() => playAudio('rescue', 0.78), 230);
    refreshAudioPanel?.();
  });
  root.append(test);

  const diagnostic = document.createElement('output');
  diagnostic.className = 'audio-diagnostic';
  diagnostic.setAttribute('aria-live', 'polite');
  root.append(diagnostic);

  refreshAudioPanel = () => {
    for (const { input, output, get } of sliders) {
      if (document.activeElement !== input) input.value = String(Math.round(get() * 100));
      output.textContent = String(Math.round(get() * 100));
    }
    mute.textContent = isMuted() ? 'MUTED' : 'M';
    mute.classList.toggle('is-muted', isMuted());
    const audio = getAudioDebugSnapshot();
    const track = getMusicDebugSnapshot();
    diagnostic.textContent = `AUDIO ${audio.context.toUpperCase()} ${audio.unlocked ? 'UNLOCKED' : 'LOCKED'} M${Math.round(audio.master * 100)} MU${Math.round(audio.music * 100)} S${Math.round(audio.sfx * 100)} ${audio.muted ? 'MUTED' : 'LIVE'} TRACK ${track.currentId ?? 'NONE'} ${track.paused === null ? '-' : track.paused ? 'PAUSED' : 'PLAY'}`;
  };
  refreshAudioPanel();
}

function setupMusicPlayer(): void {
  const root = document.getElementById('music-player');
  if (!root) return;
  root.textContent = '';

  const left = document.createElement('div');
  left.style.cssText = 'display:grid;gap:6px;min-width:0;';
  const viz = document.createElement('canvas');
  viz.className = 'music-viz';
  viz.width = 320;
  viz.height = 156;
  const transport = document.createElement('div');
  transport.className = 'music-transport';
  const now = document.createElement('div');
  now.className = 'music-now';
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'music-stop';
  stop.textContent = 'STOP';
  transport.append(now, stop);
  left.append(viz, transport);

  const list = document.createElement('div');
  list.className = 'music-list';
  list.tabIndex = 0;
  list.setAttribute('role', 'listbox');
  const tracks = [...listTracks()];
  const trackById = new Map(tracks.map(track => [track.id, track]));
  const rows: Array<{ id: string; el: HTMLButtonElement; glyph: HTMLElement }> = [];
  let selectedMusicRow = 0;

  const selectMusicRow = (index: number, focus = false): void => {
    if (rows.length === 0) return;
    selectedMusicRow = wrapIndex(index, rows.length);
    const row = rows[selectedMusicRow];
    if (focus && row) {
      row.el.focus({ preventScroll: true });
      row.el.scrollIntoView({ block: 'nearest' });
    }
    refreshMusicPanel?.();
  };

  for (const track of tracks) {
    const rowIndex = rows.length;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'music-track';
    row.tabIndex = -1;
    row.setAttribute('role', 'option');
    const glyph = document.createElement('span');
    glyph.className = 'music-glyph';
    glyph.textContent = '.';
    const copy = document.createElement('span');
    copy.className = 'music-copy';
    const label = document.createElement('span');
    label.className = 'music-label';
    label.textContent = track.label;
    const hint = document.createElement('span');
    hint.className = 'music-hint';
    hint.textContent = track.hint;
    copy.append(label, hint);
    const wave = document.createElement('span');
    wave.className = 'music-wave';
    wave.textContent = track.wave === null ? track.category.toUpperCase() : `W${track.wave}`;
    row.append(glyph, copy, wave);
    row.addEventListener('click', () => {
      selectedMusicRow = rowIndex;
      unlockGameAudio();
      musicPreviewPlay(track.id);
      refreshMusicPanel?.();
    });
    row.addEventListener('focus', () => {
      selectedMusicRow = rowIndex;
      refreshMusicPanel?.();
    });
    list.append(row);
    rows.push({ id: track.id, el: row, glyph });
  }

  list.addEventListener('keydown', ev => {
    if (ev.code === 'ArrowDown' || ev.code === 'ArrowRight') {
      ev.preventDefault();
      ev.stopPropagation();
      unlockGameAudio();
      selectMusicRow(selectedMusicRow + 1, true);
    } else if (ev.code === 'ArrowUp' || ev.code === 'ArrowLeft') {
      ev.preventDefault();
      ev.stopPropagation();
      unlockGameAudio();
      selectMusicRow(selectedMusicRow - 1, true);
    } else if (ev.code === 'Enter' || ev.code === 'Space') {
      ev.preventDefault();
      ev.stopPropagation();
      unlockGameAudio();
      rows[selectedMusicRow]?.el.click();
    }
  });
  list.addEventListener('focus', () => selectMusicRow(selectedMusicRow, true));
  root.addEventListener('focusin', () => refreshMusicPanel?.());
  root.addEventListener('focusout', () => window.setTimeout(() => refreshMusicPanel?.(), 0));

  stop.addEventListener('click', () => {
    unlockGameAudio();
    musicStop(260);
    refreshMusicPanel?.();
  });

  root.append(left, list);
  drawMusicViz(viz);

  let lastPainted = '';
  refreshMusicPanel = () => {
    const active = currentTrackId();
    const debug = getMusicDebugSnapshot();
    const listHasFocus = list.contains(document.activeElement);
    const key = `${active ?? 'none'}|${debug.paused ?? 'x'}|${debug.readyState ?? 'x'}|${getAudioContextState()}|${isAudioUnlocked()}|${listHasFocus}|${selectedMusicRow}`;
    if (key === lastPainted) return;
    lastPainted = key;
    const track = active ? trackById.get(active) : null;
    const activeIndex = rows.findIndex(row => row.id === active);
    if (!listHasFocus && activeIndex >= 0) selectedMusicRow = activeIndex;
    const stateLabel = !isAudioUnlocked()
      ? 'TAP TO ENABLE MUSIC'
      : track
        ? `${track.label} · ${getAudioContextState().toUpperCase()}`
        : 'SILENCE';
    now.textContent = stateLabel;
    for (const [index, row] of rows.entries()) {
      const activeRow = row.id === active;
      const selectedRow = listHasFocus && index === selectedMusicRow;
      row.el.classList.toggle('is-active', activeRow);
      row.el.classList.toggle('is-selected', selectedRow && !activeRow);
      row.el.setAttribute('aria-selected', String(selectedRow || activeRow));
      row.glyph.textContent = activeRow ? '>' : '.';
    }
  };
  refreshMusicPanel();
  window.setInterval(() => refreshMusicPanel?.(), 800);
}

function drawMusicViz(canvas: HTMLCanvasElement): void {
  const cctx = canvas.getContext('2d');
  if (!cctx) return;
  const bars = 34;
  const freq = new Uint8Array(512);
  const time = new Uint8Array(1024);
  const draw = (): void => {
    if (!document.body.contains(canvas)) return;
    // The settings panel is closed most of the time; idle on a slow poll
    // instead of painting gradients and shadow-blurred bars nobody can see.
    if (canvas.offsetParent === null) {
      window.setTimeout(() => requestAnimationFrame(draw), 500);
      return;
    }
    const w = canvas.width;
    const h = canvas.height;
    cctx.clearRect(0, 0, w, h);
    const bg = cctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, 'rgba(2,4,11,0.96)');
    bg.addColorStop(1, 'rgba(6,18,26,0.92)');
    cctx.fillStyle = bg;
    cctx.fillRect(0, 0, w, h);

    let bass = 0.08 + Math.sin(performance.now() * 0.003) * 0.04;
    if (isAudioUnlocked()) {
      const analyser = getMusicAnalyser();
      analyser.getByteFrequencyData(freq);
      analyser.getByteTimeDomainData(time);
      bass = 0;
      for (let i = 0; i < 8; i += 1) bass += freq[i] / 255;
      bass /= 8;
    }

    const glow = cctx.createRadialGradient(w * 0.5, h, 4, w * 0.5, h, h * (0.55 + bass * 0.55));
    glow.addColorStop(0, `rgba(94,255,219,${0.12 + bass * 0.22})`);
    glow.addColorStop(1, 'rgba(94,255,219,0)');
    cctx.fillStyle = glow;
    cctx.fillRect(0, 0, w, h);

    const gap = 3;
    const barW = (w - gap * (bars + 1)) / bars;
    const grad = cctx.createLinearGradient(0, h - 12, 0, 8);
    grad.addColorStop(0, '#5effdb');
    grad.addColorStop(0.56, '#ffd84a');
    grad.addColorStop(1, '#ff4d8d');
    cctx.fillStyle = grad;
    cctx.shadowColor = '#5effdb';
    cctx.shadowBlur = 10;
    for (let i = 0; i < bars; i += 1) {
      const sample = isAudioUnlocked()
        ? freq[Math.min(freq.length - 1, Math.floor((i / bars) ** 1.8 * freq.length))] / 255
        : 0.16 + Math.sin(performance.now() * 0.004 + i * 0.64) * 0.12;
      const value = clamp(sample, 0.035, 1);
      const bh = value * (h - 22);
      const x = gap + i * (barW + gap);
      cctx.fillRect(x, h - 10 - bh, barW, bh);
    }
    cctx.shadowBlur = 0;

    cctx.strokeStyle = `rgba(255,245,216,${0.34 + bass * 0.36})`;
    cctx.lineWidth = 1.3;
    cctx.beginPath();
    for (let x = 0; x < w; x += 1) {
      const idx = Math.min(time.length - 1, Math.floor((x / w) * time.length));
      const sample = isAudioUnlocked() ? (time[idx] - 128) / 128 : Math.sin(x * 0.035 + performance.now() * 0.004) * 0.28;
      const y = h * 0.58 + sample * (9 + bass * 28);
      if (x === 0) cctx.moveTo(x, y);
      else cctx.lineTo(x, y);
    }
    cctx.stroke();
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

function setupAudioLifecycle(): void {
  let visibilityTimer: number | null = null;
  const hardSilence = (): void => {
    musicSetPaused(true);
    suspendPlayback();
  };
  const hardResume = (): void => {
    resumePlayback();
    musicSetPaused(false);
    musicForceRefresh();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (visibilityTimer !== null) {
        clearTimeout(visibilityTimer);
        visibilityTimer = null;
      }
      resumePlayback();
      musicSetMuted(false);
      musicSetPaused(false);
      musicForceRefresh();
    } else {
      if (visibilityTimer !== null) clearTimeout(visibilityTimer);
      visibilityTimer = window.setTimeout(() => {
        visibilityTimer = null;
        musicSetMuted(true);
      }, 800);
    }
  });
  window.addEventListener('pagehide', hardSilence);
  window.addEventListener('pageshow', hardResume);
  document.addEventListener('freeze', hardSilence);
}

// Physical-keyboard fast path for the arcade name entry (capture phase, so
// consumed keys never reach the game's own keydown handling below).
window.addEventListener('keydown', ev => {
  if (state.phase !== 'gameover' || gameOverStage !== 'name') return;
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  let consumed = true;
  if (ev.code === 'Backspace') nameEntryBackspace();
  else if (ev.code === 'Enter' || ev.code === 'NumpadEnter') commitGameOverName();
  else if (ev.code === 'Escape') skipGameOverName();
  else if (ev.code === 'Space') nameEntryAppend(' ');
  else if (ev.key.length === 1 && /[a-z0-9 ]/i.test(ev.key)) nameEntryAppend(ev.key);
  else consumed = false;
  if (consumed) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
  }
}, true);

window.addEventListener('keydown', ev => {
  unlockGameAudio();
  markPlayerActivity();
  if (attractMode) {
    // Any key ends the demo; the press is consumed so it cannot also start
    // a run or toggle anything on the title underneath.
    exitAttractRun();
    ev.preventDefault();
    return;
  }
  if (ev.code === 'Escape') {
    if (state.phase === 'title' && titlePaymentModalOpen) closeTitlePaymentModal();
    else if (state.phase === 'playing') pauseRun();
    else if (state.phase === 'paused') resumeRun();
    // Game over consumes Escape from the buffer (support advance, menu);
    // returning without buffering here left ESC dead on that screen.
    else if (state.phase === 'gameover') pressedOnce.add('Escape');
    ev.preventDefault();
    return;
  }
  if (state.phase === 'paused') {
    if (handlePauseMenuKey(ev.code)) {
      ev.preventDefault();
      return;
    }
  }
  if (state.phase === 'title') {
    if (handleTitleMenuKey(ev.code)) {
      ev.preventDefault();
      return;
    }
    if (ev.code === 'Digit1') {
      selectedShip = 'interceptor';
      titleMenuField = 'ship';
    } else if (ev.code === 'Digit2') {
      selectedShip = 'guardian';
      titleMenuField = 'ship';
    } else if (ev.code === 'Digit3') {
      selectedShip = 'heavy';
      titleMenuField = 'ship';
    } else if (ev.code === 'Digit4') {
      selectedSkill = 'cadet';
      titleMenuField = 'pressure';
    } else if (ev.code === 'Digit5') {
      selectedSkill = 'normal';
      titleMenuField = 'pressure';
    } else if (ev.code === 'Digit6') {
      selectedSkill = '600b';
      titleMenuField = 'pressure';
    }
  }
  if (ev.code === 'KeyM') {
    setMuted(!isMuted());
    refreshAudioPanel?.();
    ev.preventDefault();
  }
  if (!keys.has(ev.code) && shouldBufferKeyPress(ev.code)) pressedOnce.add(ev.code);
  keys.add(ev.code);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(ev.code)) ev.preventDefault();
});

window.addEventListener('keyup', ev => {
  keys.delete(ev.code);
});

canvas.addEventListener('pointerdown', ev => {
  unlockGameAudio();
  markPlayerActivity();
  if (attractMode) {
    exitAttractRun();
    ev.preventDefault();
    return;
  }
  if (state.phase === 'title') {
    const point = canvasPointFromPointer(ev);
    if (point) handleTitlePointerAction(point.x, point.y);
    ev.preventDefault();
    return;
  }
  if (state.phase === 'paused') {
    const point = canvasPointFromPointer(ev);
    const action = point ? pauseMenuActionAt(point.x, point.y) : null;
    if (action === 'resume') resumeRun();
    else if (action === 'quit') quitPausedRunToTitle();
    ev.preventDefault();
    return;
  }
  if (state.phase === 'gameover') {
    const point = canvasPointFromPointer(ev);
    if (gameOverSupportOpen) {
      // The support screen now opens itself at death; keep the panic-tap
      // guard so the moment of death cannot buy anything by accident.
      if (Date.now() - state.finishedAt < 900) {
        ev.preventDefault();
        return;
      }
      const valueAction = point ? valueMethodActionAt(point.x, point.y) : null;
      const confirmAction = !valueAction && point ? valueConfirmActionAt(point.x, point.y) : null;
      if (valueAction) {
        activateScoreValueLink(valueAction);
      } else if (confirmAction === 'paid') {
        valueThanksVisible = true;
        supportActionStatus = null;
        supportNudgeLine = null;
        setScoreStatus('THANK YOU · SATS APPRECIATED');
        playAudio('rescue', 0.85);
        syncScoreActions();
      } else if (confirmAction === 'later') {
        setScoreStatus('NO WORRIES · CATCH US NEXT RUN');
        playAudio('lock', 0.4);
        advanceGameOverSupport();
        syncScoreActions();
      } else if (valueThanksVisible) {
        // Thank-you acknowledged with a tap anywhere — move the flow on.
        advanceGameOverSupport();
      } else if (gameOverStage !== 'support') {
        // Reopened from the score screen: tapping outside still just closes.
        gameOverSupportOpen = false;
      }
      ev.preventDefault();
      return;
    }
    if (gameOverStage === 'name') {
      if (point && Date.now() - state.finishedAt > 900) {
        const key = nameEntryKeyAt(point.x, point.y);
        if (key?.act === 'char' && key.char) nameEntryAppend(key.char);
        else if (key?.act === 'space') nameEntryAppend(' ');
        else if (key?.act === 'backspace') nameEntryBackspace();
        else if (key?.act === 'skip') skipGameOverName();
        else if (key?.act === 'done') commitGameOverName();
      }
      ev.preventDefault();
      return;
    }
    if (point && Date.now() - state.finishedAt > 900) {
      const viewport = visibleCanvasRect();
      const pills = gameOverPillRects(viewport);
      if (pointInRect(point.x, point.y, pills.support)) {
        openGameOverSupport();
        ev.preventDefault();
        return;
      }
      if (pointInRect(point.x, point.y, pills.menu)) {
        returnGameOverToTitle();
        ev.preventDefault();
        return;
      }
      // The score table reads as a menu surface, not the arena — a tap there
      // should land on the title screen, not relaunch a run.
      if (pointInRect(point.x, point.y, gameOverLeaderboardRect(viewport))) {
        returnGameOverToTitle();
        ev.preventDefault();
        return;
      }
    }
    pressedOnce.add('PointerStart');
    return;
  }
  if (state.phase !== 'playing') pressedOnce.add('PointerStart');
});

if (scorePublishButton instanceof HTMLButtonElement) {
  scorePublishButton.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    ev.stopPropagation();
  });
  scorePublishButton.addEventListener('click', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    unlockGameAudio();
    void claimAndPublishLastScore();
  });
}

for (const link of [valueSupportLink, geyserSupportLink, kofiSupportLink]) {
  if (!(link instanceof HTMLAnchorElement)) continue;
  const id: ValueLinkId = link.id === 'value-support' ? 'lightning' : link.id === 'geyser-support' ? 'geyser' : 'kofi';
  link.addEventListener('pointerdown', ev => {
    ev.stopPropagation();
  });
  link.addEventListener('click', ev => {
    ev.stopPropagation();
    unlockGameAudio();
    markNativeScoreValueLinkActivated(id);
  });
}

function setupTouch(): void {
  const stick = document.getElementById('touch-stick');
  const knob = document.getElementById('touch-knob');
  const fire = document.getElementById('touch-fire');
  const burst = document.getElementById('touch-burst');
  if (!stick || !knob || !fire || !burst) return;
  let id: number | null = null;
  let ox = 0;
  let oy = 0;
  let range = 56;
  const clear = (ev?: PointerEvent): void => {
    if (ev && id !== ev.pointerId) return;
    try {
      if (ev && stick.hasPointerCapture(ev.pointerId)) stick.releasePointerCapture(ev.pointerId);
    } catch {
      // Pointer capture can be absent for synthetic or browser-cancelled streams.
    }
    id = null;
    touch.x = 0;
    touch.y = 0;
    knob.style.transform = 'translate(0, 0)';
  };
  const suppressTouchSelection = (ev: Event): void => {
    if (state.phase === 'playing') ev.preventDefault();
  };
  const updateStick = (clientX: number, clientY: number): void => {
    const dx = clientX - ox;
    const dy = clientY - oy;
    const d = Math.hypot(dx, dy);
    const ux = d > 0 ? dx / d : 0;
    const uy = d > 0 ? dy / d : 0;
    const clipped = Math.min(range, d);
    const raw = clipped / range;
    const amount = raw <= TOUCH_STICK_DEADZONE
      ? 0
      : Math.pow((raw - TOUCH_STICK_DEADZONE) / (1 - TOUCH_STICK_DEADZONE), TOUCH_STICK_RESPONSE);
    const x = ux * clipped;
    const y = uy * clipped;
    touch.x = ux * amount;
    touch.y = uy * amount;
    knob.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  };
  stick.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    unlockGameAudio();
    markPlayerActivity();
    if (attractMode) {
      exitAttractRun();
      return;
    }
    id = ev.pointerId;
    const rect = stick.getBoundingClientRect();
    ox = rect.left + rect.width / 2;
    oy = rect.top + rect.height / 2;
    range = Math.max(42, Math.min(76, Math.min(rect.width, rect.height) * 0.43));
    updateStick(ev.clientX, ev.clientY);
    try {
      stick.setPointerCapture(ev.pointerId);
    } catch {
      // Movement still works when the browser declines pointer capture.
    }
  });
  stick.addEventListener('pointermove', ev => {
    if (id !== ev.pointerId) return;
    ev.preventDefault();
    updateStick(ev.clientX, ev.clientY);
  });
  stick.addEventListener('pointerup', clear);
  stick.addEventListener('pointercancel', clear);
  stick.addEventListener('lostpointercapture', () => clear());
  for (const target of [stick, knob, fire, burst]) {
    target.addEventListener('touchstart', suppressTouchSelection, { passive: false });
    target.addEventListener('touchmove', suppressTouchSelection, { passive: false });
    target.addEventListener('contextmenu', suppressTouchSelection);
  }
  fire.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    unlockGameAudio();
    markPlayerActivity();
    if (attractMode) {
      exitAttractRun();
      return;
    }
    if (state.phase === 'paused') return;
    if (state.phase !== 'playing') pressedOnce.add('PointerStart');
    touch.fire = true;
  });
  fire.addEventListener('pointerup', ev => {
    ev.preventDefault();
    touch.fire = false;
  });
  fire.addEventListener('pointercancel', () => { touch.fire = false; });
  fire.addEventListener('lostpointercapture', () => { touch.fire = false; });
  burst.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    unlockGameAudio();
    markPlayerActivity();
    if (attractMode) {
      exitAttractRun();
      return;
    }
    if (state.phase === 'paused') return;
    if (state.phase !== 'playing') pressedOnce.add('PointerStart');
    else smartBurst();
  });
  document.addEventListener('selectstart', suppressTouchSelection);
}

setupAudioLifecycle();
setupAudioControls();
setupMusicPlayer();
setupTouch();
setupVisualSettings({ onMeshRequested: requestMeshOverlay });
// Load the 600.wtf membership roll before the session restores so the title
// greeting and leaderboard badges can recognise members straight away.
void loadSixHundredRegistry();
void restoreNostrTitleSession();
// Warm the all-time leaderboard so the game-over panel paints instantly.
void fetchLeaderboard();
primeSignalProfiles();
window.addEventListener('neonsentinel:relays', () => {
  primeSignalProfiles(true);
});
// The soundtrack and 600B avatars are effectively immutable, so a service
// worker keeps them on-device: music survives flaky mobile networks and
// avatars stop re-downloading every session. Production only — a worker in
// dev would fight Vite's module serving.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* caching is an enhancement, never a blocker */ });
  });
}
// Installed PWAs resume from memory rather than reloading, so deploys were
// invisible until the app was force-killed. Poll the deployed build stamp —
// especially on resume — and offer a one-tap reload between runs.
if (import.meta.env.PROD) {
  const UPDATE_POLL_MS = 5 * 60 * 1000;
  let pendingBuild: string | null = null;
  let updateBanner: HTMLButtonElement | null = null;
  const ensureUpdateBanner = (): HTMLButtonElement => {
    if (updateBanner) return updateBanner;
    const el = document.createElement('button');
    el.id = 'update-ready';
    el.type = 'button';
    el.textContent = 'UPDATE READY · TAP TO RELOAD';
    el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);z-index:70;display:none;'
      + 'bottom:calc(env(safe-area-inset-bottom, 0px) + 14px);padding:10px 16px;cursor:pointer;white-space:nowrap;'
      + 'background:rgba(1,4,10,0.92);border:1px solid #ffd84a;border-radius:8px;'
      + 'font:800 12px ui-monospace,monospace;letter-spacing:0.08em;color:#ffd84a;'
      + 'box-shadow:0 0 18px rgba(255,216,74,0.35);';
    el.addEventListener('click', () => {
      void navigator.serviceWorker?.getRegistration().then(reg => reg?.update()).catch(() => undefined);
      window.location.reload();
    });
    document.body.appendChild(el);
    updateBanner = el;
    return el;
  };
  const syncUpdateBanner = (): void => {
    if (!pendingBuild) {
      if (updateBanner) updateBanner.style.display = 'none';
      return;
    }
    // Never interrupt a live run — surface the prompt between games only.
    const between = state.phase === 'title' || state.phase === 'gameover';
    ensureUpdateBanner().style.display = between ? 'block' : 'none';
  };
  const checkForUpdate = async (): Promise<void> => {
    try {
      const res = await fetch('/version.json', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json() as { build?: string };
      if (typeof data.build === 'string' && data.build && data.build !== __NEON_BUILD_ID__) pendingBuild = data.build;
    } catch { /* offline or blocked — the next poll retries */ }
  };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void checkForUpdate();
  });
  window.setInterval(() => { void checkForUpdate(); }, UPDATE_POLL_MS);
  window.setInterval(syncUpdateBanner, 1000);
  void checkForUpdate();
}
// ?musicDebug=1 mirrors the [music] console log into an on-screen box —
// phones have no devtools, and iPhone playback issues need field reports.
if (DEBUG_MUSIC) {
  const box = document.createElement('div');
  box.id = 'music-debug';
  box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:60;max-width:86vw;padding:6px 8px;'
    + 'background:rgba(1,4,10,0.85);border:1px solid rgba(94,255,219,0.5);border-radius:6px;'
    + 'font:700 10px ui-monospace,monospace;color:#8cffb4;pointer-events:none;white-space:pre-wrap;';
  box.textContent = '[music] debug overlay ready';
  document.body.appendChild(box);
  const musicDebugLines: string[] = [];
  const pushMusicDebug = (line: string): void => {
    musicDebugLines.push(line);
    if (musicDebugLines.length > 8) musicDebugLines.shift();
    box.textContent = musicDebugLines.join('\n');
  };
  window.addEventListener('neonsentinel:music-diag', ev => {
    pushMusicDebug(String((ev as CustomEvent<{ message?: string }>).detail?.message ?? 'diag'));
  });
  window.addEventListener('neonsentinel:music-load-failed', ev => {
    const detail = (ev as CustomEvent<{ id?: string; code?: number }>).detail;
    pushMusicDebug(`load failed: ${detail?.id ?? '?'} code${detail?.code ?? '?'}`);
  });
}
window.neonSentinelDebugFrame = makeDebugFrame;
window.neonSentinelClaimLastScore = claimAndPublishLastScore;
window.neonSentinelScoreStatus = scoreStatus;
window.relaykeepClaimLastScore = claimAndPublishLastScore;
window.relaykeepSignLastScore = claimAndPublishLastScore;
window.relaykeepScoreStatus = scoreStatus;
syncScoreActions();
if (DEBUG_EXPLOSION) {
  let triggered = false;
  let poll = 0;
  let fallback = 0;
  const triggerDebugExplosion = () => {
    if (triggered) return;
    triggered = true;
    window.clearInterval(poll);
    window.clearTimeout(fallback);
    startRun();
    damageShip(true, 'debug-explosion');
  };
  if (visualAssets.ready) triggerDebugExplosion();
  else {
    poll = window.setInterval(() => {
      if (visualAssets.ready) triggerDebugExplosion();
    }, 50);
    fallback = window.setTimeout(triggerDebugExplosion, 2500);
  }
} else if (DEBUG_GAMEOVER) {
  // Debug death with the stored guest identity when one exists, so game-over
  // surfaces (member stickers, name entry, claims) behave as in production.
  void restoreGuestSession().then(session => {
    if (session) activePlayerSession = session;
    startRun();
    damageShip(true, 'debug-gameover');
  });
} else if (DEBUG_FXLAB) {
  window.neonSentinelFxLabFire = (key: FxLabKey) => {
    fxLabAuto = false;
    fxLabFire(key);
  };
  startRun();
} else if (DEBUG_COMBAT) {
  startRun(4);
  seedDebugCombatScene();
} else if (QUERY.has('autostart')) startRun();
requestAnimationFrame(loop);
