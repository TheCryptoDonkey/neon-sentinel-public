#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';

const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5190/';
const outDir = process.env.SMOKE_OUT_DIR || join(tmpdir(), `neon-sentinel-smoke-${Date.now()}`);
const localTarget = /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:|\/|$)/.test(baseUrl);
const debug = process.env.SMOKE_DEBUG === '1';

const scenarios = [
  {
    name: 'title-desktop',
    path: '/',
    size: '1440,900',
    minNonDark: 0.08,
    minBytes: 620_000,
    timeoutMs: 24_000,
    waitFor: titleReadyExpression(),
  },
  {
    name: 'title-portrait',
    path: '/',
    size: '430,932',
    minNonDark: 0.07,
    minBytes: 250_000,
    timeoutMs: 24_000,
    waitFor: titleReadyExpression(),
  },
  {
    name: 'attract-desktop',
    path: '/?attract',
    size: '1440,900',
    minNonDark: 0.08,
    minBytes: 560_000,
    timeoutMs: 30_000,
    waitFor: `(() => {
      const frame = window.neonSentinelDebugFrame?.();
      return frame?.phase === 'playing'
        && frame.demo === true
        && frame.radar?.ship?.insideVisibleCrop === true;
    })()`,
    settleMs: 500,
  },
  {
    name: 'title-sats-modal',
    path: '/',
    size: '1440,900',
    minNonDark: 0.08,
    minBytes: 650_000,
    timeoutMs: 24_000,
    actions: [clickTitleActionExpression('value-lightning')],
    waitFor: `(() => {
      const frame = window.neonSentinelDebugFrame?.();
      return frame?.phase === 'title'
        && frame.titleMenu?.paymentModalOpen === true
        && String(frame.titleMenu?.valueStatus || '').includes('SCAN QR');
    })()`,
    settleMs: 220,
  },
  {
    name: 'title-v4v-ask',
    path: '/',
    size: '1440,900',
    // The ask dims and blurs the title behind it, so the PNG compresses far
    // smaller than the raw title screens.
    minNonDark: 0.05,
    minBytes: 180_000,
    timeoutMs: 28_000,
    actions: [clickTitleActionExpression('start')],
    waitFor: `(() => {
      const frame = window.neonSentinelDebugFrame?.();
      const overlay = document.getElementById('v4v');
      return frame?.phase === 'title'
        && frame.v4vAskOpen === true
        && overlay instanceof HTMLElement
        && !overlay.hidden
        && String(document.getElementById('v4v-reward')?.textContent || '').includes('PATRONS FIGHT BLESSED');
    })()`,
    settleMs: 300,
  },
  {
    name: 'title-guest-launch',
    path: '/',
    size: '1440,900',
    minNonDark: 0.045,
    minBytes: 520_000,
    timeoutMs: 28_000,
    actions: [clickTitleActionExpression('start'), declineV4vAskExpression()],
    waitFor: `(() => {
      const frame = window.neonSentinelDebugFrame?.();
      return frame?.phase === 'playing'
        && frame.wave >= 1
        && frame.radar?.ship?.insideVisibleCrop === true;
    })()`,
    settleMs: 500,
  },
  {
    name: 'gameover-board-desktop',
    path: '/?gameover',
    size: '1440,900',
    minNonDark: 0.06,
    minBytes: 620_000,
    timeoutMs: 28_000,
    actions: [advanceGameOverToBoardExpression()],
    waitFor: gameoverBoardExpression(),
    settleMs: 350,
  },
  {
    name: 'gameover-daily-desktop',
    path: '/?gameover&daily',
    size: '1440,900',
    minNonDark: 0.06,
    minBytes: 620_000,
    timeoutMs: 28_000,
    actions: [advanceGameOverToBoardExpression()],
    waitFor: gameoverDailyBoardExpression(),
    settleMs: 350,
  },
  {
    name: 'gameover-support-desktop',
    path: '/?gameover&support=1',
    size: '1440,900',
    minNonDark: 0.06,
    minBytes: 500_000,
    timeoutMs: 28_000,
    waitFor: gameoverSupportExpression(),
    settleMs: 350,
  },
  {
    name: 'gameover-support-portrait',
    path: '/?gameover&support=1',
    size: '430,932',
    minNonDark: 0.06,
    minBytes: 180_000,
    timeoutMs: 28_000,
    waitFor: gameoverSupportExpression(),
    settleMs: 350,
  },
  { name: 'combat-desktop', path: '/?combat', size: '1440,900', minNonDark: 0.045, minBytes: 520_000, timeoutMs: 36_000 },
  { name: 'combat-portrait', path: '/?combat', size: '430,932', minNonDark: 0.04, minBytes: 260_000, timeoutMs: 36_000 },
  { name: 'wave4', path: '/?autostart&wave=4', size: '1440,900', minNonDark: 0.04, minBytes: 500_000, timeoutMs: 36_000 },
  {
    name: 'boss-wounded',
    path: '/?autostart&boss&wounded',
    size: '1440,900',
    minNonDark: 0.04,
    minBytes: 500_000,
    timeoutMs: 36_000,
    waitFor: `(() => {
      const frame = window.neonSentinelDebugFrame?.();
      return frame?.phase === 'playing'
        && frame.carrier?.visible === true
        && frame.carrier?.wounded === true;
    })()`,
    settleMs: 350,
  },
  { name: 'explosion', path: '/?explode', size: '1440,900', minNonDark: 0.055, minBytes: 650_000, timeoutMs: 42_000 },
];

mkdirSync(outDir, { recursive: true });

for (const scenario of scenarios) {
  const file = join(outDir, `${scenario.name}.png`);
  const url = new URL(scenario.path, baseUrl).href;
  const timeoutMs = scenario.timeoutMs ?? 18_000;
  await captureScenario({ scenario, file, url, timeoutMs });

  const bytes = statSync(file).size;
  const stats = analyzePng(file);
  if (bytes < (scenario.minBytes ?? 90_000)) throw new Error(`${scenario.name} screenshot too small: ${bytes} bytes`);
  if (stats.nonDarkRatio < scenario.minNonDark) {
    throw new Error(`${scenario.name} looks blank: non-dark ${(stats.nonDarkRatio * 100).toFixed(2)}%`);
  }
  if (stats.stddev < 8) throw new Error(`${scenario.name} has low pixel variance: ${stats.stddev.toFixed(2)}`);

  console.log(`${scenario.name}: ${stats.width}x${stats.height}, ${(bytes / 1024).toFixed(0)} KiB, non-dark ${(stats.nonDarkRatio * 100).toFixed(1)}%, stddev ${stats.stddev.toFixed(1)}`);
}

console.log(`visual smoke screenshots: ${outDir}`);
process.exit(0);

async function captureScenario({ scenario, file, url, timeoutMs }) {
  const [width, height] = scenario.size.split(',').map(Number);
  const port = 9300 + Math.floor(Math.random() * 1200);
  const userDataDir = join(tmpdir(), `neon-sentinel-chrome-${scenario.name}-${Date.now()}`);
  const args = [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-first-run',
    '--disable-default-apps',
    '--disable-crash-reporter',
    '--disable-features=MediaRouter,OptimizationHints,Translate',
    '--run-all-compositor-stages-before-draw',
    `--window-size=${width},${height}`,
    'about:blank',
  ];
  if (localTarget) args.splice(args.length - 2, 0, '--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1, EXCLUDE localhost');

  const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  child.stderr.on('data', chunk => {
    stderr += String(chunk);
    if (stderr.length > 12_000) stderr = stderr.slice(-12_000);
  });

  try {
    await withTimeout(captureWithCdp({ scenario, scenarioName: scenario.name, port, url, file, width, height, timeoutMs }), timeoutMs + 18_000, `${scenario.name} timed out`);
  } catch (err) {
    throw new Error(`Chrome failed for ${scenario.name}: ${err instanceof Error ? err.message : String(err)}\n${stderr.trim()}`);
  } finally {
    if (!exited) child.kill('SIGTERM');
    await new Promise(resolve => {
      if (exited) return resolve();
      const timer = setTimeout(resolve, 1200);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (!exited) child.kill('SIGKILL');
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function captureWithCdp({ scenario, scenarioName, port, url, file, width, height, timeoutMs }) {
  const endpoint = await waitForDevtools(port, timeoutMs);
  const ws = new WebSocket(endpoint);
  const cdp = makeCdpClient(ws);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const loaded = cdp.waitFor('Page.domContentEventFired', Math.min(timeoutMs, 8_000)).catch(() => undefined);
    await cdp.send('Page.navigate', { url });
    await loaded;
    const readiness = await waitForVisualReadiness(cdp, timeoutMs);
    if (debug) console.log(`${scenarioName} readiness: ${JSON.stringify(readiness)}`);
    if (!readiness?.ready) throw new Error(`visual assets not ready after ${timeoutMs}ms`);
    for (const action of scenario.actions ?? []) {
      await evaluate(cdp, action, `${scenarioName} action`);
    }
    if (scenario.waitFor) await waitForScenarioCondition(cdp, scenarioName, scenario.waitFor, timeoutMs);
    if (scenario.settleMs) await delay(scenario.settleMs);
    const screenshot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    writeFileSync(file, Buffer.from(screenshot.data, 'base64'));
    if (!existsSync(file)) throw new Error('missing screenshot file');
  } finally {
    ws.close();
  }
}

async function evaluate(cdp, expression, label) {
  const response = await cdp.send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression,
  });
  if (response.exceptionDetails) {
    const text = response.exceptionDetails.text ?? response.exceptionDetails.exception?.description ?? 'evaluation failed';
    throw new Error(`${label}: ${text}`);
  }
  return response.result?.value;
}

async function waitForScenarioCondition(cdp, scenarioName, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  let lastError;
  while (Date.now() < deadline) {
    try {
      lastValue = await evaluate(cdp, expression, `${scenarioName} condition`);
      if (lastValue) return;
    } catch (err) {
      lastError = err;
    }
    await delay(100);
  }
  let frame = null;
  try {
    frame = await evaluate(cdp, 'window.neonSentinelDebugFrame?.() ?? null', `${scenarioName} debug frame`);
  } catch {
    /* Best-effort diagnostics only. */
  }
  const detail = frame ? JSON.stringify(frame).slice(0, 1400) : String(lastValue ?? lastError?.message ?? 'no frame');
  throw new Error(`${scenarioName} condition not met after ${timeoutMs}ms: ${detail}`);
}

async function waitForDevtools(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const pages = await response.json();
        const page = pages.find(entry => entry.type === 'page' && entry.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch (err) {
      lastError = err;
    }
    await delay(100);
  }
  throw new Error(`DevTools endpoint not ready${lastError ? `: ${lastError.message}` : ''}`);
}

function makeCdpClient(ws) {
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();

  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
      else resolve(message.result || {});
      return;
    }
    const handlers = listeners.get(message.method);
    if (handlers) {
      for (const handler of handlers) handler(message.params || {});
    }
  });

  return {
    send(method, params = {}) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    },
    waitFor(method, timeoutMs) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`Timed out waiting for ${method}`));
        }, timeoutMs);
        const handler = params => {
          cleanup();
          resolve(params);
        };
        const cleanup = () => {
          clearTimeout(timer);
          const handlers = listeners.get(method);
          if (!handlers) return;
          handlers.delete(handler);
          if (handlers.size === 0) listeners.delete(method);
        };
        if (!listeners.has(method)) listeners.set(method, new Set());
        listeners.get(method).add(handler);
      });
    },
  };
}

async function waitForVisualReadiness(cdp, timeoutMs) {
  const result = await cdp.send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `new Promise(resolve => {
      const started = performance.now();
      const maxWait = ${Math.max(5_000, timeoutMs - 2_000)};
      function frame(count) {
        if (count <= 0) return resolve({
          ready: !!window.neonSentinelVisualAssets?.ready,
          assets: window.neonSentinelVisualAssets || null,
          elapsed: performance.now() - started,
          href: location.href,
          readyState: document.readyState,
          images: Array.from(document.images).map(img => ({
            src: img.currentSrc || img.src,
            complete: img.complete,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight
          })),
          backdropEntries: performance.getEntriesByName('/backgrounds/generated/neon-sentinel-nasa-frontier.png')
            .concat(performance.getEntriesByName(location.origin + '/backgrounds/generated/neon-sentinel-nasa-frontier.png'))
            .map(entry => ({
              name: entry.name,
              duration: entry.duration,
              transferSize: entry.transferSize,
              encodedBodySize: entry.encodedBodySize,
              decodedBodySize: entry.decodedBodySize
            }))
        });
        requestAnimationFrame(() => frame(count - 1));
      }
      function check() {
        const assets = window.neonSentinelVisualAssets;
        const ready = !!assets?.ready;
        const expired = performance.now() - started > maxWait;
        if (ready || expired) return frame(3);
        setTimeout(check, 80);
      }
      check();
    })`,
  });
  return result.result?.value;
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), timeoutMs)),
  ]);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function titleReadyExpression() {
  return `(() => {
    const frame = window.neonSentinelDebugFrame?.();
    const actions = new Set((frame?.titleHitBoxes || []).map(button => button.action));
    return frame?.phase === 'title'
      && actions.has('start')
      && actions.has('guest')
      && actions.has('login')
      && actions.has('value-lightning')
      && actions.has('value-geyser')
      && actions.has('value-kofi');
  })()`;
}

function advanceGameOverToBoardExpression() {
  // Death now leads with the support ask, then guest name entry; walk the
  // staged flow with keyboard events until the score board is the surface.
  return `new Promise((resolve, reject) => {
    const started = Date.now();
    const press = (code, key) => {
      for (const type of ['keydown', 'keyup']) {
        window.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, code, key }));
      }
    };
    const tick = () => {
      if (Date.now() - started > 24000) return reject(new Error('game-over flow did not reach the board'));
      const frame = window.neonSentinelDebugFrame?.();
      if (frame?.phase !== 'gameover') return setTimeout(tick, 150);
      if (frame.gameOverStage === 'support') { press('Escape', 'Escape'); return setTimeout(tick, 300); }
      if (frame.gameOverStage === 'name') { press('Enter', 'Enter'); return setTimeout(tick, 300); }
      resolve('board');
    };
    tick();
  })`;
}

function gameoverBoardExpression() {
  // The redesigned game-over screen: score actions bar plus the all-time
  // leaderboard panel (live, cached, or local fallback — any source counts).
  // The score status may read SIGN SCORE READY, an already-published GAME
  // 30762 id, or the LOCAL SCORE fallback depending on claim timing.
  return `(() => {
    const frame = window.neonSentinelDebugFrame?.();
    const status = String(frame?.scoreStatus || '');
    return frame?.phase === 'gameover'
      && frame.scoreActionsVisible === true
      && (status.includes('SIGN SCORE') || status.includes('GAME 30762') || status.includes('LOCAL SCORE'))
      && frame.gameOverSupportOpen === false
      && frame.leaderboardSource !== null;
  })()`;
}

function gameoverDailyBoardExpression() {
  return `(() => {
    const frame = window.neonSentinelDebugFrame?.();
    const status = String(frame?.scoreStatus || '');
    return frame?.phase === 'gameover'
      && frame.daily === true
      && frame.scoreActionsVisible === true
      && (status.includes('SIGN SCORE') || status.includes('GAME 30762') || status.includes('LOCAL SCORE'))
      && frame.gameOverSupportOpen === false
      && frame.leaderboardSource !== null;
  })()`;
}

function gameoverSupportExpression() {
  // Support now lives in a modal (auto-opened by ?support=1); the three
  // payment method buttons are canvas hit targets rather than DOM links.
  // The score-actions bar stays hidden while the support ask is staged, so
  // only the modal itself is required here.
  return `(() => {
    const frame = window.neonSentinelDebugFrame?.();
    return frame?.phase === 'gameover'
      && frame.gameOverSupportOpen === true
      && frame.gameOverValueButtons >= 3;
  })()`;
}

function declineV4vAskExpression() {
  // Every title launch now leads with the value-for-value ask; NEXT TIME
  // declines it and lets the run proceed.
  return `new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (Date.now() - started > 12000) return reject(new Error('v4v ask never appeared'));
      const overlay = document.getElementById('v4v');
      const later = document.getElementById('v4v-later');
      if (overlay instanceof HTMLElement && !overlay.hidden && later instanceof HTMLElement) {
        later.click();
        return resolve('declined');
      }
      setTimeout(tick, 120);
    };
    tick();
  })`;
}

function clickTitleActionExpression(action) {
  return `(() => {
    const canvas = document.getElementById('game');
    const frame = window.neonSentinelDebugFrame?.();
    const button = (frame?.titleHitBoxes || []).find(item => item.action === ${JSON.stringify(action)});
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('game canvas missing');
    if (!button) throw new Error('title action missing: ${action}');
    const rect = canvas.getBoundingClientRect();
    const clientX = rect.left + ((button.x + button.w / 2) / 1280) * rect.width;
    const clientY = rect.top + ((button.y + button.h / 2) / 720) * rect.height;
    const common = {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      clientX,
      clientY,
      button: 0,
    };
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...common, buttons: 1 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...common, buttons: 0 }));
    return { action: ${JSON.stringify(action)}, clientX, clientY };
  })()`;
}

function analyzePng(file) {
  const png = readFileSync(file);
  const signature = '89504e470d0a1a0a';
  if (png.subarray(0, 8).toString('hex') !== signature) throw new Error(`${file} is not a PNG`);

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (bitDepth !== 8 || channels === 0) throw new Error(`${file} uses unsupported PNG format bitDepth=${bitDepth} colorType=${colorType}`);

  const inflated = inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let src = 0;
  let dst = 0;
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[src++];
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[src++];
      const left = x >= bpp ? pixels[dst + x - bpp] : 0;
      const up = prev[x] ?? 0;
      const upLeft = x >= bpp ? prev[x - bpp] ?? 0 : 0;
      pixels[dst + x] = (raw + predictor(filter, left, up, upLeft)) & 255;
    }
    prev = pixels.subarray(dst, dst + stride);
    dst += stride;
  }

  let count = 0;
  let nonDark = 0;
  let sum = 0;
  let sumSq = 0;
  const step = Math.max(1, Math.floor((width * height) / 70_000));
  for (let pixel = 0; pixel < width * height; pixel += step) {
    const idx = pixel * channels;
    if (channels === 4 && pixels[idx + 3] < 8) continue;
    const lum = (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3;
    count += 1;
    if (lum > 24) nonDark += 1;
    sum += lum;
    sumSq += lum * lum;
  }

  const mean = count > 0 ? sum / count : 0;
  const variance = count > 0 ? Math.max(0, sumSq / count - mean * mean) : 0;
  return {
    width,
    height,
    nonDarkRatio: count > 0 ? nonDark / count : 0,
    stddev: Math.sqrt(variance),
  };
}

function predictor(filter, left, up, upLeft) {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return Math.floor((left + up) / 2);
  if (filter === 4) return paeth(left, up, upLeft);
  throw new Error(`Unsupported PNG filter ${filter}`);
}

function paeth(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}
