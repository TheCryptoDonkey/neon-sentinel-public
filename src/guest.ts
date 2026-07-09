import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';
import { getWriteRelays } from './relays.js';
import type { SignedNostrEvent } from './scoring.js';

const STORAGE_KEY = 'neonsentinel:guest:v1';
const MAX_NAME_LEN = 32;

interface StoredGuest {
  nsecHex: string;
  name: string;
  createdAt: number;
  v: 1;
}

export interface GuestSession {
  pubkey: string;
  method: 'guest';
  displayName: string;
  signer: {
    signEvent(event: Record<string, unknown>): Promise<SignedNostrEvent>;
    close(): Promise<void>;
  };
}

export function getGuestRecord(): { name: string; pubkey: string; createdAt: number } | null {
  const stored = readStored();
  if (!stored) return null;
  try {
    return {
      name: stored.name,
      pubkey: getPublicKey(hexToBytes(stored.nsecHex)),
      createdAt: stored.createdAt,
    };
  } catch {
    return null;
  }
}

export async function restoreGuestSession(): Promise<GuestSession | null> {
  const stored = readStored();
  if (!stored) return null;
  return makeGuestSession(stored, false);
}

export async function createGuestSession(name: string): Promise<GuestSession> {
  const existing = readStored();
  if (existing) return makeGuestSession(existing, false);
  const cleanName = cleanGuestName(name);
  const secret = generateValidSecretKey();
  const stored: StoredGuest = {
    nsecHex: bytesToHex(secret),
    name: cleanName,
    createdAt: Date.now(),
    v: 1,
  };
  writeStored(stored);
  return makeGuestSession(stored, true);
}

export function isGuestSession(session: { method?: string } | null | undefined): boolean {
  return session?.method === 'guest';
}

/**
 * Rename the stored guest and republish their kind-0 profile so leaderboards
 * pick the new name up. Returns the cleaned name either way; with no stored
 * guest there is nothing to persist and the caller just uses the clean name.
 */
export function renameGuest(name: string): string {
  const clean = cleanGuestName(name);
  const stored = readStored();
  if (!stored || stored.name === clean) return clean;
  writeStored({ ...stored, name: clean });
  try {
    const signer = new GuestSigner(hexToBytes(stored.nsecHex));
    void publishGuestProfile(signer, clean)
      .catch(err => console.warn('[guest] profile rename publish failed:', err));
  } catch {
    // Corrupt key material; the rename is still stored locally.
  }
  return clean;
}

export function cleanGuestName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LEN);
  return clean || 'Guest';
}

async function makeGuestSession(stored: StoredGuest, freshlyCreated: boolean): Promise<GuestSession> {
  const secret = hexToBytes(stored.nsecHex);
  const signer = new GuestSigner(secret);
  if (freshlyCreated) {
    void publishGuestProfile(signer, stored.name)
      .catch(err => console.warn('[guest] profile publish failed:', err));
  }
  return {
    pubkey: signer.pubkey,
    method: 'guest',
    displayName: stored.name,
    signer,
  };
}

class GuestSigner {
  readonly pubkey: string;

  constructor(private readonly secret: Uint8Array) {
    this.pubkey = getPublicKey(secret);
  }

  async signEvent(event: Record<string, unknown>): Promise<SignedNostrEvent> {
    const kind = typeof event.kind === 'number' ? event.kind : 1;
    const createdAt = typeof event.created_at === 'number' ? event.created_at : Math.floor(Date.now() / 1000);
    const content = typeof event.content === 'string' ? event.content : '';
    const tags = coerceTags(event.tags);
    return finalizeEvent({
      kind,
      created_at: createdAt,
      content,
      tags,
    }, this.secret) as SignedNostrEvent;
  }

  async close(): Promise<void> {
    // Local signer, no socket to close.
  }
}

async function publishGuestProfile(signer: GuestSigner, name: string): Promise<void> {
  const event = await signer.signEvent({
    kind: 0,
    content: JSON.stringify({
      name,
      display_name: name,
      about: 'Neon Sentinel guest player. Holding the relay, saving the keys.',
      client: 'neon-sentinel-guest',
    }),
    tags: [],
    created_at: Math.floor(Date.now() / 1000),
  });
  await Promise.allSettled(getWriteRelays().map(relay => publishToRelay(relay, event)));
}

function publishToRelay(relay: string, event: SignedNostrEvent, timeoutMs = 4200): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket === 'undefined') {
      reject(new Error('websocket_unavailable'));
      return;
    }
    let ws: WebSocket;
    let settled = false;
    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      if (err) reject(err);
      else resolve();
    };
    const timer = window.setTimeout(() => finish(new Error('timeout')), timeoutMs);
    try {
      ws = new WebSocket(relay);
    } catch (err) {
      window.clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    ws.onopen = () => {
      try { ws.send(JSON.stringify(['EVENT', event])); } catch { finish(new Error('send_failed')); }
    };
    ws.onmessage = ev => {
      let msg: unknown;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
      if (!Array.isArray(msg) || msg[0] !== 'OK' || msg[1] !== event.id) return;
      finish(msg[2] === true ? undefined : new Error(typeof msg[3] === 'string' ? msg[3] : 'rejected'));
    };
    ws.onerror = () => finish(new Error('relay_error'));
    ws.onclose = () => finish(new Error('closed'));
  });
}

function coerceTags(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  const tags: string[][] = [];
  for (const tag of value) {
    if (!Array.isArray(tag)) continue;
    const clean = tag.filter((item): item is string => typeof item === 'string');
    if (clean.length > 0) tags.push(clean);
  }
  return tags;
}

function generateValidSecretKey(): Uint8Array {
  for (let i = 0; i < 4; i += 1) {
    const secret = generateSecretKey();
    try {
      getPublicKey(secret);
      return secret;
    } catch {
      // Extremely unlikely; retry with fresh entropy.
    }
  }
  throw new Error('guest_key_failed');
}

function readStored(): StoredGuest | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredGuest>;
    if (typeof parsed.nsecHex !== 'string' || !/^[0-9a-f]{64}$/i.test(parsed.nsecHex)) return null;
    if (typeof parsed.name !== 'string') return null;
    return {
      nsecHex: parsed.nsecHex.toLowerCase(),
      name: cleanGuestName(parsed.name),
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
      v: 1,
    };
  } catch {
    return null;
  }
}

function writeStored(record: StoredGuest): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch { /* ignore */ }
}
