type ToneKind = 'laserArcade' | 'laserArcadeFanout' | 'laserThump' | 'hit' | 'enemyBoom' | 'enemyBoomArcade' | 'enemyDebris' | 'boom' | 'boomArcade' | 'shipBoom' | 'rescue' | 'rescueBass' | 'pickup' | 'pickupArcade' | 'oneUp' | 'extend' | 'comboTick' | 'overtake' | 'pickupShield' | 'pickupCharge' | 'pickupZap' | 'pickupNet' | 'pickupCake' | 'pickupJackpot' | 'pickupCult' | 'pickupFourTwenty' | 'pickupScooter' | 'pickupMulti' | 'pickupTimeLock' | 'trollFeed' | 'damage' | 'wave' | 'burst' | 'lock' | 'warning' | 'enemyFireArcade' | 'jamFire' | 'carrierFire' | 'nearMiss' | 'shotImpact' | 'musicSurge';

interface AudioFrame {
  playing: boolean;
  speed: number;
  thrust: number;
  capture: number;
  danger: number;
  heat: number;
}

interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
}

export interface AudioDebugSnapshot {
  unlocked: boolean;
  context: 'none' | AudioContextState;
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
  musicDuck: number;
}

const STORAGE_KEY = 'neonsentinel:audio:v2';
// Music is a backer, not a co-lead: lower default bed under arcade-loud SFX.
const DEFAULTS: AudioSettings = { master: 0.86, music: 0.48, sfx: 1, muted: false };
// Fixed makeup gain on top of the user's SFX slider so effects read as
// cabinet-loud instead of merely matching the music bed 1:1 at full volume.
const SFX_ARCADE_GAIN = 1.35;

let audioCtx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let compressor: DynamicsCompressorNode | null = null;
let engineOsc: OscillatorNode | null = null;
let engineGain: GainNode | null = null;
let engineFilter: BiquadFilterNode | null = null;
let engineSubOsc: OscillatorNode | null = null;
let engineSubGain: GainNode | null = null;
let engineSubFilter: BiquadFilterNode | null = null;
let captureOsc: OscillatorNode | null = null;
let captureGain: GainNode | null = null;
let captureFilter: BiquadFilterNode | null = null;
let musicAnalyser: AnalyserNode | null = null;
let sharedNoiseBuffer: AudioBuffer | null = null;
let unlocked = false;
let intentionalSuspend = false;
let musicDuck = 1;
// Per-call pitch multiplier for one-shot SFX (set by playAudio, read by the
// tone/chirp/noise helpers). Lets kill chains climb in pitch per combo link.
let sfxPitch = 1;
let settings = loadSettings();

function mobileAudioRuntimeActive(): boolean {
  const ua = navigator.userAgent;
  const iosLike = /iP(hone|ad|od)/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  const coarsePointer = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return iosLike || (/Android|Mobile/i.test(ua) && coarsePointer);
}

function ensurePlaybackAudioSession(): void {
  if (!mobileAudioRuntimeActive()) return;
  try {
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session && session.type !== 'playback') session.type = 'playback';
  } catch {
    // Audio Session API is Safari-only and optional.
  }
}

export function unlockAudio(): void {
  const ctx = getCtx();
  ensurePlaybackAudioSession();
  intentionalSuspend = false;
  if (ctx.state !== 'running' && ctx.state !== 'closed') {
    void ctx.resume().catch(() => undefined);
  }
  try {
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // A closed context cannot be nudged; later gesture attempts can recreate in a fresh session.
  }
  unlocked = true;
}

export function isAudioUnlocked(): boolean {
  return unlocked;
}

export function updateAudio(frame: AudioFrame): void {
  if (!audioCtx || !engineOsc || !engineGain || !engineFilter || !engineSubOsc || !engineSubGain || !engineSubFilter || !captureOsc || !captureGain || !captureFilter) return;
  const now = audioCtx.currentTime;
  const speed = clamp(frame.speed / 1450, 0, 1);
  const thrust = clamp(frame.thrust, 0, 1);
  const heat = clamp(frame.heat, 0, 1);
  const moving = clamp(speed * 0.58 + thrust * 0.72 + heat * 0.18, 0, 1);
  const engineLevel = frame.playing ? 0.002 + speed * 0.004 + thrust * 0.006 + heat * 0.002 : 0;
  const subLevel = frame.playing ? 0.036 + moving * 0.19 : 0;
  const flutter = Math.sin(now * 4.1) * (0.18 + moving * 0.42) + Math.sin(now * 11.6) * moving * 0.28;
  engineOsc.frequency.setTargetAtTime(28 + speed * 8 + thrust * 7 + heat * 2 + flutter, now, 0.08);
  engineFilter.frequency.setTargetAtTime(64 + moving * 118 + heat * 24, now, 0.1);
  engineGain.gain.setTargetAtTime(engineLevel * settings.sfx, now, 0.09);
  engineSubOsc.frequency.setTargetAtTime(24 + speed * 5 + thrust * 4, now, 0.1);
  engineSubFilter.frequency.setTargetAtTime(48 + moving * 58, now, 0.1);
  engineSubGain.gain.setTargetAtTime(subLevel * settings.sfx, now, 0.08);

  const capture = clamp(frame.capture, 0, 1);
  const captureLevel = frame.playing ? capture * (0.012 + frame.danger * 0.026) : 0;
  captureOsc.frequency.setTargetAtTime(220 + capture * 360 + Math.sin(now * 10) * (5 + capture * 9), now, 0.075);
  captureFilter.frequency.setTargetAtTime(420 + capture * 860, now, 0.08);
  captureGain.gain.setTargetAtTime(captureLevel * settings.sfx, now, 0.1);
}

export function playAudio(kind: ToneKind, intensity = 1, pitch = 1): void {
  if (!audioCtx || !sfxBus) return;
  const now = audioCtx.currentTime;
  const amp = clamp(intensity, 0.2, 2.2);
  sfxPitch = clamp(pitch, 0.5, 2.4);
  if (kind === 'laserArcade') {
    // Cabinet pew: one composite shot that stays tight at full fire rate —
    // hard noise tick, square zap dive, short body, and a low knock so each
    // trigger pull lands with weight instead of a thin fizz. The knock lives
    // on every shot (not just laserThump's hit-confirm layer) because most
    // shots at range miss, and a pew with no body read as weak on its own.
    noise(0.013, 0.16 * amp, 8800, 'highpass', 0);
    chirp(8600, 540, 0.03, 'square', 0.165 * amp, 0, 5200, 'highpass');
    chirp(3400, 620, 0.032, 'triangle', 0.1 * amp, 0.002, 3400, 'bandpass');
    chirp(940, 132, 0.05, 'sawtooth', 0.072 * amp, 0.004, 880, 'lowpass');
    chirp(340, 88, 0.048, 'triangle', 0.078 * amp, 0.002, 420, 'lowpass');
    tone(108, 0.06, 'sine', 0.09 * amp, 0.002);
  } else if (kind === 'laserArcadeFanout') {
    // Same cabinet pew smeared across three detuned voices so triple-beam
    // fire audibly widens instead of just getting louder like before.
    noise(0.014, 0.15 * amp, 8800, 'highpass', 0);
    for (const detune of [1, 1.14, 0.88]) {
      chirp(8600 * detune, 540 * detune, 0.03, 'square', 0.1 * amp, 0, 5200, 'highpass');
      chirp(3400 * detune, 620 * detune, 0.032, 'triangle', 0.062 * amp, 0.002, 3400, 'bandpass');
    }
    chirp(940, 132, 0.05, 'sawtooth', 0.072 * amp, 0.004, 880, 'lowpass');
    chirp(340, 88, 0.048, 'triangle', 0.078 * amp, 0.002, 420, 'lowpass');
    tone(108, 0.06, 'sine', 0.09 * amp, 0.002);
  } else if (kind === 'laserThump') {
    // Confirmed-hit punctuation layered under the pew: sub knock + mid snap.
    chirp(250, 54, 0.07, 'sine', 0.115 * amp, 0, 340, 'lowpass');
    tone(64, 0.085, 'sine', 0.098 * amp, 0.004);
    noise(0.03, 0.062 * amp, 3100, 'bandpass', 0.002);
  } else if (kind === 'hit') {
    pulseMusicDuck(0.58, 170);
    chirp(1120, 48, 0.13, 'triangle', 0.19 * amp, 0, 1320, 'lowpass');
    chirp(2600, 140, 0.086, 'square', 0.096 * amp, 0.005, 2400, 'bandpass');
    chirp(5600, 720, 0.052, 'sawtooth', 0.088 * amp, 0.002, 5200, 'bandpass');
    noise(0.13, 0.19 * amp, 2100, 'bandpass', 0.001);
    noise(0.048, 0.132 * amp, 9000, 'highpass', 0.004);
    tone(82, 0.09, 'sine', 0.05 * amp, 0);
    tone(1480, 0.046, 'sine', 0.058 * amp, 0.014);
    tone(3320, 0.038, 'triangle', 0.038 * amp, 0.032);
  } else if (kind === 'enemyBoom') {
    pulseMusicDuck(0.28, 390);
    chirp(760, 28, 0.3, 'triangle', 0.29 * amp, 0, 720, 'lowpass');
    chirp(136, 19, 0.56, 'sine', 0.23 * amp, 0.002, 210, 'lowpass');
    chirp(2050, 96, 0.17, 'triangle', 0.128 * amp, 0.008, 2140, 'bandpass');
    chirp(5300, 720, 0.11, 'square', 0.096 * amp, 0.018, 5200, 'highpass');
    chirp(820, 74, 0.2, 'sawtooth', 0.078 * amp, 0.048, 720, 'lowpass');
    noise(0.31, 0.33 * amp, 560, 'lowpass', 0);
    noise(0.2, 0.235 * amp, 2850, 'bandpass', 0.004);
    noise(0.09, 0.182 * amp, 8800, 'highpass', 0.014);
    tone(34, 0.48, 'sine', 0.17 * amp, 0.006);
    tone(62, 0.28, 'sine', 0.086 * amp, 0.16);
    tone(2480, 0.07, 'triangle', 0.05 * amp, 0.09);
  } else if (kind === 'enemyDebris') {
    noise(0.28, 0.205 * amp, 2300, 'bandpass', 0);
    noise(0.16, 0.138 * amp, 9200, 'highpass', 0.01);
    chirp(2680, 210, 0.16, 'triangle', 0.096 * amp, 0.004, 1580, 'bandpass');
    chirp(820, 72, 0.18, 'sawtooth', 0.065 * amp, 0.028, 520, 'lowpass');
    chirp(5100, 920, 0.052, 'square', 0.04 * amp, 0.052, 6200, 'highpass');
    tone(102, 0.22, 'sine', 0.068 * amp, 0.012);
    tone(3080, 0.052, 'triangle', 0.035 * amp, 0.06);
  } else if (kind === 'boom') {
    pulseMusicDuck(0.42, 380);
    chirp(210, 28, 0.42, 'triangle', 0.2 * amp, 0, 560, 'lowpass');
    chirp(86, 22, 0.58, 'sine', 0.16 * amp, 0.012, 210, 'lowpass');
    chirp(980, 120, 0.14, 'triangle', 0.062 * amp, 0.026, 1600, 'bandpass');
    noise(0.36, 0.2 * amp, 620, 'lowpass', 0.006);
    noise(0.12, 0.082 * amp, 3900, 'highpass', 0.014);
    tone(43, 0.48, 'sine', 0.12 * amp, 0.018);
  } else if (kind === 'shipBoom') {
    pulseMusicDuck(0.16, 1180);
    chirp(220, 24, 0.72, 'triangle', 0.28 * amp, 0, 520, 'lowpass');
    chirp(78, 18, 0.98, 'sine', 0.22 * amp, 0.02, 170, 'lowpass');
    chirp(960, 86, 0.24, 'triangle', 0.105 * amp, 0.018, 1160, 'bandpass');
    chirp(1680, 180, 0.16, 'triangle', 0.058 * amp, 0.09, 2400, 'bandpass');
    chirp(3300, 240, 0.18, 'square', 0.054 * amp, 0.04, 3900, 'highpass');
    noise(0.62, 0.28 * amp, 500, 'lowpass', 0.008);
    noise(0.28, 0.145 * amp, 2500, 'bandpass', 0.016);
    noise(0.09, 0.076 * amp, 7000, 'highpass', 0.052);
    tone(37, 0.96, 'sine', 0.23 * amp, 0.018);
    tone(58, 0.48, 'sine', 0.13 * amp, 0.28);
    tone(116, 0.24, 'triangle', 0.058 * amp, 0.44);
  } else if (kind === 'rescue') {
    pulseMusicDuck(0.68, 320);
    tone(392, 0.065, 'sine', 0.046 * amp, 0);
    tone(588, 0.076, 'sine', 0.056 * amp, 0.038);
    tone(784, 0.09, 'triangle', 0.066 * amp, 0.076);
    tone(1176, 0.13, 'sine', 0.066 * amp, 0.13);
    tone(1764, 0.18, 'sine', 0.052 * amp, 0.205);
    tone(2352, 0.22, 'sine', 0.036 * amp, 0.29);
    chirp(620, 2780, 0.32, 'triangle', 0.055 * amp, 0.022, 3300, 'bandpass');
    chirp(148, 440, 0.28, 'sawtooth', 0.032 * amp, 0.018, 740, 'lowpass');
    noise(0.12, 0.046 * amp, 7200, 'highpass', 0.036);
  } else if (kind === 'rescueBass') {
    pulseMusicDuck(0.58, 260);
    tone(43, 0.38, 'sine', 0.112 * amp, 0);
    tone(86, 0.24, 'triangle', 0.062 * amp, 0.045);
    tone(129, 0.2, 'sine', 0.036 * amp, 0.112);
    chirp(170, 620, 0.28, 'sawtooth', 0.04 * amp, 0.016, 820, 'lowpass');
  } else if (kind === 'pickup') {
    pulseMusicDuck(0.72, 200);
    tone(820, 0.055, 'triangle', 0.06 * amp, 0);
    tone(1640, 0.12, 'sine', 0.052 * amp, 0.055);
    tone(2460, 0.16, 'sine', 0.026 * amp, 0.12);
    chirp(960, 2100, 0.18, 'triangle', 0.042 * amp, 0.03, 2800, 'bandpass');
  } else if (kind === 'pickupArcade') {
    // Coin collect: two-note square "b-ding" into a sparkle glissando.
    pulseMusicDuck(0.6, 260);
    tone(988, 0.045, 'square', 0.055 * amp, 0);
    tone(1319, 0.3, 'square', 0.046 * amp, 0.045);
    tone(2637, 0.22, 'sine', 0.028 * amp, 0.05);
    tone(1568, 0.06, 'sine', 0.034 * amp, 0.1);
    tone(2093, 0.07, 'sine', 0.032 * amp, 0.14);
    tone(2637, 0.09, 'sine', 0.028 * amp, 0.18);
    tone(3136, 0.12, 'sine', 0.022 * amp, 0.22);
    chirp(1400, 3800, 0.16, 'triangle', 0.028 * amp, 0.06, 3400, 'bandpass');
    noise(0.05, 0.03 * amp, 9500, 'highpass', 0.05);
  } else if (kind === 'oneUp') {
    // Extra-life fanfare: square arpeggio up a major triad over a triangle root.
    pulseMusicDuck(0.7, 300);
    tone(523, 0.07, 'square', 0.05 * amp, 0);
    tone(659, 0.07, 'square', 0.05 * amp, 0.07);
    tone(784, 0.07, 'square', 0.05 * amp, 0.14);
    tone(1047, 0.09, 'square', 0.052 * amp, 0.21);
    tone(1319, 0.2, 'square', 0.048 * amp, 0.3);
    tone(1568, 0.34, 'triangle', 0.045 * amp, 0.4);
    tone(131, 0.5, 'triangle', 0.05 * amp, 0);
    tone(196, 0.4, 'triangle', 0.04 * amp, 0.21);
    chirp(2100, 4200, 0.3, 'sine', 0.02 * amp, 0.32, 4200, 'bandpass');
    noise(0.08, 0.03 * amp, 9000, 'highpass', 0.3);
  } else if (kind === 'extend') {
    // Score-threshold extend: a longer cabinet fanfare than oneUp — six-note
    // square run up two octaves, sustained top note, root pedal, and shimmer.
    pulseMusicDuck(0.55, 620);
    tone(659, 0.07, 'square', 0.05 * amp, 0);
    tone(784, 0.07, 'square', 0.05 * amp, 0.075);
    tone(988, 0.07, 'square', 0.05 * amp, 0.15);
    tone(1319, 0.08, 'square', 0.052 * amp, 0.225);
    tone(1568, 0.09, 'square', 0.05 * amp, 0.305);
    tone(1976, 0.26, 'square', 0.048 * amp, 0.39);
    tone(2637, 0.4, 'triangle', 0.04 * amp, 0.5);
    tone(165, 0.66, 'triangle', 0.05 * amp, 0);
    tone(220, 0.5, 'triangle', 0.04 * amp, 0.22);
    chirp(2400, 5200, 0.34, 'sine', 0.022 * amp, 0.42, 4800, 'bandpass');
    noise(0.1, 0.032 * amp, 9200, 'highpass', 0.42);
  } else if (kind === 'comboTick') {
    // Chain link blip: tiny square hit that climbs with the pitch multiplier
    // passed per kill, so long chains audibly ladder upward.
    tone(620, 0.045, 'square', 0.042 * amp, 0);
    tone(930, 0.06, 'sine', 0.034 * amp, 0.028);
    noise(0.02, 0.02 * amp, 8400, 'highpass', 0);
  } else if (kind === 'overtake') {
    // Rival passed: quick two-note rise into a zap shimmer — celebratory but
    // short enough to not mask combat audio.
    pulseMusicDuck(0.66, 260);
    tone(784, 0.06, 'square', 0.05 * amp, 0);
    tone(1175, 0.09, 'square', 0.05 * amp, 0.065);
    tone(1568, 0.2, 'triangle', 0.042 * amp, 0.15);
    chirp(1200, 3600, 0.22, 'sawtooth', 0.026 * amp, 0.08, 3400, 'bandpass');
    noise(0.06, 0.028 * amp, 9000, 'highpass', 0.12);
  } else if (kind === 'pickupShield') {
    // Protective clunk into a metallic shimmer settling upward.
    pulseMusicDuck(0.62, 240);
    tone(131, 0.14, 'triangle', 0.06 * amp, 0);
    tone(523, 0.12, 'sine', 0.05 * amp, 0.03);
    tone(659, 0.2, 'sine', 0.046 * amp, 0.09);
    tone(988, 0.3, 'triangle', 0.036 * amp, 0.16);
    chirp(720, 1560, 0.24, 'triangle', 0.034 * amp, 0.05, 2200, 'bandpass');
    noise(0.06, 0.028 * amp, 6800, 'highpass', 0.1);
  } else if (kind === 'pickupCharge') {
    // Capacitor charge-up: rising saw into a snap and sparkle.
    pulseMusicDuck(0.62, 260);
    chirp(220, 880, 0.26, 'sawtooth', 0.055 * amp, 0, 1600, 'bandpass');
    chirp(440, 1760, 0.2, 'triangle', 0.04 * amp, 0.08, 2600, 'bandpass');
    tone(1760, 0.05, 'square', 0.05 * amp, 0.27);
    tone(2637, 0.16, 'sine', 0.032 * amp, 0.3);
    noise(0.03, 0.05 * amp, 8200, 'highpass', 0.27);
  } else if (kind === 'pickupZap') {
    // Double-score electric trill.
    pulseMusicDuck(0.6, 280);
    tone(1245, 0.045, 'square', 0.05 * amp, 0);
    tone(1661, 0.045, 'square', 0.05 * amp, 0.05);
    tone(1245, 0.045, 'square', 0.046 * amp, 0.1);
    tone(1661, 0.05, 'square', 0.046 * amp, 0.15);
    tone(2489, 0.22, 'sine', 0.034 * amp, 0.2);
    chirp(900, 3200, 0.2, 'sawtooth', 0.03 * amp, 0.04, 3400, 'bandpass');
    noise(0.12, 0.035 * amp, 9000, 'highpass', 0.02);
  } else if (kind === 'pickupNet') {
    // WoT net: soft whoosh down into a secure catch tone.
    pulseMusicDuck(0.62, 300);
    chirp(340, 90, 0.3, 'sawtooth', 0.045 * amp, 0, 620, 'lowpass');
    noise(0.24, 0.05 * amp, 1400, 'bandpass', 0);
    tone(392, 0.09, 'triangle', 0.05 * amp, 0.22);
    tone(587, 0.18, 'sine', 0.046 * amp, 0.3);
    tone(880, 0.22, 'sine', 0.03 * amp, 0.38);
  } else if (kind === 'pickupCake') {
    // Got cake: playful two-note bite and a low gulp.
    pulseMusicDuck(0.62, 240);
    tone(659, 0.07, 'triangle', 0.06 * amp, 0);
    tone(880, 0.09, 'triangle', 0.055 * amp, 0.08);
    tone(220, 0.12, 'sine', 0.05 * amp, 0.18);
    tone(1319, 0.16, 'sine', 0.028 * amp, 0.22);
    noise(0.04, 0.03 * amp, 5200, 'bandpass', 0.02);
  } else if (kind === 'pickupJackpot') {
    // 600B boost: quick coin cascade up two octaves with shimmer.
    pulseMusicDuck(0.52, 420);
    tone(1047, 0.06, 'square', 0.046 * amp, 0);
    tone(1319, 0.06, 'square', 0.046 * amp, 0.055);
    tone(1568, 0.06, 'square', 0.046 * amp, 0.11);
    tone(2093, 0.08, 'square', 0.048 * amp, 0.165);
    tone(2637, 0.1, 'square', 0.044 * amp, 0.225);
    tone(3136, 0.26, 'triangle', 0.04 * amp, 0.29);
    tone(131, 0.4, 'triangle', 0.05 * amp, 0);
    chirp(1800, 4400, 0.3, 'sine', 0.022 * amp, 0.24, 4400, 'bandpass');
    noise(0.08, 0.032 * amp, 9200, 'highpass', 0.26);
  } else if (kind === 'pickupFourTwenty') {
    // 4:20: two lazy clock ticks, then the whole world tape-slows.
    pulseMusicDuck(0.55, 460);
    noise(0.018, 0.09 * amp, 2600, 'bandpass', 0);
    noise(0.018, 0.08 * amp, 2100, 'bandpass', 0.16);
    chirp(880, 392, 0.42, 'sine', 0.06 * amp, 0.3, 1400, 'lowpass');
    chirp(1320, 588, 0.42, 'triangle', 0.035 * amp, 0.32, 1800, 'bandpass');
    tone(65, 0.5, 'sine', 0.07 * amp, 0.3);
    tone(1568, 0.3, 'sine', 0.02 * amp, 0.55);
  } else if (kind === 'pickupScooter') {
    // DNI's scooter: bicycle-bell double ding into a kick-push whoosh.
    pulseMusicDuck(0.6, 300);
    tone(2093, 0.09, 'sine', 0.055 * amp, 0);
    tone(2637, 0.16, 'sine', 0.05 * amp, 0.02);
    tone(2093, 0.09, 'sine', 0.05 * amp, 0.18);
    tone(2637, 0.18, 'sine', 0.046 * amp, 0.2);
    noise(0.3, 0.06 * amp, 1200, 'bandpass', 0.3);
    chirp(300, 900, 0.34, 'sawtooth', 0.03 * amp, 0.3, 1400, 'bandpass');
  } else if (kind === 'pickupMulti') {
    // Fanout: three rising square notes (one per beam) snapping into a
    // sustained power chord with a bright sweep — reads as "weapon online".
    pulseMusicDuck(0.6, 320);
    tone(659, 0.05, 'square', 0.055 * amp, 0);
    tone(880, 0.05, 'square', 0.055 * amp, 0.055);
    tone(1175, 0.07, 'square', 0.058 * amp, 0.11);
    tone(1568, 0.24, 'triangle', 0.05 * amp, 0.17);
    tone(784, 0.2, 'triangle', 0.04 * amp, 0.17);
    chirp(700, 2600, 0.24, 'sawtooth', 0.038 * amp, 0.02, 2600, 'bandpass');
    noise(0.06, 0.05 * amp, 8200, 'highpass', 0.16);
    tone(98, 0.2, 'sine', 0.07 * amp, 0.01);
  } else if (kind === 'pickupTimeLock') {
    // TIME LOCKED: a heavy vault-bolt clunk, two dead clock ticks slowing to
    // a stop, and a cold dissonant drone underneath — a pickup that sounds
    // like a mistake the moment it lands.
    pulseMusicDuck(0.7, 520);
    chirp(420, 60, 0.16, 'square', 0.12 * amp, 0, 620, 'lowpass');
    noise(0.05, 0.1 * amp, 900, 'lowpass', 0.01);
    noise(0.02, 0.08 * amp, 2400, 'bandpass', 0.24);
    noise(0.02, 0.07 * amp, 2100, 'bandpass', 0.52);
    tone(98, 0.7, 'triangle', 0.06 * amp, 0.06);
    tone(104, 0.7, 'triangle', 0.055 * amp, 0.08);
    chirp(660, 590, 0.5, 'sine', 0.035 * amp, 0.12, 1100, 'lowpass');
    tone(49, 0.6, 'sine', 0.07 * amp, 0.1);
  } else if (kind === 'trollFeed') {
    // Gulp: the troll swallows a laser bolt whole. Short and wet so it stays
    // readable under held fire.
    chirp(520, 128, 0.1, 'triangle', 0.11 * amp, 0, 720, 'lowpass');
    chirp(184, 68, 0.12, 'sine', 0.09 * amp, 0.05, 300, 'lowpass');
    noise(0.05, 0.05 * amp, 1800, 'bandpass', 0.01);
    tone(66, 0.12, 'sine', 0.06 * amp, 0.06);
  } else if (kind === 'pickupCult') {
    // Definitely not a cult: low organ minor triad, a descending chant sweep,
    // and one candle-flicker sparkle. Ominous, but in a fun way.
    pulseMusicDuck(0.66, 340);
    tone(110, 0.5, 'triangle', 0.055 * amp, 0);
    tone(130.8, 0.5, 'triangle', 0.05 * amp, 0.02);
    tone(164.8, 0.55, 'triangle', 0.05 * amp, 0.04);
    tone(220, 0.4, 'sine', 0.04 * amp, 0.08);
    chirp(392, 196, 0.5, 'sine', 0.035 * amp, 0.05, 700, 'lowpass');
    tone(1568, 0.2, 'sine', 0.02 * amp, 0.4);
    noise(0.1, 0.02 * amp, 4200, 'bandpass', 0.35);
  } else if (kind === 'enemyBoomArcade') {
    // Zap transient into a crunch drop, with ember crackle ticks trailing off
    // in time with the ember particles.
    pulseMusicDuck(0.3, 420);
    chirp(3200, 340, 0.09, 'square', 0.11 * amp, 0, 3600, 'bandpass');
    chirp(900, 52, 0.34, 'sawtooth', 0.2 * amp, 0.004, 900, 'lowpass');
    chirp(150, 28, 0.5, 'sine', 0.24 * amp, 0.006, 220, 'lowpass');
    noise(0.26, 0.3 * amp, 700, 'lowpass', 0);
    noise(0.1, 0.16 * amp, 8600, 'highpass', 0.008);
    noise(0.03, 0.09 * amp, 5200, 'bandpass', 0.16);
    noise(0.024, 0.075 * amp, 6400, 'bandpass', 0.26);
    noise(0.02, 0.06 * amp, 4400, 'bandpass', 0.38);
    noise(0.018, 0.05 * amp, 7200, 'bandpass', 0.52);
    tone(36, 0.42, 'sine', 0.15 * amp, 0.008);
    tone(2900, 0.05, 'triangle', 0.04 * amp, 0.05);
  } else if (kind === 'boomArcade') {
    // Carrier kill: crack, then a second sub detonation at 90ms to match the
    // visual aftershock, a long rumble on a low fifth, and a crackle tail.
    pulseMusicDuck(0.2, 700);
    chirp(3600, 300, 0.1, 'square', 0.12 * amp, 0, 3800, 'bandpass');
    chirp(320, 30, 0.5, 'triangle', 0.22 * amp, 0.004, 620, 'lowpass');
    chirp(110, 24, 0.8, 'sine', 0.24 * amp, 0.09, 200, 'lowpass');
    noise(0.5, 0.3 * amp, 520, 'lowpass', 0);
    noise(0.34, 0.2 * amp, 640, 'lowpass', 0.09);
    noise(0.16, 0.12 * amp, 3400, 'bandpass', 0.05);
    noise(0.1, 0.1 * amp, 8200, 'highpass', 0.02);
    noise(0.035, 0.1 * amp, 5600, 'bandpass', 0.3);
    noise(0.03, 0.085 * amp, 4200, 'bandpass', 0.44);
    noise(0.026, 0.07 * amp, 6800, 'bandpass', 0.6);
    noise(0.02, 0.055 * amp, 5200, 'bandpass', 0.78);
    tone(41, 0.9, 'sine', 0.2 * amp, 0.01);
    tone(61.5, 0.6, 'sine', 0.1 * amp, 0.1);
    tone(82, 0.3, 'triangle', 0.06 * amp, 0.4);
  } else if (kind === 'damage') {
    pulseMusicDuck(0.3, 520);
    chirp(260, 38, 0.48, 'sawtooth', 0.2 * amp, 0, 480, 'lowpass');
    chirp(920, 130, 0.16, 'square', 0.06 * amp, 0.018, 1300, 'bandpass');
    noise(0.24, 0.17 * amp, 460, 'lowpass', 0);
    noise(0.085, 0.09 * amp, 2600, 'highpass', 0.055);
  } else if (kind === 'wave') {
    pulseMusicDuck(0.62, 180);
    tone(196, 0.08, 'triangle', 0.05 * amp, 0);
    tone(392, 0.1, 'triangle', 0.06 * amp, 0.07);
    tone(784, 0.17, 'sine', 0.06 * amp, 0.16);
    chirp(280, 980, 0.22, 'sawtooth', 0.035 * amp, 0.02, 1800, 'bandpass');
  } else if (kind === 'burst') {
    pulseMusicDuck(0.32, 430);
    chirp(420, 1840, 0.22, 'sawtooth', 0.15 * amp, 0, 2200, 'bandpass');
    chirp(1180, 190, 0.25, 'triangle', 0.09 * amp, 0.026, 880, 'lowpass');
    chirp(72, 34, 0.34, 'sine', 0.09 * amp, 0.012, 140, 'lowpass');
    noise(0.2, 0.145 * amp, 2300, 'bandpass', 0);
    noise(0.08, 0.076 * amp, 8600, 'highpass', 0.026);
  } else if (kind === 'warning') {
    tone(720, 0.06, 'square', 0.038 * amp, 0);
    tone(1080, 0.07, 'square', 0.032 * amp, 0.072);
    tone(720, 0.055, 'square', 0.026 * amp, 0.16);
    chirp(420, 1120, 0.16, 'triangle', 0.028 * amp, 0.018, 1300, 'bandpass');
  } else if (kind === 'enemyFireArcade') {
    // Grittier, more threatening cousin of enemyFire: a detuned dissonant
    // dive (two sawtooths a semitone apart) plus real low-end so hostile
    // shots read as a distinct threat against the player's clean pew, not
    // the same thin zap enemy fire has used since before the arcade pass.
    chirp(2680, 220, 0.115, 'sawtooth', 0.128 * amp, 0, 2400, 'bandpass');
    chirp(2530, 208, 0.115, 'sawtooth', 0.09 * amp, 0.004, 2400, 'bandpass');
    chirp(820, 84, 0.13, 'square', 0.1 * amp, 0.006, 820, 'lowpass');
    chirp(5600, 640, 0.05, 'triangle', 0.062 * amp, 0.002, 5400, 'highpass');
    noise(0.08, 0.132 * amp, 4200, 'bandpass', 0);
    tone(64, 0.13, 'sine', 0.08 * amp, 0.006);
  } else if (kind === 'jamFire') {
    pulseMusicDuck(0.62, 210);
    tone(156, 0.24, 'triangle', 0.07 * amp, 0);
    chirp(420, 2380, 0.23, 'square', 0.086 * amp, 0.008, 3200, 'bandpass');
    chirp(2300, 360, 0.17, 'sine', 0.06 * amp, 0.05, 2100, 'bandpass');
    chirp(4100, 720, 0.1, 'square', 0.044 * amp, 0.028, 4600, 'highpass');
    noise(0.15, 0.084 * amp, 4600, 'highpass', 0.012);
  } else if (kind === 'carrierFire') {
    pulseMusicDuck(0.3, 460);
    chirp(240, 32, 0.5, 'sawtooth', 0.22 * amp, 0, 520, 'lowpass');
    chirp(1120, 88, 0.28, 'square', 0.11 * amp, 0.018, 1260, 'bandpass');
    chirp(2200, 240, 0.12, 'sawtooth', 0.052 * amp, 0.08, 3000, 'bandpass');
    noise(0.3, 0.19 * amp, 720, 'lowpass', 0);
    noise(0.12, 0.11 * amp, 4800, 'highpass', 0.04);
    tone(56, 0.46, 'sine', 0.13 * amp, 0.015);
  } else if (kind === 'nearMiss') {
    chirp(6800, 760, 0.13, 'sawtooth', 0.104 * amp, 0, 5600, 'highpass');
    chirp(1800, 220, 0.09, 'triangle', 0.06 * amp, 0.01, 1800, 'bandpass');
    noise(0.1, 0.092 * amp, 8200, 'highpass', 0);
    tone(78, 0.09, 'sine', 0.034 * amp, 0.016);
  } else if (kind === 'shotImpact') {
    chirp(480, 42, 0.19, 'triangle', 0.155 * amp, 0, 620, 'lowpass');
    chirp(1680, 128, 0.082, 'sawtooth', 0.066 * amp, 0.008, 1820, 'bandpass');
    noise(0.18, 0.158 * amp, 760, 'lowpass', 0);
    noise(0.064, 0.088 * amp, 6200, 'highpass', 0.012);
    tone(58, 0.13, 'sine', 0.052 * amp, 0.008);
  } else if (kind === 'musicSurge') {
    tone(110, 0.16, 'sine', 0.05 * amp, 0);
    tone(220, 0.2, 'triangle', 0.042 * amp, 0.055);
    chirp(520, 1460, 0.26, 'sawtooth', 0.038 * amp, 0.02, 1900, 'bandpass');
  } else if (kind === 'lock') {
    tone(860, 0.06, 'square', 0.044 * amp, 0);
    tone(1290, 0.075, 'square', 0.034 * amp, 0.06);
    chirp(540, 1280, 0.11, 'triangle', 0.022 * amp, 0.03, 1500, 'bandpass');
  }

  function tone(freq: number, duration: number, type: OscillatorType, gain: number, delay: number): void {
    if (!audioCtx || !sfxBus) return;
    const osc = audioCtx.createOscillator();
    const out = audioCtx.createGain();
    const start = now + delay;
    osc.type = type;
    osc.frequency.setValueAtTime(freq * sfxPitch, start);
    out.gain.setValueAtTime(0, start);
    out.gain.linearRampToValueAtTime(gain, start + 0.008);
    out.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(out);
    out.connect(sfxBus);
    osc.start(start);
    osc.stop(start + duration + 0.02);
    releaseTransientNodes([osc, out], [osc], (delay + duration + 0.16) * 1000);
  }
}

// Short recorded voice clips (e.g. the rose pickup's "Want rose, fren?").
// Decoded once, cached, and played through the sfx bus so master/sfx volume
// and mute apply exactly as for synth effects.
const voiceClips = new Map<string, AudioBuffer | 'loading' | 'failed'>();

export function preloadVoiceClip(url: string): void {
  if (!audioCtx || voiceClips.has(url)) return;
  voiceClips.set(url, 'loading');
  fetch(url)
    .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`voice clip ${r.status}`))))
    .then(bytes => audioCtx!.decodeAudioData(bytes))
    .then(buffer => voiceClips.set(url, buffer))
    .catch(() => voiceClips.set(url, 'failed'));
}

export function playVoiceClip(url: string, gain = 1): void {
  if (!audioCtx || !sfxBus) return;
  const cached = voiceClips.get(url);
  if (cached === 'failed') return;
  if (cached === undefined || cached === 'loading') {
    // Not decoded yet: kick (or keep) the load and play as soon as it lands,
    // so the very first pickup still speaks.
    if (cached === undefined) preloadVoiceClip(url);
    const started = performance.now();
    const poll = window.setInterval(() => {
      const now = voiceClips.get(url);
      if (now === 'failed' || performance.now() - started > 4000) window.clearInterval(poll);
      else if (now !== undefined && now !== 'loading') {
        window.clearInterval(poll);
        playVoiceClip(url, gain);
      }
    }, 60);
    return;
  }
  pulseMusicDuck(0.42, cached.duration * 1000);
  const src = audioCtx.createBufferSource();
  const out = audioCtx.createGain();
  src.buffer = cached;
  out.gain.value = clamp(gain, 0, 2);
  src.connect(out);
  out.connect(sfxBus);
  src.start();
  releaseTransientNodes([src, out], [src], cached.duration * 1000 + 250);
}

export function setMuted(value: boolean): void {
  settings.muted = value;
  saveSettings();
  rampGain(master, value ? 0 : settings.master, 80);
}

export function isMuted(): boolean {
  return settings.muted;
}

export function getMasterVolume(): number {
  return settings.master;
}

export function setMasterVolume(value: number): void {
  settings.master = clamp01(value);
  saveSettings();
  if (!settings.muted) rampGain(master, settings.master, 80);
}

export function getMusicVolume(): number {
  return settings.music;
}

export function getMusicDuckFactor(): number {
  return musicDuck;
}

export function setMusicVolume(value: number): void {
  settings.music = clamp01(value);
  saveSettings();
  rampGain(musicBus, settings.music * musicDuck, 80);
}

export function getSfxVolume(): number {
  return settings.sfx;
}

export function setSfxVolume(value: number): void {
  settings.sfx = clamp01(value);
  saveSettings();
  rampGain(sfxBus, settings.sfx * SFX_ARCADE_GAIN, 80);
}

export function setMusicDuck(amount: number): void {
  musicDuck = clamp01(amount);
  rampGain(musicBus, settings.music * musicDuck, 180);
}

export function pulseMusicDuck(depth: number, totalMs = 260): void {
  if (!musicBus || !audioCtx) return;
  const baseline = settings.music * musicDuck;
  const duckRatio = clamp(depth, 0.68, 1);
  const ducked = baseline * duckRatio;
  const t = audioCtx.currentTime;
  const attack = 0.045;
  const sustain = totalMs / 1000 * 0.18;
  const release = Math.max(0.34, totalMs / 1000);
  musicBus.gain.cancelScheduledValues(t);
  musicBus.gain.setValueAtTime(musicBus.gain.value, t);
  musicBus.gain.linearRampToValueAtTime(ducked, t + attack);
  musicBus.gain.setValueAtTime(ducked, t + attack + sustain);
  musicBus.gain.linearRampToValueAtTime(baseline, t + release);
}

export function getMusicDestination(): AudioNode {
  getCtx();
  return musicBus!;
}

export function getMusicAnalyser(): AnalyserNode {
  const ctx = getCtx();
  if (!musicAnalyser) {
    musicAnalyser = ctx.createAnalyser();
    musicAnalyser.fftSize = 1024;
    musicAnalyser.smoothingTimeConstant = 0.82;
    musicBus!.connect(musicAnalyser);
  }
  return musicAnalyser;
}

export function getAudioContextState(): 'none' | AudioContextState {
  return audioCtx ? audioCtx.state : 'none';
}

export function getAudioDebugSnapshot(): AudioDebugSnapshot {
  return {
    unlocked,
    context: getAudioContextState(),
    master: settings.master,
    music: settings.music,
    sfx: settings.sfx,
    muted: settings.muted,
    musicDuck,
  };
}

export function suspendPlayback(): void {
  intentionalSuspend = true;
  if (audioCtx && audioCtx.state === 'running') {
    void audioCtx.suspend().catch(() => undefined);
  }
}

export function resumePlayback(): void {
  intentionalSuspend = false;
  if (audioCtx && audioCtx.state !== 'closed') {
    void audioCtx.resume().catch(() => undefined);
  }
}

function getCtx(): AudioContext {
  if (audioCtx) return audioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  audioCtx = new Ctx();

  master = audioCtx.createGain();
  master.gain.value = settings.muted ? 0 : settings.master;

  compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 22;
  compressor.ratio.value = 5.5;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.18;

  sfxBus = audioCtx.createGain();
  sfxBus.gain.value = settings.sfx * SFX_ARCADE_GAIN;
  musicBus = audioCtx.createGain();
  musicBus.gain.value = settings.music * musicDuck;

  sfxBus.connect(master);
  musicBus.connect(master);
  master.connect(compressor);
  compressor.connect(audioCtx.destination);

  engineOsc = audioCtx.createOscillator();
  engineOsc.type = 'sawtooth';
  engineGain = audioCtx.createGain();
  engineFilter = audioCtx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 120;
  engineFilter.Q.value = 0.32;
  engineGain.gain.value = 0;
  engineOsc.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(sfxBus);
  engineOsc.start();

  engineSubOsc = audioCtx.createOscillator();
  engineSubOsc.type = 'sine';
  engineSubGain = audioCtx.createGain();
  engineSubFilter = audioCtx.createBiquadFilter();
  engineSubFilter.type = 'lowpass';
  engineSubFilter.frequency.value = 72;
  engineSubFilter.Q.value = 0.95;
  engineSubGain.gain.value = 0;
  engineSubOsc.connect(engineSubFilter);
  engineSubFilter.connect(engineSubGain);
  engineSubGain.connect(sfxBus);
  engineSubOsc.start();

  captureOsc = audioCtx.createOscillator();
  captureOsc.type = 'triangle';
  captureGain = audioCtx.createGain();
  captureFilter = audioCtx.createBiquadFilter();
  captureFilter.type = 'bandpass';
  captureFilter.frequency.value = 840;
  captureFilter.Q.value = 7;
  captureGain.gain.value = 0;
  captureOsc.connect(captureFilter);
  captureFilter.connect(captureGain);
  captureGain.connect(sfxBus);
  captureOsc.start();

  audioCtx.onstatechange = (): void => {
    if (!audioCtx || intentionalSuspend) return;
    if (audioCtx.state === 'running' || audioCtx.state === 'closed') return;
    if (document.visibilityState !== 'visible') return;
    void audioCtx.resume().catch(() => undefined);
  };

  return audioCtx;
}

function chirp(
  from: number,
  to: number,
  duration: number,
  type: OscillatorType,
  gain: number,
  delay = 0,
  filterFreq = 0,
  filterType: BiquadFilterType = 'lowpass',
): void {
  if (!audioCtx || !sfxBus) return;
  const now = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const out = audioCtx.createGain();
  let filter: BiquadFilterNode | null = null;
  osc.type = type;
  osc.frequency.setValueAtTime(from * sfxPitch, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to * sfxPitch), now + duration);
  out.gain.setValueAtTime(gain, now);
  out.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  if (filterFreq > 0) {
    filter = audioCtx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFreq, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, filterFreq * 0.42), now + duration);
    filter.Q.value = filterType === 'bandpass' ? 4.8 : 0.8;
    osc.connect(filter);
    filter.connect(out);
  } else {
    osc.connect(out);
  }
  out.connect(sfxBus);
  osc.start(now);
  osc.stop(now + duration + 0.02);
  releaseTransientNodes(filter ? [osc, filter, out] : [osc, out], [osc], (delay + duration + 0.16) * 1000);
}

function noise(duration: number, gain: number, filterFreq: number, filterType: BiquadFilterType = 'lowpass', delay = 0): void {
  if (!audioCtx || !sfxBus) return;
  const buffer = getSharedNoiseBuffer();
  const now = audioCtx.currentTime + delay;
  const source = audioCtx.createBufferSource();
  const filter = audioCtx.createBiquadFilter();
  const out = audioCtx.createGain();
  source.buffer = buffer;
  source.playbackRate.value = 0.86 + Math.random() * 0.28;
  filter.type = filterType;
  filter.frequency.value = filterFreq * Math.sqrt(sfxPitch);
  filter.Q.value = filterType === 'bandpass' ? 3.2 : 0.7;
  out.gain.setValueAtTime(0.0001, now);
  out.gain.linearRampToValueAtTime(gain, now + 0.006);
  out.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.connect(filter);
  filter.connect(out);
  out.connect(sfxBus);
  const offset = Math.random() * Math.max(0, buffer.duration - duration - 0.04);
  source.start(now, offset, duration + 0.02);
  releaseTransientNodes([source, filter, out], [source], (delay + duration + 0.16) * 1000);
}

function releaseTransientNodes(nodes: AudioNode[], sources: AudioScheduledSourceNode[], fallbackMs: number): void {
  if (sources.length === 0) return;
  let live = sources.length;
  let done = false;
  const free = (): void => {
    if (done) return;
    done = true;
    for (const node of nodes) {
      try { node.disconnect(); } catch { /* already detached */ }
    }
  };
  for (const source of sources) {
    source.addEventListener('ended', () => {
      live -= 1;
      if (live <= 0) free();
    }, { once: true });
  }
  window.setTimeout(free, Math.max(200, fallbackMs));
}

function getSharedNoiseBuffer(): AudioBuffer {
  if (!audioCtx) throw new Error('Audio context not initialised');
  if (sharedNoiseBuffer && sharedNoiseBuffer.sampleRate === audioCtx.sampleRate) return sharedNoiseBuffer;
  const duration = 2.4;
  const samples = Math.max(1, Math.floor(audioCtx.sampleRate * duration));
  const buffer = audioCtx.createBuffer(1, samples, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  let held = 0;
  let brown = 0;
  for (let i = 0; i < samples; i += 1) {
    if (i % 3 === 0) held = Math.random() * 2 - 1;
    brown = brown * 0.96 + (Math.random() * 2 - 1) * 0.04;
    data[i] = held * 0.62 + brown * 0.38;
  }
  sharedNoiseBuffer = buffer;
  return buffer;
}

function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    const master = typeof parsed.master === 'number' && parsed.master > 0.03 ? parsed.master : DEFAULTS.master;
    const music = typeof parsed.music === 'number' && parsed.music > 0.03 ? parsed.music : DEFAULTS.music;
    const sfx = typeof parsed.sfx === 'number' && parsed.sfx > 0.03 ? parsed.sfx : DEFAULTS.sfx;
    return {
      master: clamp01(master),
      music: clamp01(music),
      sfx: clamp01(sfx),
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULTS.muted,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable in private contexts; runtime audio still works.
  }
}

function rampGain(node: GainNode | null, target: number, ms = 60): void {
  if (!node || !audioCtx) return;
  const t = audioCtx.currentTime;
  node.gain.cancelScheduledValues(t);
  node.gain.setValueAtTime(node.gain.value, t);
  node.gain.linearRampToValueAtTime(target, t + ms / 1000);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
