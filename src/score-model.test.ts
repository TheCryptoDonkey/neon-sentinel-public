import { describe, expect, it } from 'vitest';
import {
  MAX_ACTION_POINTS_PER_S,
  MAX_COMBO_KILL_MULT,
  maxPlausibleWave,
  maxWaveBonusCum,
  scoreCeiling,
} from './score-model.js';

describe('score-model derived ceilings', () => {
  it('derives the action-points ceiling from the richest possible kill', () => {
    // carrier 5200 × combo cap mult 2.44 × surge 2 — one per second, sustained.
    expect(MAX_COMBO_KILL_MULT).toBeCloseTo(2.44);
    expect(MAX_ACTION_POINTS_PER_S).toBe(25376);
  });

  it('wave bonus allowance is the real quadratic sum, not a linear guess', () => {
    // Σ (1200 + 420w) for w = 1..3
    expect(maxWaveBonusCum(3)).toBe(1200 * 3 + 420 * (1 + 2 + 3));
  });

  it('accepts a deep elite run beyond the old hard wave-100 reject', () => {
    // Two-hour survival marathon reaching wave 120: the old rules 422'd this
    // outright (wave > 100). Waves average 60 s; score is every wave bonus
    // plus a strong 800 pts/s action rate.
    const durationSec = 120 * 60;
    const honestScore = Math.round(maxWaveBonusCum(120) + durationSec * 800);
    expect(maxPlausibleWave(durationSec)).toBeGreaterThanOrEqual(120);
    expect(honestScore).toBeLessThanOrEqual(scoreCeiling(120, durationSec));
  });

  it('rejects a fabricated score with no wall-clock time behind it', () => {
    // A billion points claimed off a 60-second wave-3 run.
    expect(1_000_000_000).toBeGreaterThan(scoreCeiling(3, 60));
    // Wave 500 claimed off a 60-second run.
    expect(500).toBeGreaterThan(maxPlausibleWave(60));
  });

  it('covers a surge-heavy 40-minute elite run with room to spare', () => {
    const durationSec = 40 * 60;
    // Generous honest estimate: all wave bonuses to wave 40 + 1500 pts/s.
    const honestScore = maxWaveBonusCum(40) + durationSec * 1500;
    expect(honestScore).toBeLessThanOrEqual(scoreCeiling(40, durationSec));
  });
});
