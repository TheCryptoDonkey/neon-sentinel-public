// Use the locked SDK picker with a private restored-identity fixture. External
// writes and relay sockets are blocked; this does not prove provider login.
import {chromium} from 'playwright';
import {generateSecretKey,getPublicKey} from 'nostr-tools/pure';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const dist=process.env.NEON_TEST_DIST||fileURLToPath(new URL('../dist',import.meta.url));
const origin='https://neonsentinel.com';
const pubkey=getPublicKey(generateSecretKey());
const key='neonsentinel:personal-score-outbox:v1';
const receipts=[{pubkey,summary:{runId:'keyboard-fixture',playerMode:'nostr',playerPubkey:pubkey,score:1,wave:1,sats:0,startedAt:1,finishedAt:2,durationMs:1,rescues:0,knownRescues:0,lost:0,maxCombo:0}}];
const sdkPath='/signet/signet-login-0.17.3.iife.js';
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.m4a':'audio/mp4'};
const browser=await chromium.launch(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.route('**/*',route=>route.request().method()==='GET'?route.continue():route.abort());
 await context.routeWebSocket(/^wss?:/,socket=>socket.close());
 await context.addInitScript(({key,receipts})=>{if(location.origin==='https://neonsentinel.com')localStorage.setItem(key,JSON.stringify(receipts));},{key,receipts});
 const assets=[];
 await context.route(origin+'/**',async route=>{
  if(route.request().method()!=='GET')return route.fallback();
  const path=decodeURIComponent(new URL(route.request().url()).pathname);
  const file=resolve(dist,'.'+(path==='/'?'/index.html':path));
  if(!file.startsWith(dist+'/'))return route.abort();
  let body=await readFile(file).catch(()=>null);if(!body)return route.abort();
  if(path.startsWith('/assets/')&&path.endsWith('.js'))assets.push({path,sha256:createHash('sha256').update(body).digest('hex')});
  if(path===sdkPath)body=Buffer.from(body.toString()+`;window.Signet.restoreSession=async()=>({pubkey:${JSON.stringify(pubkey)},method:'nip07',signer:{signEvent:async()=>{throw Error('private offline fixture')}}});`);
  return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body});
 });
 const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/?attract=1',{waitUntil:'domcontentloaded'});
 // The deliberately accelerated demo can start while a loaded CI worker is
 // finishing setup. Use the actual cabinet key to return to the title and
 // begin the picker check with a fresh idle interval.
 await page.waitForFunction(()=>!!document.body.dataset.neonPhase && !!window.Signet);
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>document.body.dataset.neonPhase==='title');
 await page.locator('#score-recovery-open').click();
 await page.locator('#score-recovery-reconnect').click();
 await page.locator('#signet-login-dialog[open]').waitFor();
 await page.locator('button[data-choice="local-signet"]').press('Enter');
 await page.locator('#signet-login-open-signet').waitFor({state:'visible',timeout:5000});
 // The supported attract query reduces the idle interval to 2.6 seconds.
 await page.waitForTimeout(4000);
 assert.equal(await page.evaluate(()=>document.body.dataset.neonPhase),'title');
 assert(!await page.locator('#v4v').isVisible());
 await page.keyboard.press('Escape');
 await page.locator('#score-recovery-status').filter({hasText:'Reconnect cancelled'}).waitFor();
 assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key),receipts);
 assert.deepEqual(errors,[]);
 const proof={fixture:'Private seeded public receipt and restored identity; real locked SDK picker, blocked external writes and sockets.',assets,actualMySignet:false,physicalDevice:false,externalWritesBlocked:true,acceleratedAttract:true,nativeEnterActivatesSdk:true,idleDemoBlockedDuringDialog:true,nativeEscapeCancelsSdk:true,cancelKeepsOriginalReceipt:true};
 await writeFile(process.env.NEON_RECOVERY_EVIDENCE||'/tmp/neon-actual-sdk-keyboard.json',JSON.stringify(proof,null,2)+'\n');
 console.log(JSON.stringify({result:'pass',...proof}));
}finally{await browser.close();}
