export type RelayMode = 'readwrite' | 'readonly';

export interface RelayConfig {
  url: string;
  label: string;
  mode: RelayMode;
  enabled: boolean;
  locked: boolean;
}

const STORAGE_KEY = 'neonsentinel:read-relays:v1';

export const PRIVATE_TEST_RELAY = 'wss://relay.trotters.cc';

export const WRITE_RELAYS = [
  'wss://relay.gamestr.io',
  PRIVATE_TEST_RELAY,
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
  'wss://relay.ditto.pub',
] as const;

const READONLY_RELAYS = [
  ['wss://nos.lol', 'nos.lol'],
  ['wss://relay.damus.io', 'damus'],
  ['wss://relay.nostr.band', 'nostr.band'],
  ['wss://relay.primal.net', 'primal'],
  ['wss://relay.ditto.pub', 'ditto'],
  ['wss://nostr.wine', 'nostr.wine'],
] as const;

// Kind-0 aggregators: general relays only hold profiles that happen to pass
// through them, so avatar lookups for arbitrary pubkeys (600.wtf members,
// roster contacts) often come back empty. These relays exist to serve
// profile metadata for everyone and are queried alongside the read relays.
export const PROFILE_RELAYS = [
  'wss://purplepag.es',
  'wss://user.kindpag.es',
] as const;

function loadEnabledReadonly(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set(READONLY_RELAYS.map(([url]) => url));
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set(READONLY_RELAYS.map(([url]) => url));
    return new Set(parsed.filter((url): url is string => READONLY_RELAYS.some(([candidate]) => candidate === url)));
  } catch {
    return new Set(READONLY_RELAYS.map(([url]) => url));
  }
}

function saveEnabledReadonly(enabled: Set<string>): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(enabled))); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('neonsentinel:relays'));
}

export function getRelayConfigs(): RelayConfig[] {
  const enabled = loadEnabledReadonly();
  return [
    {
      url: PRIVATE_TEST_RELAY,
      label: 'trotters',
      mode: 'readwrite',
      enabled: true,
      locked: true,
    },
    ...READONLY_RELAYS.map(([url, label]) => ({
      url,
      label,
      mode: 'readonly' as const,
      enabled: enabled.has(url),
      locked: false,
    })),
  ];
}

export function getReadRelays(): readonly string[] {
  return getRelayConfigs()
    .filter(relay => relay.enabled)
    .map(relay => relay.url);
}

export function getWriteRelays(): readonly string[] {
  return WRITE_RELAYS;
}

/** Relays for kind-0 profile fetches: the dedicated aggregators first, then the enabled read relays. */
export function getProfileRelays(): readonly string[] {
  return Array.from(new Set([...PROFILE_RELAYS, ...getReadRelays()]));
}

export function setReadonlyRelayEnabled(url: string, on: boolean): void {
  if (!READONLY_RELAYS.some(([candidate]) => candidate === url)) return;
  const enabled = loadEnabledReadonly();
  if (on) enabled.add(url);
  else enabled.delete(url);
  saveEnabledReadonly(enabled);
}
