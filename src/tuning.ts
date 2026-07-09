export interface TuningState {
  pace: number;
  shipAccel: number;
  shipReverse: number;
  shipDrag: number;
  enemySpeed: number;
  laserRange: number;
  captureTime: number;
  actorScale: number;
  contactScale: number;
}

export type TuningPresetId = 'arcade' | 'cinematic' | 'hardcore' | 'custom';

interface StoredTuning {
  preset: TuningPresetId;
  values: TuningState;
}

const KEY = 'neonsentinel:tuning:v17';

const PRESETS: Record<Exclude<TuningPresetId, 'custom'>, TuningState> = {
  arcade: {
    pace: 0.94,
    shipAccel: 1.68,
    shipReverse: 1.84,
    shipDrag: 0.96,
    enemySpeed: 0.82,
    laserRange: 0.98,
    captureTime: 2.24,
    actorScale: 0.48,
    contactScale: 1.3,
  },
  cinematic: {
    pace: 0.88,
    shipAccel: 1.6,
    shipReverse: 1.82,
    shipDrag: 0.98,
    enemySpeed: 0.76,
    laserRange: 1,
    captureTime: 2.34,
    actorScale: 0.5,
    contactScale: 1.32,
  },
  hardcore: {
    pace: 1.02,
    shipAccel: 1.64,
    shipReverse: 1.78,
    shipDrag: 1,
    enemySpeed: 0.92,
    laserRange: 0.9,
    captureTime: 2.06,
    actorScale: 0.46,
    contactScale: 1.24,
  },
};

const DEFAULTS: TuningState = PRESETS.arcade;

const SPECS = [
  { key: 'pace', label: 'PACE', min: 0.48, max: 1.3, step: 0.01 },
  { key: 'shipAccel', label: 'THRUST', min: 0.75, max: 1.85, step: 0.01 },
  { key: 'shipReverse', label: 'REVERSE', min: 0.75, max: 1.95, step: 0.01 },
  { key: 'shipDrag', label: 'DRAG', min: 0.75, max: 1.55, step: 0.01 },
  { key: 'enemySpeed', label: 'THREAT', min: 0.48, max: 1.35, step: 0.01 },
  { key: 'laserRange', label: 'LASER', min: 0.42, max: 1.1, step: 0.01 },
  { key: 'captureTime', label: 'LOCK', min: 0.9, max: 2.4, step: 0.01 },
  { key: 'actorScale', label: 'ACTORS', min: 0.3, max: 0.72, step: 0.01 },
  { key: 'contactScale', label: 'CONTACT', min: 0.72, max: 1.5, step: 0.01 },
] as const satisfies readonly {
  key: keyof TuningState;
  label: string;
  min: number;
  max: number;
  step: number;
}[];

let cached: TuningState | null = null;
let cachedPreset: TuningPresetId = 'arcade';

export function getTuning(): TuningState {
  if (cached) return cached;
  const loaded = loadTuning();
  cached = loaded.values;
  cachedPreset = loaded.preset;
  return cached;
}

export function getTuningPreset(): TuningPresetId {
  getTuning();
  return cachedPreset;
}

export function getTuningReadout(): string {
  const tuning = getTuning();
  return `${getTuningPreset().toUpperCase()} P${pct(tuning.pace)} T${pct(tuning.shipAccel)} R${pct(tuning.shipReverse)} D${pct(tuning.shipDrag)} E${pct(tuning.enemySpeed)} L${pct(tuning.laserRange)} C${pct(tuning.captureTime)}`;
}

export function setupTuningControls(): void {
  const host = document.getElementById('tune-controls');
  if (!host) return;
  host.textContent = '';
  const state = getTuning();
  const preset = getTuningPreset();

  const presetRow = document.createElement('div');
  presetRow.className = 'tune-presets';
  for (const [id, label] of [
    ['arcade', 'ARCADE'],
    ['cinematic', 'CINEMA'],
    ['hardcore', 'HARD'],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tune-preset';
    button.classList.toggle('is-active', preset === id);
    button.textContent = label;
    button.addEventListener('click', () => {
      cached = { ...PRESETS[id] };
      cachedPreset = id;
      saveTuning(cached, cachedPreset);
      setupTuningControls();
    });
    presetRow.appendChild(button);
  }
  host.appendChild(presetRow);

  for (const spec of SPECS) {
    const row = document.createElement('label');
    row.className = 'tune-control';

    const name = document.createElement('span');
    name.textContent = spec.label;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(state[spec.key]);

    const value = document.createElement('output');
    value.textContent = formatValue(state[spec.key]);

    input.addEventListener('input', () => {
      const next = clamp(Number(input.value), spec.min, spec.max);
      state[spec.key] = next;
      cachedPreset = 'custom';
      value.textContent = formatValue(next);
      saveTuning(state, cachedPreset);
      syncReadout(host);
    });

    row.append(name, input, value);
    host.appendChild(row);
  }

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'tune-reset';
  reset.textContent = 'RESET ARCADE';
  reset.addEventListener('click', () => {
    cached = { ...DEFAULTS };
    cachedPreset = 'arcade';
    saveTuning(cached, cachedPreset);
    setupTuningControls();
  });
  host.appendChild(reset);

  const readout = document.createElement('output');
  readout.className = 'tune-readout';
  readout.dataset.role = 'readout';
  readout.textContent = getTuningReadout();
  host.appendChild(readout);
}

function loadTuning(): StoredTuning {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { preset: 'arcade', values: { ...DEFAULTS } };
    const parsed = JSON.parse(raw) as Partial<StoredTuning> & Partial<Record<keyof TuningState, unknown>>;
    const source = typeof parsed.values === 'object' && parsed.values ? parsed.values as Partial<Record<keyof TuningState, unknown>> : parsed;
    const next = { ...DEFAULTS };
    for (const spec of SPECS) {
      const value = source[spec.key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        next[spec.key] = clamp(value, spec.min, spec.max);
      }
    }
    const preset = parsed.preset === 'arcade' || parsed.preset === 'cinematic' || parsed.preset === 'hardcore' || parsed.preset === 'custom'
      ? parsed.preset
      : closestPreset(next);
    return { preset, values: next };
  } catch {
    return { preset: 'arcade', values: { ...DEFAULTS } };
  }
}

function saveTuning(next: TuningState, preset: TuningPresetId): void {
  cached = next;
  cachedPreset = preset;
  try { localStorage.setItem(KEY, JSON.stringify({ preset, values: next } satisfies StoredTuning)); } catch { /* localStorage can be blocked */ }
  window.dispatchEvent(new CustomEvent('neonsentinel:tuning'));
}

function formatValue(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function pct(value: number): string {
  return String(Math.round(value * 100));
}

function syncReadout(host: HTMLElement): void {
  const readout = host.querySelector<HTMLOutputElement>('[data-role="readout"]');
  if (readout) readout.textContent = getTuningReadout();
  for (const button of host.querySelectorAll('.tune-preset')) button.classList.remove('is-active');
}

function closestPreset(value: TuningState): TuningPresetId {
  for (const [id, preset] of Object.entries(PRESETS) as Array<[Exclude<TuningPresetId, 'custom'>, TuningState]>) {
    if (SPECS.every(spec => Math.abs(value[spec.key] - preset[spec.key]) < 0.005)) return id;
  }
  return 'custom';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
