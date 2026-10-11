import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeEvent, getPublicKey, type EventTemplate } from 'nostr-tools/pure';
import { submitScoreClaim, type RelaykeepRunSummary } from './scoring.js';
const a = new Uint8Array(32).fill(11), b = new Uint8Array(32).fill(12);
const pubkey = getPublicKey(a);
const sign = (template: Record<string, unknown>, key = a) => finalizeEvent(template as unknown as EventTemplate, key);
const run = (): RelaykeepRunSummary => ({runId:'owned-run',playerMode:'nostr',playerPubkey:pubkey,score:6326,wave:1,sats:0,startedAt:1000,finishedAt:45000,durationMs:44000,rescues:0,knownRescues:0,lost:2,maxCombo:5});
beforeEach(() => {
  vi.stubGlobal('window', {setTimeout,clearTimeout});
  vi.stubGlobal('location', {origin:'https://neonsentinel.com'});
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn(async()=>new Response(JSON.stringify({ok:true,score_event_id:'a'.repeat(64)}),{status:200})));
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('finished score identity',()=>{
  it('rejects a retry through another account before asking it to sign',async()=>{
    const signEvent=vi.fn(async(t)=>sign(t,b));
    const result=await submitScoreClaim({pubkey:getPublicKey(b),signer:{signEvent}},run());
    expect(result.ok).toBe(false);expect(signEvent).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects a valid returned signature from another account',async()=>{
    const result=await submitScoreClaim({pubkey,signer:{signEvent:async(t)=>sign(t,b)}},run());
    expect(result.ok).toBe(false);expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects a valid signature over substituted claim details',async()=>{
    const result=await submitScoreClaim({pubkey,signer:{signEvent:async(t)=>sign({...t,content:'different claim'})}},run());
    expect(result.ok).toBe(false);expect(fetch).not.toHaveBeenCalled();
  });
  it('does not trust a cached verification marker on a modified event',async()=>{
    const result=await submitScoreClaim({pubkey,signer:{signEvent:async(t)=>({...sign(t),content:'tampered'})}},run());
    expect(result.ok).toBe(false);expect(fetch).not.toHaveBeenCalled();
  });
  it('accepts the original account and exact claim template',async()=>{
    const result=await submitScoreClaim({pubkey,signer:{signEvent:async(t)=>sign(t)}},run());
    expect(result.ok).toBe(true);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('requires an original owner for a personal score',async()=>{
    const summary=run();delete summary.playerPubkey;
    const signEvent=vi.fn(async(t)=>sign(t));
    const result=await submitScoreClaim({pubkey,signer:{signEvent}},summary);
    expect(result.ok).toBe(false);expect(signEvent).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  });
  it('still signs an explicitly selected guest run',async()=>{
    const summary={...run(),playerMode:'guest' as const};delete summary.playerPubkey;
    const result=await submitScoreClaim({pubkey,signer:{signEvent:async(t)=>sign(t)}},summary);
    expect(result.ok).toBe(true);expect(fetch).toHaveBeenCalledTimes(1);
  });
});
