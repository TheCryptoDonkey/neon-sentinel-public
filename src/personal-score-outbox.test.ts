import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from './test-support/memory-storage.js';
import { forgetPersonalScore, pendingPersonalScores, rememberPersonalScore } from './personal-score-outbox.js';
import type { RelaykeepRunSummary } from './scoring.js';
const a='a'.repeat(64), b='b'.repeat(64);
const run=(runId='one',pubkey=a): RelaykeepRunSummary=>({runId,playerMode:'nostr',playerPubkey:pubkey,score:6326,wave:1,sats:0,startedAt:1000,finishedAt:45000,durationMs:44000,rescues:0,knownRescues:0,lost:2,maxCombo:5});
beforeEach(()=>{vi.restoreAllMocks();globalThis.localStorage=createMemoryStorage();});
describe('account-bound public score recovery',()=>{
  it('survives reload without changing the original run or showing another account',()=>{
    expect(rememberPersonalScore(run())).toBe(true);
    const stored=localStorage.getItem('neonsentinel:personal-score-outbox:v1');
    globalThis.localStorage=createMemoryStorage();localStorage.setItem('neonsentinel:personal-score-outbox:v1',stored!);
    expect(pendingPersonalScores(a)[0].summary.score).toBe(6326);expect(pendingPersonalScores(b)).toEqual([]);
  });
  it('pins the first receipt through duplicate attempts and caller mutation',()=>{
    const summary=run();rememberPersonalScore(summary);summary.score=9999;
    rememberPersonalScore(summary);
    expect(pendingPersonalScores(a)[0].summary.score).toBe(6326);
  });
  it('clears only the exact account and run',()=>{
    rememberPersonalScore(run());rememberPersonalScore(run('two'));rememberPersonalScore(run('one',b));
    forgetPersonalScore(a,'one');expect(pendingPersonalScores(a).map(r=>r.summary.runId)).toEqual(['two']);expect(pendingPersonalScores(b)).toHaveLength(1);
  });
  it('refuses capacity overflow without evicting pending scores',()=>{
    for(let i=0;i<64;i++)expect(rememberPersonalScore(run(String(i)))).toBe(true);
    expect(rememberPersonalScore(run('overflow'))).toBe(false);expect(pendingPersonalScores(a)).toHaveLength(64);
  });
  it('preserves malformed storage rather than replacing it',()=>{
    localStorage.setItem('neonsentinel:personal-score-outbox:v1','broken');expect(rememberPersonalScore(run())).toBe(false);
    expect(localStorage.getItem('neonsentinel:personal-score-outbox:v1')).toBe('broken');
  });
  it('reports storage failure rather than claiming a saved score',()=>{
    vi.spyOn(localStorage,'setItem').mockImplementation(()=>{throw Error('quota');});expect(rememberPersonalScore(run())).toBe(false);
  });
  it('rejects a guest or substituted-owner receipt',()=>{
    expect(rememberPersonalScore({...run(),playerMode:'guest'})).toBe(false);
    localStorage.setItem('neonsentinel:personal-score-outbox:v1',JSON.stringify([{pubkey:b,summary:run()}]));
    expect(pendingPersonalScores(a)).toEqual([]);expect(rememberPersonalScore(run('two'))).toBe(false);
  });
});
