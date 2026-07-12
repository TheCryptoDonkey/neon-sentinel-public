import * as THREE from 'three';
import { profilePictureCandidates } from './profiles.js';
import { drawTroll } from './sprite-art.js';
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

type Relation = 'follow' | 'mutual' | 'high-wot';
type EnemyType = 'abductor' | 'spoof' | 'jammer' | 'hunter' | 'carrier' | 'spammer' | 'sybil' | 'troll';
type CitizenStatus = 'waiting' | 'carried' | 'falling' | 'returning' | 'saved' | 'lost';
type EnemyShotKind = 'dart' | 'jam' | 'barrage' | 'spam';
type MeshPhase = 'title' | 'playing' | 'paused' | 'gameover';
type MeshShipClass = 'interceptor' | 'guardian' | 'heavy';

export interface MeshCitizen {
  id: number;
  relation: Relation;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  status: CitizenStatus;
  savedFlash: number;
  avatarUrl?: string;
  threat: number;
  capture: number;
  targeted: boolean;
}

export interface MeshEnemy {
  id: number;
  type: EnemyType;
  sizeScale?: number;
  /** 0-1: how deep into its last-quarter-health "about to pop" telegraph window a troll is. */
  popFlash?: number;
  stolenAvatarUrl?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number | null;
  targetY: number | null;
  carryingCitizenId: number | null;
  captureCharge: number;
  muzzle: number;
  phase: number;
  face: -1 | 1;
  turnCue: number;
  intent: number;
}

export interface MeshBeacon {
  x: number;
  y: number;
  age: number;
  value: number;
  kind?: 'rose' | 'cake-piece' | 'whole-cake' | '600b' | 'life' | 'shield' | 'relay' | 'charge' | 'zap' | 'net' | 'cult' | 'fourtwenty' | 'scooter' | 'multi' | 'timelock';
  /** Which of the cake-piece icon variants this beacon shows (matches the vector tier's Beacon.spriteIndex). */
  spriteIndex?: number;
}

export interface MeshLaser {
  x: number;
  y: number;
  dir: -1 | 1;
  ttl: number;
  length: number;
  heat: number;
  impact: boolean;
  impactX: number;
  impactY: number;
}

export interface MeshEnemyShot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
  age: number;
  kind: EnemyShotKind;
}

export interface MeshFrame {
  phase: MeshPhase;
  viewW: number;
  viewH: number;
  worldW: number;
  cameraX: number;
  dpr: number;
  t: number;
  ship: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    speed: number;
    dir: -1 | 1;
    invuln: number;
    shieldHits: number;
    heat: number;
    turnCue: number;
    shipClass: MeshShipClass;
    destroyed: boolean;
  };
  citizens: readonly MeshCitizen[];
  enemies: readonly MeshEnemy[];
  beacons: readonly MeshBeacon[];
  lasers: readonly MeshLaser[];
  enemyShots: readonly MeshEnemyShot[];
  tuning: {
    actorScale: number;
    contactScale: number;
    captureLockTime: number;
  };
  viewport: {
    portrait: boolean;
    cropped: boolean;
    visibleW: number;
  };
}

export interface MeshOverlayInitOptions {
  onContextLost?: () => void;
}

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let root: THREE.Group | null = null;
let overlayCanvas: HTMLCanvasElement | null = null;
let ready = false;
let contextLost = false;
let onContextLostCallback: (() => void) | null = null;
let lastViewW = -1;
let lastViewH = -1;
let lastDpr = -1;

const CAMERA_Z = 980;
const BASE_WORLD_W = 6144;
const PLAY_TOP = 160;
const GROUND_BASE = 646;

interface AvatarEntry {
  loading: boolean;
  failed: boolean;
  material: THREE.MeshStandardMaterial | null;
  candidates: string[];
  index: number;
}

interface RelayColumnMood {
  active: boolean;
  highValue: boolean;
  intensity: number;
  contactCount: number;
}

const avatarCache = new Map<string, AvatarEntry>();

const shipBodyGeo = makeExtrudedShape([
  [58, 0],
  [21, -18],
  [-26, -19],
  [-48, -8],
  [-20, 0],
  [-48, 8],
  [-26, 19],
  [21, 18],
], 13);
const shipWingGeo = makeExtrudedShape([
  [14, -10],
  [-18, -35],
  [-32, -15],
  [-8, -3],
], 8);
const shipLowerWingGeo = makeExtrudedShape([
  [14, 10],
  [-18, 35],
  [-32, 15],
  [-8, 3],
], 8);
const shipEngineGeo = makeExtrudedShape([
  [-38, -9],
  [-78, 0],
  [-38, 9],
], 5);
const shipFuselageGeo = (() => {
  const geo = new THREE.CapsuleGeometry(11, 76, 8, 28);
  geo.rotateZ(Math.PI / 2);
  return geo;
})();
const shipNoseGeo = (() => {
  const geo = new THREE.ConeGeometry(17, 48, 36, 1, false);
  geo.rotateZ(-Math.PI / 2);
  return geo;
})();
const shipPodGeo = (() => {
  const geo = new THREE.CylinderGeometry(6, 10, 42, 24);
  geo.rotateZ(Math.PI / 2);
  return geo;
})();
const shipFinGeo = new THREE.BoxGeometry(38, 5, 11);
const shipCanopyGeo = new THREE.SphereGeometry(10, 22, 12);
const abductorHullGeo = makeExtrudedShape([
  [34, 0],
  [17, -19],
  [-12, -26],
  [-38, -10],
  [-22, 0],
  [-38, 10],
  [-12, 26],
  [17, 19],
], 14);
const spoofHullGeo = makeExtrudedShape([
  [36, -3],
  [14, -27],
  [-13, -18],
  [-40, -3],
  [-14, 15],
  [6, 27],
  [42, 5],
], 12);
const jammerWingGeo = makeExtrudedShape([
  [22, 0],
  [-6, -21],
  [-31, -13],
  [-16, 0],
  [-31, 13],
  [-6, 21],
], 7);
const enemyRingGeo = new THREE.TorusGeometry(31, 2.4, 8, 54);
const enemyPlateGeo = new THREE.BoxGeometry(34, 4, 8);
const enemyLightGeo = new THREE.SphereGeometry(4.4, 12, 8);
const hunterBladeGeo = makeExtrudedShape([
  [36, 0],
  [-24, -22],
  [-9, 0],
  [-24, 22],
], 10);
const jammerCoreGeo = new THREE.BoxGeometry(44, 34, 18);
const enemyPodGeo = new THREE.SphereGeometry(7, 14, 10);
const microPodGeo = new THREE.SphereGeometry(3.4, 12, 8);
const contactBaseGeo = new THREE.TorusGeometry(21, 1.4, 8, 48);
const contactTetherGeo = new THREE.CylinderGeometry(1.5, 1.5, 1, 8, 1, true);
const contactHaloGeo = new THREE.TorusGeometry(28, 1.2, 8, 64);
const enemySpikeGeo = (() => {
  const geo = new THREE.ConeGeometry(5, 28, 12);
  geo.rotateZ(-Math.PI / 2);
  return geo;
})();
const detailStrutGeo = (() => {
  const geo = new THREE.CylinderGeometry(2.1, 2.1, 42, 10);
  geo.rotateZ(Math.PI / 2);
  return geo;
})();
const carrierGeo = makeExtrudedShape([
  [74, 0],
  [34, -42],
  [-42, -34],
  [-74, 0],
  [-42, 34],
  [34, 42],
], 22);
const spammerHullGeo = makeExtrudedShape([
  [34, 0],
  [22, -15],
  [-9, -21],
  [-34, -11],
  [-40, 0],
  [-34, 11],
  [-9, 21],
  [22, 15],
], 13);
const sybilCoreGeo = new THREE.IcosahedronGeometry(21, 0);
const sybilOrbGeo = new THREE.IcosahedronGeometry(9, 0);
const carrierDeckGeo = new THREE.BoxGeometry(132, 18, 20);
const carrierHangarGeo = new THREE.BoxGeometry(68, 8, 8);
const carrierTurretGeo = new THREE.ConeGeometry(7, 22, 16);
const citizenGeo = new THREE.SphereGeometry(21, 36, 22);
const citizenRingGeo = new THREE.TorusGeometry(23, 1.5, 8, 52);
const beaconRingGeo = new THREE.TorusGeometry(43, 1.8, 8, 64);
const enemyBeamGeo = new THREE.CylinderGeometry(4, 11, 54, 18, 1, true);
const glowPlaneGeo = new THREE.PlaneGeometry(1, 1);
const laserGeo = new THREE.BoxGeometry(1, 1, 1);
const captureBeamGeo = new THREE.BoxGeometry(1, 1, 1);
const speedStreakGeo = new THREE.PlaneGeometry(1, 1);
const nebulaPlaneGeo = new THREE.PlaneGeometry(1, 1);
const asteroidGeo = new THREE.DodecahedronGeometry(36, 1);
const shotHeadGeo = new THREE.SphereGeometry(1, 18, 12);
const shotRingGeo = new THREE.TorusGeometry(1, 0.08, 8, 40);
const shotBoltGeo = new THREE.PlaneGeometry(1, 1);
const towerMastGeo = new THREE.CylinderGeometry(4, 8, 128, 12);
const towerRingGeo = new THREE.TorusGeometry(32, 1.6, 8, 48);
const towerBeamGeo = new THREE.CylinderGeometry(2.2, 2.2, 136, 10, 1, true);
const groundPlateGeo = new THREE.BoxGeometry(1, 4, 6);
const habitatPadGeo = (() => {
  const geo = new THREE.CylinderGeometry(28, 36, 8, 44, 1, false);
  geo.rotateX(Math.PI / 2);
  return geo;
})();
const habitatVaultGeo = (() => {
  const geo = new THREE.SphereGeometry(20, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  geo.scale(1.25, 0.62, 0.5);
  return geo;
})();
const habitatPylonGeo = new THREE.CylinderGeometry(2.4, 4.2, 34, 10);
const shipBodyEdges = new THREE.EdgesGeometry(shipBodyGeo);
const shipWingEdges = new THREE.EdgesGeometry(shipWingGeo);
const shipLowerWingEdges = new THREE.EdgesGeometry(shipLowerWingGeo);
const abductorHullEdges = new THREE.EdgesGeometry(abductorHullGeo);
const spoofHullEdges = new THREE.EdgesGeometry(spoofHullGeo);
const hunterEdges = new THREE.EdgesGeometry(hunterBladeGeo);
const jammerEdges = new THREE.EdgesGeometry(jammerCoreGeo);
const carrierEdges = new THREE.EdgesGeometry(carrierGeo);
const spammerHullEdges = new THREE.EdgesGeometry(spammerHullGeo);
const sybilCoreEdges = new THREE.EdgesGeometry(sybilCoreGeo);
const beaconGeo = (() => {
  const geo = new THREE.CylinderGeometry(28, 28, 8, 48, 1, false);
  geo.rotateX(Math.PI / 2);
  return geo;
})();
const pickupBarGeo = new THREE.BoxGeometry(1, 1, 1);

const mats = {
  ship: new THREE.MeshStandardMaterial({ color: 0xdafef7, metalness: 0.72, roughness: 0.18, emissive: 0x116c7a, emissiveIntensity: 0.34 }),
  shipDark: new THREE.MeshStandardMaterial({ color: 0x07141d, metalness: 0.84, roughness: 0.23, emissive: 0x072533, emissiveIntensity: 0.28 }),
  shipWing: new THREE.MeshStandardMaterial({ color: 0x00f5ff, metalness: 0.62, roughness: 0.16, emissive: 0x0aa6a6, emissiveIntensity: 0.92 }),
  shipGold: new THREE.MeshStandardMaterial({ color: 0xffd84a, metalness: 0.78, roughness: 0.2, emissive: 0x8a4f00, emissiveIntensity: 0.52 }),
  shipHeavy: new THREE.MeshStandardMaterial({ color: 0xff8a3a, metalness: 0.78, roughness: 0.22, emissive: 0x7a2104, emissiveIntensity: 0.56 }),
  shipHeavyDark: new THREE.MeshStandardMaterial({ color: 0x1c0c05, metalness: 0.86, roughness: 0.28, emissive: 0x461504, emissiveIntensity: 0.34 }),
  shipInterceptor: new THREE.MeshStandardMaterial({ color: 0xbffff8, metalness: 0.66, roughness: 0.14, emissive: 0x0ac9d1, emissiveIntensity: 0.52 }),
  shipInterceptorDark: new THREE.MeshStandardMaterial({ color: 0x061a22, metalness: 0.82, roughness: 0.2, emissive: 0x06395a, emissiveIntensity: 0.34 }),
  shipGlass: new THREE.MeshPhysicalMaterial({ color: 0x9dfff8, emissive: 0x32fff1, emissiveIntensity: 1.15, roughness: 0.03, metalness: 0.05, transmission: 0.35, thickness: 0.5, transparent: true, opacity: 0.9 }),
  shipEngine: new THREE.MeshBasicMaterial({ color: 0xffd84a, transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending }),
  abductor: new THREE.MeshStandardMaterial({ color: 0xff4d5e, metalness: 0.56, roughness: 0.22, emissive: 0xff183a, emissiveIntensity: 1.0 }),
  abductorDark: new THREE.MeshStandardMaterial({ color: 0x280910, metalness: 0.78, roughness: 0.28, emissive: 0x4a0713, emissiveIntensity: 0.54 }),
  spoof: new THREE.MeshStandardMaterial({ color: 0xff3aff, metalness: 0.5, roughness: 0.2, emissive: 0x9b1aff, emissiveIntensity: 1.18 }),
  spoofDark: new THREE.MeshStandardMaterial({ color: 0x180923, metalness: 0.72, roughness: 0.22, emissive: 0x3a0870, emissiveIntensity: 0.68 }),
  jammer: new THREE.MeshStandardMaterial({ color: 0x5f7cff, metalness: 0.66, roughness: 0.24, emissive: 0x283bd8, emissiveIntensity: 1.06 }),
  jammerDark: new THREE.MeshStandardMaterial({ color: 0x0b1238, metalness: 0.76, roughness: 0.3, emissive: 0x101e78, emissiveIntensity: 0.52 }),
  hunter: new THREE.MeshStandardMaterial({ color: 0xff8a3a, metalness: 0.58, roughness: 0.18, emissive: 0xb23a0a, emissiveIntensity: 1.0 }),
  hunterDark: new THREE.MeshStandardMaterial({ color: 0x2b1205, metalness: 0.74, roughness: 0.24, emissive: 0x5b2102, emissiveIntensity: 0.54 }),
  carrier: new THREE.MeshStandardMaterial({ color: 0xff2f7a, metalness: 0.72, roughness: 0.2, emissive: 0x901452, emissiveIntensity: 1.16 }),
  carrierDark: new THREE.MeshStandardMaterial({ color: 0x1b0b23, metalness: 0.7, roughness: 0.32, emissive: 0x36042a, emissiveIntensity: 0.5 }),
  spammer: new THREE.MeshStandardMaterial({ color: 0x8f5bff, metalness: 0.58, roughness: 0.22, emissive: 0x4a12c8, emissiveIntensity: 1.08 }),
  spammerDark: new THREE.MeshStandardMaterial({ color: 0x140830, metalness: 0.76, roughness: 0.26, emissive: 0x2a0a68, emissiveIntensity: 0.56 }),
  sybil: new THREE.MeshStandardMaterial({ color: 0xff5ad1, metalness: 0.5, roughness: 0.2, emissive: 0xb01e86, emissiveIntensity: 1.12 }),
  sybilDark: new THREE.MeshStandardMaterial({ color: 0x220a1c, metalness: 0.72, roughness: 0.24, emissive: 0x53103e, emissiveIntensity: 0.6 }),
  follow: new THREE.MeshStandardMaterial({ color: 0x5effdb, metalness: 0.28, roughness: 0.22, emissive: 0x176f67, emissiveIntensity: 0.8 }),
  mutual: new THREE.MeshStandardMaterial({ color: 0x8cffb4, metalness: 0.28, roughness: 0.2, emissive: 0x1f7f52, emissiveIntensity: 0.82 }),
  highWot: new THREE.MeshStandardMaterial({ color: 0xffd84a, metalness: 0.62, roughness: 0.16, emissive: 0x8a5b00, emissiveIntensity: 1.0 }),
  dangerRing: new THREE.MeshBasicMaterial({ color: 0xff4d5e, transparent: true, opacity: 0.6 }),
  signalRing: new THREE.MeshBasicMaterial({ color: 0xfff2b2, transparent: true, opacity: 0.54 }),
  beaconRing: new THREE.MeshBasicMaterial({ color: 0xffd84a, transparent: true, opacity: 0.78 }),
  enemyBeam: new THREE.MeshBasicMaterial({ color: 0xff4d5e, transparent: true, opacity: 0.38 }),
  captureBeam: new THREE.MeshBasicMaterial({ color: 0xffd84a, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false }),
  captureHot: new THREE.MeshBasicMaterial({ color: 0xff4d5e, transparent: true, opacity: 0.58, blending: THREE.AdditiveBlending, depthWrite: false }),
  laserCore: new THREE.MeshBasicMaterial({ color: 0xf7ffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  laserGlow: new THREE.MeshBasicMaterial({ color: 0x5effdb, transparent: true, opacity: 0.24, blending: THREE.AdditiveBlending, depthWrite: false }),
  laserAmber: new THREE.MeshBasicMaterial({ color: 0xffd84a, transparent: true, opacity: 0.48, blending: THREE.AdditiveBlending, depthWrite: false }),
  // dart matches vector's enemyShotColour('dart') default (#ff334e) so the
  // hunter's muzzle flash and its travelling shot read as the same colour.
  shotDart: new THREE.MeshBasicMaterial({ color: 0xff334e, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
  shotJam: new THREE.MeshBasicMaterial({ color: 0x5f7cff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
  shotBarrage: new THREE.MeshBasicMaterial({ color: 0xff2f7a, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
  shotSpam: new THREE.MeshBasicMaterial({ color: 0xb14dff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  streakCyan: new THREE.MeshBasicMaterial({ color: 0x5effdb, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  streakAmber: new THREE.MeshBasicMaterial({ color: 0xffd84a, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  streakRose: new THREE.MeshBasicMaterial({ color: 0xff4d8d, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  driftCyan: new THREE.MeshBasicMaterial({ color: 0x5effdb, transparent: true, opacity: 0.018, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  driftAmber: new THREE.MeshBasicMaterial({ color: 0xffd84a, transparent: true, opacity: 0.016, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  driftRose: new THREE.MeshBasicMaterial({ color: 0xff4d8d, transparent: true, opacity: 0.014, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  asteroid: new THREE.MeshStandardMaterial({ color: 0x6c949e, metalness: 0.04, roughness: 0.94, emissive: 0x0b3442, emissiveIntensity: 0.28, flatShading: true, transparent: true, opacity: 0.24, depthWrite: false }),
  tower: new THREE.MeshStandardMaterial({ color: 0x092b31, metalness: 0.46, roughness: 0.34, emissive: 0x0d6f67, emissiveIntensity: 0.36 }),
  towerHot: new THREE.MeshBasicMaterial({ color: 0x5effdb, transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending, depthWrite: false }),
  ground: new THREE.MeshStandardMaterial({ color: 0x0b564b, metalness: 0.18, roughness: 0.5, emissive: 0x0c7b6d, emissiveIntensity: 0.42, transparent: true, opacity: 0.68 }),
  habitatDark: new THREE.MeshStandardMaterial({ color: 0x061115, metalness: 0.52, roughness: 0.36, emissive: 0x18080e, emissiveIntensity: 0.18, transparent: true, opacity: 0.72 }),
  habitatGlass: new THREE.MeshPhysicalMaterial({ color: 0xbffef7, emissive: 0x34ffe7, emissiveIntensity: 0.44, roughness: 0.05, metalness: 0.08, transmission: 0.22, thickness: 0.35, transparent: true, opacity: 0.46 }),
  lifeBeacon: new THREE.MeshPhongMaterial({ color: 0xd7ffe1, map: makeLifeTexture(), emissive: 0x1f7f52, emissiveIntensity: 0.5, shininess: 140, specular: 0xffffff }),
  pickupRelay: new THREE.MeshStandardMaterial({ color: 0x8cffb4, metalness: 0.26, roughness: 0.24, emissive: 0x1f7f52, emissiveIntensity: 0.74 }),
  pickupCharge: new THREE.MeshStandardMaterial({ color: 0xffd84a, metalness: 0.56, roughness: 0.16, emissive: 0x8a5b00, emissiveIntensity: 0.9 }),
};

const nebulaMats = [
  new THREE.MeshBasicMaterial({ map: makeNebulaTexture('#1b7a97', '#5effdb'), transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending, depthWrite: false }),
  new THREE.MeshBasicMaterial({ map: makeNebulaTexture('#6028ff', '#ff3aff'), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }),
  new THREE.MeshBasicMaterial({ map: makeNebulaTexture('#ff8a3a', '#ffd84a'), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }),
] as const;

const glowMats = {
  cyan: new THREE.SpriteMaterial({ map: makeGlowTexture(), color: 0x5effdb, transparent: true, opacity: 0.68, blending: THREE.AdditiveBlending, depthWrite: false }),
  amber: new THREE.SpriteMaterial({ map: makeGlowTexture(), color: 0xffd84a, transparent: true, opacity: 0.74, blending: THREE.AdditiveBlending, depthWrite: false }),
  rose: new THREE.SpriteMaterial({ map: makeGlowTexture(), color: 0xff4d8d, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
  blue: new THREE.SpriteMaterial({ map: makeGlowTexture(), color: 0x5f7cff, transparent: true, opacity: 0.64, blending: THREE.AdditiveBlending, depthWrite: false }),
  green: new THREE.SpriteMaterial({ map: makeGlowTexture(), color: 0x96ff3c, transparent: true, opacity: 0.68, blending: THREE.AdditiveBlending, depthWrite: false }),
  white: new THREE.SpriteMaterial({ map: makeGlowTexture(), color: 0xf7ffff, transparent: true, opacity: 0.64, blending: THREE.AdditiveBlending, depthWrite: false }),
} as const;

const lineMats = {
  ship: new THREE.LineBasicMaterial({ color: 0xf7ffff, transparent: true, opacity: 0.95 }),
  shipGlow: new THREE.LineBasicMaterial({ color: 0x5effdb, transparent: true, opacity: 0.7 }),
  enemy: new THREE.LineBasicMaterial({ color: 0xfff2b2, transparent: true, opacity: 0.82 }),
  relayArcDim: new THREE.LineBasicMaterial({ color: 0x5effdb, transparent: true, opacity: 0.075 }),
  relayArc: new THREE.LineBasicMaterial({ color: 0x5effdb, transparent: true, opacity: 0.24 }),
  relayArcHot: new THREE.LineBasicMaterial({ color: 0xffd84a, transparent: true, opacity: 0.32 }),
};

// Pre-built material variants that used to be produced with a fresh `.clone()` every
// frame. These are constant for the lifetime of the process (their varying inputs -
// enemy type, asteroid rim dimness - never change once an entity exists), so a single
// shared instance per variant is enough; nothing needs to be cloned per frame at all.
const asteroidRimGlowMat = (() => {
  const m = glowMats.blue.clone();
  m.opacity = 0.08;
  return m;
})();

const enemyTrailMats = {
  hunter: (() => { const m = glowMats.amber.clone(); m.opacity = 0.28; return m; })(),
  spoof: (() => { const m = glowMats.rose.clone(); m.opacity = 0.24; return m; })(),
  other: (() => { const m = glowMats.rose.clone(); m.opacity = 0.19; return m; })(),
};

// The ship is a singleton, so its handful of opacity-animated glow materials are owned
// clones created once and mutated in place every frame - never re-cloned.
const shipAuraMat = glowMats.cyan.clone();
const shipFloorShadowMat = glowMats.cyan.clone();
const shipShieldRingMat = mats.laserGlow.clone();
const shipShieldGlowMat = glowMats.cyan.clone();

function syncSpriteVariant(target: THREE.SpriteMaterial, source: THREE.SpriteMaterial, opacity: number): void {
  if (target.map !== source.map) target.map = source.map;
  target.color.copy(source.color);
  target.opacity = opacity;
}

function syncBasicVariant(target: THREE.MeshBasicMaterial, source: THREE.MeshBasicMaterial, opacity: number): void {
  target.color.copy(source.color);
  target.opacity = opacity;
}

const sharedMaterials = new Set<THREE.Material>([
  ...Object.values(mats),
  ...nebulaMats,
  ...Object.values(glowMats),
  ...Object.values(lineMats),
  asteroidRimGlowMat,
  enemyTrailMats.hunter,
  enemyTrailMats.spoof,
  enemyTrailMats.other,
  shipAuraMat,
  shipFloorShadowMat,
  shipShieldRingMat,
  shipShieldGlowMat,
]);

const sharedGeometries = new Set<THREE.BufferGeometry>([
  shipBodyGeo, shipWingGeo, shipLowerWingGeo, shipEngineGeo, shipFuselageGeo, shipNoseGeo, shipPodGeo, shipFinGeo,
  shipCanopyGeo, abductorHullGeo, spoofHullGeo, jammerWingGeo, enemyRingGeo, enemyPlateGeo, enemyLightGeo,
  hunterBladeGeo, jammerCoreGeo, enemyPodGeo, microPodGeo, contactBaseGeo, contactTetherGeo, contactHaloGeo,
  enemySpikeGeo, detailStrutGeo, carrierGeo, carrierDeckGeo, carrierHangarGeo, carrierTurretGeo, citizenGeo,
  citizenRingGeo, beaconRingGeo, enemyBeamGeo, glowPlaneGeo, laserGeo, captureBeamGeo, speedStreakGeo,
  nebulaPlaneGeo, asteroidGeo, shotHeadGeo, shotRingGeo, shotBoltGeo, towerMastGeo, towerRingGeo, towerBeamGeo, groundPlateGeo,
  habitatPadGeo, habitatVaultGeo, habitatPylonGeo, shipBodyEdges, shipWingEdges, shipLowerWingEdges,
  abductorHullEdges, spoofHullEdges, hunterEdges, jammerEdges, carrierEdges, beaconGeo, pickupBarGeo,
]);

function disposeIfOwned(obj: THREE.Object3D): void {
  const withMaterial = obj as Partial<THREE.Mesh>;
  const material = withMaterial.material;
  if (material) {
    const materials = Array.isArray(material) ? material : [material];
    for (const m of materials) if (!sharedMaterials.has(m)) m.dispose();
  }
  const geometry = withMaterial.geometry;
  if (geometry && !sharedGeometries.has(geometry)) geometry.dispose();
}

/**
 * Holds a persistent, keyed set of children under one parent Object3D so that repeated
 * per-frame "add a mesh here" calls reuse the same Mesh/Sprite/Line/Group instance
 * instead of allocating a new one. `beginEntity` hides every child so that whichever
 * keys are *not* re-acquired this frame stay hidden - this is what lets conditional /
 * variant-dependent branches (e.g. a citizen that stops being "waiting", or a pooled
 * slot whose underlying entity kind changed) drop stale geometry cleanly.
 */
class ChildPool {
  private readonly items = new Map<string, THREE.Object3D>();

  constructor(private readonly parent: THREE.Object3D) {}

  beginEntity(): void {
    for (const obj of this.items.values()) obj.visible = false;
  }

  hide(key: string): void {
    const obj = this.items.get(key);
    if (obj) obj.visible = false;
  }

  private acquire<T extends THREE.Object3D>(key: string, ctor: new () => T): T {
    const existing = this.items.get(key);
    if (existing instanceof ctor) {
      existing.visible = true;
      return existing;
    }
    if (existing) {
      this.parent.remove(existing);
      disposeIfOwned(existing);
    }
    const created = new ctor();
    created.visible = true;
    this.items.set(key, created);
    this.parent.add(created);
    return created;
  }

  mesh(key: string, geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    const m = this.acquire(key, THREE.Mesh);
    m.geometry = geometry;
    m.material = material;
    m.castShadow = false;
    m.receiveShadow = false;
    return m;
  }

  sprite(key: string, material: THREE.SpriteMaterial): THREE.Sprite {
    const s = this.acquire(key, THREE.Sprite);
    s.material = material;
    return s;
  }

  edges(key: string, geometry: THREE.BufferGeometry, material: THREE.LineBasicMaterial): THREE.LineSegments {
    const l = this.acquire(key, THREE.LineSegments);
    l.geometry = geometry;
    l.material = material;
    return l;
  }

  dynamicLine(key: string, geometry: THREE.BufferGeometry, material: THREE.LineBasicMaterial): THREE.Line {
    const l = this.acquire(key, THREE.Line);
    l.geometry = geometry;
    l.material = material;
    return l;
  }
}

const childPools = new WeakMap<THREE.Object3D, ChildPool>();

function childPool(container: THREE.Object3D): ChildPool {
  let pool = childPools.get(container);
  if (!pool) {
    pool = new ChildPool(container);
    childPools.set(container, pool);
  }
  return pool;
}

function getEntityGroup(map: Map<number, THREE.Group>, key: number, parent: THREE.Object3D): THREE.Group {
  let group = map.get(key);
  if (!group) {
    group = new THREE.Group();
    map.set(key, group);
    parent.add(group);
  }
  group.visible = true;
  return group;
}

function getIndexedGroup(arr: THREE.Group[], index: number, parent: THREE.Object3D): THREE.Group {
  let group = arr[index];
  if (!group) {
    group = new THREE.Group();
    arr[index] = group;
    parent.add(group);
  }
  group.visible = true;
  return group;
}

function hideMapEntriesExcept(map: Map<number, THREE.Group>, keep: ReadonlySet<number>): void {
  for (const [key, group] of map) {
    if (!keep.has(key)) group.visible = false;
  }
}

function hideIndexedFrom(arr: THREE.Group[], fromIndexInclusive: number): void {
  for (let i = fromIndexInclusive; i < arr.length; i += 1) {
    const g = arr[i];
    if (g) g.visible = false;
  }
}

function hideAllIndexed(arr: THREE.Group[]): void {
  for (const g of arr) if (g) g.visible = false;
}

function hideAllMapped(map: Map<number, THREE.Group>): void {
  for (const g of map.values()) g.visible = false;
}

const depthAsteroids = Array.from({ length: 16 }, (_, i) => ({
  x: (i * 809 + 173) % BASE_WORLD_W,
  y: 210 + ((i * 137) % 300),
  z: -1120 + ((i * 53) % 220),
  scale: 0.08 + ((i * 37) % 32) / 100,
  phase: i * 0.81,
}));

const nebulaClouds = Array.from({ length: 8 }, (_, i) => ({
  x: (i * 997 + 311) % BASE_WORLD_W,
  y: 250 + ((i * 113) % 230),
  z: -980 - i * 45,
  scale: 380 + ((i * 137) % 320),
  phase: i * 1.7,
  mat: nebulaMats[i % nebulaMats.length]!,
}));

const relayColumns = Array.from({ length: 12 }, (_, i) => i * 512);

function makeExtrudedShape(points: Array<[number, number]>, depth: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < points.length; i += 1) {
    const [x, y] = points[i]!;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 1.4,
    bevelSize: 1.4,
    bevelSegments: 2,
  });
  geo.center();
  return geo;
}

function makeLifeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);
  const grad = ctx.createLinearGradient(0, 0, 512, 256);
  grad.addColorStop(0, '#d7ffe1');
  grad.addColorStop(0.34, '#8cffb4');
  grad.addColorStop(1, '#1f7f52');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = 'rgba(255,255,255,0.42)';
  ctx.lineWidth = 10;
  for (let x = 32; x < 512; x += 96) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 52, 256);
    ctx.stroke();
  }
  ctx.fillStyle = '#f7ffff';
  ctx.font = '950 86px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#5effdb';
  ctx.shadowBlur = 16;
  ctx.fillText('TIME', 256, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function makeGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);
  const glow = ctx.createRadialGradient(128, 128, 4, 128, 128, 126);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.18, 'rgba(255,255,255,0.72)');
  glow.addColorStop(0.46, 'rgba(255,255,255,0.2)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeNebulaTexture(a: string, b: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);
  const core = ctx.createRadialGradient(256, 256, 18, 256, 256, 248);
  core.addColorStop(0, 'rgba(255,255,255,0.72)');
  core.addColorStop(0.16, a);
  core.addColorStop(0.48, b);
  core.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, 512, 512);
  ctx.globalCompositeOperation = 'destination-in';
  const mask = ctx.createRadialGradient(256, 256, 80, 256, 256, 248);
  mask.addColorStop(0, 'rgba(255,255,255,0.72)');
  mask.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, 512, 512);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Cheap mobile heuristic: a coarse (touch) pointer or a very high-density panel is
// almost always a phone/tablet GPU, where MSAA and soft PCF shadow filtering are
// disproportionately expensive relative to the visual gain. Desktops keep full quality.
function isMobileHeuristic(): boolean {
  const coarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return window.devicePixelRatio > 1.5 || coarsePointer;
}

function handleContextLost(event: Event): void {
  event.preventDefault();
  contextLost = true;
  status('3D context lost, pausing');
  onContextLostCallback?.();
}

function handleContextRestored(): void {
  contextLost = false;
  lastViewW = -1;
  lastViewH = -1;
  lastDpr = -1;
  status('3D cinema mesh restored');
}

export async function ensureMeshOverlay(options?: MeshOverlayInitOptions): Promise<boolean> {
  onContextLostCallback = options?.onContextLost ?? onContextLostCallback;
  if (ready) return true;
  overlayCanvas = document.getElementById('game3d') instanceof HTMLCanvasElement
    ? document.getElementById('game3d') as HTMLCanvasElement
    : null;
  if (!overlayCanvas) return false;

  try {
    const mobile = isMobileHeuristic();
    renderer = new THREE.WebGLRenderer({
      canvas: overlayCanvas,
      alpha: true,
      antialias: !mobile,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    // No mesh in the scene sets receiveShadow, so shadow maps would burn a
    // depth pass every frame without producing a visible shadow. Keep the
    // pipeline off; if real shadows are ever wanted, receivers and the key
    // light's shadow camera bounds must be wired up first.
    renderer.shadowMap.enabled = false;
    overlayCanvas.addEventListener('webglcontextlost', handleContextLost, false);
    overlayCanvas.addEventListener('webglcontextrestored', handleContextRestored, false);

    scene = new THREE.Scene();
    root = new THREE.Group();
    scene.add(root);
    scene.add(new THREE.AmbientLight(0x8aa9ff, 0.92));

    const key = new THREE.DirectionalLight(0xfff2b2, 3.6);
    key.position.set(-360, -520, 880);
    key.castShadow = true;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x5effdb, 2.3);
    rim.position.set(520, 260, 600);
    scene.add(rim);
    const rose = new THREE.DirectionalLight(0xff4d8d, 1.55);
    rose.position.set(420, -300, 500);
    scene.add(rose);
    const hot = new THREE.PointLight(0xffd84a, 3.1, 980);
    hot.position.set(640, 360, 260);
    scene.add(hot);

    camera = new THREE.PerspectiveCamera(calcFov(720), 1280 / 720, 10, 4200);
    camera.position.set(640, 360, CAMERA_Z);
    camera.lookAt(640, 360, 0);
    ready = true;
    status('3D cinema mesh ready');
    return true;
  } catch (err) {
    console.warn('[mesh-overlay] WebGL unavailable', err);
    status('3D unavailable, using vector');
    ready = false;
    return false;
  }
}

export function isMeshOverlayReady(): boolean {
  return ready;
}

export function getMeshCanvas(): HTMLCanvasElement | null {
  return overlayCanvas;
}

// Persistent per-entity scene state. Every drawn "thing" owns a Group that is created
// once and re-parented to `root` forever afterwards; frames only ever mutate transforms
// and toggle `.visible`, never rebuild the graph. Variable-length collections (citizens,
// enemies: keyed by their stable `id`; beacons/lasers/enemy shots: keyed by array index,
// per the perf review's "index+type" allowance) grow on demand and hide surplus slots.
let shipGroup: THREE.Group | null = null;
let shipExtrasGroup: THREE.Group | null = null;
let shipShieldGroup: THREE.Group | null = null;
const citizenGroups = new Map<number, THREE.Group>();
const citizenExtraGroups = new Map<number, THREE.Group>();
const habitatGroups = new Map<number, THREE.Group>();
const habitatExtraGroups = new Map<number, THREE.Group>();
const enemyGroups = new Map<number, THREE.Group>();
const beaconGroups: THREE.Group[] = [];
const laserGroups: THREE.Group[] = [];
const shotGroups: THREE.Group[] = [];
const shotExtraGroups: THREE.Group[] = [];
const relayColumnGroups: THREE.Group[] = [];
const relayArcGroups: THREE.Group[] = [];
const nebulaGroups: THREE.Group[] = [];
const asteroidGroups: THREE.Group[] = [];
const groundPlateGroups: THREE.Group[] = [];
let speedStreaksGroup: THREE.Group | null = null;
const usedCitizenIds = new Set<number>();
const usedEnemyIds = new Set<number>();

function hideGameplayGroups(): void {
  hideAllIndexed(nebulaGroups);
  hideAllIndexed(asteroidGroups);
  hideAllIndexed(groundPlateGroups);
  hideAllIndexed(relayColumnGroups);
  hideAllIndexed(relayArcGroups);
  if (speedStreaksGroup) speedStreaksGroup.visible = false;
  hideAllIndexed(laserGroups);
  hideAllIndexed(shotGroups);
  hideAllIndexed(shotExtraGroups);
  hideAllMapped(citizenGroups);
  hideAllMapped(citizenExtraGroups);
  hideAllMapped(habitatGroups);
  hideAllMapped(habitatExtraGroups);
  hideAllIndexed(beaconGroups);
  hideAllMapped(enemyGroups);
}

export function renderMeshOverlay(frame: MeshFrame): void {
  if (!ready || !renderer || !scene || !camera || !root || contextLost) return;
  const sceneRoot = root;

  if (frame.dpr !== lastDpr) {
    renderer.setPixelRatio(frame.dpr);
    lastDpr = frame.dpr;
  }
  if (frame.viewW !== lastViewW || frame.viewH !== lastViewH) {
    renderer.setSize(frame.viewW, frame.viewH, false);
    lastViewW = frame.viewW;
    lastViewH = frame.viewH;
  }
  camera.aspect = frame.viewW / frame.viewH;
  camera.fov = calcFov(frame.viewH);
  const swayX = clamp(frame.ship.vx / 1200, -1, 1) * 8 + Math.sin(frame.t * 1.3) * 2.2;
  const swayY = clamp(frame.ship.vy / 520, -1, 1) * 5 + Math.cos(frame.t * 1.1) * 1.6;
  camera.position.set(frame.viewW / 2 + swayX, frame.viewH / 2 + swayY, CAMERA_Z);
  camera.up.set(Math.sin(frame.t * 0.5) * 0.01, 1, 0);
  camera.lookAt(frame.viewW / 2, frame.viewH / 2, 0);
  camera.updateProjectionMatrix();

  if (frame.phase !== 'title') {
    addCinematicWorld(sceneRoot, frame);
    addSpeedStreaks(sceneRoot, frame);
    frame.lasers.forEach((laser, i) => addLaser(sceneRoot, frame, laser, i));
    hideIndexedFrom(laserGroups, frame.lasers.length);
    frame.enemyShots.forEach((shot, i) => addEnemyShot(sceneRoot, frame, shot, i));
    hideIndexedFrom(shotGroups, frame.enemyShots.length);
    hideIndexedFrom(shotExtraGroups, frame.enemyShots.length);
  } else {
    hideGameplayGroups();
  }
  addShip(sceneRoot, frame);
  if (frame.phase !== 'title') {
    usedCitizenIds.clear();
    for (const citizen of frame.citizens) {
      usedCitizenIds.add(citizen.id);
      addCitizen(sceneRoot, frame, citizen);
    }
    hideMapEntriesExcept(citizenGroups, usedCitizenIds);
    hideMapEntriesExcept(citizenExtraGroups, usedCitizenIds);
    hideMapEntriesExcept(habitatGroups, usedCitizenIds);
    hideMapEntriesExcept(habitatExtraGroups, usedCitizenIds);

    frame.beacons.forEach((beacon, i) => addBeacon(sceneRoot, frame, beacon, i));
    hideIndexedFrom(beaconGroups, frame.beacons.length);

    usedEnemyIds.clear();
    for (const enemy of frame.enemies) {
      usedEnemyIds.add(enemy.id);
      addEnemy(sceneRoot, frame, enemy);
    }
    hideMapEntriesExcept(enemyGroups, usedEnemyIds);
  }

  renderer.clear();
  renderer.render(scene, camera);
}

function addCinematicWorld(rootGroup: THREE.Group, frame: MeshFrame): void {
  nebulaClouds.forEach((cloud, i) => {
    const group = getIndexedGroup(nebulaGroups, i, rootGroup);
    const x = sxParallax(cloud.x, frame, 0.18);
    if (x < -520 || x > frame.viewW + 520) {
      group.visible = false;
      return;
    }
    const pool = childPool(group);
    pool.beginEntity();
    const nebula = pool.mesh('cloud', nebulaPlaneGeo, cloud.mat);
    nebula.position.set(x, sy(cloud.y + Math.sin(frame.t * 0.18 + cloud.phase) * 18, frame), cloud.z);
    nebula.rotation.z = Math.sin(frame.t * 0.08 + cloud.phase) * 0.2;
    nebula.scale.set(cloud.scale * 1.45, cloud.scale * 0.72, 1);
  });

  depthAsteroids.forEach((rock, i) => {
    const group = getIndexedGroup(asteroidGroups, i, rootGroup);
    const x = sxParallax(rock.x, frame, 0.36);
    if (x < -150 || x > frame.viewW + 150) {
      group.visible = false;
      return;
    }
    const pool = childPool(group);
    pool.beginEntity();
    const asteroid = pool.mesh('rock', asteroidGeo, mats.asteroid);
    asteroid.position.set(x, sy(rock.y, frame), rock.z);
    asteroid.scale.setScalar(rock.scale * (frame.viewport.portrait ? 0.72 : 1));
    asteroid.rotation.set(frame.t * 0.09 + rock.phase, frame.t * 0.13 + rock.phase * 0.4, frame.t * 0.06);
    const rim = pool.sprite('rim', asteroidRimGlowMat);
    rim.position.set(x, sy(rock.y, frame), rock.z + 8);
    rim.scale.set(rock.scale * 92, rock.scale * 58, 1);
  });

  addGroundPlates(rootGroup, frame);
  addRelaySkyArcs(rootGroup, frame);
  relayColumns.forEach((worldX, i) => addRelayColumn(rootGroup, frame, worldX, i));
}

const relayArcGeometries: THREE.BufferGeometry[] = [];

function getArcGeometry(index: number): THREE.BufferGeometry {
  let geo = relayArcGeometries[index];
  if (!geo) {
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    relayArcGeometries[index] = geo;
  }
  return geo;
}

function updateArcGeometry(geo: THREE.BufferGeometry, x1: number, y1: number, midX: number, midY: number, x2: number, y2: number): void {
  const attr = geo.getAttribute('position') as THREE.BufferAttribute;
  const array = attr.array as Float32Array;
  array[0] = x1; array[1] = y1; array[2] = -130;
  array[3] = midX; array[4] = midY; array[5] = -180;
  array[6] = x2; array[7] = y2; array[8] = -130;
  attr.needsUpdate = true;
  geo.computeBoundingSphere();
}

function addRelaySkyArcs(rootGroup: THREE.Group, frame: MeshFrame): void {
  relayColumns.forEach((worldX, i) => {
    const group = getIndexedGroup(relayArcGroups, i, rootGroup);
    const nextX = wrapX(worldX + 512, frame.worldW);
    const x1 = sx(worldX, frame);
    const x2 = sx(nextX, frame);
    if ((x1 < -180 || x1 > frame.viewW + 180) && (x2 < -180 || x2 > frame.viewW + 180)) {
      group.visible = false;
      return;
    }
    const leftMood = relayColumnMood(frame, worldX);
    const rightMood = relayColumnMood(frame, nextX);
    const intensity = Math.max(leftMood.intensity, rightMood.intensity);
    if (intensity < 0.12 && !leftMood.highValue && !rightMood.highValue && worldX % 1024 !== 0) {
      group.visible = false;
      return;
    }
    const pool = childPool(group);
    pool.beginEntity();
    const y1 = sy(terrainY(worldX) - 94, frame);
    const y2 = sy(terrainY(nextX) - 94, frame);
    const mid = (x1 + x2) / 2;
    const lift = Math.min(y1, y2) - 30 - intensity * 24 - Math.sin(frame.t * 0.8 + worldX * 0.01) * 6;
    const mat = intensity > 0.42 ? lineMats.relayArcHot : intensity > 0.12 ? lineMats.relayArc : lineMats.relayArcDim;
    const geo = getArcGeometry(i);
    updateArcGeometry(geo, x1, y1, mid, lift, x2, y2);
    pool.dynamicLine('arc', geo, mat);
    if (worldX % 1024 === 0 || intensity > 0.35) {
      const packet = pool.sprite('packet', glowMats.amber);
      const p = (frame.t * 0.18 + worldX / frame.worldW) % 1;
      const px = (1 - p) * (1 - p) * x1 + 2 * (1 - p) * p * mid + p * p * x2;
      const py = (1 - p) * (1 - p) * y1 + 2 * (1 - p) * p * lift + p * p * y2;
      packet.position.set(px, py, -118);
      packet.scale.set(18 + intensity * 20, 18 + intensity * 20, 1);
    }
  });
}

function addGroundPlates(rootGroup: THREE.Group, frame: MeshFrame): void {
  const start = Math.floor((frame.cameraX - frame.viewW / 2 - 220) / 140) * 140;
  let slot = 0;
  for (let x = start; x <= frame.cameraX + frame.viewW / 2 + 360; x += 140) {
    const group = getIndexedGroup(groundPlateGroups, slot, rootGroup);
    const pool = childPool(group);
    pool.beginEntity();
    const worldX = wrapX(x, frame.worldW);
    const screen = sx(worldX, frame);
    const y = terrainY(worldX) + 22;
    const slab = pool.mesh('slab', groundPlateGeo, mats.ground);
    slab.position.set(screen, sy(y, frame), -50);
    slab.scale.set(124, 1, 1 + Math.sin(worldX * 0.019) * 0.16);
    slab.rotation.z = Math.sin(worldX * 0.01) * 0.05;
    if (x % 280 === 0) {
      const seam = pool.mesh('seam', groundPlateGeo, worldX % 560 === 0 ? mats.beaconRing : mats.signalRing);
      seam.position.set(screen + 34, sy(y - 4, frame), -42);
      seam.scale.set(18, 0.5, 0.7);
      seam.rotation.z = slab.rotation.z + 0.08;
    }
    slot += 1;
  }
  hideIndexedFrom(groundPlateGroups, slot);
}

function relayColumnMood(frame: MeshFrame, worldX: number): RelayColumnMood {
  let best = 0;
  let contactCount = 0;
  let highValue = false;
  for (const citizen of frame.citizens) {
    const delta = Math.abs(wrapDelta(citizen.homeX, worldX, frame.worldW));
    if (delta > 256 * 0.82) continue;
    contactCount += 1;
    highValue ||= citizen.relation === 'high-wot';
    const relationBoost = citizen.relation === 'high-wot' ? 0.18 : citizen.relation === 'mutual' ? 0.11 : 0.06;
    const statusBoost = citizen.status === 'falling'
      ? 0.82
      : citizen.status === 'carried'
        ? 0.96
        : citizen.status === 'lost'
          ? 0.28
          : 0;
    const homeBoost = clamp(1 - delta / (256 * 0.82), 0, 1) * 0.16;
    best = Math.max(best, citizen.threat * 0.38 + citizen.capture * 0.36 + statusBoost + relationBoost + homeBoost);
  }
  for (const shot of frame.enemyShots) {
    const delta = Math.abs(wrapDelta(shot.x, worldX, frame.worldW));
    if (delta < 180 && shot.y > terrainY(worldX) - 130) best = Math.max(best, shot.kind === 'barrage' ? 0.78 : 0.48);
  }
  const intensity = clamp(best, 0, 1);
  return {
    active: intensity > 0.16,
    highValue,
    intensity,
    contactCount,
  };
}

function addRelayColumn(rootGroup: THREE.Group, frame: MeshFrame, worldX: number, index: number): void {
  const group = getIndexedGroup(relayColumnGroups, index, rootGroup);
  const x = sx(worldX, frame);
  if (x < -160 || x > frame.viewW + 160) {
    group.visible = false;
    return;
  }
  const mood = relayColumnMood(frame, worldX);
  if (!mood.active && !mood.highValue && Math.round(worldX / 512) % 2 !== 0) {
    group.visible = false;
    return;
  }
  const pool = childPool(group);
  pool.beginEntity();
  const ground = terrainY(worldX);
  const portraitTower = frame.viewport.portrait;
  group.position.set(x, sy(ground - 48, frame), -18);
  const baseScale = portraitTower ? 0.2 : 0.34;
  group.scale.setScalar(baseScale + (mood.active ? mood.intensity * (portraitTower ? 0.16 : 0.24) : mood.highValue ? 0.06 : 0));

  const foundation = pool.mesh('foundation', habitatPadGeo, mats.tower);
  foundation.position.set(0, 50, -4);
  foundation.scale.set(mood.active ? 0.94 : 0.72, mood.active ? 0.38 : 0.3, 0.32);

  const mast = pool.mesh('mast', towerMastGeo, mats.tower);
  mast.scale.set(mood.active ? 0.62 : 0.45, mood.active ? 0.64 + mood.intensity * 0.18 : 0.42, mood.active ? 0.62 : 0.45);
  mast.castShadow = true;

  if (mood.active) {
    const beam = pool.mesh('beam', towerBeamGeo, mats.towerHot);
    beam.position.set(0, -4 - mood.intensity * 12, 0);
    beam.scale.set(0.48 + mood.intensity * 0.28 + Math.sin(frame.t * 5.6 + worldX) * 0.06, 0.5 + mood.intensity * 0.18, 0.5 + mood.intensity * 0.18);
  }

  const ringCount = mood.active ? 3 : mood.highValue ? 2 : 1;
  for (let i = 0; i < ringCount; i += 1) {
    const ring = pool.mesh(`ring:${i}`, towerRingGeo, mats.towerHot);
    ring.position.y = -54 + i * 34;
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = frame.t * (0.65 + mood.intensity * 0.42 + i * 0.22) + worldX * 0.01;
    ring.scale.setScalar(0.36 + mood.intensity * 0.2 + i * 0.11 + Math.sin(frame.t * 2.2 + i + worldX) * 0.025);
  }

  const dish = pool.mesh('dish', towerRingGeo, mats.beaconRing);
  dish.position.set(0, -64 - mood.intensity * 16, 14);
  dish.rotation.x = Math.PI / 2 + Math.sin(frame.t * 0.7 + worldX) * 0.08;
  dish.rotation.z = frame.t * 0.42 + worldX * 0.004;
  dish.scale.set(portraitTower ? 0.5 + mood.intensity * 0.2 : 0.72 + mood.intensity * 0.34, portraitTower ? 0.14 : 0.22, 1);

  addSpriteGlow(pool, 'dish-glow', mood.intensity > 0.45 ? glowMats.amber : glowMats.cyan, 0, -50 - mood.intensity * 12, 2, (portraitTower ? 22 : 34) + mood.intensity * 34, (portraitTower ? 12 : 18) + mood.intensity * 22);
}

function addSpeedStreaks(rootGroup: THREE.Group, frame: MeshFrame): void {
  if (!speedStreaksGroup) {
    speedStreaksGroup = new THREE.Group();
    rootGroup.add(speedStreaksGroup);
  }
  const group = speedStreaksGroup;
  group.visible = true;
  const speed = Math.abs(frame.ship.vx);
  if (speed < 860) {
    group.visible = false;
    return;
  }
  const pool = childPool(group);
  pool.beginEntity();
  const intensity = clamp((speed - 860) / 1040, 0, 1);
  const dir = frame.ship.vx >= 0 ? -1 : 1;
  const drift = (frame.t * (170 + speed * 0.46)) % 520;
  const count = intensity > 0.64 ? 4 : 3;
  for (let i = 0; i < count; i += 1) {
    const mat = i % 5 === 0 ? mats.driftAmber : i % 3 === 0 ? mats.driftRose : mats.driftCyan;
    const streak = pool.mesh(`streak:${i}`, speedStreakGeo, mat);
    const baseX = ((i * 211 + drift * dir) % (frame.viewW + 620)) - 300;
    const y = PLAY_TOP + 44 + ((i * 91) % 310) + Math.sin(frame.t * 2.4 + i) * 8;
    const length = 34 + speed * 0.052 + (i % 4) * 12;
    streak.position.set(baseX, sy(y, frame), 120 + (i % 6) * 12);
    streak.scale.set(length, 0.75 + intensity * 0.9 + (i % 2) * 0.45, 1);
    streak.rotation.z = dir * 0.015 + Math.sin(i) * 0.02;
  }
}

function addLaser(rootGroup: THREE.Group, frame: MeshFrame, laser: MeshLaser, index: number): void {
  const group = getIndexedGroup(laserGroups, index, rootGroup);
  const pool = childPool(group);
  pool.beginEntity();
  const x = sx(laser.x, frame);
  const length = Math.min(frame.viewW * 1.35, laser.length);
  const life = clamp(laser.ttl / 0.052, 0, 1);
  const heat = clamp(laser.heat, 0, 1);
  const core = pool.mesh('core', laserGeo, mats.laserCore);
  core.position.set(x + laser.dir * length * 0.5, sy(laser.y, frame), 120);
  core.scale.set(length, 0.82 + life * 0.42 - heat * 0.18, 1.4);

  const glow = pool.mesh('glow', laserGeo, mats.laserGlow);
  glow.position.copy(core.position);
  glow.scale.set(length * (1 - heat * 0.08), 2.6 + life * 2.9 + heat * 1.3, 3.4);

  for (const side of [-1, 1] as const) {
    const rail = pool.mesh(`rail:${side}`, laserGeo, mats.laserAmber);
    rail.position.set(core.position.x, core.position.y + side * (2.3 + life * 0.6), 123);
    rail.scale.set(length * (0.72 - heat * 0.08), 0.42 + heat * 0.12, 1.1);
  }

  const flash = pool.sprite('flash', glowMats.white);
  flash.position.set(x + laser.dir * 44, sy(laser.y, frame), 128);
  const pop = 18 + life * 12 + Math.sin(frame.t * 70) * 2.5;
  flash.scale.set(pop, pop * 0.7, 1);

  const wake = pool.sprite('wake', glowMats.cyan);
  wake.position.set(x + laser.dir * (length * 0.42), sy(laser.y, frame), 116);
  wake.scale.set(length * 0.2, 10 + life * 7, 1);

  if (laser.impact) {
    const impactX = sx(laser.impactX, frame);
    const impactY = sy(laser.impactY, frame);
    const hit = pool.sprite('hit', heat > 0.68 ? glowMats.amber : glowMats.white);
    hit.position.set(impactX, impactY, 132);
    hit.scale.set(46 + heat * 28 + life * 16, 30 + heat * 14 + life * 9, 1);

    const ring = pool.mesh('ring', enemyRingGeo, heat > 0.68 ? mats.laserAmber : mats.laserGlow);
    ring.position.set(impactX, impactY, 130);
    ring.rotation.x = Math.PI / 2;
    ring.scale.setScalar(0.42 + heat * 0.24 + life * 0.18);
  }
}

function colourWithAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface ShotBoltAsset {
  material: THREE.MeshBasicMaterial;
  worldWidth: number;
  worldHeight: number;
  offsetX: number;
}

// Enemy shot bolts (dart/jam/barrage) used to be built from stacked 3D boxes
// + a sphere tip. That volumetric approach caught real perspective/rotation
// shading and read as a solid faceted "flying arrow" object - the opposite
// of vector's flat neon energy-bolt look, and the thing players kept
// rejecting ("dart/arrow style", "chunky"). Baking the *exact same* canvas
// draw vector's drawEnemyShot uses (screen-blend gradient trail + diamond
// head + kind-specific fins/tendrils) onto a flat plane keeps the shot
// pixel-faithful to vector from every angle - same trick already used for
// pickup icons (see drawScreenBlendIconMaterial above). The plane only ever
// spins around its own view-axis (rotation.z in addEnemyShot below), and the
// camera looks almost exactly down -Z (see CAMERA_Z / camera.lookAt), so a
// Z-only rotation keeps the plane face-on to the camera for free - no sprite
// billboarding math needed.
function bakeShotBoltAsset(kind: 'dart' | 'jam' | 'barrage', worldLength: number): ShotBoltAsset {
  const tailLen = kind === 'barrage' ? 48 : kind === 'jam' ? 42 : 38;
  const headLen = kind === 'barrage' ? 10 : kind === 'jam' ? 8 : 6;
  const half = kind === 'barrage' ? 2.8 : kind === 'jam' ? 2.3 : 1.35;
  const pulse = 0.5;
  const colour = kind === 'jam' ? '#5f7cff' : kind === 'barrage' ? '#ff2f7a' : '#ff334e';
  const backSpan = tailLen * 1.15;
  const frontSpan = (headLen * 1.8 + 10) * 1.15;
  const totalSpan = backSpan + frontSpan;
  const W = 256;
  const H = 104;
  const scale = W / totalSpan;
  const originFrac = backSpan / totalSpan;
  const worldHeight = worldLength * (H / W);
  const offsetX = (0.5 - originFrac) * worldLength;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');
  if (!c) {
    return { material: new THREE.MeshBasicMaterial(), worldWidth: worldLength, worldHeight, offsetX };
  }
  c.fillStyle = '#000000';
  c.fillRect(0, 0, W, H);
  c.translate(backSpan * scale, H / 2);
  c.scale(scale, scale);
  c.globalCompositeOperation = 'screen';
  c.shadowColor = colour;
  c.shadowBlur = kind === 'jam' ? 10 : kind === 'barrage' ? 12 : 7;
  c.lineCap = 'butt';
  c.lineJoin = 'miter';
  const trailGrad = c.createLinearGradient(-tailLen, 0, headLen, 0);
  trailGrad.addColorStop(0, 'rgba(0,0,0,0)');
  trailGrad.addColorStop(0.38, colourWithAlpha(colour, kind === 'barrage' ? 0.28 : 0.22));
  trailGrad.addColorStop(0.86, colour);
  trailGrad.addColorStop(1, '#fff5d8');
  c.globalAlpha = kind === 'jam' ? 0.82 : kind === 'barrage' ? 0.88 : 0.86;
  c.strokeStyle = trailGrad;
  c.lineWidth = kind === 'barrage' ? 1.35 : kind === 'jam' ? 1.15 : 0.72;
  c.beginPath();
  c.moveTo(-tailLen, 0);
  c.lineTo(headLen * 0.65, 0);
  c.stroke();

  c.globalAlpha = 0.82;
  c.strokeStyle = kind === 'jam' ? '#e7edff' : kind === 'barrage' ? '#fff0f7' : '#fff5d8';
  c.lineWidth = kind === 'barrage' ? 0.55 : 0.42;
  c.shadowBlur = 4;
  c.beginPath();
  c.moveTo(-tailLen * 0.48, 0);
  c.lineTo(headLen * 0.78, 0);
  c.stroke();

  c.globalAlpha = 0.96;
  c.fillStyle = kind === 'jam' ? '#b6c7ff' : kind === 'barrage' ? '#ffd5e5' : '#fff5d8';
  c.strokeStyle = colour;
  c.lineWidth = 1;
  c.shadowBlur = kind === 'barrage' ? 14 : 9;
  c.beginPath();
  c.moveTo(headLen + pulse * 1.5, 0);
  c.lineTo(0, -half);
  c.lineTo(-headLen * 0.42, 0);
  c.lineTo(0, half);
  c.closePath();
  c.fill();
  c.stroke();

  if (kind === 'barrage') {
    c.globalAlpha = 0.72;
    c.strokeStyle = '#fff0f7';
    c.lineWidth = 1.1;
    for (const side of [-1, 1] as const) {
      c.beginPath();
      c.moveTo(-8, side * 1.8);
      c.lineTo(-24 - pulse * 5, side * (8 + pulse * 2));
      c.stroke();
    }
  } else if (kind === 'jam') {
    c.globalAlpha = 0.68;
    c.strokeStyle = '#5effdb';
    c.lineWidth = 0.9;
    for (const side of [-1, 1] as const) {
      c.beginPath();
      c.moveTo(-4, side * 1.4);
      c.lineTo(-22 - pulse * 4, side * (7 + pulse * 2));
      c.lineTo(-31 - pulse * 3, side * (2 + pulse));
      c.stroke();
    }
  }

  const image = c.getImageData(0, 0, W, H);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    const alpha = Math.max(r, g, b);
    if (alpha > 0) {
      data[i] = Math.min(255, Math.round((r * 255) / alpha));
      data[i + 1] = Math.min(255, Math.round((g * 255) / alpha));
      data[i + 2] = Math.min(255, Math.round((b * 255) / alpha));
    }
    data[i + 3] = alpha;
  }
  c.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return { material, worldWidth: worldLength, worldHeight, offsetX };
}

const shotBoltAssets = {
  dart: bakeShotBoltAsset('dart', 78),
  jam: bakeShotBoltAsset('jam', 72),
  barrage: bakeShotBoltAsset('barrage', 94),
};

function addEnemyShot(rootGroup: THREE.Group, frame: MeshFrame, shot: MeshEnemyShot, index: number): void {
  const innerGroup = getIndexedGroup(shotGroups, index, rootGroup);
  const extraGroup = getIndexedGroup(shotExtraGroups, index, rootGroup);
  const x = sx(shot.x, frame);
  if (x < -130 || x > frame.viewW + 130) {
    innerGroup.visible = false;
    extraGroup.visible = false;
    return;
  }
  const pool = childPool(innerGroup);
  pool.beginEntity();
  const extraPool = childPool(extraGroup);
  extraPool.beginEntity();
  const y = sy(shot.y, frame);
  const kind = shot.kind;
  if (kind === 'spam') {
    // Spam mines float in place: spinning spiked core with a warning ring and glow.
    const minePhase = frame.t * 8 + shot.age * 5;
    const minePulse = 0.5 + Math.sin(minePhase) * 0.5;
    const armed = shot.age >= 0.55;
    innerGroup.position.set(x, y, 150);
    innerGroup.rotation.set(frame.t * 1.2 + shot.age, frame.t * 1.7, frame.t * 0.9 + shot.age * 0.6);

    // sybilOrbGeo has a 9-unit radius (unlike the unit shot geometries), so scale it down.
    const core = pool.mesh('spam-core', sybilOrbGeo, mats.shotSpam);
    core.scale.setScalar(((armed ? 12 : 8.5) + minePulse * 2.2) / 9);

    const ring = pool.mesh('spam-ring', shotRingGeo, mats.shotSpam);
    ring.rotation.x = Math.PI / 2;
    ring.scale.setScalar((armed ? 19 : 13) + minePulse * 3.5);

    for (let i = 0; i < 4; i += 1) {
      const spikeAngle = (i / 4) * Math.PI * 2 + frame.t * 2.2;
      const spike = pool.mesh(`spam-spike:${i}`, laserGeo, mats.shotSpam);
      spike.position.set(Math.cos(spikeAngle) * 16, Math.sin(spikeAngle) * 16, 0);
      spike.rotation.z = spikeAngle;
      spike.scale.set(9 + minePulse * 3, 1.4, 1.4);
    }

    const mineGlow = extraPool.sprite('glow', glowMats.blue);
    mineGlow.position.set(x, y, 140);
    const glowSize = (armed ? 58 : 40) + minePulse * 14;
    mineGlow.scale.set(glowSize, glowSize, 1);
    return;
  }
  const angle = Math.atan2(-shot.vy, shot.vx);
  const isBarrage = kind === 'barrage';
  const isJam = kind === 'jam';
  const phase = frame.t * (isBarrage ? 15 : isJam ? 11 : 22) + shot.age * 16;
  const pulse = 0.5 + Math.sin(phase) * 0.5;
  const glowMat = isBarrage ? glowMats.rose : isJam ? glowMats.blue : glowMats.amber;
  const asset = isBarrage ? shotBoltAssets.barrage : isJam ? shotBoltAssets.jam : shotBoltAssets.dart;
  innerGroup.position.set(x, y, isBarrage ? 166 : isJam ? 154 : 146);
  // rotation.x/y are never otherwise touched here, but this pool index may
  // have last held a spam mine, which leaves a large accumulated tumble
  // behind (spam tumbles via rotation.set(t*1.2+age, ...)) — reset so a
  // reused slot doesn't inherit it. The bolt is a flat plane baked from
  // vector's own drawEnemyShot draw (see bakeShotBoltAsset above); it only
  // ever spins in Z (screen-plane angle) so it stays face-on to the
  // near-orthogonal camera, matching vector's always-flat-to-viewer look
  // instead of the old boxes' faceted "flying arrow" read.
  innerGroup.rotation.x = 0;
  innerGroup.rotation.y = 0;
  innerGroup.rotation.z = angle;

  const bolt = pool.mesh('bolt', shotBoltGeo, asset.material);
  bolt.position.set(asset.offsetX, 0, 0);
  bolt.scale.set(asset.worldWidth, asset.worldHeight, 1);

  const glow = extraPool.sprite('glow', glowMat);
  glow.position.set(x, y, isBarrage ? 150 : 136);
  glow.scale.set(isBarrage ? 78 + pulse * 18 : isJam ? 60 + pulse * 14 : 50 + pulse * 9, isBarrage ? 21 + pulse * 7 : isJam ? 27 + pulse * 8 : 17 + pulse * 5, 1);
}

function addCaptureBeam(rootGroup: THREE.Group, frame: MeshFrame, enemy: MeshEnemy): void {
  if (enemy.type !== 'abductor' || enemy.carryingCitizenId !== null || enemy.captureCharge <= 0 || enemy.targetX === null || enemy.targetY === null) return;
  const capture = clamp(enemy.captureCharge / Math.max(0.1, frame.tuning.captureLockTime), 0, 1);
  const x1 = sx(enemy.x, frame);
  const y1 = sy(enemy.y, frame);
  const x2 = sx(enemy.targetX, frame);
  const y2 = sy(enemy.targetY, frame);
  if ((x1 < -120 && x2 < -120) || (x1 > frame.viewW + 120 && x2 > frame.viewW + 120)) return;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;

  const beam = new THREE.Mesh(captureBeamGeo, capture > 0.72 ? mats.captureHot : mats.captureBeam);
  beam.position.set((x1 + x2) / 2, (y1 + y2) / 2, 86);
  beam.scale.set(len, 2.5 + capture * 7, 3 + capture * 7);
  beam.rotation.z = Math.atan2(dy, dx);
  rootGroup.add(beam);

  const lock = new THREE.Mesh(enemyRingGeo, capture > 0.72 ? mats.captureHot : mats.captureBeam);
  lock.position.set(x2, y2, 88);
  lock.rotation.x = Math.PI / 2;
  lock.scale.setScalar(0.72 + capture * 0.78 + Math.sin(frame.t * 12) * 0.04);
  rootGroup.add(lock);
  const glow = new THREE.Sprite(capture > 0.72 ? glowMats.rose : glowMats.amber);
  glow.position.set(x2, y2, 82);
  glow.scale.set(70 + capture * 70, 70 + capture * 70, 1);
  rootGroup.add(glow);
}

function hideShipShield(): void {
  if (shipShieldGroup) shipShieldGroup.visible = false;
}

function addShip(rootGroup: THREE.Group, frame: MeshFrame): void {
  if (!shipGroup) {
    shipGroup = new THREE.Group();
    rootGroup.add(shipGroup);
  }
  if (!shipExtrasGroup) {
    shipExtrasGroup = new THREE.Group();
    rootGroup.add(shipExtrasGroup);
  }
  if (frame.ship.destroyed) {
    shipGroup.visible = false;
    shipExtrasGroup.visible = false;
    hideShipShield();
    return;
  }
  const x = sx(frame.ship.x, frame);
  const y = sy(frame.ship.y, frame);
  const shipClass = frame.ship.shipClass;
  const interceptor = shipClass === 'interceptor';
  const guardian = shipClass === 'guardian';
  const heavy = shipClass === 'heavy';
  const shipMat = heavy ? mats.shipHeavy : interceptor ? mats.shipInterceptor : mats.ship;
  const darkMat = heavy ? mats.shipHeavyDark : interceptor ? mats.shipInterceptorDark : mats.shipDark;
  const wingMat = interceptor ? mats.shipInterceptor : heavy ? mats.shipGold : mats.shipWing;
  const accentMat = heavy ? mats.shipWing : mats.shipGold;
  const primaryGlow = heavy ? glowMats.amber : glowMats.cyan;
  const secondaryGlow = heavy ? glowMats.rose : glowMats.amber;
  const titlePreview = frame.phase === 'title';
  // The vector tier deliberately shows the title ship preview BIGGER than
  // the in-flight ship (0.78 vs 0.69 scale, see drawTitleShipPreview) since
  // it's a showcase, not a gameplay actor — this used to go the other way
  // (1.48 vs 1.72, smaller), leaving the mesh-tier preview looking tiny and
  // washed out next to the vector version.
  const actorScale = frame.tuning.actorScale * (frame.viewport.portrait ? 0.96 : frame.viewport.cropped ? 1 : 1.02) * (titlePreview ? 3.2 : 1.72);
  if (frame.ship.shieldHits > 0) addShipShieldMesh(rootGroup, frame, x, y, actorScale, frame.ship.shieldHits);
  else hideShipShield();
  if (frame.ship.invuln > 0 && Math.floor(frame.t * 14) % 2 === 0) {
    shipGroup.visible = false;
    shipExtrasGroup.visible = false;
    return;
  }

  shipGroup.visible = true;
  shipExtrasGroup.visible = true;
  const group = shipGroup;
  const pool = childPool(group);
  pool.beginEntity();
  const extraPool = childPool(shipExtrasGroup);
  extraPool.beginEntity();
  group.position.set(x, y, 86);
  const baseScale = 0.38 * actorScale;
  const lengthScale = interceptor ? 1.12 : heavy ? 1.05 : 1;
  const widthScale = interceptor ? 0.76 : heavy ? 1.2 : 1;
  group.scale.set(frame.ship.dir * baseScale * lengthScale, baseScale * widthScale, baseScale);
  group.rotation.x = Math.sin(frame.t * 2.1) * 0.07 + clamp(frame.ship.vy / 1800, -0.16, 0.16);
  group.rotation.y = Math.sin(frame.t * 2.7) * 0.22 + frame.ship.dir * clamp(frame.ship.vx / 9000, -0.1, 0.1);
  group.rotation.z = clamp(frame.ship.vy / 660, -0.24, 0.24);
  const thrust = clamp(frame.ship.speed / 1150, 0, 1);
  const turn = clamp(frame.ship.turnCue, 0, 1);
  const heat = clamp(frame.ship.heat, 0, 1);
  const pulse = Math.sin(frame.t * 34) * 0.5 + 0.5;

  syncSpriteVariant(shipAuraMat, primaryGlow, 0.22 + thrust * 0.08 + turn * 0.08);
  const aura = extraPool.sprite('aura', shipAuraMat);
  aura.position.set(x - frame.ship.dir * (14 + thrust * 18), y, 62);
  aura.scale.set(112 + thrust * 90 + turn * 44, 46 + thrust * 28 + turn * 18, 1);

  syncSpriteVariant(shipFloorShadowMat, primaryGlow, 0.14 + thrust * 0.08);
  const floorShadow = extraPool.sprite('floor-shadow', shipFloorShadowMat);
  floorShadow.position.set(x, sy(terrainY(frame.ship.x) - 10, frame), 24);
  floorShadow.scale.set(116 + thrust * 66, 20 + thrust * 8, 1);

  const shadowBody = pool.mesh('shadow-body', shipBodyGeo, darkMat);
  shadowBody.position.z = -3;
  shadowBody.scale.set(interceptor ? 1.18 : heavy ? 1.18 : 1.06, interceptor ? 0.78 : heavy ? 1.18 : 1.04, 1.22);
  shadowBody.castShadow = true;

  const body = pool.mesh('body', shipFuselageGeo, shipMat);
  body.position.z = 7;
  body.scale.set(interceptor ? 1.48 : heavy ? 1.04 : 1.2, interceptor ? 0.7 : heavy ? 1.16 : 1.0, heavy ? 1.16 : 1.05);
  body.castShadow = true;

  const shell = pool.mesh('shell', shipBodyGeo, shipMat);
  shell.position.z = 3;
  shell.scale.set(interceptor ? 0.98 : heavy ? 1.08 : 0.92, interceptor ? 0.58 : heavy ? 1.12 : 0.82, heavy ? 1.08 : 0.92);
  shell.castShadow = true;
  addLine(pool, 'body-edges', shipBodyEdges, lineMats.ship, 9.5);

  const nose = pool.mesh('nose', shipNoseGeo, accentMat);
  nose.position.set(interceptor ? 70 : heavy ? 53 : 58, 0, 6);
  nose.scale.set(interceptor ? 1.24 : heavy ? 0.8 : 0.9, interceptor ? 0.54 : heavy ? 1.08 : 0.86, heavy ? 0.92 : 0.72);

  const upperWing = pool.mesh('upper-wing', shipWingGeo, wingMat);
  upperWing.position.z = -7;
  upperWing.rotation.x = -0.16;
  upperWing.scale.set(interceptor ? 1.18 : heavy ? 1.02 : 1, interceptor ? 0.7 : heavy ? 1.22 : 1, heavy ? 1.08 : 1);
  addLine(pool, 'upper-wing-edges', shipWingEdges, lineMats.shipGlow, -1.2);

  const lowerWing = pool.mesh('lower-wing', shipLowerWingGeo, wingMat);
  lowerWing.position.z = -7;
  lowerWing.rotation.x = 0.16;
  lowerWing.scale.set(interceptor ? 1.18 : heavy ? 1.02 : 1, interceptor ? 0.7 : heavy ? 1.22 : 1, heavy ? 1.08 : 1);
  addLine(pool, 'lower-wing-edges', shipLowerWingEdges, lineMats.shipGlow, -1.2);

  for (const side of [-1, 1] as const) {
    const pod = pool.mesh(`pod:${side}`, shipPodGeo, darkMat);
    pod.position.set(interceptor ? -38 : heavy ? -32 : -29, side * (interceptor ? 17 : heavy ? 31 : 25), 1);
    pod.rotation.x = side * 0.12;
    pod.scale.set(interceptor ? 0.62 : heavy ? 1.22 : 1, interceptor ? 0.68 : heavy ? 1.16 : 1, heavy ? 1.12 : 1);
    pod.castShadow = true;

    const fin = pool.mesh(`fin:${side}`, shipFinGeo, accentMat);
    fin.position.set(interceptor ? -13 : heavy ? -4 : -7, side * (interceptor ? 23 : heavy ? 36 : 30), 8);
    fin.rotation.z = side * (interceptor ? 0.32 : heavy ? 0.12 : 0.18);
    fin.scale.set(interceptor ? 0.82 : heavy ? 1.18 : 1, interceptor ? 0.74 : heavy ? 1.08 : 1, 1);

    const strip = pool.mesh(`strip:${side}`, shipFinGeo, wingMat);
    strip.position.set(interceptor ? 16 : 3, side * (interceptor ? 15 : heavy ? 24 : 19), 15);
    strip.scale.set(interceptor ? 0.72 : 0.56, interceptor ? 0.26 : heavy ? 0.52 : 0.42, 0.32);

    const intake = pool.mesh(`intake:${side}`, microPodGeo, accentMat);
    intake.position.set(interceptor ? 38 : 29, side * (interceptor ? 9 : heavy ? 18 : 14), 11);
    intake.scale.setScalar((interceptor ? 0.9 : heavy ? 1.55 : 1.3) + pulse * 0.12);

    const nav = pool.mesh(`nav:${side}`, microPodGeo, side < 0 ? wingMat : accentMat);
    nav.position.set(interceptor ? -48 : -41, side * (interceptor ? 13 : heavy ? 22 : 18), 13);
    nav.scale.setScalar((interceptor ? 0.82 : heavy ? 1.22 : 1.05) + Math.sin(frame.t * 8 + side) * 0.08);
  }

  if (guardian) {
    const shield = pool.mesh('guardian-shield', enemyRingGeo, mats.laserGlow);
    shield.position.set(-8, 0, 15);
    shield.rotation.x = Math.PI / 2;
    shield.scale.set(1.34, 0.72, 1);
  }

  if (heavy) {
    for (const side of [-1, 1] as const) {
      const cannon = pool.mesh(`cannon:${side}`, detailStrutGeo, mats.shipGold);
      cannon.position.set(41, side * 15, 18);
      cannon.scale.set(1.04, 0.28, 0.28);
      const muzzle = pool.mesh(`heavy-muzzle:${side}`, microPodGeo, mats.shipWing);
      muzzle.position.set(63, side * 15, 18);
      muzzle.scale.setScalar(1.1 + heat * 0.28);
    }
  }

  const canopy = pool.mesh('canopy', shipCanopyGeo, mats.shipGlass);
  canopy.position.set(interceptor ? 26 : heavy ? 11 : 17, heavy ? -2 : -4, 18);
  canopy.scale.set(interceptor ? 1.5 : heavy ? 1.7 : 1.85, interceptor ? 0.58 : heavy ? 0.88 : 0.78, heavy ? 0.56 : 0.48);

  const engine = pool.mesh('engine', shipEngineGeo, mats.shipEngine);
  engine.position.set(interceptor ? -58 : heavy ? -50 : -47, 0, -5);
  engine.scale.set((interceptor ? 1.08 : heavy ? 1.12 : 0.9) + thrust * (interceptor ? 1.8 : 1.45) + turn * 0.42 + pulse * 0.18, (interceptor ? 0.82 : heavy ? 1.42 : 1.05) + thrust * 0.46 + turn * 0.16, heavy ? 1.2 : 1);

  const spine = pool.mesh('spine', detailStrutGeo, accentMat);
  spine.position.set(0, 0, 23);
  spine.scale.set(interceptor ? 1.58 : heavy ? 1.18 : 1.36, interceptor ? 0.32 : heavy ? 0.58 : 0.48, 0.48);

  addSpriteGlow(pool, 'engine-glow', secondaryGlow, (interceptor ? -88 : -76) - thrust * 22, 0, -2, 95 + thrust * (interceptor ? 150 : 120), (interceptor ? 32 : heavy ? 58 : 46) + thrust * 42);
  addSpriteGlow(pool, 'nose-glow', primaryGlow, interceptor ? 28 : 18, -3, 24, interceptor ? 54 : heavy ? 70 : 62, heavy ? 44 : 38);
  if (turn > 0.02) {
    addSpriteGlow(pool, 'turn-glow-a', primaryGlow, 28, 0, 6, 64 + turn * 56, 24 + turn * 28);
    addSpriteGlow(pool, 'turn-glow-b', secondaryGlow, -52, 0, -3, 74 + turn * 80, 28 + turn * 28);
  }
  if (heat > 0.05) addSpriteGlow(pool, 'heat-glow', secondaryGlow, 62, 0, 9, 30 + heat * 48, 18 + heat * 26);
  const exhaustStreak = clamp((frame.ship.speed - 430) / 680, 0, 1);
  if (exhaustStreak > 0.08) {
    const count = interceptor ? 4 : exhaustStreak > 0.68 ? 3 : 2;
    for (let i = 0; i < count; i += 1) {
      const trail = pool.mesh(`exhaust:${i}`, speedStreakGeo, i % 2 === 0 ? mats.streakAmber : mats.streakCyan);
      trail.position.set((interceptor ? -92 : -78) - i * 36 - exhaustStreak * 30, (i - (count - 1) / 2) * (interceptor ? 5 : heavy ? 11 : 8), -13 - i * 3);
      trail.scale.set((46 + i * (interceptor ? 24 : 18)) * exhaustStreak, 1.7 + exhaustStreak * 1.4 + i * 0.45, 1);
      trail.rotation.z = Math.sin(frame.t * 8 + i) * 0.035;
    }
  }
}

function addShipShieldMesh(rootGroup: THREE.Group, frame: MeshFrame, x: number, y: number, actorScale: number, hits: number): void {
  if (!shipShieldGroup) {
    shipShieldGroup = new THREE.Group();
    rootGroup.add(shipShieldGroup);
  }
  shipShieldGroup.visible = true;
  const pool = childPool(shipShieldGroup);
  pool.beginEntity();
  const pulse = 0.5 + Math.sin(frame.t * 7.2) * 0.5;
  const amber = hits >= 2;
  syncBasicVariant(shipShieldRingMat, amber ? mats.laserAmber : mats.laserGlow, amber ? 0.36 + pulse * 0.16 : 0.28 + pulse * 0.14);
  const ring = pool.mesh('ring', beaconRingGeo, shipShieldRingMat);
  ring.position.set(x, y, 94);
  ring.scale.setScalar((1.46 + hits * 0.14 + pulse * 0.05) * actorScale);

  syncSpriteVariant(shipShieldGlowMat, amber ? glowMats.amber : glowMats.cyan, 0.18 + pulse * 0.12);
  const glow = pool.sprite('glow', shipShieldGlowMat);
  glow.position.set(x, y, 82);
  const glowScale = (150 + hits * 26 + pulse * 18) * actorScale;
  glow.scale.set(glowScale, glowScale, 1);

  const nodeMat = amber ? mats.laserAmber : mats.laserGlow;
  const nodeRadius = (66 + hits * 5) * actorScale;
  for (let i = 0; i < hits; i += 1) {
    const angle = frame.t * 1.6 + i * (Math.PI * 2 / Math.max(1, hits));
    const node = pool.mesh(`node:${i}`, shotHeadGeo, nodeMat);
    node.position.set(x + Math.cos(angle) * nodeRadius, y + Math.sin(angle) * nodeRadius, 100);
    node.scale.setScalar((4.4 + pulse * 1.2) * actorScale);
  }
}

function addCitizen(rootGroup: THREE.Group, frame: MeshFrame, citizen: MeshCitizen): void {
  addCitizenHabitat(rootGroup, frame, citizen);
  const group = getEntityGroup(citizenGroups, citizen.id, rootGroup);
  const extraGroup = getEntityGroup(citizenExtraGroups, citizen.id, rootGroup);
  if (citizen.status === 'lost' || citizen.status === 'saved') {
    group.visible = false;
    extraGroup.visible = false;
    return;
  }
  const x = sx(citizen.x, frame);
  if (x < -90 || x > frame.viewW + 90) {
    group.visible = false;
    extraGroup.visible = false;
    return;
  }
  const waiting = citizen.status === 'waiting';
  const carried = citizen.status === 'carried';
  const falling = citizen.status === 'falling';
  const locking = waiting && citizen.capture > 0.03;
  const targeted = citizen.targeted || locking;
  const dangerous = carried || falling;
  const alert = dangerous || targeted;
  const screenY = waiting ? citizen.y - 28 : citizen.y;
  const y = sy(screenY, frame);
  const groundY = sy(terrainY(citizen.x) - 3, frame);

  const mat = citizen.relation === 'high-wot'
    ? mats.highWot
    : citizen.relation === 'mutual'
      ? mats.mutual
      : mats.follow;
  const avatarMat = citizen.avatarUrl ? getAvatarMaterial(citizen.avatarUrl) : null;
  const pool = childPool(group);
  pool.beginEntity();
  const extraPool = childPool(extraGroup);
  extraPool.beginEntity();
  group.position.set(x, y, 66);
  group.rotation.y = frame.t * (1.55 + citizen.id * 0.015) + citizen.id;
  group.rotation.x = Math.sin(frame.t * 1.8 + citizen.id) * 0.16;
  group.scale.setScalar((dangerous ? 1.08 : targeted ? 0.96 + citizen.capture * 0.11 : 0.9) * frame.tuning.contactScale);

  if (waiting) {
    const alertMat = locking ? (citizen.capture > 0.72 ? mats.captureHot : mats.captureBeam) : mats.beaconRing;
    const base = extraPool.mesh('base', contactBaseGeo, targeted ? alertMat : citizen.relation === 'high-wot' ? mats.beaconRing : mats.signalRing);
    base.position.set(x, groundY + 4, 42);
    base.rotation.x = Math.PI / 2;
    base.scale.set(1.2 + citizen.threat * 0.05, 0.62 + citizen.threat * 0.025, 1);

    const tetherH = Math.max(10, y - groundY - 4);
    const tether = extraPool.mesh('tether', contactTetherGeo, targeted ? alertMat : citizen.relation === 'high-wot' ? mats.beaconRing : mats.signalRing);
    tether.position.set(x, groundY + tetherH / 2 + 2, 41);
    tether.scale.set(targeted ? 1.35 : 1, tetherH, targeted ? 1.35 : 1);
  }

  const sphere = pool.mesh('sphere', citizenGeo, avatarMat ?? mat);
  const breathe = 1 + Math.sin(frame.t * 4.2 + citizen.id) * 0.08;
  sphere.scale.setScalar(dangerous ? 1.12 : breathe);
  sphere.castShadow = true;

  const alertRing = dangerous ? mats.dangerRing : locking ? (citizen.capture > 0.72 ? mats.captureHot : mats.captureBeam) : targeted ? mats.beaconRing : mats.signalRing;
  const equator = pool.mesh('equator', citizenRingGeo, alertRing);
  equator.rotation.y = frame.t * 1.0 + citizen.id;
  equator.scale.setScalar(falling ? 1.14 + Math.sin(frame.t * 7) * 0.12 : locking ? 1.04 + citizen.capture * 0.22 : targeted ? 1.0 : 0.92);

  const orbit = pool.mesh('orbit', contactHaloGeo, alert ? alertRing : mat);
  orbit.rotation.x = Math.PI / 2 + Math.sin(frame.t * 1.2 + citizen.id) * 0.18;
  orbit.rotation.y = -frame.t * 1.35 + citizen.id * 0.37;
  orbit.scale.setScalar(dangerous ? 1.18 : locking ? 1.12 + citizen.capture * 0.26 : targeted ? 1.04 : 0.96);

  const sparkMat = citizen.relation === 'high-wot' ? mats.shipGold : citizen.relation === 'mutual' ? mats.shipWing : mats.ship;
  for (let i = 0; i < 3; i += 1) {
    const a = frame.t * (1.8 + i * 0.24) + citizen.id + i * Math.PI * 2 / 3;
    const pod = pool.mesh(`spark:${i}`, microPodGeo, sparkMat);
    pod.position.set(Math.cos(a) * 29, Math.sin(a * 0.7) * 6, Math.sin(a) * 15);
    pod.scale.setScalar(1 + Math.sin(frame.t * 4 + i + citizen.id) * 0.14);
  }

  const ring = pool.mesh('ring', citizenRingGeo, alertRing);
  ring.rotation.y = frame.t * 0.9 + citizen.id;
  ring.rotation.x = Math.PI * 0.18;
  ring.scale.setScalar(falling ? 1.18 + Math.sin(frame.t * 7) * 0.12 : locking ? 1.08 + citizen.capture * 0.24 : targeted ? 0.98 : 0.9);
  if (targeted && waiting) {
    const lockRing = pool.mesh('lock-ring', beaconRingGeo, locking ? (citizen.capture > 0.72 ? mats.captureHot : mats.captureBeam) : mats.beaconRing);
    lockRing.rotation.x = Math.PI / 2 + Math.sin(frame.t * 3.2 + citizen.id) * 0.05;
    lockRing.rotation.y = frame.t * 0.7 + citizen.id;
    lockRing.scale.setScalar(0.5 + citizen.threat * 0.08 + citizen.capture * 0.28);
  }
  const glowMat = dangerous || locking
    ? (citizen.capture > 0.72 || carried ? glowMats.rose : glowMats.amber)
    : citizen.relation === 'high-wot' ? glowMats.amber : citizen.relation === 'mutual' ? glowMats.cyan : glowMats.white;
  const glow = extraPool.sprite('glow', glowMat);
  glow.position.set(x, y, 50);
  const glowScale = carried ? 70 : locking ? 58 + citizen.capture * 44 : targeted ? 60 : 52 + Math.sin(frame.t * 4 + citizen.id) * 4;
  glow.scale.set(glowScale, glowScale, 1);
}

function addCitizenHabitat(rootGroup: THREE.Group, frame: MeshFrame, citizen: MeshCitizen): void {
  const group = getEntityGroup(habitatGroups, citizen.id, rootGroup);
  const extraGroup = getEntityGroup(habitatExtraGroups, citizen.id, rootGroup);
  const x = sx(citizen.homeX, frame);
  if (x < -110 || x > frame.viewW + 110) {
    group.visible = false;
    extraGroup.visible = false;
    return;
  }
  const pool = childPool(group);
  pool.beginEntity();
  const extraPool = childPool(extraGroup);
  extraPool.beginEntity();
  const ground = sy(terrainY(citizen.homeX) - 2, frame);
  const dangerous = citizen.status === 'carried' || citizen.status === 'falling' || citizen.status === 'lost';
  const targeted = citizen.targeted || citizen.capture > 0.03;
  const saved = citizen.status === 'saved';
  const high = citizen.relation === 'high-wot';
  const hotMat = citizen.status === 'lost'
    ? mats.spoof
    : citizen.status === 'carried'
      ? mats.dangerRing
      : targeted
        ? (citizen.capture > 0.72 ? mats.captureHot : mats.captureBeam)
        : high
          ? mats.beaconRing
          : mats.signalRing;
  const shellMat = dangerous ? mats.habitatDark : mats.tower;
  const glowMat = dangerous || targeted
    ? (citizen.status === 'lost' ? glowMats.rose : citizen.capture > 0.72 || citizen.status === 'carried' ? glowMats.rose : glowMats.amber)
    : high ? glowMats.amber : glowMats.cyan;
  const pulse = 0.5 + Math.sin(frame.t * (targeted ? 9 : 3.2) + citizen.id) * 0.5;

  group.position.set(x, ground, 38);
  group.scale.setScalar(high ? 1.08 : 0.94);

  const pad = pool.mesh('pad', habitatPadGeo, shellMat);
  pad.position.set(0, 2, -4);
  pad.scale.set(1.0 + (targeted ? citizen.capture * 0.14 : 0), 0.46, 0.34);

  const vault = pool.mesh('vault', habitatVaultGeo, dangerous ? mats.habitatDark : mats.habitatGlass);
  vault.position.set(0, -22, 12);
  vault.scale.set(1.12, 0.84, 0.78);

  const ring = pool.mesh('ring', beaconRingGeo, hotMat);
  ring.position.set(0, -18, 18);
  ring.rotation.x = Math.PI / 2;
  ring.rotation.z = frame.t * (targeted ? 1.1 : 0.42) + citizen.id;
  ring.scale.setScalar(0.52 + (targeted ? 0.1 + citizen.capture * 0.22 : 0));

  for (const side of [-1, 1] as const) {
    const pylon = pool.mesh(`pylon:${side}`, habitatPylonGeo, high ? mats.shipGold : mats.tower);
    pylon.position.set(side * 31, -14, 5);
    pylon.rotation.z = side * 0.16;
    pylon.scale.setScalar(saved ? 0.72 : 1);
    const node = pool.mesh(`node:${side}`, microPodGeo, hotMat);
    node.position.set(side * 31, -33, 14);
    node.scale.setScalar(1.2 + pulse * 0.2);
  }

  if (targeted || dangerous) {
    const alert = pool.mesh('alert', beaconRingGeo, hotMat);
    alert.position.set(0, -20, 22);
    alert.rotation.x = Math.PI / 2 + Math.sin(frame.t * 2 + citizen.id) * 0.05;
    alert.scale.setScalar(0.74 + pulse * 0.08 + citizen.capture * 0.22);
  }

  const glow = extraPool.sprite('glow', glowMat);
  glow.position.set(x, ground - 24, 40);
  glow.scale.set(74 + pulse * 16 + (targeted ? citizen.capture * 70 : 0), 38 + pulse * 8, 1);
}

function getAvatarMaterial(url: string): THREE.MeshStandardMaterial | null {
  const candidates = profilePictureCandidates(url);
  if (candidates.length === 0) return null;
  const cacheKey = candidates.join('|');
  const existing = avatarCache.get(cacheKey);
  if (existing) return existing.failed ? null : existing.material;

  const entry: AvatarEntry = { loading: true, failed: false, material: null, candidates, index: 0 };
  avatarCache.set(cacheKey, entry);
  loadAvatarCandidate(entry);
  return null;
}

// Avatars arrive at whatever size the profile hosts them (often 1–2K square);
// uploading those and generating full mipmap chains mid-wave stalls the frame.
// The citizen sphere is ~30px on screen, so a small square is plenty.
const AVATAR_TEXTURE_SIZE = 256;

function loadAvatarCandidate(entry: AvatarEntry): void {
  const url = entry.candidates[entry.index];
  if (!url) {
    entry.loading = false;
    entry.failed = true;
    return;
  }
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    let texture: THREE.CanvasTexture;
    try {
      texture = new THREE.CanvasTexture(downscaleAvatarImage(image));
    } catch {
      advanceAvatarCandidate(entry);
      return;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    entry.material = makeAvatarMaterial(texture);
    entry.loading = false;
  };
  image.onerror = () => { advanceAvatarCandidate(entry); };
  image.src = url;
}

function advanceAvatarCandidate(entry: AvatarEntry): void {
  entry.index += 1;
  if (entry.index < entry.candidates.length) {
    loadAvatarCandidate(entry);
    return;
  }
  entry.loading = false;
  entry.failed = true;
}

function downscaleAvatarImage(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_TEXTURE_SIZE;
  canvas.height = AVATAR_TEXTURE_SIZE;
  // Squashing non-square images to a square matches the previous mapping —
  // the sphere UVs already stretched the full texture across the surface.
  canvas.getContext('2d')?.drawImage(image, 0, 0, AVATAR_TEXTURE_SIZE, AVATAR_TEXTURE_SIZE);
  return canvas;
}

function makeAvatarMaterial(texture: THREE.Texture): THREE.MeshStandardMaterial {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(1, 1);
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: texture,
    emissive: 0x102b28,
    emissiveMap: texture,
    emissiveIntensity: 0.22,
    metalness: 0.16,
    roughness: 0.34,
  });
}

function enemyVisualScale(type: EnemyType): number {
  if (type === 'carrier') return 0.98;
  if (type === 'jammer') return 1.02;
  if (type === 'hunter') return 1.08;
  if (type === 'spoof') return 1;
  if (type === 'spammer') return 1.04;
  if (type === 'sybil') return 1;
  if (type === 'troll') return 1.3;
  return 1.03;
}

function enemyFacing(enemy: MeshEnemy, frame: MeshFrame): -1 | 1 {
  if (enemy.face) return enemy.face;
  if (enemy.vx > 24) return 1;
  if (enemy.vx < -24) return -1;
  return wrapDelta(frame.ship.x, enemy.x, frame.worldW) >= 0 ? 1 : -1;
}

function enemyBodyGeometry(type: EnemyType): THREE.BufferGeometry {
  if (type === 'hunter') return hunterBladeGeo;
  if (type === 'jammer') return jammerCoreGeo;
  if (type === 'carrier') return carrierGeo;
  if (type === 'spoof') return spoofHullGeo;
  if (type === 'spammer') return spammerHullGeo;
  if (type === 'sybil') return sybilCoreGeo;
  return abductorHullGeo;
}

function enemyEdgeGeometry(type: EnemyType): THREE.EdgesGeometry {
  if (type === 'carrier') return carrierEdges;
  if (type === 'hunter') return hunterEdges;
  if (type === 'jammer') return jammerEdges;
  if (type === 'spoof') return spoofHullEdges;
  if (type === 'spammer') return spammerHullEdges;
  if (type === 'sybil') return sybilCoreEdges;
  return abductorHullEdges;
}

// The donkey/bankster troll's 3D model used to be a boxes-and-dodecahedron
// approximation of drawTroll's much richer vector art (ears, top hat,
// monocle, cigar, gold tooth grin) - it read as a plain lumpy blob next to
// the real thing. Baking the *exact* vector art once as a billboard (the
// same fix already applied to pickup icons and enemy shot bolts this
// session) is pixel-faithful from every angle instead of a hand-tuned
// primitive guess. drawTroll draws with normal (non-screen-blend)
// compositing onto a transparent canvas, so - unlike the shield/net icons -
// no alpha-recovery trick is needed; it's the same bake used for every
// other enemy's cached 2D sprite (see enemySprite() in sprite-art.ts).
const TROLL_SPRITE_W = 158;
const TROLL_SPRITE_H = 104;
function bakeTrollSpriteMaterial(): THREE.SpriteMaterial {
  const supersample = 2;
  const canvas = document.createElement('canvas');
  canvas.width = TROLL_SPRITE_W * supersample;
  canvas.height = TROLL_SPRITE_H * supersample;
  const g = canvas.getContext('2d');
  if (!g) return new THREE.SpriteMaterial();
  g.setTransform(supersample, 0, 0, supersample, canvas.width / 2, canvas.height / 2);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  drawTroll(g);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
}
const trollBodyMat = bakeTrollSpriteMaterial();
// Additive rainbow flash overlay for the "about to pop" telegraph (see
// trollPopFlash equivalent gating in addEnemy below). Shared across all
// simultaneous trolls - a rare, purely cosmetic case where two near-death
// trolls exist at once would show the same flash phase rather than
// independent ones.
const trollPopFlashMat = new THREE.SpriteMaterial({ map: makeGlowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });

function addEnemy(rootGroup: THREE.Group, frame: MeshFrame, enemy: MeshEnemy): void {
  const group = getEntityGroup(enemyGroups, enemy.id, rootGroup);
  const x = sx(enemy.x, frame);
  if (x < -130 || x > frame.viewW + 130) {
    group.visible = false;
    return;
  }
  const pool = childPool(group);
  pool.beginEntity();
  group.position.set(x, sy(enemy.y, frame), enemy.type === 'carrier' ? 72 : 66);
  const baseScale = enemyVisualScale(enemy.type) * frame.tuning.actorScale * (enemy.sizeScale ?? 1);
  const turn = clamp(enemy.turnCue, 0, 1);
  const intentSwell = enemy.type === 'carrier' ? 0 : clamp(enemy.intent, 0, 1) * (enemy.type === 'hunter' ? 0.07 : 0.055);
  group.scale.set(
    baseScale * (1 + intentSwell) * (1 - turn * (enemy.type === 'carrier' ? 0.06 : 0.1)),
    baseScale * (1 + intentSwell) * (1 + turn * 0.04),
    baseScale * (1 + intentSwell) * (1 + turn * 0.03),
  );
  const threatPulse = 0.5 + Math.sin(frame.t * 9 + enemy.phase) * 0.5;
  const motionBank = clamp(enemy.vy / 520, -0.2, 0.2);
  const motionYaw = clamp(enemy.vx / 700, -0.18, 0.18) + enemy.face * Math.sin(turn * Math.PI) * (enemy.type === 'carrier' ? 0.18 : 0.36);
  const faceYaw = enemyFacing(enemy, frame) < 0 ? Math.PI : 0;
  group.rotation.x = motionBank + Math.sin(frame.t * 3 + enemy.phase) * (enemy.type === 'jammer' ? 0.16 : 0.12) + Math.sin(turn * Math.PI) * (enemy.type === 'carrier' ? 0.06 : 0.14);
  group.rotation.y = faceYaw + Math.sin(frame.t * (enemy.type === 'carrier' ? 0.52 : enemy.type === 'hunter' ? 2.2 : 1.65) + enemy.phase) * (enemy.type === 'carrier' ? 0.16 : enemy.type === 'hunter' ? 0.42 : 0.34) + Math.sin(turn * Math.PI) * enemy.face * 0.28;
  group.rotation.z = motionYaw + Math.sin(frame.t * (enemy.type === 'hunter' ? 3.4 : 2.7) + enemy.phase) * (enemy.type === 'carrier' ? 0.08 : 0.14) + clamp(enemy.intent, 0, 1) * enemy.face * (enemy.type === 'hunter' ? 0.08 : 0.05);

  // material/shadowMaterial are unused for troll (billboard sprite instead
  // of a body mesh, see below) - the ternary just falls through to the
  // abductor default in that case.
  const material = enemy.type === 'spoof'
    ? mats.spoof
    : enemy.type === 'jammer'
      ? mats.jammer
      : enemy.type === 'hunter'
        ? mats.hunter
        : enemy.type === 'carrier'
          ? mats.carrier
          : enemy.type === 'spammer'
            ? mats.spammer
            : enemy.type === 'sybil'
              ? mats.sybil
              : mats.abductor;
  const shadowMaterial = enemy.type === 'spoof'
    ? mats.spoofDark
    : enemy.type === 'jammer'
      ? mats.jammerDark
      : enemy.type === 'hunter'
        ? mats.hunterDark
        : enemy.type === 'carrier'
          ? mats.carrierDark
          : enemy.type === 'spammer'
            ? mats.spammerDark
            : enemy.type === 'sybil'
              ? mats.sybilDark
              : mats.abductorDark;
  if (enemy.type === 'troll') {
    // Sprites always billboard to face the camera, ignoring the group's own
    // rotation - so group.rotation.y (which flips a real 3D body mesh to
    // face the other way) does nothing here. Mirror via negative x-scale
    // instead, same trick as vector's ctx.scale(dir, 1).
    const donkey = pool.sprite('donkey-sprite', trollBodyMat);
    donkey.position.z = 18;
    donkey.scale.set(TROLL_SPRITE_W * 0.46 * enemyFacing(enemy, frame), TROLL_SPRITE_H * 0.46, 1);
  } else {
    const bodyGeo = enemyBodyGeometry(enemy.type);
    const shadowBody = pool.mesh('shadow-body', bodyGeo, shadowMaterial);
    shadowBody.position.z = -3;
    shadowBody.scale.set(1.12, 1.08, 1.15);
    shadowBody.castShadow = true;

    const body = pool.mesh('body', bodyGeo, material);
    body.scale.set(
      enemy.type === 'carrier' ? 1.05 : enemy.type === 'hunter' ? 1.18 : enemy.type === 'jammer' ? 1.08 : enemy.type === 'spoof' ? 1.09 : 1.14,
      enemy.type === 'carrier' ? 1.0 : enemy.type === 'jammer' ? 0.98 : enemy.type === 'hunter' ? 0.9 : 0.98,
      enemy.type === 'carrier' ? 1.02 : enemy.type === 'jammer' ? 0.94 : 0.9,
    );
    body.castShadow = true;
    const edgeGeo = enemyEdgeGeometry(enemy.type);
    addLine(pool, 'body-edges', edgeGeo, lineMats.enemy, 1);
  }

  if (enemy.type === 'carrier') {
    addCarrierDetail(group, frame, enemy);
  } else if (enemy.type === 'jammer') {
    addJammerDetail(group, frame, threatPulse);
  } else if (enemy.type === 'hunter') {
    addHunterDetail(group, frame, threatPulse);
  } else if (enemy.type === 'spoof') {
    addSpoofDetail(group, frame, enemy, threatPulse);
  } else if (enemy.type === 'spammer') {
    addSpammerDetail(group, frame, enemy, threatPulse);
  } else if (enemy.type === 'sybil') {
    addSybilDetail(group, frame, enemy, threatPulse);
  } else if (enemy.type === 'troll') {
    addTrollDetail(group, frame, enemy);
  } else {
    addAbductorDetail(group, frame, enemy, threatPulse);
  }
  addEnemyIdentityMarks(group, frame, enemy, threatPulse);
  addEnemyRunningLights(group, frame, enemy, threatPulse);
  addEnemyMuzzleBloom(group, frame, enemy);

  if (enemy.type !== 'carrier' && enemy.type !== 'jammer') {
    const trailMat = enemy.type === 'hunter' ? enemyTrailMats.hunter : enemy.type === 'spoof' ? enemyTrailMats.spoof : enemyTrailMats.other;
    const trail = pool.sprite('trail', trailMat);
    const trailDir = -1;
    trail.position.set(trailDir * 42, 0, -8);
    trail.scale.set(enemy.type === 'hunter' ? 104 : enemy.type === 'spoof' ? 78 : 72, enemy.type === 'hunter' ? 18 : enemy.type === 'spoof' ? 19 : 26, 1);
  }

  const worldGlow = pool.sprite('world-glow', enemy.type === 'jammer' || enemy.type === 'spammer' ? glowMats.blue : enemy.type === 'hunter' ? glowMats.amber : enemy.type === 'troll' ? glowMats.green : glowMats.rose);
  worldGlow.position.set(0, 0, -12);
  const intentGlow = clamp(enemy.intent, 0, 1);
  const glowW = enemy.type === 'carrier' ? 150 : enemy.type === 'hunter' ? 112 + threatPulse * 28 + intentGlow * 22 : enemy.type === 'jammer' ? 100 + threatPulse * 20 + intentGlow * 18 : 92 + threatPulse * 22 + intentGlow * 14;
  const glowH = enemy.type === 'carrier' ? 82 : enemy.type === 'hunter' ? 29 + threatPulse * 9 + intentGlow * 6 : enemy.type === 'jammer' ? 48 + threatPulse * 10 + intentGlow * 8 : 38 + threatPulse * 9 + intentGlow * 6;
  worldGlow.scale.set(glowW, glowH, 1);
}

function addEnemyMuzzleBloom(group: THREE.Group, frame: MeshFrame, enemy: MeshEnemy): void {
  const pool = childPool(group);
  const muzzle = clamp(enemy.muzzle, 0, 1);
  if (muzzle <= 0.01) return;
  const pulse = muzzle * (0.72 + Math.sin(frame.t * 44 + enemy.phase) * 0.16);
  if (enemy.type === 'carrier') {
    for (const side of [-1, 0, 1] as const) {
      addSpriteGlow(pool, `muzzle-vent-glow:${side}`, glowMats.rose, 74, side * 24, 24, 82 * pulse, 58 * pulse);
      const vent = pool.mesh(`muzzle-vent:${side}`, shotHeadGeo, mats.shotBarrage);
      vent.position.set(68, side * 24, 28);
      vent.scale.setScalar(8 * pulse);
    }
    addSpriteGlow(pool, 'muzzle-amber', glowMats.amber, 44, 0, 30, 74 * pulse, 44 * pulse);
    return;
  }

  const glow = enemy.type === 'jammer' ? glowMats.blue : enemy.type === 'hunter' ? glowMats.amber : glowMats.rose;
  const mat = enemy.type === 'jammer' ? mats.shotJam : enemy.type === 'hunter' ? mats.shotDart : mats.shotBarrage;
  const x = enemy.type === 'hunter' ? 42 : enemy.type === 'jammer' ? 34 : 32;
  addSpriteGlow(pool, 'muzzle-glow', glow, x, 0, 22, 54 * pulse, 38 * pulse);
  const core = pool.mesh('muzzle-core', shotHeadGeo, mat);
  core.position.set(x + 6, 0, 25);
  core.scale.setScalar(5.6 * pulse);
}

function addEnemyRunningLights(group: THREE.Group, frame: MeshFrame, enemy: MeshEnemy, pulse: number): void {
  const pool = childPool(group);
  if (enemy.type === 'carrier') {
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < 4; i += 1) {
        const cannon = pool.mesh(`lights-cannon:${side}:${i}`, detailStrutGeo, i % 2 === 0 ? mats.shipGold : mats.carrier);
        cannon.position.set(-48 + i * 31, side * 47, 28);
        cannon.rotation.z = side * (Math.PI / 2 + 0.08);
        cannon.rotation.x = side * 0.08;
        cannon.scale.set(0.44, 0.44, 0.5);

        const lamp = pool.mesh(`lights-lamp:${side}:${i}`, microPodGeo, i % 2 === 0 ? mats.shipWing : mats.shipGold);
        lamp.position.set(-38 + i * 31, side * 34, 35);
        lamp.scale.setScalar(1.1 + pulse * 0.16);
      }
    }
    addSpriteGlow(pool, 'lights-glow', glowMats.rose, 42, 0, 34, 80 + pulse * 32, 26 + pulse * 10);
    return;
  }

  if (enemy.type === 'jammer') {
    for (const side of [-1, 1] as const) {
      const mast = pool.mesh(`lights-mast:${side}`, detailStrutGeo, side < 0 ? mats.shipWing : mats.jammer);
      mast.position.set(-34, side * (34 + pulse * 3), 25);
      mast.rotation.z = side * (0.84 + Math.sin(frame.t * 3 + enemy.phase) * 0.04);
      mast.scale.set(0.72, 0.72, 0.72);

      const diode = pool.mesh(`lights-diode:${side}`, enemyLightGeo, side < 0 ? mats.shipGold : mats.shipWing);
      diode.position.set(-51, side * (44 + pulse * 4), 31);
      diode.scale.setScalar(1.08 + pulse * 0.18);
    }
    addSpriteGlow(pool, 'lights-glow', glowMats.blue, -8, 0, 31, 52 + pulse * 22, 20 + pulse * 8);
    return;
  }

  if (enemy.type === 'hunter') {
    for (const side of [-1, 1] as const) {
      const edge = pool.mesh(`lights-edge:${side}`, speedStreakGeo, side < 0 ? mats.streakAmber : mats.streakRose);
      edge.position.set(-22, side * (23 + pulse * 2), 20);
      edge.rotation.z = side * 0.28;
      edge.scale.set(54 + pulse * 12, 2.8, 1);
    }
    addSpriteGlow(pool, 'lights-glow', glowMats.amber, 28, 0, 22, 36 + pulse * 18, 18 + pulse * 6);
    return;
  }

  const hot = enemy.type === 'spoof' ? mats.spoof : mats.shipGold;
  for (const side of [-1, 1] as const) {
    const eye = pool.mesh(`lights-eye:${side}`, microPodGeo, hot);
    eye.position.set(24, side * 11, 20);
    eye.scale.setScalar(1.15 + pulse * 0.14);

    const captureRail = pool.mesh(`lights-rail:${side}`, detailStrutGeo, enemy.type === 'spoof' ? mats.shipWing : mats.captureBeam);
    captureRail.position.set(-4, side * 20, -18);
    captureRail.rotation.z = side * (0.62 + pulse * 0.04);
    captureRail.scale.set(0.5, 0.5, 0.5);
  }
}

function addEnemyIdentityMarks(group: THREE.Group, frame: MeshFrame, enemy: MeshEnemy, pulse: number): void {
  if (enemy.type === 'carrier') return;
  const pool = childPool(group);
  const hot = enemy.type === 'jammer'
    ? mats.shipWing
    : enemy.type === 'hunter'
      ? mats.shipGold
      : enemy.type === 'spoof'
        ? mats.spoof
        : mats.abductor;
  const glow = enemy.type === 'jammer'
    ? glowMats.blue
    : enemy.type === 'hunter'
      ? glowMats.amber
      : enemy.type === 'spoof'
        ? glowMats.rose
        : glowMats.rose;

  if (enemy.type === 'jammer') {
    for (let i = 0; i < 3; i += 1) {
      const blade = pool.mesh(`identity-blade:${i}`, enemyPlateGeo, i === 1 ? mats.shipGold : mats.shipWing);
      blade.position.set(-20 + i * 20, 0, 30 + i * 2);
      blade.rotation.z = Math.PI / 2 + Math.sin(frame.t * 4.2 + enemy.phase + i) * 0.08;
      blade.scale.set(0.32 + pulse * 0.04, 1.48 - i * 0.18, 0.5);
    }
    addSpriteGlow(pool, 'identity-glow', glow, 0, 0, 34, 66 + pulse * 20, 24 + pulse * 8);
    return;
  }

  if (enemy.type === 'hunter') {
    for (const side of [-1, 1] as const) {
      const fin = pool.mesh(`identity-fin:${side}`, shipFinGeo, hot);
      fin.position.set(-30, side * 25, 5);
      fin.rotation.z = side * (0.38 + pulse * 0.04);
      fin.scale.set(0.72, 0.66, 0.58);
    }
    addSpriteGlow(pool, 'identity-glow', glow, -48, 0, -6, 72 + pulse * 18, 22 + pulse * 7);
    return;
  }

  for (const side of [-1, 1] as const) {
    const mandible = pool.mesh(`identity-mandible:${side}`, enemySpikeGeo, hot);
    mandible.position.set(18, side * (23 + pulse * 2), -8);
    mandible.rotation.z = side * 0.68;
    mandible.scale.set(0.78, 0.78, 0.78);
  }

  if (enemy.type === 'spoof') {
    for (let i = 0; i < 4; i += 1) {
      const shard = pool.mesh(`identity-shard:${i}`, enemyPlateGeo, i % 2 === 0 ? mats.spoof : mats.shipWing);
      shard.position.set(-30 + i * 18, Math.sin(frame.t * 4 + enemy.phase + i) * 24, 23 + i);
      shard.rotation.z = frame.t * (0.6 + i * 0.18) + i;
      shard.scale.set(0.28, 0.48, 0.42);
    }
  } else {
    addSpriteGlow(pool, 'identity-glow', glow, 16, 0, -18, 48 + pulse * 18, 34 + pulse * 9);
  }
}

function addSpoofDetail(group: THREE.Group, frame: MeshFrame, enemy: MeshEnemy, pulse: number): void {
  const pool = childPool(group);
  const jitter = Math.sin(frame.t * 17 + enemy.phase) * 2.4;
  const stolenMat = enemy.stolenAvatarUrl ? getAvatarMaterial(enemy.stolenAvatarUrl) : null;
  if (stolenMat) {
    // The stolen identity rides at the hull core: the victim's avatar on a
    // glitch-jittering orb, caged by a spoof-coloured ring.
    const face = pool.mesh('spoof-face', citizenGeo, stolenMat);
    face.position.set(6 + jitter * 0.8, 0, 22);
    face.rotation.y = frame.t * 1.4 + Math.sin(frame.t * 9 + enemy.phase) * 0.22;
    face.rotation.z = Math.sin(frame.t * 13 + enemy.phase) * 0.12;
    face.scale.setScalar(0.62 + pulse * 0.04);

    const cage = pool.mesh('spoof-face-cage', citizenRingGeo, mats.spoof);
    cage.position.set(6 + jitter * 0.8, 0, 22);
    cage.rotation.x = Math.PI / 2 + Math.sin(frame.t * 3.1) * 0.4;
    cage.rotation.y = frame.t * 2.2;
    cage.scale.setScalar(0.74 + pulse * 0.08);
  } else {
    const core = pool.mesh('spoof-core', enemyLightGeo, mats.shipGold);
    core.position.set(10 + jitter, 0, 18);
    core.scale.set(1.8 + pulse * 0.3, 1.0, 0.9);
  }

  for (const side of [-1, 1] as const) {
    const falseWing = pool.mesh(`spoof-wing:${side}`, jammerWingGeo, side < 0 ? mats.spoof : mats.shipWing);
    falseWing.position.set(-7 + jitter * 0.5, side * (20 + pulse * 3), -3);
    falseWing.rotation.z = side * (0.32 + Math.sin(frame.t * 6 + enemy.phase) * 0.08);
    falseWing.scale.set(0.62, 0.54, 0.54);

    const antenna = pool.mesh(`spoof-antenna:${side}`, detailStrutGeo, side < 0 ? mats.shipWing : mats.spoof);
    antenna.position.set(-24 + jitter, side * 24, 10);
    antenna.rotation.z = side * (0.78 + pulse * 0.08);
    antenna.scale.set(0.58, 0.58, 0.58);

    const node = pool.mesh(`spoof-node:${side}`, enemyLightGeo, side < 0 ? mats.shipGold : mats.shipWing);
    node.position.set(-37 + jitter, side * 31, 14);
    node.scale.setScalar(1.08 + pulse * 0.16);
  }

  for (let i = 0; i < 6; i += 1) {
    const shard = pool.mesh(`spoof-shard:${i}`, enemyPlateGeo, i % 3 === 0 ? mats.shipGold : i % 2 === 0 ? mats.shipWing : mats.spoof);
    shard.position.set(-32 + i * 13 + Math.sin(frame.t * 8 + enemy.phase + i) * 2.8, -18 + (i % 3) * 18, 21 + i * 1.5);
    shard.rotation.z = frame.t * (0.7 + i * 0.12) + enemy.phase + i;
    shard.rotation.x = Math.sin(frame.t * 5 + i) * 0.25;
    shard.scale.set(0.22 + (i % 2) * 0.08, 0.46, 0.42);
  }

  addSpriteGlow(pool, 'spoof-glow-a', glowMats.rose, -10 + jitter, 0, -8, 72 + pulse * 20, 26 + pulse * 8);
  addSpriteGlow(pool, 'spoof-glow-b', glowMats.blue, 20, 0, 16, 36 + pulse * 14, 18 + pulse * 5);
}

function addSpammerDetail(group: THREE.Group, frame: MeshFrame, enemy: MeshEnemy, pulse: number): void {
  const pool = childPool(group);
  // Antenna array along the spine — the spam broadcaster silhouette.
  for (let i = 0; i < 3; i += 1) {
    const mast = pool.mesh(`spammer-mast:${i}`, detailStrutGeo, i === 1 ? mats.shipWing : mats.spammer);
    mast.position.set(-22 + i * 18, 0, 20 + (i === 1 ? 6 : 0));
    mast.rotation.z = Math.PI / 2;
    mast.rotation.x = Math.sin(frame.t * 3.4 + enemy.phase + i) * 0.08;
    mast.scale.set(0.4, 0.52 + (i === 1 ? 0.18 : 0), 0.4);

    const tip = pool.mesh(`spammer-tip:${i}`, enemyLightGeo, mats.shipGold);
    tip.position.set(-22 + i * 18, 0, 34 + (i === 1 ? 8 : 0));
    tip.scale.setScalar(0.82 + pulse * 0.22);
  }

  // Belly mine port with a slow-spinning dispenser ring.
  const port = pool.mesh('spammer-port', enemyRingGeo, mats.spammer);
  port.position.set(-2, 0, -16);
  port.rotation.x = Math.PI / 2;
  port.rotation.z = frame.t * 1.4 + enemy.phase;
  port.scale.setScalar(0.5 + pulse * 0.05);

  const hopper = pool.mesh('spammer-hopper', enemyPodGeo, mats.spammerDark);
  hopper.position.set(-2, 0, -13);
  hopper.scale.set(1.4, 1.4, 1.1);

  for (const side of [-1, 1] as const) {
    const plate = pool.mesh(`spammer-plate:${side}`, enemyPlateGeo, mats.spammerDark);
    plate.position.set(-8, side * 18, 8);
    plate.rotation.z = side * 0.2;
    plate.scale.set(0.72, 0.8, 0.6);

    const rail = pool.mesh(`spammer-rail:${side}`, detailStrutGeo, mats.shipWing);
    rail.position.set(4, side * 13, 14);
    rail.rotation.z = side * 0.32;
    rail.scale.set(0.66, 0.66, 0.66);
  }

  const cockpit = pool.mesh('spammer-cockpit', enemyLightGeo, mats.shipGold);
  cockpit.position.set(20, 0, 14);
  cockpit.scale.set(1.7 + pulse * 0.14, 1.1, 1);

  addSpriteGlow(pool, 'spammer-glow-a', glowMats.blue, -4, 0, -12, 62 + pulse * 16, 24 + pulse * 7);
  addSpriteGlow(pool, 'spammer-glow-b', glowMats.white, -2, 0, -20, 26 + pulse * 12, 12 + pulse * 5);
}

function addTrollDetail(group: THREE.Group, frame: MeshFrame, enemy: MeshEnemy): void {
  const pool = childPool(group);
  // The donkey/bankster's body is now the baked vector billboard (see
  // addEnemy above) - this only adds effects layered *over* that static
  // art: the feeding tell (green gulp glow) and the last-quarter-health
  // "about to pop" rainbow flash.
  const feeding = clamp(enemy.intent, 0, 1);
  if (feeding > 0.05) {
    const gulp = 0.72 + Math.sin(frame.t * 9 + enemy.phase) * 0.18;
    addSpriteGlow(pool, 'troll-feed-glow', glowMats.green, 20, -6, 26, 52 * feeding * gulp, 36 * feeding * gulp);
  }
  const pop = clamp(enemy.popFlash ?? 0, 0, 1);
  if (pop > 0) {
    const hue = ((frame.t * 540) % 360) / 360;
    const flicker = 0.55 + Math.sin(frame.t * 26 + enemy.phase) * 0.45;
    trollPopFlashMat.color.setHSL(hue, 1, 0.58);
    trollPopFlashMat.opacity = pop * (0.55 + flicker * 0.45);
    const flash = pool.sprite('pop-flash', trollPopFlashMat);
    flash.position.set(0, 0, 24);
    flash.scale.set(120, 90, 1);
  }
}

function addSybilDetail(group: THREE.Group, frame: MeshFrame, enemy: MeshEnemy, pulse: number): void {
  const pool = childPool(group);
  const shard = (enemy.sizeScale ?? 1) < 1;
  const orbCount = shard ? 2 : 4;
  const orbitR = shard ? 22 : 34;
  // Fake identities orbit the core — the cluster reads as one body until it splits.
  for (let i = 0; i < orbCount; i += 1) {
    const a = frame.t * (shard ? 3.1 : 1.9) + enemy.phase + (i / orbCount) * Math.PI * 2;
    const orb = pool.mesh(`sybil-orb:${i}`, sybilOrbGeo, i % 2 === 0 ? mats.sybil : mats.spoof);
    orb.position.set(Math.cos(a) * orbitR, Math.sin(a) * orbitR * 0.62, 10 + Math.sin(a * 2) * 8);
    orb.rotation.set(a, a * 0.7, 0);
    orb.scale.setScalar((shard ? 0.66 : 0.92) + pulse * 0.12);

    const spark = pool.mesh(`sybil-spark:${i}`, enemyLightGeo, mats.shipGold);
    spark.position.set(Math.cos(a) * (orbitR + 8), Math.sin(a) * (orbitR + 8) * 0.62, 12);
    spark.scale.setScalar(0.5 + pulse * 0.2);
  }

  const halo = pool.mesh('sybil-halo', enemyRingGeo, mats.sybil);
  halo.rotation.x = Math.PI / 2 + Math.sin(frame.t * 1.3 + enemy.phase) * 0.3;
  halo.rotation.y = frame.t * 0.9;
  halo.scale.setScalar(shard ? 0.78 : 1.18 + pulse * 0.06);

  const eye = pool.mesh('sybil-eye', enemyLightGeo, mats.shipWing);
  eye.position.set(6, 0, 18);
  eye.scale.set(1.5 + pulse * 0.24, 1.1, 1);

  addSpriteGlow(pool, 'sybil-glow-a', glowMats.rose, 0, 0, -10, (shard ? 42 : 66) + pulse * 18, (shard ? 18 : 26) + pulse * 8);
}

function addAbductorDetail(group: THREE.Group, frame: MeshFrame, enemy: MeshEnemy, pulse: number): void {
  const pool = childPool(group);
  const mainMat = enemy.type === 'spoof' ? mats.spoof : mats.abductor;
  const accentMat = enemy.type === 'spoof' ? mats.shipWing : mats.shipGold;
  const bladeLean = enemy.type === 'spoof' ? -0.16 : 0.12;

  for (const side of [-1, 1] as const) {
    const claw = pool.mesh(`abductor-claw:${side}`, hunterBladeGeo, mainMat);
    claw.position.set(-10, side * (22 + pulse * 2.5), -3);
    claw.rotation.z = side * (0.42 + bladeLean);
    claw.rotation.x = side * 0.1;
    claw.scale.set(0.54, 0.42, 0.48);

    const rail = pool.mesh(`abductor-rail:${side}`, detailStrutGeo, accentMat);
    rail.position.set(0, side * 17, 12);
    rail.rotation.z = side * 0.48;
    rail.scale.set(0.78, 0.78, 0.78);

    const vane = pool.mesh(`abductor-vane:${side}`, enemyPlateGeo, enemy.type === 'spoof' ? mats.spoof : mats.shipWing);
    vane.position.set(17, side * 11, 17);
    vane.rotation.z = side * 0.22;
    vane.scale.set(0.68, 0.82, 0.72);
  }

  const cockpit = pool.mesh('abductor-cockpit', enemyLightGeo, enemy.type === 'spoof' ? mats.shipGold : mats.ship);
  cockpit.position.set(2, 0, 18);
  cockpit.scale.set(2.1 + pulse * 0.18, 1.3, 1.1);

  const nose = pool.mesh('abductor-nose', enemySpikeGeo, accentMat);
  nose.position.set(25 + pulse * 2.2, 0, 4);
  nose.scale.set(0.86, 0.86, 0.86);

  for (let i = 0; i < 4; i += 1) {
    const rib = pool.mesh(`abductor-rib:${i}`, enemyPlateGeo, i % 2 === 0 ? mats.abductorDark : mats.abductor);
    rib.position.set(-24 + i * 14, 0, 18 + i * 1.2);
    rib.rotation.z = Math.sin(frame.t * 2.4 + enemy.phase + i) * 0.04;
    rib.scale.set(0.32, 1.1 - i * 0.08, 0.44);
  }

  const belly = pool.mesh('abductor-belly', detailStrutGeo, enemy.type === 'spoof' ? mats.spoof : mats.captureHot);
  belly.position.set(-4, 0, -19);
  belly.rotation.z = Math.PI / 2;
  belly.scale.set(0.62, 0.62, 0.62);

  for (const side of [-1, 1] as const) {
    const collector = pool.mesh(`abductor-collector:${side}`, enemyPlateGeo, enemy.type === 'spoof' ? mats.shipWing : mats.captureBeam);
    collector.position.set(-7, side * 18, -18);
    collector.rotation.z = side * (0.9 + pulse * 0.05);
    collector.scale.set(0.36, 0.72, 0.44);
  }

  const podSlots: Array<[number, number, number]> = [
    [-22, -19, 10],
    [-22, 19, 10],
    [13, -22, -7],
    [13, 22, -7],
  ];
  for (let i = 0; i < podSlots.length; i += 1) {
    const [px, py, pz] = podSlots[i]!;
    const pod = pool.mesh(`abductor-pod:${i}`, i < 2 ? enemyPodGeo : enemyLightGeo, i % 2 === 0 ? accentMat : mainMat);
    pod.position.set(px + Math.sin(frame.t * 5 + enemy.phase + i) * 1.8, py, pz);
    pod.scale.setScalar(i < 2 ? 1.16 + pulse * 0.08 : 1.44);
  }

  addSpriteGlow(pool, 'abductor-glow-a', glowMats.rose, -2, 0, -18, 58 + pulse * 18, 24 + pulse * 8);
  addSpriteGlow(pool, 'abductor-glow-b', glowMats.amber, 24, 0, 9, 30 + pulse * 10, 16 + pulse * 5);
}

function addJammerDetail(group: THREE.Group, frame: MeshFrame, pulse: number): void {
  const pool = childPool(group);
  const shadow = pool.mesh('jammer-shadow', jammerCoreGeo, mats.jammerDark);
  shadow.position.set(-3, 0, -4);
  shadow.scale.set(1.12, 1.1, 0.78);

  const scanBar = pool.mesh('jammer-scan-bar', enemyPlateGeo, mats.shipWing);
  scanBar.position.set(0, 0, 16);
  scanBar.rotation.z = Math.sin(frame.t * 7.5) * 0.05;
  scanBar.scale.set(1.2 + pulse * 0.12, 1, 0.78);

  const hotCore = pool.mesh('jammer-hot-core', enemyLightGeo, mats.shipGold);
  hotCore.position.set(18, 0, 19);
  hotCore.scale.setScalar(1.7 + pulse * 0.25);

  for (let i = 0; i < 3; i += 1) {
    const panel = pool.mesh(`jammer-panel:${i}`, enemyPlateGeo, i === 1 ? mats.shipGold : mats.shipWing);
    panel.position.set(-15 + i * 15, -18 + i * 18, 11);
    panel.rotation.z = (i - 1) * 0.28;
    panel.scale.set(0.42, 0.8, 0.55);
  }

  for (const side of [-1, 1] as const) {
    const sidePlate = pool.mesh(`jammer-side-plate:${side}`, jammerWingGeo, side < 0 ? mats.shipWing : mats.jammer);
    sidePlate.position.set(-4, side * 27, 4);
    sidePlate.rotation.z = side * (0.34 + pulse * 0.03);
    sidePlate.scale.set(0.72, 0.62, 0.54);

    const mast = pool.mesh(`jammer-mast:${side}`, detailStrutGeo, mats.shipGold);
    mast.position.set(2, side * (36 + pulse * 2), 8);
    mast.rotation.z = Math.PI / 2 + side * 0.1;
    mast.scale.set(0.78, 0.78, 0.78);

    const node = pool.mesh(`jammer-node:${side}`, enemyLightGeo, mats.shipWing);
    node.position.set(2, side * 50, 10);
    node.scale.setScalar(1.5 + pulse * 0.18);
    addSpriteGlow(pool, `jammer-node-glow:${side}`, glowMats.blue, 3, side * 46, 10, 30, 30);
  }

  for (let i = 0; i < 3; i += 1) {
    const sheet = pool.mesh(`jammer-sheet:${i}`, speedStreakGeo, i === 1 ? mats.streakCyan : mats.streakRose);
    sheet.position.set(-8 + i * 8, -34 + i * 34, -6 - i * 2);
    sheet.rotation.z = -0.22 + i * 0.22 + Math.sin(frame.t * 3.4 + i) * 0.04;
    sheet.scale.set(56 + pulse * 14, 3.5, 1);
  }

  addSpriteGlow(pool, 'jammer-glow', glowMats.blue, 0, 0, -8, 68 + pulse * 18, 36 + pulse * 8);
}

function addHunterDetail(group: THREE.Group, frame: MeshFrame, pulse: number): void {
  const pool = childPool(group);
  for (const side of [-1, 1] as const) {
    const blade = pool.mesh(`hunter-blade:${side}`, hunterBladeGeo, mats.hunter);
    blade.position.set(-12, side * 19, -4);
    blade.rotation.z = side * (0.18 + Math.sin(frame.t * 9) * 0.02);
    blade.scale.set(0.58, 0.48, 0.42);

    const hotRail = pool.mesh(`hunter-hot-rail:${side}`, enemyPlateGeo, mats.shipGold);
    hotRail.position.set(-17, side * 11, 9);
    hotRail.rotation.z = side * 0.2;
    hotRail.scale.set(0.55, 0.56, 0.5);

    const dorsalFin = pool.mesh(`hunter-dorsal-fin:${side}`, enemySpikeGeo, side < 0 ? mats.hunterDark : mats.shipGold);
    dorsalFin.position.set(-34, side * 10, 11);
    dorsalFin.rotation.z = side * (1.22 + pulse * 0.05);
    dorsalFin.scale.set(0.62, 0.44, 0.44);
  }
  const spike = pool.mesh('hunter-spike', enemySpikeGeo, mats.shipGold);
  spike.position.set(31 + pulse * 4, 0, 3);
  const cockpit = pool.mesh('hunter-cockpit', enemyLightGeo, mats.shipWing);
  cockpit.position.set(10, 0, 12);
  cockpit.scale.setScalar(1.3 + pulse * 0.15);

  for (let i = 0; i < 3; i += 1) {
    const rail = pool.mesh(`hunter-rail:${i}`, enemyPlateGeo, i === 1 ? mats.shipWing : mats.shipGold);
    rail.position.set(-28 + i * 18, 0, 18 + i);
    rail.scale.set(0.32, 0.78 - i * 0.12, 0.42);
    rail.rotation.z = Math.sin(frame.t * 4.5 + i) * 0.05;
  }

  addSpriteGlow(pool, 'hunter-glow-a', glowMats.amber, -42, 0, -4, 74 + pulse * 22, 22 + pulse * 7);
  addSpriteGlow(pool, 'hunter-glow-b', glowMats.cyan, 18, 0, 14, 28 + pulse * 10, 15 + pulse * 4);
}

function addCarrierDetail(group: THREE.Group, frame: MeshFrame, enemy: MeshEnemy): void {
  const pool = childPool(group);
  const topDeck = pool.mesh('carrier-top-deck', carrierDeckGeo, mats.carrierDark);
  topDeck.position.set(0, -32, 11);
  topDeck.rotation.z = -0.05;
  const lowerDeck = pool.mesh('carrier-lower-deck', carrierDeckGeo, mats.carrierDark);
  lowerDeck.position.set(0, 32, 11);
  lowerDeck.rotation.z = 0.05;

  const hangar = pool.mesh('carrier-hangar', carrierHangarGeo, mats.shipWing);
  hangar.position.set(12, 0, 24);
  hangar.scale.set(1.15 + Math.sin(frame.t * 5 + enemy.phase) * 0.04, 1, 1);

  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 3; i += 1) {
      const turret = pool.mesh(`carrier-turret:${side}:${i}`, carrierTurretGeo, mats.shipGold);
      turret.position.set(-42 + i * 42, side * 47, 18);
      turret.rotation.x = Math.PI / 2;
      turret.rotation.z = frame.t * side * 0.8 + i;
    }

    const flank = pool.mesh(`carrier-flank:${side}`, hunterBladeGeo, mats.carrier);
    flank.position.set(-2, side * 54, 4);
    flank.rotation.z = side * 0.62;
    flank.scale.set(0.86, 0.5, 0.5);

    const engineGlow = pool.mesh(`carrier-engine-glow:${side}`, enemyLightGeo, mats.shipGold);
    engineGlow.position.set(-76, side * 24, 8);
    engineGlow.scale.setScalar(2.4 + Math.sin(frame.t * 6 + enemy.phase + side) * 0.18);
  }

  for (let i = 0; i < 5; i += 1) {
    const rib = pool.mesh(`carrier-rib:${i}`, enemyPlateGeo, i % 2 === 0 ? mats.shipWing : mats.shipGold);
    rib.position.set(-54 + i * 27, 0, 27);
    rib.rotation.z = Math.sin(frame.t * 2 + enemy.phase + i) * 0.04;
    rib.scale.set(0.52, 1.34, 0.7);
  }

  const bridge = pool.mesh('carrier-bridge', enemyLightGeo, mats.shipWing);
  bridge.position.set(46, 0, 34);
  bridge.scale.set(2.6, 1.45, 1.2);

  for (const side of [-1, 1] as const) {
    const broadside = pool.mesh(`carrier-broadside:${side}`, speedStreakGeo, mats.streakRose);
    broadside.position.set(8, side * 61, 10);
    broadside.rotation.z = side * 0.04;
    broadside.scale.set(118, 5, 1);

    const launchRail = pool.mesh(`carrier-launch-rail:${side}`, enemyPlateGeo, mats.shipGold);
    launchRail.position.set(34, side * 35, 28);
    launchRail.scale.set(1.26, 0.48, 0.54);
  }

  addSpriteGlow(pool, 'carrier-glow-main', glowMats.rose, 0, 0, -8, 150, 108);
  addSpriteGlow(pool, 'carrier-glow-left', glowMats.amber, -72, -28, 0, 68, 38);
  addSpriteGlow(pool, 'carrier-glow-right', glowMats.amber, -72, 28, 0, 68, 38);
}

function addLine(pool: ChildPool, key: string, geometry: THREE.EdgesGeometry, material: THREE.LineBasicMaterial, z: number): void {
  const line = pool.edges(key, geometry, material);
  line.position.z = z;
}

function addSpriteGlow(
  pool: ChildPool,
  key: string,
  material: THREE.SpriteMaterial,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
): void {
  const glow = pool.sprite(key, material);
  glow.position.set(x, y, z);
  glow.scale.set(w, h, 1);
}

// --- Beacon icon billboards -------------------------------------------------
//
// Rose, cake, cult, 4:20, and scooter only ever read as their intended shape
// via the specific vector-tier art (sprite image or procedural drawing) — a
// separate 3D interpretation drifted from that and lost recognizability
// (plain-ish blobs instead of a rose/watch/hooded-figure/scooter). Rather
// than maintain two versions, both tiers now draw the exact same icon: the
// image-based ones (rose/cake) load their PNG straight into a texture; the
// procedural ones (scooter/4:20/cult) render the shared draw function from
// pickup-icons.ts onto an offscreen canvas once. Textures load async, so
// each material is created blank up front and mutated in place once ready —
// pool.sprite() call sites never need to know whether the real art has
// arrived yet.
const ICON_TEXTURE_SIZE = 160;

function makeIconSpriteMaterial(): THREE.SpriteMaterial {
  return new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthWrite: false });
}

function applyIconCanvas(material: THREE.SpriteMaterial, canvas: HTMLCanvasElement): void {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  material.map = texture;
  material.opacity = 1;
  material.needsUpdate = true;
}

function loadIconImageMaterial(material: THREE.SpriteMaterial, url: string): void {
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_TEXTURE_SIZE;
    canvas.height = ICON_TEXTURE_SIZE;
    const c = canvas.getContext('2d');
    if (!c) return;
    const fit = Math.min(ICON_TEXTURE_SIZE / image.naturalWidth, ICON_TEXTURE_SIZE / image.naturalHeight);
    const w = image.naturalWidth * fit;
    const h = image.naturalHeight * fit;
    c.drawImage(image, (ICON_TEXTURE_SIZE - w) / 2, (ICON_TEXTURE_SIZE - h) / 2, w, h);
    applyIconCanvas(material, canvas);
  };
  image.src = url;
}

function drawIconMaterial(material: THREE.SpriteMaterial, draw: (ctx: CanvasRenderingContext2D) => void): void {
  const canvas = document.createElement('canvas');
  canvas.width = ICON_TEXTURE_SIZE;
  canvas.height = ICON_TEXTURE_SIZE;
  const c = canvas.getContext('2d');
  if (!c) return;
  c.translate(ICON_TEXTURE_SIZE / 2, ICON_TEXTURE_SIZE / 2);
  draw(c);
  applyIconCanvas(material, canvas);
}

// drawShieldBeacon/drawNetBeacon paint with `globalCompositeOperation =
// 'screen'` so they glow against the game's dark backdrop when drawn live
// each frame in vector mode. Baked once onto a bare transparent canvas via
// drawIconMaterial, `screen` against zero backdrop alpha renders washed out
// (no readable net lattice/shield hex, just a faint blob) instead of
// glowing. Bake against opaque black instead — screen-blending onto black is
// the identity blend, so the composited pixel equals the true colour
// premultiplied by the source's own alpha — then recover per-pixel alpha
// from luminance and un-premultiply so the sprite is transparent outside the
// icon again.
function drawScreenBlendIconMaterial(material: THREE.SpriteMaterial, draw: (ctx: CanvasRenderingContext2D) => void): void {
  const canvas = document.createElement('canvas');
  canvas.width = ICON_TEXTURE_SIZE;
  canvas.height = ICON_TEXTURE_SIZE;
  const c = canvas.getContext('2d');
  if (!c) return;
  c.fillStyle = '#000000';
  c.fillRect(0, 0, ICON_TEXTURE_SIZE, ICON_TEXTURE_SIZE);
  c.translate(ICON_TEXTURE_SIZE / 2, ICON_TEXTURE_SIZE / 2);
  draw(c);
  const image = c.getImageData(0, 0, ICON_TEXTURE_SIZE, ICON_TEXTURE_SIZE);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    const alpha = Math.max(r, g, b);
    if (alpha > 0) {
      data[i] = Math.min(255, Math.round((r * 255) / alpha));
      data[i + 1] = Math.min(255, Math.round((g * 255) / alpha));
      data[i + 2] = Math.min(255, Math.round((b * 255) / alpha));
    }
    data[i + 3] = alpha;
  }
  c.putImageData(image, 0, 0);
  applyIconCanvas(material, canvas);
}

const iconMats = {
  rose: makeIconSpriteMaterial(),
  wholeCake: makeIconSpriteMaterial(),
  cakePiece: CAKE_PICKUP_URLS.map(() => makeIconSpriteMaterial()),
  scooter: makeIconSpriteMaterial(),
  fourtwenty: makeIconSpriteMaterial(),
  timelock: makeIconSpriteMaterial(),
  cult: makeIconSpriteMaterial(),
  shield: makeIconSpriteMaterial(),
  net: makeIconSpriteMaterial(),
  sixHundredB: makeIconSpriteMaterial(),
};

loadIconImageMaterial(iconMats.rose, ROSE_PICKUP_URL);
loadIconImageMaterial(iconMats.wholeCake, WHOLE_CAKE_PICKUP_URL);
CAKE_PICKUP_URLS.forEach((url, i) => loadIconImageMaterial(iconMats.cakePiece[i]!, url));
// pulse fixed at 0.5 (its resting midpoint) and rot at 0 (no wobble, and for
// the tumble-width icons — shield/net/600b — rot=0 gives the widest,
// face-on silhouette) - a billboard texture is drawn once, not re-rendered
// every frame like the vector tier's per-frame canvas draw.
drawIconMaterial(iconMats.scooter, c => drawScooterBeacon(0, 0.5, c));
drawIconMaterial(iconMats.fourtwenty, c => drawFourTwentyBeacon(0, 0.5, c));
drawIconMaterial(iconMats.timelock, c => drawTimeLockBeacon(0, 0.5, c));
drawIconMaterial(iconMats.cult, c => drawCultBeacon(0, 0.5, c));
drawScreenBlendIconMaterial(iconMats.shield, c => drawShieldBeacon(0, 0.5, c));
drawScreenBlendIconMaterial(iconMats.net, c => drawNetBeacon(0, 0.5, c));
drawIconMaterial(iconMats.sixHundredB, c => draw600bMedallion(0, c));

function addIconBeaconMesh(pool: ChildPool, material: THREE.SpriteMaterial, size: number): void {
  const icon = pool.sprite('icon', material);
  icon.position.z = 14;
  icon.scale.set(size, size, 1);
}

function addBeacon(rootGroup: THREE.Group, frame: MeshFrame, beacon: MeshBeacon, index: number): void {
  const group = getIndexedGroup(beaconGroups, index, rootGroup);
  const x = sx(beacon.x, frame);
  if (x < -100 || x > frame.viewW + 100) {
    group.visible = false;
    return;
  }
  const pool = childPool(group);
  pool.beginEntity();
  group.position.set(x, sy(beacon.y, frame), 92);
  group.rotation.y = frame.t * 3.2 + beacon.age * 1.4;
  group.rotation.x = Math.sin(frame.t * 2.2) * 0.12;
  const kind = beacon.kind ?? '600b';
  group.scale.setScalar(0.62 * frame.tuning.actorScale * meshPickupScale(kind));
  const scale = kind === 'life' ? 1.08 : 1 + Math.min(0.32, (beacon.value - 1) * 0.12);

  if (kind === 'life') addLifeBeaconMesh(pool, frame, scale);
  else if (kind === 'rose') addIconBeaconMesh(pool, iconMats.rose, 100 * scale);
  else if (kind === 'cake-piece') addIconBeaconMesh(pool, iconMats.cakePiece[(beacon.spriteIndex ?? 0) % iconMats.cakePiece.length]!, 100 * scale);
  else if (kind === 'whole-cake') addIconBeaconMesh(pool, iconMats.wholeCake, 100 * scale);
  else if (kind === 'shield') addIconBeaconMesh(pool, iconMats.shield, 100 * scale);
  else if (isStandardPickupKind(kind)) addStandardBeaconMesh(pool, frame, kind, scale);
  else if (kind === 'zap') addZapBeaconMesh(pool, frame, scale);
  else if (kind === 'net') addIconBeaconMesh(pool, iconMats.net, 100 * scale);
  else if (kind === 'cult') addIconBeaconMesh(pool, iconMats.cult, 100 * scale);
  else if (kind === 'fourtwenty') addIconBeaconMesh(pool, iconMats.fourtwenty, 100 * scale);
  else if (kind === 'timelock') addIconBeaconMesh(pool, iconMats.timelock, 100 * scale);
  else if (kind === 'scooter') addIconBeaconMesh(pool, iconMats.scooter, 100 * scale);
  else if (kind === 'multi') addFanoutBeaconMesh(pool, scale);
  else addIconBeaconMesh(pool, iconMats.sixHundredB, 100 * scale);

  const ring = pool.mesh('ring', beaconRingGeo, pickupRingMaterial(kind));
  ring.rotation.y = -group.rotation.y;
  ring.scale.setScalar(1 + Math.sin(frame.t * 6.5) * 0.08);
  const glow = pickupGlowMaterial(kind);
  addSpriteGlow(pool, 'glow', glow, 0, 0, -8, 88 + scale * 14, 88 + scale * 14);
}

function addFanoutBeaconMesh(pool: ChildPool, scale: number): void {
  // Relay fanout: one feed node splitting into three beam lanes, each capped
  // with a bright tip node — the weapon pickup wears the network diagram.
  const hub = pool.mesh('fanout-hub', enemyPodGeo, mats.shipGold);
  hub.position.set(-16 * scale, 0, 10);
  hub.scale.setScalar(1.35 * scale);
  hub.castShadow = true;
  for (const lane of [-1, 0, 1] as const) {
    const bar = pool.mesh(`fanout-beam:${lane}`, pickupBarGeo, mats.laserAmber);
    bar.position.set(-2 * scale, lane * 9.5 * scale, 10);
    bar.rotation.z = Math.atan2(lane * 19, 28) - Math.PI / 2;
    bar.scale.set(2.6 * scale, 34 * scale, 2.6 * scale);
    const tip = pool.mesh(`fanout-tip:${lane}`, microPodGeo, mats.laserCore);
    tip.position.set(12 * scale, lane * 19 * scale, 10);
    tip.scale.setScalar(0.85 * scale);
  }
}

function meshPickupScale(kind: MeshBeacon['kind']): number {
  // Pickups are the route-risk decisions of the whole loop — at arcade scale
  // they should be unmissable, so everything renders at double weight.
  if (kind === 'life') return 3;
  if (kind === 'rose') return 3.36;
  if (kind === 'cake-piece') return 3.24;
  if (kind === 'whole-cake') return 3.04;
  if (kind === 'shield') return 2.84;
  if (kind === 'relay') return 2.76;
  if (kind === 'charge') return 2.84;
  if (kind === 'zap') return 2.96;
  if (kind === 'net') return 2.84;
  if (kind === 'cult') return 3;
  if (kind === 'fourtwenty') return 2.96;
  if (kind === 'scooter') return 2.9;
  if (kind === 'multi') return 2.96;
  if (kind === 'timelock') return 2.96;
  return 3;
}

function isStandardPickupKind(kind: MeshBeacon['kind']): kind is 'relay' | 'charge' {
  return kind === 'relay' || kind === 'charge';
}

function addLifeBeaconMesh(pool: ChildPool, frame: MeshFrame, scale: number): void {
  const coin = pool.mesh('coin', beaconGeo, mats.lifeBeacon);
  coin.scale.set(scale, scale, scale);
  coin.castShadow = true;
  const plusPulse = 1 + Math.sin(frame.t * 8) * 0.08;
  for (const rot of [0, Math.PI / 2]) {
    const bar = pool.mesh(`life-bar:${rot}`, pickupBarGeo, mats.laserCore);
    bar.position.z = 7;
    bar.rotation.z = rot;
    bar.scale.set(34 * plusPulse, 6.5, 3.6);
  }
}

function addStandardBeaconMesh(pool: ChildPool, frame: MeshFrame, kind: 'relay' | 'charge', scale: number): void {
  const material = kind === 'relay' ? mats.pickupRelay : mats.pickupCharge;
  const core = pool.mesh('core', beaconGeo, material);
  core.scale.set(scale * 0.92, scale * 0.92, scale * 0.92);
  core.castShadow = true;

  if (kind === 'relay') {
    for (let i = 0; i < 3; i += 1) {
      const ring = pool.mesh(`relay-ring:${i}`, citizenRingGeo, i === 2 ? mats.laserCore : mats.signalRing);
      ring.position.z = 9 + i * 2;
      ring.scale.setScalar((0.42 + i * 0.24) * scale * (1 + Math.sin(frame.t * 6 + i) * 0.04));
    }
    const mast = pool.mesh('relay-mast', pickupBarGeo, mats.laserCore);
    mast.position.z = 15;
    mast.scale.set(5 * scale, 5 * scale, 32 * scale);
    return;
  }

  const boltBits = [
    { x: 4, y: -12, rot: -0.45, h: 28 },
    { x: -5, y: 4, rot: 0.5, h: 26 },
    { x: 4, y: 16, rot: -0.42, h: 22 },
  ] as const;
  boltBits.forEach((bit, i) => {
    const bolt = pool.mesh(`charge-bolt:${i}`, pickupBarGeo, mats.laserCore);
    bolt.position.set(bit.x * scale, bit.y * scale, 15);
    bolt.rotation.z = bit.rot;
    bolt.scale.set(7 * scale, bit.h * scale, 5 * scale);
  });
}

function addZapBeaconMesh(pool: ChildPool, frame: MeshFrame, scale: number): void {
  // Zap pickup: gold diamond core with an oversized bolt — reads as "score event".
  const core = pool.mesh('core', beaconGeo, mats.pickupCharge);
  core.rotation.z = Math.PI / 4;
  core.scale.set(scale * 0.78, scale * 0.78, scale * 0.78);
  core.castShadow = true;
  const boltPulse = 1 + Math.sin(frame.t * 9) * 0.1;
  const boltBits = [
    { x: 5, y: -14, rot: -0.48, h: 30 },
    { x: -6, y: 3, rot: 0.52, h: 28 },
    { x: 5, y: 19, rot: -0.44, h: 24 },
  ] as const;
  boltBits.forEach((bit, i) => {
    const bolt = pool.mesh(`zap-bolt:${i}`, pickupBarGeo, mats.laserCore);
    bolt.position.set(bit.x * scale, bit.y * scale, 15);
    bolt.rotation.z = bit.rot;
    bolt.scale.set(8 * scale * boltPulse, bit.h * scale, 5 * scale);
  });
  for (const side of [-1, 1] as const) {
    const arc = pool.mesh(`zap-arc:${side}`, citizenRingGeo, mats.laserAmber);
    arc.position.z = 8;
    arc.rotation.z = frame.t * side * 2.4;
    arc.scale.setScalar((0.9 + side * 0.14) * scale * boltPulse);
  }
}

function pickupRingMaterial(kind: MeshBeacon['kind']): THREE.MeshBasicMaterial {
  if (kind === 'timelock') return mats.captureHot;
  if (kind === 'fourtwenty') return mats.signalRing;
  if (kind === 'scooter') return mats.laserGlow;
  if (kind === 'multi') return mats.laserAmber;
  if (kind === 'life') return mats.signalRing;
  if (kind === 'rose') return mats.captureHot;
  if (kind === 'shield') return mats.laserGlow;
  if (kind === 'relay' || kind === 'net') return mats.signalRing;
  return mats.beaconRing;
}

function pickupGlowMaterial(kind: MeshBeacon['kind']): THREE.SpriteMaterial {
  if (kind === 'timelock') return glowMats.rose;
  if (kind === 'cult') return glowMats.rose;
  if (kind === 'fourtwenty') return glowMats.cyan;
  if (kind === 'scooter') return glowMats.cyan;
  if (kind === 'life') return glowMats.cyan;
  if (kind === 'rose') return glowMats.rose;
  if (kind === 'shield' || kind === 'relay' || kind === 'net') return glowMats.cyan;
  return glowMats.amber;
}

function sx(worldX: number, frame: MeshFrame): number {
  return frame.viewW / 2 + wrapDelta(worldX, frame.cameraX, frame.worldW);
}

function sxParallax(worldX: number, frame: MeshFrame, factor: number): number {
  return frame.viewW / 2 + wrapDelta(worldX, frame.cameraX * factor, frame.worldW);
}

function sy(screenY: number, frame: MeshFrame): number {
  return frame.viewH - screenY;
}

function wrapX(x: number, worldW: number): number {
  let out = x % worldW;
  if (out < 0) out += worldW;
  return out;
}

function wrapDelta(a: number, b: number, worldW: number): number {
  let d = a - b;
  if (d > worldW / 2) d -= worldW;
  if (d < -worldW / 2) d += worldW;
  return d;
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

function calcFov(viewH: number): number {
  return THREE.MathUtils.radToDeg(2 * Math.atan(viewH / (2 * CAMERA_Z)));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function status(label: string): void {
  window.dispatchEvent(new CustomEvent('neonsentinel:mesh-status', { detail: { label } }));
}
