import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from './test-support/memory-storage.js';
import type { TuningPresetId, TuningState } from './tuning.js';

// Must mirror the private constants in tuning.ts — there are no exported
// symbols for the storage key, presets or per-control bounds, so the
// public storage contract is duplicated here deliberately.
const KEY = 'neonsentinel:tuning:v17';

const ARCADE: TuningState = {
  pace: 0.94,
  shipAccel: 1.68,
  shipReverse: 1.84,
  shipDrag: 0.96,
  enemySpeed: 0.82,
  laserRange: 0.98,
  captureTime: 2.24,
  actorScale: 0.48,
  contactScale: 1.3,
};

const CINEMATIC: TuningState = {
  pace: 0.88,
  shipAccel: 1.6,
  shipReverse: 1.82,
  shipDrag: 0.98,
  enemySpeed: 0.76,
  laserRange: 1,
  captureTime: 2.34,
  actorScale: 0.5,
  contactScale: 1.32,
};

// [key, min, max] for a couple of representative controls — enough to
// exercise the clamp behaviour without duplicating the entire spec table.
const BOUNDS: Array<[keyof TuningState, number, number]> = [
  ['pace', 0.48, 1.3],
  ['shipAccel', 0.75, 1.85],
];

async function freshTuning() {
  vi.resetModules();
  return import('./tuning.js');
}

function seed(value: unknown): void {
  localStorage.setItem(KEY, JSON.stringify(value));
}

beforeEach(() => {
  globalThis.localStorage = createMemoryStorage();
});

describe('getTuning / loadTuning fallback behaviour', () => {
  it('defaults to the arcade preset and values when nothing is stored', async () => {
    const { getTuning, getTuningPreset } = await freshTuning();
    expect(getTuningPreset()).toBe('arcade');
    expect(getTuning()).toEqual(ARCADE);
  });

  it('falls back to arcade defaults when the stored JSON is corrupt', async () => {
    localStorage.setItem(KEY, '{not valid json');
    const { getTuning, getTuningPreset } = await freshTuning();
    expect(getTuningPreset()).toBe('arcade');
    expect(getTuning()).toEqual(ARCADE);
  });

  it('clamps out-of-range stored values to each control\'s bounds', async () => {
    seed({ preset: 'custom', values: { pace: 999, shipAccel: -5 } });
    const { getTuning } = await freshTuning();
    const tuning = getTuning();
    for (const [key, min, max] of BOUNDS) {
      expect(tuning[key]).toBeGreaterThanOrEqual(min);
      expect(tuning[key]).toBeLessThanOrEqual(max);
    }
    expect(tuning.pace).toBe(1.3);
    expect(tuning.shipAccel).toBe(0.75);
  });

  it('fills in missing keys with arcade defaults while preserving provided ones', async () => {
    seed({ preset: 'custom', values: { pace: 0.7 } });
    const { getTuning } = await freshTuning();
    const tuning = getTuning();
    expect(tuning.pace).toBe(0.7);
    expect(tuning.shipAccel).toBe(ARCADE.shipAccel);
    expect(tuning.contactScale).toBe(ARCADE.contactScale);
  });

  it('supports the legacy flat-value storage format with no {preset, values} wrapper', async () => {
    seed({ pace: 0.7, shipAccel: 1.7 });
    const { getTuning } = await freshTuning();
    const tuning = getTuning();
    expect(tuning.pace).toBe(0.7);
    expect(tuning.shipAccel).toBe(1.7);
  });

  it('infers the closest matching preset when the stored preset id is missing or invalid', async () => {
    seed({ preset: 'not-a-real-preset', values: CINEMATIC });
    const { getTuningPreset } = await freshTuning();
    expect(getTuningPreset()).toBe<TuningPresetId>('cinematic');
  });

  it('caches the loaded tuning so repeated calls return the same object', async () => {
    const { getTuning } = await freshTuning();
    expect(getTuning()).toBe(getTuning());
  });
});
