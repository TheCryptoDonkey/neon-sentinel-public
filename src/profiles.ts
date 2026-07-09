import { getProfileRelays, getReadRelays } from './relays.js';

export interface NostrProfile {
  pubkey: string;
  name?: string;
  display_name?: string;
  picture?: string;
  nip05?: string;
  about?: string;
  fetchedAt: number;
}

interface Kind0Event {
  pubkey: string;
  kind: 0;
  created_at: number;
  content: string;
}

interface Kind3Event {
  pubkey: string;
  kind: 3;
  created_at: number;
  tags: string[][];
}

const CACHE_PREFIX = 'neonsentinel:profile:v2:';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function getCachedProfile(pubkey: string): NostrProfile | null {
  const clean = cleanPubkey(pubkey);
  if (!clean) return null;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + clean);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NostrProfile>;
    if (parsed.pubkey !== clean || typeof parsed.fetchedAt !== 'number') return null;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed as NostrProfile;
  } catch {
    return null;
  }
}

export async function fetchProfiles(
  pubkeys: readonly string[],
  opts: { force?: boolean; refreshMissingPictures?: boolean; timeoutMs?: number; relays?: readonly string[] } = {},
): Promise<Map<string, NostrProfile>> {
  const out = new Map<string, NostrProfile>();
  const unique = Array.from(new Set(pubkeys.map(cleanPubkey).filter((pk): pk is string => !!pk)));
  const missing: string[] = [];

  for (const pubkey of unique) {
    const cached = opts.force ? null : getCachedProfile(pubkey);
    if (cached) {
      out.set(pubkey, cached);
      if (opts.refreshMissingPictures && !cached.picture) missing.push(pubkey);
    } else {
      missing.push(pubkey);
    }
  }
  if (missing.length === 0 || typeof WebSocket === 'undefined') return out;

  const relays = [...(opts.relays ?? getProfileRelays())];
  if (relays.length === 0) return out;
  const timeoutMs = opts.timeoutMs ?? 4200;

  return new Promise(resolve => {
    const best = new Map<string, Kind0Event>();
    const sockets: WebSocket[] = [];
    const finishedRelays = new Set<string>();
    let settled = false;

    const settle = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const ws of sockets) {
        try { ws.close(); } catch { /* ignore */ }
      }
      for (const [pubkey, event] of best) {
        const profile = parseProfile(pubkey, event);
        if (!profile) continue;
        saveProfile(profile);
        out.set(pubkey, profile);
      }
      resolve(out);
    };

    const markDone = (relay: string): void => {
      finishedRelays.add(relay);
      if (finishedRelays.size >= relays.length) settle();
    };

    const timer = window.setTimeout(settle, timeoutMs);

    for (const relay of relays) {
      let ws: WebSocket;
      try {
        ws = new WebSocket(relay);
      } catch {
        markDone(relay);
        continue;
      }
      sockets.push(ws);
      const subId = `rk-profile-${Math.random().toString(36).slice(2, 9)}`;

      ws.onopen = () => {
        try {
          ws.send(JSON.stringify(['REQ', subId, { kinds: [0], authors: missing, limit: missing.length }]));
        } catch {
          markDone(relay);
        }
      };

      ws.onmessage = ev => {
        let msg: unknown;
        try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
        if (!Array.isArray(msg)) return;
        if (msg[0] === 'EVENT' && msg[1] === subId && isKind0Event(msg[2])) {
          const event = msg[2];
          const pubkey = cleanPubkey(event.pubkey);
          if (!pubkey || !missing.includes(pubkey)) return;
          const prev = best.get(pubkey);
          if (!prev || event.created_at > prev.created_at) best.set(pubkey, event);
        } else if (msg[0] === 'EOSE' && msg[1] === subId) {
          if (best.size >= missing.length) window.setTimeout(settle, 180);
          else markDone(relay);
        }
      };

      ws.onerror = () => { markDone(relay); };
      ws.onclose = () => { markDone(relay); };
    }
  });
}

export async function fetchFollowPubkeys(
  pubkey: string,
  opts: { timeoutMs?: number; relays?: readonly string[]; limit?: number } = {},
): Promise<string[]> {
  const clean = cleanPubkey(pubkey);
  if (!clean || typeof WebSocket === 'undefined') return [];
  const relays = [...(opts.relays ?? getReadRelays())];
  if (relays.length === 0) return [];
  const timeoutMs = opts.timeoutMs ?? 3600;
  const limit = opts.limit ?? 96;

  return new Promise(resolve => {
    const sockets: WebSocket[] = [];
    const finishedRelays = new Set<string>();
    let best: Kind3Event | null = null;
    let settled = false;

    const settle = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const ws of sockets) {
        try { ws.close(); } catch { /* ignore */ }
      }
      const follows = best?.tags
        .filter(tag => tag[0] === 'p')
        .map(tag => cleanPubkey(tag[1]))
        .filter((candidate): candidate is string => !!candidate && candidate !== clean)
        .slice(0, limit) ?? [];
      resolve(Array.from(new Set(follows)));
    };

    const markDone = (relay: string): void => {
      finishedRelays.add(relay);
      if (finishedRelays.size >= relays.length) settle();
    };

    const timer = window.setTimeout(settle, timeoutMs);

    for (const relay of relays) {
      let ws: WebSocket;
      try {
        ws = new WebSocket(relay);
      } catch {
        markDone(relay);
        continue;
      }
      sockets.push(ws);
      const subId = `rk-follows-${Math.random().toString(36).slice(2, 9)}`;
      ws.onopen = () => {
        try {
          ws.send(JSON.stringify(['REQ', subId, { kinds: [3], authors: [clean], limit: 1 }]));
        } catch {
          markDone(relay);
        }
      };
      ws.onmessage = ev => {
        let msg: unknown;
        try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
        if (!Array.isArray(msg)) return;
        if (msg[0] === 'EVENT' && msg[1] === subId && isKind3Event(msg[2])) {
          const event = msg[2];
          if (!best || event.created_at > best.created_at) best = event;
        } else if (msg[0] === 'EOSE' && msg[1] === subId) {
          if (best) window.setTimeout(settle, 160);
          else markDone(relay);
        }
      };
      ws.onerror = () => { markDone(relay); };
      ws.onclose = () => { markDone(relay); };
    }
  });
}

export async function fetchFollowerPubkeys(
  pubkey: string,
  opts: { timeoutMs?: number; relays?: readonly string[]; limit?: number } = {},
): Promise<string[]> {
  const clean = cleanPubkey(pubkey);
  if (!clean || typeof WebSocket === 'undefined') return [];
  const relays = [...(opts.relays ?? getReadRelays())];
  if (relays.length === 0) return [];
  const timeoutMs = opts.timeoutMs ?? 4200;
  const limit = opts.limit ?? 96;

  return new Promise(resolve => {
    const sockets: WebSocket[] = [];
    const finishedRelays = new Set<string>();
    const bestByAuthor = new Map<string, Kind3Event>();
    let settled = false;

    const settle = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const ws of sockets) {
        try { ws.close(); } catch { /* ignore */ }
      }
      const followers = Array.from(bestByAuthor.values())
        .sort((a, b) => b.created_at - a.created_at)
        .map(event => event.pubkey)
        .slice(0, limit);
      resolve(followers);
    };

    const markDone = (relay: string): void => {
      finishedRelays.add(relay);
      if (finishedRelays.size >= relays.length) settle();
    };

    const timer = window.setTimeout(settle, timeoutMs);

    for (const relay of relays) {
      let ws: WebSocket;
      try {
        ws = new WebSocket(relay);
      } catch {
        markDone(relay);
        continue;
      }
      sockets.push(ws);
      const subId = `rk-followers-${Math.random().toString(36).slice(2, 9)}`;
      ws.onopen = () => {
        try {
          ws.send(JSON.stringify(['REQ', subId, { kinds: [3], '#p': [clean], limit: Math.max(limit * 2, 80) }]));
        } catch {
          markDone(relay);
        }
      };
      ws.onmessage = ev => {
        let msg: unknown;
        try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
        if (!Array.isArray(msg)) return;
        if (msg[0] === 'EVENT' && msg[1] === subId && isKind3Event(msg[2])) {
          const event = msg[2];
          const author = cleanPubkey(event.pubkey);
          if (!author || author === clean) return;
          const prev = bestByAuthor.get(author);
          if (!prev || event.created_at > prev.created_at) bestByAuthor.set(author, { ...event, pubkey: author });
          if (bestByAuthor.size >= limit) window.setTimeout(settle, 220);
        } else if (msg[0] === 'EOSE' && msg[1] === subId) {
          if (bestByAuthor.size >= limit) window.setTimeout(settle, 160);
          else markDone(relay);
        }
      };
      ws.onerror = () => { markDone(relay); };
      ws.onclose = () => { markDone(relay); };
    }
  });
}

export function profileDisplayName(profile: NostrProfile | null, fallback: string): string {
  const display = profile?.display_name?.trim() || profile?.name?.trim();
  return display ? display.slice(0, 18) : fallback;
}

export function profilePictureCandidates(picture: string | null | undefined): string[] {
  const clean = cleanProfilePictureUrl(picture);
  if (!clean) return [];
  return [`/api/profile-image?url=${encodeURIComponent(clean)}`, clean];
}

function saveProfile(profile: NostrProfile): void {
  try { localStorage.setItem(CACHE_PREFIX + profile.pubkey, JSON.stringify(profile)); } catch { /* ignore */ }
}

function isKind0Event(value: unknown): value is Kind0Event {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Partial<Kind0Event>;
  return event.kind === 0
    && typeof event.pubkey === 'string'
    && typeof event.created_at === 'number'
    && typeof event.content === 'string';
}

function isKind3Event(value: unknown): value is Kind3Event {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Partial<Kind3Event>;
  return event.kind === 3
    && typeof event.pubkey === 'string'
    && typeof event.created_at === 'number'
    && Array.isArray(event.tags);
}

function parseProfile(pubkey: string, event: Kind0Event): NostrProfile | null {
  try {
    const raw = JSON.parse(event.content) as Record<string, unknown>;
    if (typeof raw !== 'object' || raw === null) return null;
    const profile: NostrProfile = { pubkey, fetchedAt: Date.now() };
    if (typeof raw.name === 'string') profile.name = raw.name.slice(0, 64);
    if (typeof raw.display_name === 'string') profile.display_name = raw.display_name.slice(0, 64);
    if (typeof raw.displayName === 'string') profile.display_name = raw.displayName.slice(0, 64);
    const picture = typeof raw.picture === 'string'
      ? raw.picture
      : typeof raw.image === 'string'
        ? raw.image
        : '';
    if (/^https?:\/\//i.test(picture) && picture.length < 2048) profile.picture = picture;
    if (typeof raw.nip05 === 'string') profile.nip05 = raw.nip05.slice(0, 128);
    if (typeof raw.about === 'string') profile.about = raw.about.slice(0, 280);
    return profile;
  } catch {
    return null;
  }
}

function cleanPubkey(pubkey: string | null | undefined): string | null {
  if (typeof pubkey !== 'string') return null;
  const clean = pubkey.toLowerCase();
  return /^[0-9a-f]{64}$/.test(clean) ? clean : null;
}

function cleanProfilePictureUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null;
  const clean = url.trim();
  if (!/^https?:\/\//i.test(clean) || clean.length >= 2048) return null;
  return clean;
}
