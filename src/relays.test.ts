import { beforeEach, describe, expect, it } from 'vitest';
import {
  getProfileRelays,
  getReadRelays,
  getRelayConfigs,
  getWriteRelays,
  PRIVATE_TEST_RELAY,
  PROFILE_RELAYS,
  setReadonlyRelayEnabled,
  WRITE_RELAYS,
} from './relays.js';
import { createMemoryStorage, installMinimalWindow } from './test-support/memory-storage.js';

// Must mirror the private STORAGE_KEY constant in relays.ts.
const STORAGE_KEY = 'neonsentinel:read-relays:v1';

beforeEach(() => {
  globalThis.localStorage = createMemoryStorage();
  installMinimalWindow();
});

describe('production relay policy', () => {
  it('writes directly to the Gamestr main relay, never the retired hostname', () => {
    expect(WRITE_RELAYS).toContain('wss://main.relay.gamestr.io');
    expect(WRITE_RELAYS).not.toContain('wss://relay.gamestr.io');
  });
});

describe('getRelayConfigs', () => {
  it('always includes the private relay as locked, enabled read-write', () => {
    const trotters = getRelayConfigs().find(relay => relay.url === PRIVATE_TEST_RELAY);
    expect(trotters).toMatchObject({ mode: 'readwrite', enabled: true, locked: true });
  });

  it('enables every read-only relay by default when nothing is stored', () => {
    const readonly = getRelayConfigs().filter(relay => !relay.locked);
    expect(readonly.length).toBeGreaterThan(0);
    expect(readonly.every(relay => relay.enabled)).toBe(true);
  });

  it('falls back to the default fully-enabled set when stored JSON is corrupt', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json');
    const readonly = getRelayConfigs().filter(relay => !relay.locked);
    expect(readonly.every(relay => relay.enabled)).toBe(true);
  });

  it('ignores unknown urls in stored JSON and only re-enables known read-only relays', () => {
    const known = getRelayConfigs().find(relay => !relay.locked)!.url;
    localStorage.setItem(STORAGE_KEY, JSON.stringify([known, 'wss://not-a-real-relay.example']));
    const configs = getRelayConfigs();
    const knownConfig = configs.find(relay => relay.url === known);
    expect(knownConfig?.enabled).toBe(true);
    expect(configs.some(relay => relay.url === 'wss://not-a-real-relay.example')).toBe(false);
  });
});

describe('setReadonlyRelayEnabled', () => {
  it('toggles a read-only relay off and getReadRelays reflects it, without touching write relays', () => {
    const target = getRelayConfigs().find(relay => !relay.locked)!.url;
    setReadonlyRelayEnabled(target, false);
    expect(getReadRelays()).not.toContain(target);
    expect(getWriteRelays()).toEqual(WRITE_RELAYS);
  });

  it('re-enabling a previously disabled relay restores it in getReadRelays', () => {
    const target = getRelayConfigs().find(relay => !relay.locked)!.url;
    setReadonlyRelayEnabled(target, false);
    setReadonlyRelayEnabled(target, true);
    expect(getReadRelays()).toContain(target);
  });

  it('cannot disable the locked private relay — it is not a toggleable read-only entry', () => {
    setReadonlyRelayEnabled(PRIVATE_TEST_RELAY, false);
    const trotters = getRelayConfigs().find(relay => relay.url === PRIVATE_TEST_RELAY);
    expect(trotters?.enabled).toBe(true);
    expect(trotters?.locked).toBe(true);
  });

  it('is a no-op for urls that are not part of the known relay list', () => {
    const before = getRelayConfigs();
    setReadonlyRelayEnabled('wss://unknown.example', true);
    expect(getRelayConfigs()).toEqual(before);
  });
});

describe('getProfileRelays', () => {
  it('puts the dedicated kind-0 aggregators ahead of the enabled read relays', () => {
    const relays = getProfileRelays();
    expect(relays.slice(0, PROFILE_RELAYS.length)).toEqual([...PROFILE_RELAYS]);
    for (const url of getReadRelays()) expect(relays).toContain(url);
  });

  it('deduplicates when a read relay is also a profile relay and tracks read-relay toggles', () => {
    const target = getRelayConfigs().find(relay => !relay.locked)!.url;
    setReadonlyRelayEnabled(target, false);
    const relays = getProfileRelays();
    expect(relays).not.toContain(target);
    expect(new Set(relays).size).toBe(relays.length);
  });
});
