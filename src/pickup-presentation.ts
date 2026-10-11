// Shared code-native art: cached as a billboard in 3D, drawn directly in vector.
export function drawPickupFrame(ctx: CanvasRenderingContext2D, radius: number, colour: string, danger = false): void {
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = colour;
  ctx.globalAlpha *= 0.22;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha *= 3.4;
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + i * Math.PI / 2;
    ctx.beginPath();
    ctx.arc(0, 0, radius, angle - 0.19, angle + 0.19);
    ctx.stroke();
  }
  // A trap keeps a red diamond; valuable objects have open signal brackets.
  if (danger) {
    ctx.beginPath();
    ctx.moveTo(0, -radius - 5);
    ctx.lineTo(4, -radius - 1);
    ctx.lineTo(0, -radius + 3);
    ctx.lineTo(-4, -radius - 1);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
  }
  ctx.restore();
}

export function drawValuePickupFallback(ctx: CanvasRenderingContext2D, kind: 'rose' | 'cake-piece' | 'whole-cake'): void {
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.lineJoin = 'round';
  if (kind === 'rose') {
    ctx.strokeStyle = '#51bf92';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, 12); ctx.quadraticCurveTo(-8, 29, -4, 42); ctx.stroke();
    ctx.fillStyle = '#51bf92';
    ctx.beginPath(); ctx.ellipse(8, 24, 12, 4, -0.55, 0, Math.PI*2); ctx.fill();
    for (let i = 6; i >= 0; i--) {
      const angle = i*2.4;
      ctx.fillStyle = i%2 ? '#b51e52' : '#ff4d8d';
      ctx.strokeStyle = '#ff94b5'; ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.ellipse(Math.cos(angle)*9, -8+Math.sin(angle)*7, 16-i*0.7, 9, angle, 0, Math.PI*2);
      ctx.fill(); ctx.stroke();
    }
  } else {
    const whole = kind === 'whole-cake';
    for (let layer = 0; layer < 3; layer++) {
      const y = layer*10;
      ctx.fillStyle = layer%2 ? '#fff3da' : '#ed9d24';
      ctx.strokeStyle = '#ffe2a3'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-32,y-15); ctx.lineTo(whole ? 32 : 34, y-15);
      ctx.lineTo(whole ? 32 : 8, y+2); ctx.lineTo(-32,y+2); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#fff5e1';
    ctx.beginPath(); ctx.ellipse(0,-15,33,whole ? 9 : 5,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#ffc04a';
    ctx.font = '900 11px ui-monospace, monospace'; ctx.textAlign = 'center';
    ctx.fillText('600B',0,-12);
  }
  ctx.restore();
}
