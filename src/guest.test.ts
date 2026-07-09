import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSecretKey } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';
import { cleanGuestName, getGuestRecord, renameGuest } from './guest.js';
import { createMemoryStorage, installMinimalWindow } from './test-support/memory-storage.js';

// Must mirror the private STORAGE_KEY constant in guest.ts.
const STORAGE_KEY = 'neonsentinel:guest:v1';

function seedGuest(name: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    nsecHex: bytesToHex(generateSecretKey()),
    name,
    createdAt: 1_700_000_000_000,
    v: 1,
  }));
}

beforeEach(() => {
  globalThis.localStorage = createMemoryStorage();
  installMinimalWindow();
  // Node ships a global WebSocket; without this the kind-0 republish inside
  // renameGuest would open real relay sockets from the test run.
  vi.stubGlobal('WebSocket', undefined);
});

describe('cleanGuestName', () => {
  it('collapses whitespace and falls back to Guest when empty', () => {
    expect(cleanGuestName('  neo   sentinel  ')).toBe('neo sentinel');
    expect(cleanGuestName('   ')).toBe('Guest');
  });
});

describe('renameGuest', () => {
  it('returns the cleaned name without persisting anything when no guest is stored', () => {
    expect(renameGuest('DONKEY')).toBe('DONKEY');
    expect(getGuestRecord()).toBeNull();
  });

  it('updates the stored guest name', () => {
    seedGuest('Guest');
    expect(renameGuest('DONKEY')).toBe('DONKEY');
    expect(getGuestRecord()?.name).toBe('DONKEY');
  });

  it('keeps the previous name when the entry cleans to the same value', () => {
    seedGuest('DONKEY');
    expect(renameGuest('  DONKEY ')).toBe('DONKEY');
    expect(getGuestRecord()?.name).toBe('DONKEY');
  });

  it('falls back to Guest for an empty entry', () => {
    seedGuest('Old Name');
    expect(renameGuest('   ')).toBe('Guest');
    expect(getGuestRecord()?.name).toBe('Guest');
  });
});
