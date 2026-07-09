export type SpriteEnemyType = 'abductor' | 'forgery' | 'jammer' | 'hunter' | 'carrier' | 'spammer' | 'sybil' | 'troll';
export type SpriteShipClass = 'interceptor' | 'guardian' | 'heavy';

interface SpriteAsset {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
}

interface ShipSpriteOptions {
  ctx: CanvasRenderingContext2D;
  shipClass: SpriteShipClass;
  x: number;
  y: number;
  dir: -1 | 1;
  scale: number;
  bank: number;
  turn: number;
  thrust: number;
  heat: number;
  t: number;
}

interface EnemySpriteOptions {
  ctx: CanvasRenderingContext2D;
  type: SpriteEnemyType;
  x: number;
  y: number;
  dir: -1 | 1;
  scale: number;
  bank: number;
  turn: number;
  intent: number;
  muzzle: number;
  phase: number;
  hp: number;
  maxHp: number;
  t: number;
  hot: boolean;
}

const DPR = Math.min(3, Math.max(2, Math.ceil(window.devicePixelRatio || 2)));
const shipCache = new Map<SpriteShipClass, SpriteAsset>();
const enemyCache = new Map<SpriteEnemyType, SpriteAsset>();

export function drawShipSprite(opts: ShipSpriteOptions): void {
  const { ctx, x, y, dir, scale, bank, turn, thrust, heat, t } = opts;
  const sprite = shipSprite(opts.shipClass);
  const pulse = 0.5 + Math.sin(t * 42) * 0.5;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(bank * 0.06);

  if (thrust > 0.03) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.scale(dir, 1);
    const plumeLen = 42 + thrust * 92 + pulse * 12;
    const plume = ctx.createLinearGradient(-44, 0, -44 - plumeLen, 0);
    plume.addColorStop(0, colourWithAlpha('#fff5d8', 0.92));
    plume.addColorStop(0.18, colourWithAlpha('#5effdb', 0.76));
    plume.addColorStop(0.46, colourWithAlpha('#ffd84a', 0.4));
    plume.addColorStop(1, 'rgba(255,77,141,0)');
    ctx.fillStyle = plume;
    ctx.shadowColor = thrust > 0.55 ? '#ffd84a' : '#5effdb';
    ctx.shadowBlur = 16 + thrust * 22;
    ctx.beginPath();
    ctx.moveTo(-37 * scale, -7 * scale);
    ctx.lineTo((-42 - plumeLen) * scale, 0);
    ctx.lineTo(-37 * scale, 7 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  if (turn > 0.03) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.scale(dir, 1);
    ctx.globalAlpha = 0.22 + turn * 0.56;
    const brake = ctx.createLinearGradient(46 * scale, 0, -86 * scale, 0);
    brake.addColorStop(0, 'rgba(255,255,255,0.88)');
    brake.addColorStop(0.22, 'rgba(94,255,219,0.58)');
    brake.addColorStop(1, 'rgba(94,255,219,0)');
    ctx.fillStyle = brake;
    ctx.shadowColor = '#5effdb';
    ctx.shadowBlur = 16 + turn * 22;
    for (const side of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(33 * scale, side * 16 * scale);
      ctx.lineTo((-67 - turn * 30) * scale, side * (28 + turn * 8) * scale);
      ctx.lineTo(-16 * scale, side * 7 * scale);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.scale(dir * scale, scale);
  ctx.drawImage(sprite.canvas, -sprite.w / 2, -sprite.h / 2, sprite.w, sprite.h);

  if (heat > 0.05) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.26 + heat * 0.52;
    ctx.fillStyle = heat > 0.68 ? '#ff4d5e' : '#ffd84a';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 18 + heat * 30;
    ctx.beginPath();
    ctx.ellipse(70, 0, 8 + heat * 8, 4 + heat * 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

export function drawEnemySprite(opts: EnemySpriteOptions): void {
  const { ctx, type, x, y, dir, scale, bank, turn, intent, muzzle, phase, t, hot } = opts;
  const sprite = enemySprite(type);
  const colour = enemyColour(type);
  const pulse = 0.5 + Math.sin(t * 8 + phase) * 0.5;
  const turnBlade = Math.sin((1 - turn) * Math.PI);
  const narrow = turn > 0.025 ? 0.52 + Math.abs((1 - turn) - 0.5) * 0.9 : 1;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(bank);

  ctx.save();
  ctx.scale(dir, 1);
  ctx.globalCompositeOperation = 'screen';
  const wakeLen = type === 'carrier' ? 150 : type === 'hunter' ? 98 : 86;
  const wake = ctx.createLinearGradient(-36 * scale, 0, (-36 - wakeLen) * scale, 0);
  wake.addColorStop(0, colourWithAlpha(colour, 0.24 + intent * 0.18));
  wake.addColorStop(0.52, colourWithAlpha(type === 'hunter' ? '#ffd84a' : type === 'jammer' ? '#5f7cff' : colour, 0.12 + intent * 0.08));
  wake.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = wake;
  ctx.shadowColor = colour;
  ctx.shadowBlur = 10 + intent * 16;
  ctx.beginPath();
  ctx.moveTo(-24 * scale, -9 * scale);
  ctx.lineTo((-38 - wakeLen) * scale, 0);
  ctx.lineTo(-24 * scale, 9 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.scale(dir * scale * narrow, scale * (1 + turnBlade * 0.08));
  ctx.shadowColor = colour;
  ctx.shadowBlur = type === 'carrier' ? 22 : 15;
  ctx.drawImage(sprite.canvas, -sprite.w / 2, -sprite.h / 2, sprite.w, sprite.h);

  if (turn > 0.035) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.24 + turnBlade * 0.58;
    ctx.strokeStyle = '#fff5d8';
    ctx.shadowColor = '#fff5d8';
    ctx.shadowBlur = 18;
    ctx.lineWidth = type === 'carrier' ? 4 : 3;
    ctx.beginPath();
    ctx.moveTo(-8, -sprite.h * 0.34);
    ctx.lineTo(10, sprite.h * 0.34);
    ctx.stroke();
    ctx.strokeStyle = '#5effdb';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(15, -sprite.h * 0.26);
    ctx.lineTo(-14, sprite.h * 0.26);
    ctx.stroke();
    ctx.restore();
  }

  if (hot || intent > 0.08) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = hot ? 0.34 + pulse * 0.18 : 0.16 + intent * 0.18;
    ctx.strokeStyle = hot ? '#ff4d5e' : colour;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = hot ? 20 : 12;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, sprite.w * 0.35 + intent * 10, sprite.h * 0.32 + pulse * 4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (muzzle > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.34 + muzzle * 0.5;
    ctx.fillStyle = type === 'jammer' ? '#b6c7ff' : type === 'hunter' ? '#ffd84a' : '#ffd5e5';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 16 + muzzle * 18;
    const muzzleX = sprite.w * (type === 'carrier' ? 0.4 : 0.34);
    ctx.beginPath();
    ctx.ellipse(muzzleX, 0, 6 + muzzle * 10, 2.8 + muzzle * 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (type === 'carrier') {
    ctx.save();
    const hp = Math.max(0, Math.min(1, opts.hp / Math.max(1, opts.maxHp)));
    ctx.fillStyle = 'rgba(255,245,216,0.2)';
    ctx.fillRect(-62, -58, 124, 4);
    ctx.fillStyle = '#ff2f7a';
    ctx.fillRect(-62, -58, 124 * hp, 4);
    ctx.restore();
  }
  ctx.restore();
}

function shipSprite(shipClass: SpriteShipClass): SpriteAsset {
  const existing = shipCache.get(shipClass);
  if (existing) return existing;

  const w = 174;
  const h = 96;
  const asset = makeAsset(w, h);
  const g = asset.canvas.getContext('2d');
  if (!g) throw new Error('Missing 2D context');
  setupSpriteContext(g, w, h);
  drawShipBase(g, shipClass);
  shipCache.set(shipClass, asset);
  return asset;
}

function enemySprite(type: SpriteEnemyType): SpriteAsset {
  const existing = enemyCache.get(type);
  if (existing) return existing;

  const carrier = type === 'carrier';
  const asset = makeAsset(carrier ? 300 : 158, carrier ? 146 : 104);
  const g = asset.canvas.getContext('2d');
  if (!g) throw new Error('Missing 2D context');
  setupSpriteContext(g, asset.w, asset.h);
  if (type === 'hunter') drawHunter(g);
  else if (type === 'jammer') drawJammer(g);
  else if (type === 'forgery') drawForgery(g);
  else if (type === 'carrier') drawCarrier(g);
  else if (type === 'spammer') drawSpammer(g);
  else if (type === 'sybil') drawSybil(g);
  else if (type === 'troll') drawTroll(g);
  else drawAbductor(g);
  enemyCache.set(type, asset);
  return asset;
}

function makeAsset(w: number, h: number): SpriteAsset {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * DPR);
  canvas.height = Math.round(h * DPR);
  return { canvas, w, h };
}

function setupSpriteContext(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.setTransform(DPR, 0, 0, DPR, w * DPR / 2, h * DPR / 2);
  g.lineCap = 'round';
  g.lineJoin = 'round';
}

function drawShipBase(g: CanvasRenderingContext2D, shipClass: SpriteShipClass): void {
  const accent = shipClass === 'heavy' ? '#ff8a3a' : shipClass === 'guardian' ? '#8cffb4' : '#5effdb';
  const secondary = shipClass === 'heavy' ? '#ffd84a' : shipClass === 'guardian' ? '#5effdb' : '#dffcff';
  const hull = g.createLinearGradient(-72, -28, 78, 24);
  hull.addColorStop(0, '#030910');
  hull.addColorStop(0.28, shipClass === 'heavy' ? '#2a1308' : '#0b2530');
  hull.addColorStop(0.56, shipClass === 'heavy' ? '#a84917' : shipClass === 'guardian' ? '#1b8f70' : '#1a8ca1');
  hull.addColorStop(0.78, '#efffff');
  hull.addColorStop(1, secondary);

  g.globalCompositeOperation = 'screen';
  g.shadowColor = accent;
  g.shadowBlur = shipClass === 'heavy' ? 22 : 26;
  g.fillStyle = colourWithAlpha(accent, shipClass === 'interceptor' ? 0.14 : 0.18);
  g.beginPath();
  g.ellipse(
    shipClass === 'interceptor' ? 13 : 7,
    0,
    shipClass === 'heavy' ? 74 : 79,
    shipClass === 'heavy' ? 34 : shipClass === 'guardian' ? 29 : 23,
    0,
    0,
    Math.PI * 2,
  );
  g.fill();

  g.globalCompositeOperation = 'source-over';
  g.shadowBlur = 14;
  g.fillStyle = hull;
  g.strokeStyle = '#f6ffff';
  g.lineWidth = shipClass === 'heavy' ? 2.8 : 2.2;
  g.beginPath();
  if (shipClass === 'interceptor') {
    g.moveTo(84, 0);
    g.lineTo(38, -13);
    g.lineTo(-42, -16);
    g.lineTo(-76, -6);
    g.lineTo(-52, 0);
    g.lineTo(-76, 6);
    g.lineTo(-42, 16);
    g.lineTo(38, 13);
  } else if (shipClass === 'heavy') {
    g.moveTo(72, 0);
    g.lineTo(42, -23);
    g.lineTo(-38, -30);
    g.lineTo(-76, -18);
    g.lineTo(-69, 0);
    g.lineTo(-76, 18);
    g.lineTo(-38, 30);
    g.lineTo(42, 23);
  } else {
    g.moveTo(78, 0);
    g.lineTo(35, -19);
    g.lineTo(-32, -23);
    g.lineTo(-67, -12);
    g.lineTo(-42, 0);
    g.lineTo(-67, 12);
    g.lineTo(-32, 23);
    g.lineTo(35, 19);
  }
  g.closePath();
  g.fill();
  g.stroke();

  g.save();
  g.globalCompositeOperation = 'screen';
  g.shadowColor = accent;
  g.shadowBlur = 14;
  g.fillStyle = colourWithAlpha(accent, shipClass === 'heavy' ? 0.42 : 0.32);
  g.strokeStyle = colourWithAlpha(secondary, 0.86);
  g.lineWidth = shipClass === 'heavy' ? 2 : 1.4;
  if (shipClass === 'interceptor') {
    for (const side of [-1, 1] as const) {
      g.beginPath();
      g.moveTo(-8, side * 10);
      g.lineTo(-60, side * 34);
      g.lineTo(-28, side * 14);
      g.closePath();
      g.fill();
      g.stroke();
    }
    g.strokeStyle = '#fff5d8';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(42, 0);
    g.lineTo(88, 0);
    g.stroke();
  } else if (shipClass === 'heavy') {
    for (const side of [-1, 1] as const) {
      g.beginPath();
      g.moveTo(10, side * 16);
      g.lineTo(-52, side * 40);
      g.lineTo(-70, side * 25);
      g.lineTo(-22, side * 17);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = colourWithAlpha('#030910', 0.72);
      g.fillRect(-48, side * 22 - 4, 32, 8);
      g.fillStyle = colourWithAlpha(accent, 0.42);
    }
    g.strokeStyle = '#ffd84a';
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(47, -5);
    g.lineTo(83, -5);
    g.moveTo(47, 5);
    g.lineTo(83, 5);
    g.stroke();
  } else {
    for (const side of [-1, 1] as const) {
      g.beginPath();
      g.ellipse(-9, side * 25, 21, 7, side * 0.1, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.beginPath();
      g.arc(-9, side * 25, 12, 0, Math.PI * 2);
      g.stroke();
    }
  }
  g.restore();

  g.save();
  g.globalCompositeOperation = 'screen';
  g.shadowColor = accent;
  g.shadowBlur = 16;
  for (const side of [-1, 1] as const) {
    const rail = g.createLinearGradient(-48, side * 18, 56, side * 7);
    rail.addColorStop(0, colourWithAlpha(accent, 0.1));
    rail.addColorStop(0.56, colourWithAlpha(accent, 0.95));
    rail.addColorStop(1, '#fff5d8');
    g.strokeStyle = rail;
    g.lineWidth = shipClass === 'heavy' ? 2.8 : 2.1;
    g.beginPath();
    if (shipClass === 'interceptor') {
      g.moveTo(-58, side * 10);
      g.quadraticCurveTo(-6, side * 24, 63, side * 4);
    } else if (shipClass === 'heavy') {
      g.moveTo(-58, side * 22);
      g.quadraticCurveTo(-7, side * 36, 53, side * 12);
    } else {
      g.moveTo(-49, side * 15);
      g.quadraticCurveTo(-3, side * 31, 58, side * 7);
    }
    g.stroke();
  }
  g.fillStyle = '#fff5d8';
  g.shadowColor = '#fff5d8';
  const lightCount = shipClass === 'interceptor' ? 10 : shipClass === 'heavy' ? 6 : 8;
  const lightStep = shipClass === 'interceptor' ? 7.5 : shipClass === 'heavy' ? 11 : 9.4;
  for (let i = 0; i < lightCount; i += 1) g.fillRect(-35 + i * lightStep, -2, shipClass === 'heavy' ? 5.8 : 4.6, 4);
  g.restore();

  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(2,4,11,0.66)';
  g.lineWidth = shipClass === 'heavy' ? 2.4 : 1.9;
  g.beginPath();
  if (shipClass === 'interceptor') {
    g.moveTo(-38, -7);
    g.lineTo(36, 0);
    g.lineTo(-38, 7);
    g.moveTo(-61, -4);
    g.lineTo(-37, 0);
    g.lineTo(-61, 4);
  } else if (shipClass === 'heavy') {
    g.moveTo(-33, -15);
    g.lineTo(20, 0);
    g.lineTo(-33, 15);
    g.moveTo(-61, -11);
    g.lineTo(-36, 0);
    g.lineTo(-61, 11);
  } else {
    g.moveTo(-31, -11);
    g.lineTo(24, 0);
    g.lineTo(-31, 11);
    g.moveTo(-54, -7);
    g.lineTo(-29, 0);
    g.lineTo(-54, 7);
  }
  g.stroke();

  const canopyX = shipClass === 'heavy' ? 14 : shipClass === 'interceptor' ? 30 : 22;
  const canopyY = shipClass === 'heavy' ? -4 : -8;
  const canopy = g.createRadialGradient(canopyX, canopyY, 1, canopyX - 2, canopyY + 3, 22);
  canopy.addColorStop(0, '#efffff');
  canopy.addColorStop(0.42, '#7dfff2');
  canopy.addColorStop(1, colourWithAlpha('#5effdb', 0.14));
  g.fillStyle = canopy;
  g.shadowColor = '#5effdb';
  g.shadowBlur = 17;
  g.beginPath();
  g.ellipse(canopyX - 4, canopyY + 3, shipClass === 'heavy' ? 14 : shipClass === 'interceptor' ? 15 : 17, shipClass === 'heavy' ? 8 : 7, -0.16, 0, Math.PI * 2);
  g.fill();

  g.strokeStyle = secondary;
  g.lineWidth = shipClass === 'heavy' ? 1.7 : 1.2;
  g.beginPath();
  g.moveTo(shipClass === 'heavy' ? 64 : 66, 0);
  g.lineTo(shipClass === 'interceptor' ? 91 : 83, 0);
  g.stroke();
}

function drawHunter(g: CanvasRenderingContext2D): void {
  drawGlow(g, '#ff8a3a', 70, 28);
  const body = g.createLinearGradient(-62, -28, 66, 24);
  body.addColorStop(0, '#260a03');
  body.addColorStop(0.32, '#b73812');
  body.addColorStop(0.66, '#ff8a3a');
  body.addColorStop(1, '#fff5d8');
  g.fillStyle = body;
  g.strokeStyle = '#ffd84a';
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(72, 0);
  g.lineTo(-38, -27);
  g.lineTo(-13, 0);
  g.lineTo(-38, 27);
  g.closePath();
  g.fill();
  g.stroke();
  for (const side of [-1, 1] as const) drawBlade(g, -28, side * 13, -72, side * 38, '#ffd84a', '#ff4d5e');
  drawLens(g, 18, -3, 15, 6, '#5effdb');
  drawEnginePods(g, -52, '#ff4d5e');
  drawPanelPins(g, '#ffd84a');
}

function drawAbductor(g: CanvasRenderingContext2D): void {
  drawGlow(g, '#ff4d5e', 72, 31);
  const body = g.createLinearGradient(-68, -31, 62, 28);
  body.addColorStop(0, '#29070f');
  body.addColorStop(0.45, '#bd2331');
  body.addColorStop(0.76, '#ff4d5e');
  body.addColorStop(1, '#ffd84a');
  g.fillStyle = body;
  g.strokeStyle = '#ff9ab9';
  g.lineWidth = 2.1;
  g.beginPath();
  g.moveTo(58, 0);
  g.lineTo(24, -24);
  g.lineTo(-30, -32);
  g.lineTo(-69, -8);
  g.lineTo(-42, 0);
  g.lineTo(-69, 8);
  g.lineTo(-30, 32);
  g.lineTo(24, 24);
  g.closePath();
  g.fill();
  g.stroke();
  g.save();
  g.globalCompositeOperation = 'screen';
  g.strokeStyle = '#ffd84a';
  g.lineWidth = 1.8;
  for (const side of [-1, 1] as const) {
    g.beginPath();
    g.moveTo(-8, side * 15);
    g.quadraticCurveTo(28, side * 36, 55, side * 21);
    g.stroke();
  }
  g.restore();
  drawLens(g, 16, -8, 16, 6, '#fff2a8');
  drawEnginePods(g, -57, '#ff4d5e');
  drawPanelPins(g, '#5effdb');
}

function drawJammer(g: CanvasRenderingContext2D): void {
  drawGlow(g, '#5f7cff', 72, 37);
  const body = g.createLinearGradient(-58, -33, 61, 33);
  body.addColorStop(0, '#05091f');
  body.addColorStop(0.42, '#2133a4');
  body.addColorStop(0.78, '#5f7cff');
  body.addColorStop(1, '#b6c7ff');
  g.fillStyle = body;
  g.strokeStyle = '#b6c7ff';
  g.lineWidth = 2;
  roundedRect(g, -52, -26, 104, 52, 8);
  g.fill();
  g.stroke();
  for (const side of [-1, 1] as const) {
    drawBlade(g, -20, side * 18, -76, side * 43, '#5effdb', '#5f7cff');
    drawBlade(g, 21, side * 14, 72, side * 30, '#b6c7ff', '#5effdb');
  }
  g.save();
  g.globalCompositeOperation = 'screen';
  g.strokeStyle = '#5effdb';
  g.lineWidth = 2.2;
  for (let i = 0; i < 4; i += 1) {
    g.beginPath();
    g.moveTo(-44, -18 + i * 12);
    g.lineTo(44, -14 + i * 10);
    g.stroke();
  }
  g.restore();
  drawLens(g, 18, 0, 13, 12, '#ffd84a');
}

function drawForgery(g: CanvasRenderingContext2D): void {
  drawGlow(g, '#ff3aff', 70, 34);
  g.strokeStyle = '#ff3aff';
  g.fillStyle = 'rgba(255,58,255,0.34)';
  g.lineWidth = 2.1;
  g.beginPath();
  g.moveTo(66, -2);
  g.lineTo(27, -35);
  g.lineTo(-22, -24);
  g.lineTo(-70, -2);
  g.lineTo(-20, 24);
  g.lineTo(18, 35);
  g.closePath();
  g.fill();
  g.stroke();
  g.save();
  g.globalCompositeOperation = 'screen';
  for (let i = 0; i < 10; i += 1) {
    g.fillStyle = i % 3 === 0 ? '#ffd84a' : i % 2 === 0 ? '#5effdb' : '#ff3aff';
    g.globalAlpha = 0.62;
    g.fillRect(-58 + i * 12, -28 + (i % 5) * 13, 18, 3);
  }
  g.restore();
  drawLens(g, 18, 0, 13, 6, '#ffb8ff');
}

function drawSpammer(g: CanvasRenderingContext2D): void {
  drawGlow(g, '#8f5bff', 70, 33);
  const body = g.createLinearGradient(-60, -30, 58, 28);
  body.addColorStop(0, '#120726');
  body.addColorStop(0.4, '#4a1d9e');
  body.addColorStop(0.74, '#8f5bff');
  body.addColorStop(1, '#dcc8ff');
  g.fillStyle = body;
  g.strokeStyle = '#c9a8ff';
  g.lineWidth = 2.1;
  g.beginPath();
  g.moveTo(52, 0);
  g.lineTo(34, -20);
  g.lineTo(-14, -30);
  g.lineTo(-52, -16);
  g.lineTo(-60, 0);
  g.lineTo(-52, 16);
  g.lineTo(-14, 30);
  g.lineTo(34, 20);
  g.closePath();
  g.fill();
  g.stroke();
  g.save();
  g.globalCompositeOperation = 'screen';
  g.strokeStyle = '#5effdb';
  g.lineWidth = 1.6;
  for (const [mx, tip] of [[-30, -46], [-6, -50], [18, -44]] as const) {
    g.beginPath();
    g.moveTo(mx, -24);
    g.lineTo(mx + 4, tip);
    g.stroke();
    g.fillStyle = '#c9a8ff';
    g.shadowColor = '#c9a8ff';
    g.shadowBlur = 10;
    g.beginPath();
    g.arc(mx + 4, tip, 3.2, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  g.save();
  g.globalCompositeOperation = 'screen';
  g.strokeStyle = '#b14dff';
  g.fillStyle = colourWithAlpha('#b14dff', 0.4);
  g.shadowColor = '#b14dff';
  g.shadowBlur = 14;
  g.lineWidth = 1.8;
  g.beginPath();
  g.arc(-4, 26, 9, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(-16, 33);
  g.lineTo(8, 33);
  g.stroke();
  g.restore();
  drawLens(g, 20, -6, 13, 6, '#c9a8ff');
  drawEnginePods(g, -50, '#8f5bff');
  drawPanelPins(g, '#5effdb');
}

function drawSybil(g: CanvasRenderingContext2D): void {
  drawGlow(g, '#ff5ad1', 66, 36);
  const orbs: ReadonlyArray<readonly [number, number, number]> = [
    [0, 0, 22],
    [34, -18, 12],
    [36, 16, 11],
    [-30, -22, 12],
    [-34, 18, 13],
  ];
  g.save();
  g.globalCompositeOperation = 'screen';
  g.strokeStyle = colourWithAlpha('#ff9ce2', 0.66);
  g.lineWidth = 1.6;
  for (let i = 1; i < orbs.length; i += 1) {
    g.beginPath();
    g.moveTo(orbs[0]![0], orbs[0]![1]);
    g.lineTo(orbs[i]![0], orbs[i]![1]);
    g.stroke();
  }
  g.restore();
  for (let i = 0; i < orbs.length; i += 1) {
    const [ox, oy, r] = orbs[i]!;
    const orb = g.createRadialGradient(ox - r * 0.3, oy - r * 0.35, 1, ox, oy, r * 1.15);
    orb.addColorStop(0, '#fff0fa');
    orb.addColorStop(0.4, i === 0 ? '#ff5ad1' : '#e23fb0');
    orb.addColorStop(1, '#3a0b2c');
    g.fillStyle = orb;
    g.strokeStyle = '#ffb1e8';
    g.lineWidth = i === 0 ? 2 : 1.4;
    g.shadowColor = '#ff5ad1';
    g.shadowBlur = i === 0 ? 18 : 10;
    g.beginPath();
    g.arc(ox, oy, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  g.save();
  g.globalCompositeOperation = 'screen';
  g.fillStyle = '#ffd84a';
  g.shadowColor = '#ffd84a';
  g.shadowBlur = 9;
  for (const [ox, oy] of [[34, -18], [-34, 18], [36, 16], [-30, -22]] as const) {
    g.beginPath();
    g.arc(ox, oy, 2.4, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  drawLens(g, 4, -4, 10, 8, '#ffb1e8');
}

export function drawTroll(g: CanvasRenderingContext2D): void {
  // The community donkey mascot, corrupted into a fat-cat bankster: dark
  // pinstripe hide, long donkey ears, a top hat, a monocle and a cigar.
  // The toxic-green aura/eye-glow is the only thing the old troll kept —
  // that's the "corruption" tell, and feeding state reuses the same glow.
  drawGlow(g, '#96ff3c', 68, 38);
  const body = g.createRadialGradient(-14, -14, 6, 0, 0, 46);
  body.addColorStop(0, '#4c525c');
  body.addColorStop(0.3, '#33383f');
  body.addColorStop(0.72, '#17191d');
  body.addColorStop(1, '#050506');
  g.fillStyle = body;
  g.strokeStyle = '#d4af37';
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(48, 4);
  g.quadraticCurveTo(44, -22, 22, -30);
  g.quadraticCurveTo(12, -42, -2, -32);
  g.quadraticCurveTo(-30, -38, -44, -18);
  g.quadraticCurveTo(-58, 0, -44, 18);
  g.quadraticCurveTo(-34, 34, -8, 34);
  g.quadraticCurveTo(18, 38, 34, 26);
  g.quadraticCurveTo(50, 18, 48, 4);
  g.closePath();
  g.fill();
  g.stroke();

  // Gold pinstripes across the suit.
  g.save();
  g.strokeStyle = colourWithAlpha('#d4af37', 0.5);
  g.lineWidth = 1.4;
  for (let i = 0; i < 4; i += 1) {
    g.beginPath();
    g.moveTo(-40 + i * 20, -30);
    g.lineTo(-30 + i * 20, 32);
    g.stroke();
  }
  g.restore();

  // Long donkey ears, swept back, dark hide with a soft pink inner ear.
  // Tips stay above -52 — the cached sprite canvas is only 104 tall (±52).
  for (const [hx, hy, tx, ty, side] of [[-16, -32, -24, -51, -1], [10, -33, 18, -52, 1]] as const) {
    g.beginPath();
    g.moveTo(hx - 7, hy + 6);
    g.quadraticCurveTo(hx + side * 4 - 10, (hy + ty) / 2, tx, ty);
    g.quadraticCurveTo(hx + side * 4 + 10, (hy + ty) / 2, hx + 8, hy + 2);
    g.closePath();
    g.fillStyle = '#25282d';
    g.fill();
    g.strokeStyle = '#d4af37';
    g.lineWidth = 1.6;
    g.stroke();
    g.beginPath();
    g.moveTo(hx - 2, hy + 2);
    g.quadraticCurveTo(hx + side * 4, (hy + ty) / 2 + 4, tx + side * -2, ty + 6);
    g.quadraticCurveTo(hx + side * 4 + 4, (hy + ty) / 2 + 4, hx + 4, hy);
    g.closePath();
    g.fillStyle = '#7a4a52';
    g.fill();
  }

  // Top hat, resting low on the head between the ear bases (kept within the
  // cached sprite canvas's ±52 vertical bound — no room for a tall stovepipe).
  g.fillStyle = '#0a0a0b';
  g.strokeStyle = '#d4af37';
  g.lineWidth = 1.6;
  roundedRect(g, -14, -40, 24, 6, 2);
  g.fill();
  g.stroke();
  roundedRect(g, -10, -50, 16, 12, 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#d4af37';
  g.fillRect(-10, -41, 16, 2.4);

  // Snout: pale muzzle patch at the front with two nostril dots.
  const snout = g.createRadialGradient(38, 14, 2, 38, 14, 16);
  snout.addColorStop(0, '#e8d9b8');
  snout.addColorStop(1, '#b8a172');
  g.fillStyle = snout;
  g.beginPath();
  g.ellipse(36, 14, 15, 11, 0.1, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#8a7550';
  g.lineWidth = 1.4;
  g.stroke();
  g.fillStyle = '#3a2f1e';
  for (const ny of [10, 18] as const) {
    g.beginPath();
    g.ellipse(44, ny, 1.8, 2.6, 0, 0, Math.PI * 2);
    g.fill();
  }

  // Grin under the snout, with one gold tooth for the bankster tell.
  g.fillStyle = '#0a1a02';
  g.strokeStyle = '#96ff3c';
  g.lineWidth = 1.8;
  g.beginPath();
  g.moveTo(44, 8);
  g.quadraticCurveTo(20, 26, -8, 22);
  g.quadraticCurveTo(16, 9, 44, 8);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = '#fff5d8';
  for (let i = 0; i < 4; i += 1) {
    const tx = 36 - i * 11;
    const ty = 11 + i * 2.4;
    g.beginPath();
    g.moveTo(tx, ty);
    g.lineTo(tx - 4, ty + 7);
    g.lineTo(tx - 8, ty + 1);
    g.closePath();
    g.fillStyle = i === 1 ? '#d4af37' : '#fff5d8';
    g.fill();
  }

  // Cigar, clamped in the corner of the mouth. Outlined so it doesn't melt
  // into the dark suit hide behind it.
  g.save();
  g.translate(38, 20);
  g.rotate(0.34);
  g.fillStyle = '#8a6338';
  g.strokeStyle = '#d4af37';
  g.lineWidth = 1;
  roundedRect(g, -2, -3, 16, 6, 2.4);
  g.fill();
  g.stroke();
  g.fillStyle = '#ffd84a';
  roundedRect(g, 10, -3, 4, 6, 1.6);
  g.fill();
  g.save();
  g.globalCompositeOperation = 'screen';
  g.fillStyle = '#ff8a3a';
  g.shadowColor = '#ff8a3a';
  g.shadowBlur = 8;
  g.beginPath();
  g.arc(15, 0, 2.2, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.restore();

  // Monocle over the corrupted eye, with a thin chain to the lapel.
  drawLens(g, 8, -16, 11, 8, '#d4ffb0');
  g.strokeStyle = '#d4af37';
  g.lineWidth = 1.8;
  g.beginPath();
  g.ellipse(8, -16, 12, 9, -0.08, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(17, -10);
  g.quadraticCurveTo(26, 4, 20, 24);
  g.strokeStyle = colourWithAlpha('#d4af37', 0.7);
  g.lineWidth = 1.2;
  g.stroke();

  // A couple of glowing corruption cracks left over from the old troll hide.
  g.save();
  g.globalCompositeOperation = 'screen';
  g.fillStyle = colourWithAlpha('#96ff3c', 0.75);
  for (const [wx, wy, wr] of [[-30, 8, 2.6], [-38, -6, 2.2]] as const) {
    g.beginPath();
    g.arc(wx, wy, wr, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  drawEnginePods(g, -48, '#96ff3c');
}

function drawCarrier(g: CanvasRenderingContext2D): void {
  drawGlow(g, '#ff2f7a', 128, 52);
  const hull = g.createLinearGradient(-132, -58, 130, 56);
  hull.addColorStop(0, '#170414');
  hull.addColorStop(0.36, '#5b1237');
  hull.addColorStop(0.7, '#ff2f7a');
  hull.addColorStop(1, '#ffd5e5');
  g.fillStyle = hull;
  g.strokeStyle = '#ff9ab9';
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(132, 0);
  g.lineTo(62, -55);
  g.lineTo(-68, -48);
  g.lineTo(-134, 0);
  g.lineTo(-68, 48);
  g.lineTo(62, 55);
  g.closePath();
  g.fill();
  g.stroke();
  g.save();
  g.globalCompositeOperation = 'screen';
  g.fillStyle = 'rgba(2,4,11,0.68)';
  roundedRect(g, -92, -38, 132, 20, 4);
  g.fill();
  roundedRect(g, -92, 18, 132, 20, 4);
  g.fill();
  g.strokeStyle = '#5effdb';
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(-98, 0);
  g.lineTo(96, 0);
  g.stroke();
  g.fillStyle = '#ffd84a';
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 5; i += 1) {
      g.beginPath();
      g.arc(-72 + i * 38, side * 54, 4.8, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
  drawLens(g, 68, 0, 22, 9, '#b6c7ff');
  drawEnginePods(g, -124, '#ff8a3a');
}

function drawGlow(g: CanvasRenderingContext2D, colour: string, rx: number, ry: number): void {
  g.save();
  g.globalCompositeOperation = 'screen';
  g.shadowColor = colour;
  g.shadowBlur = 28;
  g.fillStyle = colourWithAlpha(colour, 0.22);
  g.beginPath();
  g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function drawBlade(g: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, fill: string, stroke: string): void {
  g.save();
  g.globalCompositeOperation = 'screen';
  g.fillStyle = colourWithAlpha(fill, 0.48);
  g.strokeStyle = stroke;
  g.shadowColor = fill;
  g.shadowBlur = 13;
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(ax, ay);
  g.lineTo(bx, by);
  g.lineTo((ax + bx) * 0.5, ay * 0.45);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
}

function drawLens(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, colour: string): void {
  const lens = g.createRadialGradient(x - rx * 0.25, y - ry * 0.4, 1, x, y, rx * 1.25);
  lens.addColorStop(0, '#fff5d8');
  lens.addColorStop(0.42, colour);
  lens.addColorStop(1, colourWithAlpha(colour, 0.12));
  g.save();
  g.globalCompositeOperation = 'screen';
  g.fillStyle = lens;
  g.shadowColor = colour;
  g.shadowBlur = 14;
  g.beginPath();
  g.ellipse(x, y, rx, ry, -0.08, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function drawEnginePods(g: CanvasRenderingContext2D, x: number, colour: string): void {
  g.save();
  g.globalCompositeOperation = 'screen';
  g.fillStyle = colour;
  g.shadowColor = colour;
  g.shadowBlur = 15;
  for (const side of [-1, 1] as const) {
    g.beginPath();
    g.ellipse(x, side * 12, 8, 4, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function drawPanelPins(g: CanvasRenderingContext2D, colour: string): void {
  g.save();
  g.globalCompositeOperation = 'screen';
  g.fillStyle = colour;
  g.shadowColor = colour;
  g.shadowBlur = 9;
  for (let i = 0; i < 5; i += 1) {
    g.beginPath();
    g.arc(-34 + i * 16, 14 + (i % 2) * 5, 2.4, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function roundedRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

function enemyColour(type: SpriteEnemyType): string {
  if (type === 'carrier') return '#ff2f7a';
  if (type === 'hunter') return '#ff8a3a';
  if (type === 'jammer') return '#5f7cff';
  if (type === 'forgery') return '#ff3aff';
  if (type === 'spammer') return '#8f5bff';
  if (type === 'sybil') return '#ff5ad1';
  if (type === 'troll') return '#96ff3c';
  return '#ff4d5e';
}

function colourWithAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}
