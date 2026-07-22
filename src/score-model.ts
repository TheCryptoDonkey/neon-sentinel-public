// Scoring constants shared by the game client and the claim service.
//
// The server-side plausibility ceiling MUST be derived from the same numbers
// the game actually awards — hand-written caps rot silently when the game is
// retuned, and then honest runs get 422'd (hang-on-fren lost three days of
// scores to exactly that). Ceilings here are impossible-only: generous enough
// that no honest run can ever cross them, tight enough that a fabricated
// score with no matching wall-clock time cannot.

/** Wave-clear bonus: `WAVE_CLEAR_FLAT + wave * WAVE_CLEAR_STEP` per wave. */
export const WAVE_CLEAR_FLAT = 1200;
export const WAVE_CLEAR_STEP = 420;

/** Richest single kill in the game (carrier). */
export const KILL_BASE_CARRIER = 5200;

/** Combo chain: capped, +18% kill points per 5 links. */
export const COMBO_CAP = 40;
export const COMBO_STEP_MULT = 0.18;
export const MAX_COMBO_KILL_MULT = 1 + Math.floor(COMBO_CAP / 5) * COMBO_STEP_MULT;

/** Score surge doubles kill/rescue/beacon points while active. */
export const SURGE_SCORE_MULT = 2;

/**
 * One max-value carrier kill per second, at combo cap, under a score surge,
 * sustained for the whole run — beyond any honest pace by a wide margin.
 */
export const MAX_ACTION_POINTS_PER_S = Math.ceil(
  KILL_BASE_CARRIER * MAX_COMBO_KILL_MULT * SURGE_SCORE_MULT,
);

/** Start-of-run allowance: opening bonuses, rescues banked before wave 1 ends. */
export const SCORE_CEILING_FLAT = 18_000;

/** Cumulative wave-clear bonus after clearing `wave` waves (quadratic, not linear). */
export function maxWaveBonusCum(wave: number): number {
  return WAVE_CLEAR_FLAT * wave + (WAVE_CLEAR_STEP * wave * (wave + 1)) / 2;
}

/**
 * Hard score ceiling for a run that reached `wave` and lasted `durationSec`.
 * Anything above this could not have been earned by playing the game.
 */
export function scoreCeiling(wave: number, durationSec: number): number {
  return SCORE_CEILING_FLAT + maxWaveBonusCum(wave) + durationSec * MAX_ACTION_POINTS_PER_S;
}

/**
 * Waves are gated by a forced 1.8 s clear pause plus the spawns themselves,
 * so even a theoretical speedrun cannot average under a second a wave; debug
 * starts can begin as deep as wave 30. There is no designed maximum
 * wave — survival is open-ended — so the only honest bound is time.
 */
export function maxPlausibleWave(durationSec: number): number {
  return 30 + Math.ceil(durationSec);
}
