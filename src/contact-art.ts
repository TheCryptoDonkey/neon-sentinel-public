// Canvas fallback for the Blender portrait UV sphere. Profile pixels are
// projected into a finite rotation cache, never read back (remote images can
// legitimately taint canvas). Frames are made only as they are encountered.
const SIDE = 64;
const FRAMES = 16;
const LIMIT = 32;
interface PortraitViews { frames: Map<number, HTMLCanvasElement> }
const portraits = new Map<CanvasImageSource, PortraitViews>();
let lastRotation = 0;
let lighting: HTMLImageElement | undefined;
let lightingState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';

function requestLighting(): void {
  if (lightingState !== 'idle') return;
  lightingState = 'loading';
  const image = new Image();
  image.onload = () => { lighting = image; lightingState = 'ready'; };
  image.onerror = () => { lightingState = 'failed'; };
  image.src = '/models/contact-light-v1.webp';
}

export function contactRotation(time: number, id: number, reducedEffects: boolean): number {
  return reducedEffects ? 0 : (time * (1.55 + id * .015) + id) % (Math.PI * 2);
}

function projectedPortrait(image: CanvasImageSource, frame: number): HTMLCanvasElement {
  let atlas = portraits.get(image);
  if (!atlas) {
    atlas = { frames: new Map() };
    if (portraits.size >= LIMIT) portraits.delete(portraits.keys().next().value!);
  }
  // LRU keeps the current visible roster warm during longer runs.
  portraits.delete(image);
  portraits.set(image, atlas);
  const cachedFrame = atlas.frames.get(frame);
  if (cachedFrame) return cachedFrame;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIDE;
  const source = image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
  const width = source.naturalWidth || source.width || SIDE;
  const height = source.naturalHeight || source.height || SIDE;
  const side = Math.min(width, height);
  const c = canvas.getContext('2d')!;
  c.save();
  // Each immutable pose has its own surface, keeping interpolation isolated
  // from lazy creation of neighbouring rotation views.
  c.beginPath(); c.rect(0,0,SIDE,SIDE); c.clip();
  c.beginPath(); c.arc(SIDE / 2, SIDE / 2, SIDE / 2, 0, Math.PI * 2); c.clip();
  // The inverse of the authored angular UV map, sampled in a finite grid.
  const angle = frame * Math.PI * 2 / FRAMES;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const uv = (x: number, y: number) => {
    const z = Math.sqrt(Math.max(0, 1 - x*x - y*y));
    const localX = x*cos-z*sin, localZ = x*sin+z*cos;
    return [0.5 + Math.atan2(localX, Math.abs(localZ)) / Math.PI, 0.5 + Math.asin(Math.max(-1, Math.min(1, y))) / Math.PI];
  };
  const step = 4;
  for (let y = 0; y < SIDE; y += step) for (let x = 0; x < SIDE; x += step) {
    const nx = (x + step/2) / (SIDE/2) - 1;
    const ny = (y + step/2) / (SIDE/2) - 1;
    if (nx*nx + ny*ny > 1.07) continue;
    const a = uv((x)/(SIDE/2)-1, ny);
    const b = uv((x+step)/(SIDE/2)-1, ny);
    const top = uv(nx, y/(SIDE/2)-1)[1];
    const bottom = uv(nx, (y+step)/(SIDE/2)-1)[1];
    c.save();
    c.translate(b[0]<a[0] ? x+step : x,y);
    if (b[0]<a[0]) c.scale(-1,1);
    c.drawImage(image, (width-side)/2+Math.min(a[0],b[0])*side, (height-side)/2+top*side,
      Math.max(.01,Math.abs(b[0]-a[0])*side), Math.max(.01,(bottom-top)*side), 0,0,step+.3,step+.3);
    c.restore();
  }
  c.restore();
  atlas.frames.set(frame,canvas);
  return canvas;
}

export function drawContactSphere(ctx: CanvasRenderingContext2D, image: CanvasImageSource | null, radius: number, colour: string, rotation = 0): void {
  requestLighting();
  lastRotation = rotation;
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.arc(0,0,radius,0,Math.PI*2); ctx.clip();
  ctx.fillStyle = colour; ctx.fillRect(-radius,-radius,radius*2,radius*2);
  if (image) {
    const phase = ((rotation / (Math.PI*2)) % 1 + 1) % 1 * FRAMES;
    const frame = Math.floor(phase), next = (frame+1) % FRAMES;
    const drawFrame = (index: number) => ctx.drawImage(projectedPortrait(image,index),-radius,-radius,radius*2,radius*2);
    drawFrame(frame);
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha *= phase-frame;
    if (phase>frame) drawFrame(next);
    ctx.globalAlpha = alpha;
  }
  ctx.globalCompositeOperation = 'multiply';
  if (lighting) ctx.drawImage(lighting,-radius,-radius,radius*2,radius*2);
  else {
    const shade = ctx.createRadialGradient(-radius*.32,-radius*.4,radius*.1,0,0,radius);
    shade.addColorStop(0,'#ffffff'); shade.addColorStop(.5,'#b8b8b8'); shade.addColorStop(1,'#262636');
    ctx.fillStyle = shade; ctx.fillRect(-radius,-radius,radius*2,radius*2);
  }
  ctx.globalCompositeOperation = 'screen';
  const glint = ctx.createRadialGradient(-radius*.32,-radius*.4,0,-radius*.32,-radius*.4,radius*.4);
  glint.addColorStop(0,'rgba(255,255,255,.5)'); glint.addColorStop(.25,'rgba(255,255,255,.16)'); glint.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle = glint; ctx.fillRect(-radius,-radius,radius*2,radius*2);
  ctx.restore();
}

export function contactArtDiagnostics() {
  return { lighting: lightingState, portraitBakes: portraits.size, portraitLimit: LIMIT,
    rotationFrames: FRAMES, frameSide: SIDE, lastRotation };
}
