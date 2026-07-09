// Client-side view of the 600.wtf membership roll. Fetches the registry with
// a localStorage cache and answers pubkey lookups for badges and greetings.
// Membership is decorative on the client — the claim server re-verifies
// before tagging signed score events — so every failure path here degrades
// silently to "not a member" and never blocks the game.

import { parseSixHundredRegistry, SIX_HUNDRED_REGISTRY_URL } from './sixhundred-registry.js';

export { SIX_HUNDRED_DOMAIN, sixHundredNip05 } from './sixhundred-registry.js';

const CACHE_KEY = 'neonsentinel:600b-registry:v1';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

let clientRegistry: Map<string, string> | null = null;

/** Handle for a member pubkey, or null when unknown or the registry is unavailable. */
export function sixHundredHandle(pubkey: string | null | undefined): string | null {
  if (!pubkey || !clientRegistry) return null;
  return clientRegistry.get(pubkey.toLowerCase()) ?? null;
}

export function isSixHundredMember(pubkey: string | null | undefined): boolean {
  return sixHundredHandle(pubkey) !== null;
}

interface StoredRegistry {
  fetchedAt: number;
  names: Record<string, string>;
}

function readStoredRegistry(): StoredRegistry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredRegistry>;
    if (typeof parsed.fetchedAt !== 'number' || !parsed.names || typeof parsed.names !== 'object') return null;
    return { fetchedAt: parsed.fetchedAt, names: parsed.names };
  } catch {
    return null;
  }
}

function writeStoredRegistry(registry: Map<string, string>): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      fetchedAt: Date.now(),
      names: Object.fromEntries(registry),
    } satisfies StoredRegistry));
  } catch {
    // Storage may be blocked; the in-memory registry still applies this session.
  }
}

/**
 * Populate the in-memory registry: cached copy first (so lookups work even
 * offline), then a network refresh when the cache is stale.
 */
export async function loadSixHundredRegistry(): Promise<void> {
  const stored = readStoredRegistry();
  if (stored) clientRegistry = new Map(Object.entries(stored.names));
  if (stored && Date.now() - stored.fetchedAt < CACHE_TTL_MS) return;
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(SIX_HUNDRED_REGISTRY_URL, { signal: controller.signal, mode: 'cors' });
    window.clearTimeout(timer);
    if (!response.ok) return;
    const registry = parseSixHundredRegistry(await response.json());
    if (registry.size === 0) return;
    clientRegistry = registry;
    writeStoredRegistry(registry);
  } catch {
    // Offline or 600.wtf unavailable — keep whatever the cache gave us.
  }
}
