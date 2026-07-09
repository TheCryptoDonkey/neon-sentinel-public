/**
 * Presentation passes lifted into a game-agnostic shape from Pallasite.
 * A finished game canvas goes in; a styled frame comes out.
 */

export type ThemeId = 'none' | 'cinematic' | 'crt' | 'synthwave' | 'hologram' | 'blueprint' | 'vhs';

export interface ThemeInfo {
  id: ThemeId;
  label: string;
}

export const THEMES: readonly ThemeInfo[] = [
  { id: 'none', label: 'CLEAN' },
  { id: 'cinematic', label: 'CINEMA' },
  { id: 'crt', label: 'CRT' },
  { id: 'synthwave', label: 'SYNTH' },
  { id: 'hologram', label: 'HOLO' },
  { id: 'blueprint', label: 'BLUE' },
  { id: 'vhs', label: 'VHS' },
];

export function coerceThemeId(value: unknown): ThemeId {
  return typeof value === 'string' && THEMES.some(theme => theme.id === value)
    ? value as ThemeId
    : 'none';
}

let scratch: HTMLCanvasElement | null = null;
let crtBloomSource: HTMLCanvasElement | null = null;
let crtBloom: HTMLCanvasElement | null = null;
let crtVignette: { w: number; h: number; canvas: HTMLCanvasElement } | null = null;

function getScratch(w: number, h: number): HTMLCanvasElement {
  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width !== w) scratch.width = w;
  if (scratch.height !== h) scratch.height = h;
  return scratch;
}

export function applyPostFx(canvas: HTMLCanvasElement, theme: ThemeId, nowMs: number): void {
  if (theme === 'none') return;
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width === 0 || canvas.height === 0) return;
  if (theme === 'cinematic') applyCinematic(ctx, canvas, nowMs);
  else if (theme === 'crt') applyVectorCrt(ctx, canvas, nowMs);
  else if (theme === 'synthwave') applySynthwave(ctx, canvas, nowMs);
  else if (theme === 'hologram') applyHologram(ctx, canvas, nowMs);
  else if (theme === 'blueprint') applyBlueprint(ctx, canvas);
  else if (theme === 'vhs') applyVhs(ctx, canvas, nowMs);
}

function snapshot(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const w = canvas.width;
  const h = canvas.height;
  const sc = getScratch(w, h);
  const scx = sc.getContext('2d');
  if (!scx) return null;

  scx.setTransform(1, 0, 0, 1, 0, 0);
  scx.clearRect(0, 0, w, h);
  scx.drawImage(canvas, 0, 0);
  return scx;
}

function getCrtScratch(ref: 'source' | 'bloom', w: number, h: number): HTMLCanvasElement {
  const current = ref === 'source' ? crtBloomSource : crtBloom;
  let next = current;
  if (!next) next = document.createElement('canvas');
  if (next.width !== w) next.width = w;
  if (next.height !== h) next.height = h;
  if (ref === 'source') crtBloomSource = next;
  else crtBloom = next;
  return next;
}

function getCrtVignette(w: number, h: number): HTMLCanvasElement {
  if (crtVignette && crtVignette.w === w && crtVignette.h === h) return crtVignette.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const vx = canvas.getContext('2d');
  if (vx) {
    const tube = vx.createRadialGradient(w / 2, h / 2, h * 0.36, w / 2, h / 2, h * 0.78);
    tube.addColorStop(0, 'rgba(0,0,0,0)');
    tube.addColorStop(0.72, 'rgba(0,0,0,0.16)');
    tube.addColorStop(1, 'rgba(0,0,0,0.52)');
    vx.fillStyle = tube;
    vx.fillRect(0, 0, w, h);
  }
  crtVignette = { w, h, canvas };
  return canvas;
}

function applyCinematic(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, nowMs: number): void {
  const w = canvas.width;
  const h = canvas.height;
  const k = w / 1280;
  if (!snapshot(canvas)) return;
  const sc = getScratch(w, h);
  const pulse = 0.9 + 0.04 * Math.sin(nowMs * 0.0018);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.filter = `blur(${(1.2 * k).toFixed(2)}px) saturate(1.08)`;
  ctx.globalAlpha = 0.13 * pulse;
  ctx.drawImage(sc, 0, 0);
  ctx.filter = `blur(${(6.5 * k).toFixed(2)}px) saturate(1.16)`;
  ctx.globalAlpha = 0.08;
  ctx.drawImage(sc, 0, 0);

  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.07;
  const grade = ctx.createLinearGradient(0, 0, w, h);
  grade.addColorStop(0, '#213cff');
  grade.addColorStop(0.42, '#00ffd5');
  grade.addColorStop(0.78, '#ffd84a');
  grade.addColorStop(1, '#ff3a5f');
  ctx.fillStyle = grade;
  ctx.fillRect(0, 0, w, h);

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  const vignette = ctx.createRadialGradient(w / 2, h * 0.48, h * 0.34, w / 2, h * 0.5, h * 0.84);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(0.74, 'rgba(0,0,0,0.08)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function applyVectorCrt(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, nowMs: number): void {
  const w = canvas.width;
  const h = canvas.height;
  if (w === 0 || h === 0) return;
  const k = w / 1280;
  const flicker = 0.985 + 0.015 * Math.sin(nowMs * 0.05);
  const bloomScale = w >= 1200 ? 0.45 : 0.7;
  const bw = Math.max(1, Math.round(w * bloomScale));
  const bh = Math.max(1, Math.round(h * bloomScale));
  const src = getCrtScratch('source', bw, bh);
  const bloom = getCrtScratch('bloom', bw, bh);
  const sx = src.getContext('2d');
  const bx = bloom.getContext('2d');
  if (!sx || !bx) return;

  sx.setTransform(1, 0, 0, 1, 0, 0);
  sx.filter = 'none';
  sx.globalAlpha = 1;
  sx.globalCompositeOperation = 'source-over';
  sx.clearRect(0, 0, bw, bh);
  sx.drawImage(canvas, 0, 0, bw, bh);

  bx.setTransform(1, 0, 0, 1, 0, 0);
  bx.clearRect(0, 0, bw, bh);
  bx.globalCompositeOperation = 'source-over';
  bx.filter = `blur(${(1.3 * k).toFixed(2)}px)`;
  bx.globalAlpha = 0.72;
  bx.drawImage(src, 0, 0);
  bx.globalCompositeOperation = 'lighter';
  bx.filter = `blur(${(3.4 * k).toFixed(2)}px)`;
  bx.globalAlpha = 0.42;
  bx.drawImage(src, 0, 0);
  bx.filter = 'none';

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.filter = 'none';
  ctx.globalAlpha = 0.78 * flicker;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bloom, 0, 0, w, h);

  // Vector CRT bloom only. Raster scanlines cost time and make motion harder to read.
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.drawImage(getCrtVignette(w, h), 0, 0);
  ctx.restore();
}

function applySynthwave(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, nowMs: number): void {
  const w = canvas.width;
  const h = canvas.height;
  const k = w / 1280;
  if (!snapshot(canvas)) return;
  const sc = getScratch(w, h);
  const pulse = 0.52 + 0.14 * Math.sin(nowMs * 0.0016);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.filter = `blur(${(3.4 * k).toFixed(2)}px)`;
  ctx.globalAlpha = 0.5;
  ctx.drawImage(sc, 0, 0);
  ctx.filter = `blur(${(9.5 * k).toFixed(2)}px)`;
  ctx.globalAlpha = 0.32;
  ctx.drawImage(sc, 0, 0);

  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.38;
  const grade = ctx.createLinearGradient(0, 0, 0, h);
  grade.addColorStop(0, '#292066');
  grade.addColorStop(0.56, '#ff2db4');
  grade.addColorStop(1, '#ff8a3a');
  ctx.fillStyle = grade;
  ctx.fillRect(0, 0, w, h);

  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = pulse;
  const sun = ctx.createRadialGradient(w * 0.52, h * 1.04, h * 0.06, w * 0.52, h * 1.04, h * 0.56);
  sun.addColorStop(0, 'rgba(255,216,74,0.52)');
  sun.addColorStop(0.54, 'rgba(255,58,255,0.22)');
  sun.addColorStop(1, 'rgba(255,58,255,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function applyHologram(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, nowMs: number): void {
  const w = canvas.width;
  const h = canvas.height;
  if (!snapshot(canvas)) return;
  const sc = getScratch(w, h);
  const drift = Math.sin(nowMs * 0.004) * 3;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = '#5effdb';
  ctx.fillRect(0, 0, w, h);

  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.22;
  ctx.filter = 'contrast(1.4) saturate(1.8)';
  ctx.drawImage(sc, drift, 0);
  ctx.drawImage(sc, -drift, 0);
  ctx.filter = 'none';

  ctx.globalCompositeOperation = 'source-over';
  for (let y = Math.floor((nowMs * 0.03) % 9); y < h; y += 9) {
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#5effdb';
    ctx.fillRect(0, y, w, 1);
  }
  ctx.globalAlpha = 0.26;
  ctx.strokeStyle = '#5effdb';
  ctx.lineWidth = Math.max(1, w / 1280);
  for (let x = 0; x < w; x += Math.max(60, Math.round(w / 18))) {
    ctx.beginPath();
    ctx.moveTo(x + drift * 2, 0);
    ctx.lineTo(x - drift * 2, h);
    ctx.stroke();
  }
  ctx.restore();
}

function applyBlueprint(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  const w = canvas.width;
  const h = canvas.height;
  if (!snapshot(canvas)) return;
  const sc = getScratch(w, h);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#06152d';
  ctx.fillRect(0, 0, w, h);

  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.9;
  ctx.filter = 'grayscale(1) contrast(1.8) brightness(1.2)';
  ctx.drawImage(sc, 0, 0);
  ctx.filter = 'none';

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.24;
  ctx.strokeStyle = '#8ad9ff';
  ctx.lineWidth = 1;
  const gap = Math.max(24, Math.round(w / 48));
  for (let x = 0; x <= w; x += gap) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += gap) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}

function applyVhs(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, nowMs: number): void {
  const w = canvas.width;
  const h = canvas.height;
  if (!snapshot(canvas)) return;
  const sc = getScratch(w, h);
  const wobble = Math.sin(nowMs * 0.006) * 4;
  const tearY = Math.floor((0.3 + 0.28 * Math.sin(nowMs * 0.0013)) * h);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, w, h);

  ctx.globalAlpha = 1;
  ctx.filter = 'saturate(0.95) contrast(1.16)';
  ctx.drawImage(sc, 0, 0);
  ctx.filter = 'none';

  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.2;
  ctx.drawImage(sc, wobble + 2, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.18;
  ctx.drawImage(sc, -wobble - 2, 0);

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#ffffff';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#5effdb';
  ctx.fillRect(0, tearY, w, Math.max(2, h * 0.006));
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#ff3aff';
  ctx.fillRect(0, tearY + Math.max(3, h * 0.012), w, 1);
  ctx.restore();
}
