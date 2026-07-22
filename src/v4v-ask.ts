// Value-for-value interstitial: shown between the title menu and the run.
// Honour-system, same pattern as take-me-to-your-ledger — a plain lightning
// address gives no payment callback, so the player self-confirms with I PAID.
// The reward is printed on the overlay: tipping arms a launch blessing.

import { playVoiceClip, preloadVoiceClip } from './audio.js';
import { getValueForValueConfig, getValueForValueQrCanvas } from './value-for-value.js';

const STORE_KEY = 'neonsentinel:v4v:v1';
const THANKS_VOICES = ['/sfx/thanks-fren.m4a', '/sfx/thanks-legend.m4a'];
const BLESSING_HOURS = 24;

/** What a patron's sats buy at launch — printed on the overlay so the deal is explicit. */
export const V4V_BLESSING_SHIELD = 2;
export const V4V_BLESSING_TIME_SECONDS = 15;
export const V4V_REWARD_LINE = `🙏 PATRONS FIGHT BLESSED — +${V4V_BLESSING_SHIELD} SHIELD AT LAUNCH · +${V4V_BLESSING_TIME_SECONDS}s CLOCK`;
const THANKS_REWARD_LINE = `🙏 BLESSING ARMED — +${V4V_BLESSING_SHIELD} SHIELD · +${V4V_BLESSING_TIME_SECONDS}s CLOCK · ${BLESSING_HOURS}H`;

interface V4vAskState {
  declines: number;
  paidAt: number;
}

function loadState(): V4vAskState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { declines: 0, paidAt: 0, ...JSON.parse(raw) as Partial<V4vAskState> };
  } catch { /* storage may be blocked; the ask still works, it just forgets */ }
  return { declines: 0, paidAt: 0 };
}

function saveState(s: V4vAskState): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

const NUDGES = [
  `This relay runs on sats. Patrons fight blessed: +${V4V_BLESSING_SHIELD} shield and +${V4V_BLESSING_TIME_SECONDS}s on the clock.`,
  'Free run logged. The relay remembers. Patrons launch shielded.',
  'Still free. Every sat keeps the relay lit — the blessing is not subtle.',
  'Sats are voluntary. So is getting TIME LOCKED without a shield.',
];

// Previous patrons get a warmer word — the ask still shows every run.
const RETURNING_NUDGES = [
  `You paid before. The relay remembers. Your blessing holds for ${BLESSING_HOURS} hours.`,
  `Generosity noted on the ledger. Fight blessed: +${V4V_BLESSING_SHIELD} shield, +${V4V_BLESSING_TIME_SECONDS}s clock.`,
  'One sat is a signal. Two is a habit. Bless you either way.',
];

let askOpen = false;
let qrRendered = false;
let onClosed: (() => void) | null = null;

function el(id: string): HTMLElement {
  return document.getElementById(id)!;
}

/** The ask fires before every run launched from the title menu. Retry and
 *  instant-restart paths skip it — nobody re-pitches mid-session momentum. */
export function shouldAskV4v(): boolean {
  return true;
}

/** Patrons fight blessed for 24 hours after paying: extra shield and clock time at launch. */
export function isV4vBlessed(): boolean {
  const s = loadState();
  return s.paidAt > 0 && Date.now() - s.paidAt < BLESSING_HOURS * 60 * 60 * 1000;
}

export function isV4vAskOpen(): boolean {
  return askOpen;
}

export function openV4vAsk(closed: () => void): void {
  onClosed = closed;
  const s = loadState();
  el('v4v-nudge').textContent = s.paidAt
    ? RETURNING_NUDGES[Math.min(s.declines, RETURNING_NUDGES.length - 1)]!
    : NUDGES[Math.min(s.declines, NUDGES.length - 1)]!;
  el('v4v-ask').hidden = false;
  el('v4v-thanks').hidden = true;
  el('v4v').hidden = false;
  askOpen = true;
  for (const url of THANKS_VOICES) preloadVoiceClip(url);
  if (!qrRendered) {
    const config = getValueForValueConfig();
    const qr = getValueForValueQrCanvas(config.qrValue);
    if (qr) {
      (el('v4v-qr') as HTMLImageElement).src = qr.toDataURL();
      qrRendered = true;
    }
  }
  // Enter keeps momentum: mashing START declines and launches; it never
  // claims a payment by accident.
  el('v4v-later').focus();
}

function closeV4vAsk(): void {
  el('v4v').hidden = true;
  askOpen = false;
  const cb = onClosed;
  onClosed = null;
  cb?.();
}

export function initV4vAsk(): void {
  const config = getValueForValueConfig();
  const address = config.qrValue.replace(/^lightning:/i, '');
  el('v4v-reward').textContent = V4V_REWARD_LINE;
  el('v4v-thanks-reward').textContent = THANKS_REWARD_LINE;
  el('v4v-addr').textContent = config.display;
  const geyser = config.links.find(link => link.id === 'geyser');
  const kofi = config.links.find(link => link.id === 'kofi');
  if (geyser) (el('v4v-geyser') as HTMLAnchorElement).href = geyser.href;
  else el('v4v-geyser').hidden = true;
  if (kofi) (el('v4v-kofi') as HTMLAnchorElement).href = kofi.href;
  else el('v4v-kofi').hidden = true;
  el('v4v-addr').addEventListener('click', () => {
    void navigator.clipboard?.writeText(address).then(() => {
      el('v4v-addr').textContent = 'COPIED!';
      setTimeout(() => { el('v4v-addr').textContent = config.display; }, 1400);
    }).catch(() => undefined);
    // Same gesture also offers the wallet deep link.
    window.location.href = config.href;
  });
  el('v4v-paid').addEventListener('click', () => {
    const s = loadState();
    s.paidAt = Date.now();
    s.declines = 0;
    saveState(s);
    el('v4v-ask').hidden = true;
    el('v4v-thanks').hidden = false;
    el('v4v-start').focus();
    playVoiceClip(THANKS_VOICES[Math.floor(Math.random() * THANKS_VOICES.length)]!, 1.1);
  });
  el('v4v-later').addEventListener('click', () => {
    const s = loadState();
    s.declines += 1;
    saveState(s);
    closeV4vAsk();
  });
  el('v4v-start').addEventListener('click', closeV4vAsk);
}
