import { describe, expect, it } from 'vitest';
import { parseSixHundredRegistry, sixHundredNip05, SIX_HUNDRED_REGISTRY_URL } from './sixhundred-registry.js';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);

describe('parseSixHundredRegistry', () => {
  it('maps hex pubkeys to handles', () => {
    const registry = parseSixHundredRegistry({ names: { alice: PK_A, bob: PK_B } });
    expect(registry.get(PK_A)).toBe('alice');
    expect(registry.get(PK_B)).toBe('bob');
    expect(registry.size).toBe(2);
  });

  it('prefers the longest alias when one pubkey has several names', () => {
    expect(parseSixHundredRegistry({ names: { j: PK_A, janine: PK_A } }).get(PK_A)).toBe('janine');
    expect(parseSixHundredRegistry({ names: { janine: PK_A, j: PK_A } }).get(PK_A)).toBe('janine');
  });

  it('keeps the first alias on equal length', () => {
    expect(parseSixHundredRegistry({ names: { ann: PK_A, bee: PK_A } }).get(PK_A)).toBe('ann');
  });

  it('normalises pubkeys to lower case', () => {
    const registry = parseSixHundredRegistry({ names: { alice: PK_A.toUpperCase() } });
    expect(registry.get(PK_A)).toBe('alice');
  });

  it('skips entries that are not valid NIP-05 rows', () => {
    const registry = parseSixHundredRegistry({
      names: {
        'bad hex': PK_A,
        'spaced name': PK_B,
        short: 'abc123',
        numeric: 42,
        'ok-name_1.x': PK_B,
      },
    });
    expect(registry.size).toBe(1);
    expect(registry.get(PK_B)).toBe('ok-name_1.x');
  });

  it('returns an empty map for malformed documents', () => {
    expect(parseSixHundredRegistry(null).size).toBe(0);
    expect(parseSixHundredRegistry('nope').size).toBe(0);
    expect(parseSixHundredRegistry({}).size).toBe(0);
    expect(parseSixHundredRegistry({ names: 'nope' }).size).toBe(0);
    expect(parseSixHundredRegistry({ names: null }).size).toBe(0);
  });
});

describe('sixHundredNip05', () => {
  it('builds a name@600.wtf identifier', () => {
    expect(sixHundredNip05('darren')).toBe('darren@600.wtf');
  });

  it('registry URL points at the well-known NIP-05 document', () => {
    expect(SIX_HUNDRED_REGISTRY_URL).toBe('https://600.wtf/.well-known/nostr.json');
  });
});
