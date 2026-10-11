// Finite art identities shared by Canvas and Three. Failed loads are attempted
// once; original code-native drawings remain immediately available.
import { CAKE_PICKUP_URLS } from './pickup-icons.js';
export const ALIEN_KINDS = ['abductor','hunter','jammer','forgery','spammer','sybil','troll'] as const;
export const PICKUP_KINDS = ['rose','cake-piece','whole-cake','600b','life','shield','relay','charge','zap','net','cult','fourtwenty','scooter','multi','timelock'] as const;
export type AlienArt = typeof ALIEN_KINDS[number];
export type PickupArt = typeof PICKUP_KINDS[number];
export type SculptedArt = AlienArt | PickupArt;
const images = new Map<SculptedArt, HTMLImageElement>();
const states = new Map<SculptedArt, 'loading' | 'ready' | 'failed'>();
const cakeSlices: (HTMLImageElement | undefined)[] = Array(CAKE_PICKUP_URLS.length).fill(undefined);
states.set('cake-piece','loading');
CAKE_PICKUP_URLS.forEach((url,index) => {
  const image = new Image();
  image.onload = () => {
    cakeSlices[index] = image;
    if (cakeSlices.every(Boolean)) states.set('cake-piece','ready');
  };
  image.onerror = () => states.set('cake-piece','failed');
  image.src = url;
});
for (const kind of [...ALIEN_KINDS,...PICKUP_KINDS]) {
  // The six iced 600 billion slices are accepted character art. Preserve
  // their actual spriteIndex instead of replacing all six with generic cake.
  if (kind === 'cake-piece') continue;
  const image = new Image();
  states.set(kind,'loading');
  image.onload = () => { images.set(kind,image); states.set(kind,'ready'); };
  image.onerror = () => { states.set(kind,'failed'); };
  image.src = `/models/${kind}-v3.webp`;
}
export function cakeSliceIndex(spriteIndex = 0): number {
  return ((Math.floor(spriteIndex) % CAKE_PICKUP_URLS.length) + CAKE_PICKUP_URLS.length) % CAKE_PICKUP_URLS.length;
}
export function sculptedImage(kind: SculptedArt, spriteIndex = 0): HTMLImageElement | undefined {
  return kind === 'cake-piece' ? cakeSlices[cakeSliceIndex(spriteIndex)] : images.get(kind);
}
export function sculptedArtDiagnostics() { return Object.fromEntries(states); }
export function drawSculptedPickup(ctx: CanvasRenderingContext2D, kind: PickupArt, rotation = 0, spriteIndex = 0): boolean {
  const image = sculptedImage(kind,spriteIndex);
  if (!image) return false;
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.rotate(rotation);
  ctx.drawImage(image,-55,-55,110,110);
  ctx.restore();
  return true;
}
