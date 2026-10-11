// Private integration gate: compiled API, disposable keys, no external network.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {generateSecretKey, getPublicKey, finalizeEvent, verifyEvent} from 'nostr-tools/pure';
import {nip19} from 'nostr-tools';
const scratch = await mkdtemp(join(tmpdir(), 'neon-claim-recovery-'));
const gameKey = generateSecretKey(), playerKey = generateSecretKey();
const registry = createServer((req,res) => {res.setHeader('content-type','application/json');res.end('{"names":{}}');});
await new Promise(resolve => registry.listen(0,'127.0.0.1',resolve));
const portProbe = createServer();
await new Promise(resolve => portProbe.listen(0,'127.0.0.1',resolve));
const port = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const journal = join(scratch,'claims.jsonl'), publications = join(scratch,'publications.jsonl');
const bootstrap = join(scratch,'bootstrap.mjs');
await writeFile(bootstrap, `
import {appendFileSync} from 'node:fs';
const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, ...args) => {
  if (new URL(url).hostname !== '127.0.0.1') throw new Error('external_fetch_blocked');
  return nativeFetch(url, ...args);
};
globalThis.WebSocket = class {
  constructor() {setTimeout(() => this.onopen?.(), 0);}
  send(raw) {
    const [, event] = JSON.parse(raw);
    if (event.kind === 30762) appendFileSync(process.env.PROBE_PUBLICATIONS, JSON.stringify(event)+'\\n');
    setTimeout(() => this.onmessage?.({data:JSON.stringify(['OK',event.id,process.env.PROBE_ACK === '1','fixture'])}),0);
  }
  close() {}
};
await import(${JSON.stringify(new URL('../server-dist/index.js',import.meta.url).href)});
`);
let child;
async function stop() {
  if (!child || child.exitCode !== null) return;
  const done = new Promise(resolve => child.once('exit',resolve));
  child.kill('SIGTERM'); await done;
}
async function start(ack) {
  child=spawn(process.execPath,[bootstrap],{stdio:['ignore','ignore','ignore'],env:{...process.env,
    PORT:String(port),HOST:'127.0.0.1',NEON_SENTINEL_CLAIM_LOG:journal,
    NEON_SENTINEL_GAME_NSEC:Buffer.from(gameKey).toString('hex'),
    NEON_SENTINEL_GAME_NPUB:nip19.npubEncode(getPublicKey(gameKey)),
    NEON_SENTINEL_WRITE_RELAYS:'ws://private-fixture.invalid',
    NEON_SENTINEL_600B_URL:`http://127.0.0.1:${registry.address().port}/registry`,
    NEON_SENTINEL_PUBLISH:'1',PROBE_ACK:ack?'1':'0',PROBE_PUBLICATIONS:publications}});
  for(let i=0;i<100;i++) {
    if(child.exitCode!==null) throw new Error('private_api_exited');
    try {if((await fetch(`${origin}/healthz`)).ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('private_api_not_ready');
}
async function claim(body,{age=0,key=playerKey}={}) {
  const payload=JSON.stringify(body),url=`${origin}/api/claim`;
  const auth=finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000)-age,content:'',tags:[
    ['u',url],['method','POST'],['payload',createHash('sha256').update(payload).digest('hex')]]},key);
  const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:`Nostr ${Buffer.from(JSON.stringify(auth)).toString('base64')}`},body:payload});
  return {status:res.status,body:await res.json()};
}
try {
  const finished=Date.now()-7*86400000;
  const run={game:'neonsentinel',run_id:'saved-run-seven-days',score:100,wave:1,duration_ms:30000,
    started_at:finished-30000,finished_at:finished,credits:0,sats_claimed:0,rescues:1,known_rescues:0,lost:0,max_combo:1,player_mode:'nostr'};
  await start(false);
  const first=await claim(run); assert.equal(first.status,200);assert.equal(first.body.published.ok,0);
  const events=(await readFile(publications,'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(events.length,1);assert(verifyEvent(events[0]));assert(events[0].tags.some(t=>t[0]==='p'&&t[1]===getPublicKey(playerKey)));
  const durable=JSON.parse((await readFile(journal,'utf8')).trim().split('\n')[0]);
  assert.equal(durable.event.id,events[0].id);assert.equal(durable.claim.finished_at,finished);
  assert.equal(durable.key,`${getPublicKey(playerKey)}:${run.run_id}:${run.started_at}:${run.finished_at}`);
  await stop();await start(true);
  const recovered=await claim({...run});assert.equal(recovered.status,200);assert.equal(recovered.body.published.ok,1);
  assert.equal(recovered.body.score_event_id,first.body.score_event_id);
  const duplicate=await claim(run);assert.equal(duplicate.body.score_event_id,first.body.score_event_id);
  assert.equal((await claim({...run,score:101})).status,409);
  assert.equal((await claim({...run,finished_at:Date.now()+120000})).status,422);
  assert.equal((await claim(run,{age:600})).status,401);
  const published=(await readFile(publications,'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(published.length,2);assert.equal(published[0].id,published[1].id);
  await stop();await start(true);
  const parallel=await Promise.all([claim({...run,run_id:'parallel-saved-run'}),claim({...run,run_id:'parallel-saved-run'})]);
  assert(parallel.every(r=>r.status===200));assert.equal(parallel[0].body.score_event_id,parallel[1].body.score_event_id);
  const final=(await readFile(publications,'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(final.length,3);
  await stop();
  const legacy={...durable,published:{ok:0,total:1}};
  delete legacy.event;
  await writeFile(journal,JSON.stringify(legacy)+'\n');
  await start(true);
  const legacyRetry=await claim(run);
  assert.equal(legacyRetry.status,409);assert.equal(legacyRetry.body.error,'recovery_event_missing');
  assert.equal((await readFile(publications,'utf8')).trim().split('\n').length,3);
  await stop();await writeFile(journal,'corrupt durable history\n');
  await assert.rejects(()=>start(true),/private_api_exited/);
  console.log(JSON.stringify({ok:true,runAgeDays:7,restartRecovery:true,sameEventRepublished:true,immutableRun:true,
    concurrentDeduplication:true,freshNip98Required:true,legacyJournalKeyCompatible:true,legacyMissingEventFailsClosed:true,
    corruptHistoryFailsClosed:true,externalNetwork:false,liveProvider:false}));
} finally {await stop();await new Promise(resolve=>registry.close(resolve));await rm(scratch,{recursive:true,force:true});}
