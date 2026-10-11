import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeEvent, getPublicKey, type EventTemplate } from 'nostr-tools/pure';
import { pendingPersonalScores } from './personal-score-outbox.js';
import { createMemoryStorage } from './test-support/memory-storage.js';
import { submitScoreClaim, type RelaykeepRunSummary } from './scoring.js';
const a = new Uint8Array(32).fill(11), b = new Uint8Array(32).fill(12);
const pubkey = getPublicKey(a);
const sign = (template: Record<string, unknown>, key = a) => finalizeEvent(template as unknown as EventTemplate, key);
const run = (): RelaykeepRunSummary => ({runId:'owned-run',playerMode:'nostr',playerPubkey:pubkey,score:6326,wave:1,sats:0,startedAt:1000,finishedAt:45000,durationMs:44000,rescues:0,knownRescues:0,lost:2,maxCombo:5});
beforeEach(() => {
  vi.stubGlobal('window', {setTimeout,clearTimeout});
  vi.stubGlobal('localStorage', createMemoryStorage());
  vi.stubGlobal('location', {origin:'https://neonsentinel.com'});
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn(async()=>new Response(JSON.stringify({ok:true,score_event_id:'a'.repeat(64)}),{status:200})));
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
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
  it('shares one approval and claim for concurrent retries',async()=>{
    let approve!:()=>void;
    const held=new Promise<void>(resolve=>approve=resolve);
    const signEvent=vi.fn(async(t)=>{await held;return sign(t);});
    const session={pubkey,signer:{signEvent}};
    const first=submitScoreClaim(session,run());const second=submitScoreClaim(session,run());
    approve();await Promise.all([first,second]);
    expect(signEvent).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps an unconfirmed accepted receipt and clears only confirmed publication',async()=>{
    await submitScoreClaim({pubkey,signer:{signEvent:async(t)=>sign(t)}},run());
    expect(pendingPersonalScores(pubkey)).toHaveLength(1);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ok:true,score_event_id:'a'.repeat(64),published:{ok:1,total:7}})));
    await submitScoreClaim({pubkey,signer:{signEvent:async(t)=>sign(t)}},run());
    expect(pendingPersonalScores(pubkey)).toHaveLength(0);
  });
  it('blocks publication when the session is revoked during approval',async()=>{
    let current=true;
    const result=await submitScoreClaim({pubkey,signer:{signEvent:async(t)=>{current=false;return sign(t);}}},run(),()=>current);
    expect(result.ok).toBe(false);expect(fetch).not.toHaveBeenCalled();expect(pendingPersonalScores(pubkey)).toHaveLength(1);
  });
  it('bounds a stalled claim body and keeps the receipt available for retry',async()=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    vi.stubGlobal('window',{setTimeout,clearTimeout});
    const stalled={status:200,json:()=>new Promise(()=>{})} as Response;
    vi.mocked(fetch).mockResolvedValue(stalled);
    const result=submitScoreClaim({pubkey,signer:{signEvent:async(t)=>sign(t)}},run());
    for(let i=0;i<20&&vi.mocked(fetch).mock.calls.length===0;i++)await new Promise(resolve=>setImmediate(resolve));
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000+800+15_000);
    expect((await result).ok).toBe(false);expect(pendingPersonalScores(pubkey)).toHaveLength(1);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ok:true,score_event_id:'a'.repeat(64),published:{ok:1,total:7}})));
    expect((await submitScoreClaim({pubkey,signer:{signEvent:async(t)=>sign(t)}},run())).ok).toBe(true);
    expect(pendingPersonalScores(pubkey)).toHaveLength(0);
  });

  it('rejects an identity change during approval even if the old signature is valid',async()=>{
    const session={pubkey,signer:{signEvent:async(t:Record<string,unknown>)=>{session.pubkey=getPublicKey(b);return sign(t);}}};
    const result=await submitScoreClaim(session,run());
    expect(result.ok).toBe(false);expect(fetch).not.toHaveBeenCalled();expect(pendingPersonalScores(pubkey)).toHaveLength(1);
  });

});
