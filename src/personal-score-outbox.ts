import type { RelaykeepRunSummary } from './scoring.js';

const KEY = 'neonsentinel:personal-score-outbox:v1';
const MAX_RUNS = 64;
const MAX_BYTES = 128 * 1024;
export interface PersonalScoreReceipt { pubkey: string; summary: RelaykeepRunSummary }

function valid(value: unknown): value is PersonalScoreReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as PersonalScoreReceipt;
  const run = receipt.summary;
  return typeof receipt.pubkey === 'string' && /^[a-f0-9]{64}$/.test(receipt.pubkey)
    && !!run && run.playerMode === 'nostr' && run.playerPubkey === receipt.pubkey
    && typeof run.runId === 'string' && run.runId.length > 0 && run.runId.length <= 128
    && ['score','wave','sats','startedAt','finishedAt','durationMs','rescues','knownRescues','lost','maxCombo']
      .every(key => typeof run[key as keyof RelaykeepRunSummary] === 'number'
        && Number.isFinite(run[key as keyof RelaykeepRunSummary] as number)
        && (run[key as keyof RelaykeepRunSummary] as number) >= 0);
}
function read(): PersonalScoreReceipt[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    if (new TextEncoder().encode(raw).length > MAX_BYTES) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > MAX_RUNS || !parsed.every(valid)) return null;
    return parsed;
  } catch { return null; }
}
function write(receipts: PersonalScoreReceipt[]): boolean {
  try {
    const raw = JSON.stringify(receipts);
    if (new TextEncoder().encode(raw).length > MAX_BYTES) return false;
    localStorage.setItem(KEY, raw);
    return true;
  } catch { return false; }
}
/** Only return this account's public run receipts; never expose another player's runs. */
export function pendingPersonalScores(pubkey: string): PersonalScoreReceipt[] {
  return (read() ?? []).filter(receipt => receipt.pubkey === pubkey);
}
export function rememberPersonalScore(summary: RelaykeepRunSummary): boolean {
  const receipt = {pubkey: summary.playerPubkey ?? '', summary: structuredClone(summary)};
  if (!valid(receipt)) return false;
  const receipts = read();
  if (!receipts) return false;
  if (receipts.some(old => old.pubkey === receipt.pubkey && old.summary.runId === summary.runId)) return true;
  // Never make room by evicting a run the player has not published.
  if (receipts.length >= MAX_RUNS) return false;
  return write([...receipts, receipt]);
}
export function forgetPersonalScore(pubkey: string, runId: string): boolean {
  const receipts = read();
  return !!receipts && write(receipts.filter(receipt => receipt.pubkey !== pubkey || receipt.summary.runId !== runId));
}
