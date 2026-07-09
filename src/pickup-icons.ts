// Pickup icon art shared between the vector (2D canvas) and mesh (3D billboard)
// render tiers. Some pickups only ever read as their intended shape via a
// specific procedural drawing or sprite image — rather than maintain a second,
// drifting interpretation in 3D, both tiers draw the exact same icon.

const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

export const ROSE_PICKUP_URL = '/pickups/600b/rose.png';
export const CAKE_PICKUP_URLS = [
  '/pickups/600b/cake-piece-1.png',
  '/pickups/600b/cake-piece-2.png',
  '/pickups/600b/cake-piece-3.png',
  '/pickups/600b/cake-piece-4.png',
  '/pickups/600b/cake-piece-5.png',
  '/pickups/600b/cake-piece-6.png',
] as const;
export const WHOLE_CAKE_PICKUP_URL = '/pickups/600b/whole-cake.png';

export function drawCultBeacon(rot: number, pulse: number, ctx: CanvasRenderingContext2D): void {
  // Definitely-not-a-cult pickup: swaying hooded figure with glowing eyes
  // under a red prohibition ring. The joke IS the pickup.
  ctx.save();
  ctx.rotate(Math.sin(rot * 0.6) * 0.07);
  ctx.fillStyle = '#3c2264';
  ctx.strokeStyle = '#c58bff';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(0, -28);
  ctx.quadraticCurveTo(-22, -6, -18, 24);
  ctx.lineTo(18, 24);
  ctx.quadraticCurveTo(22, -6, 0, -28);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#100420';
  ctx.beginPath();
  ctx.ellipse(0, -8, 10, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ff9ce2';
  ctx.globalAlpha = 0.55 + pulse * 0.45;
  ctx.beginPath();
  ctx.arc(-4, -9, 2, 0, Math.PI * 2);
  ctx.arc(4, -9, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,77,94,0.92)';
  ctx.lineWidth = 3.6;
  ctx.beginPath();
  ctx.arc(0, 0, 36 + pulse * 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-26 - pulse * 1.4, -26 - pulse * 1.4);
  ctx.lineTo(26 + pulse * 1.4, 26 + pulse * 1.4);
  ctx.stroke();
}

export function drawFourTwentyBeacon(rot: number, pulse: number, ctx: CanvasRenderingContext2D): void {
  // 4:20 pocket watch, lifted from Pallasite's 600bn-mode coin reverse (a
  // heritage clock face frozen at 4:20pm, the time-lock motif) rather than
  // the bitcoin/rose/cake engraved face this used to have.
  ctx.save();
  ctx.rotate(Math.sin(rot * 0.5) * 0.09);
  ctx.fillStyle = '#d9a94a';
  ctx.fillRect(-4, -43, 8, 8);
  ctx.strokeStyle = '#d9a94a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, -48, 5, 0, Math.PI * 2);
  ctx.stroke();
  const casing = ctx.createRadialGradient(-4, -4, 2, 0, 0, 34);
  casing.addColorStop(0, '#fff6c0');
  casing.addColorStop(0.5, '#ffd84a');
  casing.addColorStop(1, '#8a5800');
  ctx.fillStyle = casing;
  ctx.beginPath();
  ctx.arc(0, 0, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#5a3a00';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 33, 0, Math.PI * 2);
  ctx.stroke();
  // Hour ticks — 12 around the dial, cardinals (12/3/6/9) drawn bolder.
  ctx.strokeStyle = '#0a0418';
  ctx.lineCap = 'butt';
  for (let h = 0; h < 12; h += 1) {
    const angle = (h / 12) * Math.PI * 2 - Math.PI / 2;
    const cardinal = h % 3 === 0;
    const r1 = cardinal ? 25 : 28;
    const r2 = 32;
    ctx.lineWidth = cardinal ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * r1, Math.sin(angle) * r1);
    ctx.lineTo(Math.cos(angle) * r2, Math.sin(angle) * r2);
    ctx.stroke();
  }
  // Roman numerals at the cardinals — heritage-clock feel over wristwatch.
  ctx.fillStyle = '#0a0418';
  ctx.font = `700 7px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('XII', 0, -22);
  ctx.fillText('III', 22, 0);
  ctx.fillText('VI', 0, 22);
  ctx.fillText('IX', -22, 0);
  // "TIME LOCKED" wordmark above centre.
  ctx.font = `700 5px ${FONT_MONO}`;
  ctx.fillStyle = '#3a2400';
  ctx.fillText('TIME LOCKED', 0, -12);
  // Hands at 4:20. Canvas angle = degrees-clockwise-from-top minus 90°.
  const minuteA = (120 - 90) * Math.PI / 180;
  const hourA = (130 - 90) * Math.PI / 180;
  ctx.strokeStyle = '#0a0418';
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(minuteA) * 21, Math.sin(minuteA) * 21);
  ctx.stroke();
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(hourA) * 14, Math.sin(hourA) * 14);
  ctx.stroke();
  ctx.fillStyle = '#0a0418';
  ctx.beginPath();
  ctx.arc(0, 0, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd84a';
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(140,255,90,${(0.3 + pulse * 0.3).toFixed(3)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 40, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function drawScooterBeacon(rot: number, pulse: number, ctx: CanvasRenderingContext2D): void {
  // DNI's ride, side on: a proper Vespa-type moped — rounded rear cowl,
  // step-through frame, tall front leg-shield, handlebar and headlight.
  // Handle with care, the CEO has history (hence the get-well cross).
  ctx.save();
  ctx.rotate(Math.sin(rot * 0.7) * 0.05);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Wheels first, so the fenders/cowl overlap them.
  for (const wx of [-19, 21] as const) {
    ctx.fillStyle = '#0a1622';
    ctx.beginPath();
    ctx.arc(wx, 21, 7.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#7dcfff';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(wx, 21, 7.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(125,207,255,0.5)';
    ctx.beginPath();
    ctx.arc(wx, 21, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Body silhouette: rear cowl → seat → step-through dip → front leg-shield →
  // nose → floorboard back to the rear.
  const body = ctx.createLinearGradient(0, -18, 0, 14);
  body.addColorStop(0, '#c7ecff');
  body.addColorStop(0.5, '#3f8fc9');
  body.addColorStop(1, '#153f66');
  ctx.fillStyle = body;
  ctx.strokeStyle = '#d6f2ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-31, 12);
  ctx.quadraticCurveTo(-35, 2, -29, -7);
  ctx.quadraticCurveTo(-23, -16, -12, -15);
  ctx.lineTo(-4, -15);
  ctx.quadraticCurveTo(3, -14, 5, -6);
  ctx.quadraticCurveTo(7, 1, 10, 7);
  ctx.lineTo(12, 8);
  ctx.quadraticCurveTo(13, -3, 16, -11);
  ctx.quadraticCurveTo(19, -19, 25, -16);
  ctx.quadraticCurveTo(29, -14, 27, -3);
  ctx.quadraticCurveTo(26, 5, 22, 12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Seat cushion on top of the rear cowl.
  ctx.fillStyle = '#0e2438';
  ctx.beginPath();
  ctx.moveTo(-14, -15);
  ctx.quadraticCurveTo(-14, -19, -8, -19);
  ctx.lineTo(-4, -19);
  ctx.quadraticCurveTo(-1, -19, -2, -15);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(125,207,255,0.7)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Front fender curling over the front wheel.
  ctx.strokeStyle = '#9fdcff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(21, 21, 12, -Math.PI * 0.92, -Math.PI * 0.12);
  ctx.stroke();

  // Handlebar stalk rising from the leg-shield, with a grip.
  ctx.strokeStyle = '#d6f2ff';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(24, -15);
  ctx.lineTo(31, -22);
  ctx.stroke();
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(28, -23);
  ctx.lineTo(34, -21);
  ctx.stroke();

  // Headlight on the front of the leg-shield, glowing with the pulse.
  const glow = 0.55 + pulse * 0.45;
  ctx.fillStyle = `rgba(255,245,216,${glow.toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(25, -5, 2.8, 0, Math.PI * 2);
  ctx.fill();

  // Get-well cross near the rear — the "handle with care" DNI nod.
  const flash = 0.4 + pulse * 0.5;
  ctx.strokeStyle = `rgba(255,138,138,${flash.toFixed(3)})`;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(-28, -16);
  ctx.lineTo(-20, -16);
  ctx.moveTo(-24, -20);
  ctx.lineTo(-24, -12);
  ctx.stroke();
  ctx.restore();
}

export function drawShieldBeacon(rot: number, pulse: number, ctx: CanvasRenderingContext2D): void {
  const face = Math.abs(Math.cos(rot));
  const bodyW = 18 + face * 46;
  ctx.save();
  ctx.rotate(Math.sin(rot * 0.45) * 0.14);
  ctx.globalCompositeOperation = 'screen';
  const body = ctx.createRadialGradient(-bodyW * 0.18, -12, 4, 0, 0, 34);
  body.addColorStop(0, '#fffdf4');
  body.addColorStop(0.24, '#5effdb');
  body.addColorStop(0.7, '#06475a');
  body.addColorStop(1, '#02040b');
  ctx.fillStyle = body;
  ctx.strokeStyle = '#fff5d8';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(0, -34 - pulse * 2);
  ctx.lineTo(bodyW / 2, -16);
  ctx.lineTo(bodyW * 0.34, 24 + pulse);
  ctx.lineTo(0, 38 + pulse);
  ctx.lineTo(-bodyW * 0.34, 24 + pulse);
  ctx.lineTo(-bodyW / 2, -16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,245,216,0.62)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.lineTo(bodyW * 0.26, -10);
  ctx.lineTo(bodyW * 0.18, 18);
  ctx.lineTo(0, 27);
  ctx.lineTo(-bodyW * 0.18, 18);
  ctx.lineTo(-bodyW * 0.26, -10);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

export function drawNetBeacon(rot: number, pulse: number, ctx: CanvasRenderingContext2D): void {
  const face = Math.abs(Math.cos(rot));
  const bodyW = 18 + face * 46;
  ctx.save();
  ctx.rotate(Math.sin(rot * 0.45) * 0.14);
  ctx.globalCompositeOperation = 'screen';
  const body = ctx.createRadialGradient(-bodyW * 0.18, -12, 4, 0, 0, 34);
  body.addColorStop(0, '#f2fff7');
  body.addColorStop(0.26, '#8cffb4');
  body.addColorStop(0.7, '#07532b');
  body.addColorStop(1, '#02040b');
  ctx.fillStyle = body;
  ctx.strokeStyle = '#fff5d8';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.ellipse(0, 0, bodyW / 2, 32 + pulse, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Web lattice: rings and radial threads read as a catch net at a glance.
  ctx.strokeStyle = 'rgba(226,255,238,0.78)';
  ctx.lineWidth = 1.2;
  for (let i = 1; i <= 3; i += 1) {
    ctx.beginPath();
    ctx.ellipse(0, 0, (bodyW / 2) * (i / 3), (30 + pulse) * (i / 3), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * (bodyW / 2), Math.sin(a) * (30 + pulse));
    ctx.stroke();
  }
  ctx.fillStyle = '#fff5d8';
  ctx.beginPath();
  ctx.arc(0, 0, 4 + pulse * 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function draw600bMedallion(rot: number, ctx: CanvasRenderingContext2D): void {
  const coinW = 58 * Math.abs(Math.cos(rot)) + 12;
  const grad = ctx.createRadialGradient(-10, -14, 4, 0, 0, 35);
  grad.addColorStop(0, '#fff1b6');
  grad.addColorStop(0.2, '#ffb142');
  grad.addColorStop(0.62, '#f47316');
  grad.addColorStop(1, '#8d2d07');
  ctx.fillStyle = grad;
  ctx.strokeStyle = '#fff2a8';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.ellipse(0, 0, coinW / 2, 34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (coinW < 25) return;
  ctx.save();
  ctx.scale(Math.max(0.45, coinW / 68), 1);
  ctx.fillStyle = '#fffdf4';
  ctx.font = `900 13px ${FONT_MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('600', 0, -18);
  ctx.fillText('000', 0, -6);
  ctx.fillText('000', 0, 6);
  ctx.fillText('000', 0, 18);
  ctx.restore();
}
