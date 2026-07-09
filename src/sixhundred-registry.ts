// 600.wtf membership — the NIP-05 registry at https://600.wtf/.well-known/nostr.json
// doubles as the roll of the 600 billion. A pubkey listed there is a verified
// member; the handle becomes their name@600.wtf NIP-05 identifier.
//
// Pure parsing only: this module is shared with the claim server (which adds
// the tamper-proof nip05 tag to signed score events), so it must not touch
// browser or Node globals. Client fetch/caching lives in sixhundred.ts.

export const SIX_HUNDRED_DOMAIN = '600.wtf';
export const SIX_HUNDRED_REGISTRY_URL = `https://${SIX_HUNDRED_DOMAIN}/.well-known/nostr.json`;

const HEX_PUBKEY = /^[0-9a-f]{64}$/;
// NIP-05 local-part charset: a-z0-9-_. (case-insensitive).
const NIP05_NAME = /^[a-z0-9\-_.]{1,64}$/i;

/**
 * Parse a NIP-05 `names` document into pubkey → preferred handle.
 * Several members register aliases against one pubkey (j/janine, n/nind);
 * the longest alias wins because single letters are shortcuts, not names.
 */
export function parseSixHundredRegistry(value: unknown): Map<string, string> {
  const registry = new Map<string, string>();
  if (!value || typeof value !== 'object') return registry;
  const names = (value as { names?: unknown }).names;
  if (!names || typeof names !== 'object') return registry;
  for (const [name, pubkey] of Object.entries(names as Record<string, unknown>)) {
    if (typeof pubkey !== 'string' || !NIP05_NAME.test(name)) continue;
    const clean = pubkey.toLowerCase();
    if (!HEX_PUBKEY.test(clean)) continue;
    const existing = registry.get(clean);
    if (!existing || name.length > existing.length) registry.set(clean, name);
  }
  return registry;
}

export function sixHundredNip05(handle: string): string {
  return `${handle}@${SIX_HUNDRED_DOMAIN}`;
}
