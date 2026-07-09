import { THEMES, coerceThemeId, type ThemeId } from './postfx.js';
import { getRelayConfigs, setReadonlyRelayEnabled } from './relays.js';
import { setupTuningControls } from './tuning.js';

export type VisualTier = 'vector' | 'mesh';

interface VisualState {
  tier: VisualTier;
  theme: ThemeId;
  brightness: number;
  postfxChosen: boolean;
  reducedEffects: boolean;
  leftHandedTouch: boolean;
}

const KEY = 'neonsentinel:visual:v2';
const MIN_BRIGHTNESS = 0.85;
const MAX_BRIGHTNESS = 1.3;

function defaults(): VisualState {
  return {
    // Vector picker hidden for the moment — always start in mesh. Runtime
    // fallback (WebGL context loss, see main.ts requestMeshOverlay) still
    // switches the live tier to 'vector' mid-session; only the persisted
    // default/parse is forced here.
    tier: 'mesh',
    theme: 'none',
    brightness: 1,
    postfxChosen: false,
    reducedEffects: false,
    leftHandedTouch: false,
  };
}

let cached: VisualState | null = null;

function coerceBrightness(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(MIN_BRIGHTNESS, Math.min(MAX_BRIGHTNESS, value))
    : fallback;
}

function applyBrightnessSetting(value: number): void {
  const root = document.documentElement;
  const brightness = Math.abs(value - 1) > 0.005 ? `brightness(${value.toFixed(2)})` : 'none';
  root.style.setProperty('--ns-game-filter', brightness);
  root.style.setProperty('--ns-game3d-filter', brightness === 'none'
    ? 'saturate(1.24) contrast(1.08)'
    : `${brightness} saturate(1.24) contrast(1.08)`);
}

function load(): VisualState {
  if (cached) return cached;
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      cached = {
        tier: 'mesh',
        theme: parsed.postfxChosen === true ? coerceThemeId(parsed.theme ?? base.theme) : base.theme,
        brightness: coerceBrightness(parsed.brightness, base.brightness),
        postfxChosen: parsed.postfxChosen === true,
        reducedEffects: parsed.reducedEffects === true,
        leftHandedTouch: parsed.leftHandedTouch === true,
      };
      applyBrightnessSetting(cached.brightness);
      applyTouchLayoutSetting(cached.leftHandedTouch);
      return cached;
    }
  } catch {
    // localStorage may be blocked; defaults are fine.
  }
  cached = base;
  applyBrightnessSetting(cached.brightness);
  applyTouchLayoutSetting(cached.leftHandedTouch);
  return cached;
}

function applyTouchLayoutSetting(leftHanded: boolean): void {
  document.body?.classList.toggle('ns-left-hand', leftHanded);
}

function save(next: VisualState): void {
  cached = next;
  applyBrightnessSetting(next.brightness);
  applyTouchLayoutSetting(next.leftHandedTouch);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('neonsentinel:visual-settings'));
}

export function getVisualTier(): VisualTier {
  return load().tier;
}

export function setVisualTier(tier: VisualTier): void {
  save({ ...load(), tier });
}

export function getTheme(): ThemeId {
  return load().theme;
}

export function setTheme(theme: ThemeId): void {
  save({ ...load(), theme, postfxChosen: true });
}

export function getBrightness(): number {
  return load().brightness;
}

export function setBrightness(brightness: number): void {
  save({ ...load(), brightness: coerceBrightness(brightness, 1) });
}

export function getReducedEffects(): boolean {
  return load().reducedEffects;
}

export function setReducedEffects(reducedEffects: boolean): void {
  save({ ...load(), reducedEffects });
}

export function getLeftHandedTouch(): boolean {
  return load().leftHandedTouch;
}

export function setLeftHandedTouch(leftHandedTouch: boolean): void {
  save({ ...load(), leftHandedTouch });
}

export function setupVisualSettings(opts: { onMeshRequested?: () => void } = {}): void {
  const panel = document.getElementById('settings-panel');
  const toggle = document.getElementById('settings-toggle');
  const tierHost = document.getElementById('tier-controls');
  const themeHost = document.getElementById('theme-controls');
  const brightnessHost = document.getElementById('brightness-controls');
  const screenHost = document.getElementById('screen-controls');
  const relayHost = document.getElementById('relay-controls');
  const meshStatus = document.getElementById('mesh-status');
  if (!panel || !toggle || !tierHost || !themeHost) return;

  const tierButtons: HTMLButtonElement[] = [];
  const themeButtons: HTMLButtonElement[] = [];

  const makeButton = (parent: HTMLElement, label: string): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'segmented-button';
    button.textContent = label;
    parent.appendChild(button);
    return button;
  };

  // Vector picker hidden for the moment — see the note on defaults() above.
  for (const [tier, label] of [['mesh', '3D MESH']] as const) {
    const button = makeButton(tierHost, label);
    button.dataset.tier = tier;
    button.addEventListener('click', () => {
      setVisualTier(tier);
      if (tier === 'mesh') opts.onMeshRequested?.();
      sync();
    });
    tierButtons.push(button);
  }

  for (const theme of THEMES) {
    const button = makeButton(themeHost, theme.label);
    button.dataset.theme = theme.id;
    button.addEventListener('click', () => {
      setTheme(theme.id);
      sync();
    });
    themeButtons.push(button);
  }

  if (screenHost) renderScreenControls(screenHost);
  if (brightnessHost) renderBrightnessControls(brightnessHost);
  const accessHost = document.getElementById('access-controls');
  if (accessHost) renderAccessControls(accessHost);
  if (relayHost) renderRelayControls(relayHost);
  setupTuningControls();

  toggle.addEventListener('click', () => {
    const open = panel.getAttribute('data-open') !== 'true';
    panel.setAttribute('data-open', String(open));
    toggle.setAttribute('aria-expanded', String(open));
  });

  window.addEventListener('neonsentinel:mesh-status', ev => {
    if (!meshStatus) return;
    const detail = (ev as CustomEvent<{ label?: string }>).detail;
    meshStatus.textContent = detail?.label ?? '';
  });
  window.addEventListener('neonsentinel:visual-settings', sync);

  function sync(): void {
    const tier = getVisualTier();
    const theme = getTheme();
    for (const button of tierButtons) {
      const on = button.dataset.tier === tier;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', String(on));
    }
    for (const button of themeButtons) {
      const on = button.dataset.theme === theme;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', String(on));
    }
  }

  sync();
  if (new URLSearchParams(window.location.search).get('settings') === '1') {
    panel.setAttribute('data-open', 'true');
    toggle.setAttribute('aria-expanded', 'true');
  }
  if (getVisualTier() === 'mesh') opts.onMeshRequested?.();
}

function renderBrightnessControls(host: HTMLElement): void {
  host.textContent = '';
  const label = document.createElement('label');
  label.className = 'brightness-control';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(Math.round(MIN_BRIGHTNESS * 100));
  input.max = String(Math.round(MAX_BRIGHTNESS * 100));
  input.step = '1';
  input.value = String(Math.round(getBrightness() * 100));
  const output = document.createElement('output');
  output.textContent = input.value;
  input.addEventListener('input', () => {
    const value = coerceBrightness(input.valueAsNumber / 100, 1);
    setBrightness(value);
    output.textContent = String(Math.round(value * 100));
  });
  label.append(input, output);
  host.append(label);
}

function renderAccessControls(host: HTMLElement): void {
  host.textContent = '';
  const calm = makeScreenButton(host, 'CALM FX');
  calm.title = 'Reduce screen flash and shake';
  const leftHand = makeScreenButton(host, 'LEFT HAND');
  leftHand.title = 'Mirror the touch controls for left-handed play';

  const sync = (): void => {
    const calmOn = getReducedEffects();
    const leftOn = getLeftHandedTouch();
    calm.classList.toggle('is-active', calmOn);
    calm.setAttribute('aria-pressed', String(calmOn));
    leftHand.classList.toggle('is-active', leftOn);
    leftHand.setAttribute('aria-pressed', String(leftOn));
  };
  calm.addEventListener('click', () => {
    setReducedEffects(!getReducedEffects());
    sync();
  });
  leftHand.addEventListener('click', () => {
    setLeftHandedTouch(!getLeftHandedTouch());
    sync();
  });
  sync();
}

function renderScreenControls(host: HTMLElement): void {
  host.textContent = '';
  const canFullscreen = typeof document.documentElement.requestFullscreen === 'function';
  const fullscreen = makeScreenButton(host, 'FULLSCREEN');
  const windowed = makeScreenButton(host, 'WINDOW');
  fullscreen.disabled = !canFullscreen;
  fullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement && canFullscreen) void document.documentElement.requestFullscreen();
  });
  windowed.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
  });

  const sync = (): void => {
    const on = Boolean(document.fullscreenElement);
    fullscreen.classList.toggle('is-active', on);
    windowed.classList.toggle('is-active', !on);
    fullscreen.setAttribute('aria-pressed', String(on));
    windowed.setAttribute('aria-pressed', String(!on));
  };
  document.addEventListener('fullscreenchange', sync);
  sync();
}

function makeScreenButton(parent: HTMLElement, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'segmented-button';
  button.textContent = label;
  parent.appendChild(button);
  return button;
}

function renderRelayControls(host: HTMLElement): void {
  host.textContent = '';
  for (const relay of getRelayConfigs()) {
    const label = document.createElement('label');
    label.className = `relay-toggle relay-${relay.mode}`;
    label.title = `${relay.url} · ${relay.mode}`;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = relay.enabled;
    input.disabled = relay.locked;
    input.addEventListener('change', () => {
      setReadonlyRelayEnabled(relay.url, input.checked);
      renderRelayControls(host);
    });

    const name = document.createElement('span');
    name.textContent = relay.label;

    const mode = document.createElement('span');
    mode.className = 'relay-mode';
    mode.textContent = relay.mode === 'readwrite' ? 'RW' : 'R';

    label.append(input, name, mode);
    host.appendChild(label);
  }
}
