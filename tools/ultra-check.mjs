// Controlled, unranked real-game presentation acceptance. Outputs stay ignored.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const baseline = process.argv.includes('--baseline');
const familiesOnly = process.argv.includes('--families-only');
const selectionOnly = process.argv.includes('--selection-only');
const coreOnly = process.argv.includes('--core-only');
const contactsOnly = process.argv.includes('--contacts-only');
const baseUrl = process.env.ULTRA_BASE_URL || 'http://127.0.0.1:5190/';
if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(baseUrl)) throw new Error('Only unranked loopback fixtures are allowed');
const out = resolve(process.env.ULTRA_OUT || '.playwright-mcp/ultra');
const reference = resolve(process.env.ULTRA_REFERENCE || out);
mkdirSync(out, { recursive: true });
const chromeProfile = `${out}/chrome-${Date.now()}`;
const port = 9400 + Math.floor(Math.random()*1800);
const chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless', '--no-sandbox', '--disable-background-networking', '--disable-sync', '--no-first-run',
  '--run-all-compositor-stages-before-draw',
  '--enable-unsafe-swiftshader',
  '--disable-features=MediaRouter,OptimizationHints,Translate',
  '--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1, EXCLUDE localhost',
  `--remote-debugging-port=${port}`, `--user-data-dir=${chromeProfile}`, 'about:blank',
], { stdio: 'ignore' });
const delay = ms => new Promise(r => setTimeout(r, ms));
let ws;
try {
  let endpoint;
  for (let i = 0; i < 100 && !endpoint; i++) {
    try { endpoint = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === 'page')?.webSocketDebuggerUrl; } catch {}
    if (!endpoint) await delay(100);
  }
  if (!endpoint) throw new Error('Chrome DevTools unavailable');
  ws = new WebSocket(endpoint);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0;
  const pending = new Map();
  const errors = [];
  const consoleErrors = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Fetch.requestPaused' && contactsOnly) {
      const missing = m.params.request.url.includes('missing-skin');
      const colour = m.params.request.url.includes('skin-1') ? '#ff964a' : '#64dded';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#12314b"/><rect x="0" y="0" width="256" height="38" fill="${colour}"/><circle cx="128" cy="137" r="86" fill="#efc595"/><path d="M46 112 Q65 40 143 56 Q206 66 210 109 L156 81 L114 102 L80 83Z" fill="#52293f"/><ellipse cx="94" cy="134" rx="9" ry="13" fill="#14233a"/><ellipse cx="159" cy="134" rx="9" ry="13" fill="#14233a"/><path d="M92 171 Q130 210 167 171" fill="none" stroke="#ab3856" stroke-width="9"/><text x="128" y="28" text-anchor="middle" font-size="25" font-family="sans-serif" font-weight="bold" fill="#10233a">UP</text><rect x="0" y="224" width="256" height="32" fill="#af416a"/></svg>`;
      void send('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:missing?404:200,responseHeaders:[{name:'Content-Type',value:'image/svg+xml'},{name:'Access-Control-Allow-Origin',value:'*'}],body:Buffer.from(missing?'':svg).toString('base64')}).catch(()=>{});
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
    if (m.method === 'Runtime.consoleAPICalled' && ['error','warning'].includes(m.params.type)) consoleErrors.push(m.params.args.map(a=>a.description ?? a.value).join(' '));
    const p = pending.get(m.id);
    if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(`${method} timed out`)); }, 45000);
    pending.set(key, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*://relay.*/*', '*://main.relay.*/*', '*600.wtf*', '*primal.net*', '*nos.lol*'] });
  if (process.argv.includes('--perf') || process.argv.includes('--perf-current')) {
    const measurements = [];
    // A single active page, native rAF and native performance clock. Never run
    // alongside another graphics acceptance job. These are local browser data.
    for (const [name, url] of (process.argv.includes('--perf-current') ? [['current',baseUrl]] : [['before','http://127.0.0.1:5191/'],['after',baseUrl]])) {
      await send('Emulation.setDeviceMetricsOverride', { width:1440,height:900,deviceScaleFactor:1,mobile:false });
      await send('Page.navigate',{url:`${url}?combat&daily`});
      for(let i=0;i<100;i++) { if(await evaluate('!!window.neonSentinelDebugFrame')) break; await delay(100); }
      const sample = await evaluate(`(async () => {
        for(let i=0;i<60;i++) await new Promise(requestAnimationFrame);
        const start=window.neonSentinelDebugFrame();
        const intervals=[]; let previous;
        for(let i=0;i<240;i++) { const now=await new Promise(requestAnimationFrame); if(previous!==undefined) intervals.push(now-previous); previous=now; }
        intervals.sort((a,b)=>a-b);
        const end=window.neonSentinelDebugFrame();
        return {medianMs:intervals[Math.floor(intervals.length*.5)],p95Ms:intervals[Math.floor(intervals.length*.95)],stallsOver50:intervals.filter(x=>x>50).length,phaseStart:start.phase,phaseEnd:end.phase,enemiesStart:start.enemies.length,enemiesEnd:end.enemies.length,presentation:end.presentation ?? null,viewport:[innerWidth,innerHeight]};
      })()`);
      measurements.push({name,...sample});
    }
    writeFileSync(`${out}/performance.json`,JSON.stringify(measurements,null,2));
    console.log(JSON.stringify(measurements,null,2));
    process.exitCode = 0;
  } else if (process.argv.includes('--cold-current')) {
    await send('Page.addScriptToEvaluateOnNewDocument',{source:'localStorage.clear();'});
    await send('Network.setCacheDisabled',{cacheDisabled:true});
    await send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:2_500_000,uploadThroughput:1_000_000});
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:`${baseUrl}?combat&daily&artfamilies`});
    let first, enhanced;
    for(let i=0;i<240;i++) {
      const sample=await evaluate(`(() => {
        if(!window.neonSentinelDebugFrame)return null;
        const f=window.neonSentinelDebugFrame();
        return {atMs:performance.now(),phase:f.phase,renderer:f.presentation.renderer,spritesReady:Object.values(f.presentation.sculptedArt).every(x=>x==='ready'),modelsReady:['abductor','hunter','jammer','forgery','spammer','sybil'].every(k=>f.presentation.mesh?.flightArt[k]?.state==='ready')};
      })()`);
      if(sample && !first)first=sample;
      if(sample?.spritesReady && sample?.modelsReady){enhanced=sample;break;}
      await delay(50);
    }
    if(!first || first.phase!=='playing' || !enhanced)throw new Error('Cold art did not become usable');
    const probe=await evaluate('window.neonSentinelPresentationCheck()');
    if(!probe.stateUnchanged || probe.rngCalls)throw new Error('Cold asset upgrade changed play');
    const result={cacheDisabled:true,networkLatencyMs:100,downloadBytesPerSecond:2_500_000,firstRecognisablePlay:first,enhancedArt:enhanced,probe};
    writeFileSync(`${out}/cold-loading.json`,JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
  } else {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const nativeRAF = window.requestAnimationFrame.bind(window);
    window.ultraPaint = () => new Promise(resolve => nativeRAF(() => nativeRAF(resolve)));
    localStorage.clear();
    if (location.search.includes('ultraVector')) localStorage.setItem('neonsentinel:visual:v2',JSON.stringify({tier:'vector',reducedEffects:false}));
    if (location.search.includes('ultraNoWebGL')) {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type,...args) { return this.id === 'game3d' && type.startsWith('webgl') ? null : original.call(this,type,...args); };
    }
    let queue = [], tick = 0, origin;
    performance.now = () => 1000 + tick*1000/60;
    window.requestAnimationFrame = fn => { if (origin === undefined) origin = performance.now(); queue.push(fn); return queue.length; };
    window.ultraAdvance = n => { for (let i=0; i<n; i++) { const batch=queue; queue=[]; tick++; for(const fn of batch) fn(origin + tick*1000/60); } };
    window.ultraKey = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code === 'Escape' ? 'Escape' : code, bubbles:true }));
  ` });
  const screenshot = async path => { await evaluate('ultraPaint()'); const r=await send('Page.captureScreenshot',{format:'png'}); writeFileSync(path,Buffer.from(r.data,'base64')); };
  const advance = n => evaluate(`(async () => { for(let i=0;i<${n};i+=6) { ultraAdvance(Math.min(6,${n}-i)); await ultraPaint(); } })()`);
  if (contactsOnly) {
    const rosterSource = readFileSync('src/main.ts','utf8').split('const roster = [')[1].split('] satisfies')[0];
    const pubkeys = [...rosterSource.matchAll(/pubkey: '([a-f0-9]{64})'/g)].map(m=>m[1]);
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`
      const keys=${JSON.stringify(pubkeys)};
      keys.forEach((pubkey,i)=>localStorage.setItem('neonsentinel:profile:v2:'+pubkey,JSON.stringify({pubkey,fetchedAt:Date.now(),picture:'${baseUrl}contact-skin-check/'+(location.search.includes('missingSkin')?'missing-skin':'skin-'+i%2)+'.png'})));
    `});
    await send('Fetch.enable',{patterns:[{urlPattern:'*/api/profile-image*'},{urlPattern:'*/contact-skin-check/*'}]});
    const contactResults=[];
    for (const [name,width,height,query,failure] of [
      ['contacts-desktop',1440,900,'',null],['contacts-portrait',430,932,'',null],
      ['contacts-landscape',932,430,'',null],['contacts-vector',1440,900,'&ultraVector',null],
      ['contacts-no-webgl',430,932,'&ultraNoWebGL',null],['contacts-missing-model',1440,900,'','glb'],
      ['contacts-missing-art',1440,900,'','all'],['contacts-missing-skin',1440,900,'&missingSkin',null],
    ]) {
      if(process.argv.includes('--contact-vector-only')&&name!=='contacts-vector')continue;
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await send('Network.setBlockedURLs',{urls:['*://relay.*/*','*600.wtf*','*primal.net*','*nos.lol*',...(failure==='all'?['*/models/*']:failure==='glb'?['*/models/contact-sphere-*.glb']:[])]});
      await send('Page.navigate',{url:`${baseUrl}?combat&daily${query}`});
      for(let i=0;i<150;i++){if(await evaluate('!!window.neonSentinelDebugFrame'))break;await delay(100);}
      await delay(1000); await advance(1); await delay(1200); await advance(1);
      let frame=await evaluate('neonSentinelDebugFrame()');
      const vector=query.includes('ultraVector')||query.includes('ultraNoWebGL');
      if(vector ? frame.presentation.renderer!=='vector' : frame.presentation.renderer!=='mesh')throw new Error(`${name}: wrong renderer`);
      const probe=await evaluate('neonSentinelPresentationCheck()');
      if(!probe.stateUnchanged||!probe.cameraUnchanged||probe.rngCalls)throw new Error(`${name}: presentation altered play`);
      if(!vector) {
        await evaluate(`import(performance.getEntriesByType('resource').map(e=>e.name).find(u=>/\\/src\\/mesh-overlay\\.ts/.test(u))).then(m=>window.ultraMesh=m)`);
        await evaluate('ultraMesh.renderMeshOverlay({...neonSentinelDebugFrame(),lowCost:false})');
        const high=await evaluate('ultraMesh.getMeshDiagnostics()');
        if(high.contactArt.state !== (failure?'failed':'ready')||!high.contactArt.uv)throw new Error(`${name}: sphere/UV missing`);
        if(!high.contactSkins.length||high.contactSkins.some(c=>name==='contacts-missing-skin'?c.skin!==null:!c.skin))throw new Error(`${name}: skin wrong`);
        await screenshot(`${out}/${name}-high.png`);
        await evaluate('ultraMesh.renderMeshOverlay({...neonSentinelDebugFrame(),t:neonSentinelDebugFrame().t+1.5,lowCost:false})');
        const turned=await evaluate('ultraMesh.getMeshDiagnostics()');
        if(turned.contactSkins.some(c=>high.contactSkins.find(h=>h.id===c.id)?.rotation===c.rotation))throw new Error(`${name}: contact bodies did not rotate`);
        await screenshot(`${out}/${name}-turned.png`);
        await evaluate('ultraMesh.renderMeshOverlay({...neonSentinelDebugFrame(),lowCost:true,reducedEffects:true})');
        const low=await evaluate('ultraMesh.getMeshDiagnostics()');
        if(low.contactSkins.some(c=>c.rotation!==0))throw new Error(`${name}: reduced motion kept contact spin`);
        if(low.contactSkins.some(c=>c.shape !== (failure?'procedural-sphere':'blender-sphere')))throw new Error(`${name}: low quality flattened contacts`);
        await screenshot(`${out}/${name}-low.png`);
        contactResults.push({name,high,turned,low,probe});
      } else {
        if(frame.presentation.contacts.lighting!=='ready'||!frame.presentation.contacts.portraitBakes)throw new Error(`${name}: rounded canvas skins missing`);
        await screenshot(`${out}/${name}.png`);
        contactResults.push({name,presentation:frame.presentation,probe});
      }
      await evaluate("ultraKey('Space',true);ultraKey('ArrowRight',true)"); await advance(120);
      await evaluate("ultraKey('Space',false);ultraKey('ArrowRight',false)");
      frame=await evaluate('neonSentinelDebugFrame()');
      if(frame.phase!=='playing'||!frame.trace.shotsFired)throw new Error(`${name}: ordinary play failed`);
      contactResults.at(-1).shotsFired=frame.trace.shotsFired;
      await screenshot(`${out}/${name}-playing.png`);
      await evaluate("ultraKey('Escape',true);ultraKey('Escape',false)");await advance(1);
      const paused=await evaluate('neonSentinelDebugFrame()');
      await advance(30);
      const held=await evaluate('neonSentinelDebugFrame()');
      const motion=f=>vector ? f.presentation.contacts.lastRotation : f.presentation.mesh.contactSkins.map(c=>[c.id,c.rotation]);
      if(held.phase!=='paused'||JSON.stringify(motion(paused))!==JSON.stringify(motion(held)))throw new Error(`${name}: pause did not freeze contact rotation`);
      contactResults.at(-1).pauseFrozen=true;
      await evaluate("ultraKey('Escape',true);ultraKey('Escape',false)");await advance(1);
      if(vector) {
        const canvasMotion=await evaluate(`(async()=>{
          const m=await import(performance.getEntriesByType('resource').map(e=>e.name).find(u=>/\\/src\\/contact-art\\.ts/.test(u)));
          const skin=document.createElement('canvas');skin.width=skin.height=64;const s=skin.getContext('2d');s.fillStyle='#ff5533';s.fillRect(0,0,32,64);s.fillStyle='#22bbff';s.fillRect(32,0,32,64);
          const out=document.createElement('canvas');out.width=out.height=64;const c=out.getContext('2d',{willReadFrequently:true});c.translate(32,32);
          const capture=angle=>{c.clearRect(-32,-32,64,64);m.drawContactSphere(c,skin,28,'#5effdb',angle);return Array.from(c.getImageData(0,0,64,64).data);};
          // Prime the lazy poses before pixel comparison. Readback can move a
          // source canvas between GPU/CPU backing and change edge antialiasing.
          capture(0);capture(Math.PI/2);
          const front=capture(0),quarter=capture(Math.PI/2),full=capture(Math.PI*2);
          return {changed:front.some((v,i)=>v!==quarter[i]),looped:front.every((v,i)=>v===full[i]),loopDifferences:front.filter((v,i)=>v!==full[i]).length};
        })()`);
        if(!canvasMotion.changed||!canvasMotion.looped)throw new Error(`${name}: canvas skin did not complete a rotation: ${JSON.stringify(canvasMotion)}`);
        await evaluate(`import(performance.getEntriesByType('resource').map(e=>e.name).find(u=>/\\/src\\/visual-settings\\.ts/.test(u))).then(m=>m.setReducedEffects(true))`);
        await advance(1);
        if((await evaluate('neonSentinelDebugFrame()')).presentation.contacts.lastRotation!==0)throw new Error(`${name}: reduced fallback kept spinning`);
        await screenshot(`${out}/${name}-reduced.png`);
        contactResults.at(-1).canvasMotion=canvasMotion;
      }
      if(name==='contacts-desktop') {
        // Reuse actual render entity IDs across six changing follower windows.
        // The simulation frame is copied; this cannot create contacts/rewards.
        const checks=[];
        for(let round=0;round<6;round++) {
          await evaluate(`window.contactStress={...neonSentinelDebugFrame(),citizens:neonSentinelDebugFrame().citizens.map((c,i)=>({...c,x:neonSentinelDebugFrame().cameraX-450+i*60,status:'waiting',avatarUrl:'${baseUrl}contact-skin-check/stress-${round}-'+i+'.png'}))};ultraMesh.renderMeshOverlay(contactStress)`);
          await delay(350);
          await evaluate('ultraMesh.renderMeshOverlay(contactStress)');
          const check=await evaluate('ultraMesh.getMeshDiagnostics()');
          if(check.avatarTextures>check.avatarTextureLimit||check.contactSkins.length!==pubkeys.length||check.contactSkins.some(c=>!c.skin?.includes(`stress-${round}-`)))throw new Error('Contact cache/identity reuse failed');
          checks.push({round,avatars:check.avatarTextures,geometries:check.geometries,textures:check.textures,drawCalls:check.drawCalls});
        }
        await evaluate('ultraMesh.renderMeshOverlay(neonSentinelDebugFrame())');
        await delay(350);await evaluate('ultraMesh.renderMeshOverlay(neonSentinelDebugFrame())');
        const recovery=await evaluate('ultraMesh.getMeshDiagnostics()');
        if(recovery.contactSkins.some(c=>!c.skin?.includes('/skin-')))throw new Error('Contact cache did not restore original faces');
        const canvasCache=await evaluate(`(async()=>{
          const m=await import(performance.getEntriesByType('resource').map(e=>e.name).find(u=>/\\/src\\/contact-art\\.ts/.test(u)));
          const out=document.createElement('canvas');out.width=out.height=64;const c=out.getContext('2d');c.translate(32,32);
          for(let i=0;i<80;i++){const skin=document.createElement('canvas');skin.width=skin.height=32;skin.getContext('2d').fillRect(0,0,32,32);m.drawContactSphere(c,skin,21,'#5effdb');}
          return m.contactArtDiagnostics();
        })()`);
        if(canvasCache.portraitBakes!==canvasCache.portraitLimit)throw new Error('Unbounded Canvas portraits');
        contactResults.at(-1).reuse={checks,recovery,canvasCache};
      }
      console.log(`${name}: sphere, skin and ordinary firing passed`);
    }
    writeFileSync(`${out}/contact-results.json`,JSON.stringify(contactResults,null,2));
  }
  if (selectionOnly) {
    const selectionResults=[];
    const clickTitle = async action => {
      const point=await evaluate(`(() => {
        const b=neonSentinelDebugFrame().titleHitBoxes.find(b=>b.action===${JSON.stringify(action)});
        const c=document.getElementById('game'); const r=c.getBoundingClientRect();
        return {x:r.left+(b.x+b.w/2)*r.width/1280,y:r.top+(b.y+b.h/2)*r.height/720};
      })()`);
      await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
      await advance(1);
    };
    for(const [name,kind,query,width,height,daily] of [
      ['interceptor','interceptor','',1440,900,false],['guardian','guardian','',1440,900,false],
      ['heavy','heavy','',1440,900,false],['daily-selection','guardian','?daily',1440,900,false],
      ['portrait-selection','interceptor','',430,932,false],['vector-selection','guardian','?ultraVector',1440,900,false],
      ['failed-art-selection','heavy','',1440,900,false],['daily-fixed','interceptor','?daily',1440,900,true],
    ]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await send('Network.setBlockedURLs',{urls:['*://relay.*/*','*600.wtf*','*primal.net*','*nos.lol*',...(name==='failed-art-selection'?['*/models/*']:[])]});
      await send('Page.navigate',{url:`${baseUrl}${query}`});
      for(let i=0;i<120;i++){if(await evaluate('!!window.neonSentinelDebugFrame'))break;await delay(100);}
      await delay(1000); await advance(1);
      if(!daily) {
        for(let i=0;i<3;i++) {
          if((await evaluate('neonSentinelDebugFrame().titleMenu.launchShip ?? neonSentinelDebugFrame().titleMenu.ship'))===kind)break;
          await clickTitle('ship-next');
        }
      }
      const title=await evaluate('neonSentinelDebugFrame()');
      await screenshot(`${out}/${name}-title.png`);
      await clickTitle('start');
      await evaluate(`new Promise((resolve,reject)=>{const start=Date.now();const check=()=>{
        const b=document.getElementById('v4v-later');if(neonSentinelDebugFrame().v4vAskOpen&&b){b.click();resolve();return;}
        if(Date.now()-start>10000){reject(new Error('Launch ask missing'));return;}setTimeout(check,100);};check();})`);
      for(let i=0;i<100;i++){await advance(6);if(await evaluate("neonSentinelDebugFrame().phase==='playing'"))break;await delay(50);}
      await evaluate("ultraKey('Space',true);ultraKey('ArrowRight',true)"); await advance(60);
      await evaluate("ultraKey('Space',false);ultraKey('ArrowRight',false)");
      const play=await evaluate('neonSentinelDebugFrame()');
      await screenshot(`${out}/${name}-playing.png`);
      const passed=title.ship.shipClass===kind&&play.phase==='playing'&&play.ship.shipClass===kind&&play.daily===daily&&play.trace.shotsFired>0
        &&(play.presentation.renderer!=='mesh'||play.presentation.mesh.flightShipClass===kind);
      selectionResults.push({name,kind,passed,title:{ship:title.ship.shipClass,menu:title.titleMenu},play:{ship:play.ship.shipClass,daily:play.daily,shots:play.trace.shotsFired,presentation:play.presentation}});
      if(!passed&&!process.argv.includes('--regression-baseline'))throw new Error(`${name}: menu ${title.titleMenu.ship} launched ${play.ship.shipClass} daily=${play.daily}`);
      console.log(`${name}: ${passed?'passed':'REPRODUCED'} (${play.ship.shipClass}, daily=${play.daily})`);
    }
    writeFileSync(`${out}/selection-results.json`,JSON.stringify(selectionResults,null,2));
    if(!process.argv.includes('--regression-baseline')) {
      const cakeResults=[];
      for(const [name,width,height,query,failure] of [
        ['cake-desktop',1440,900,'',false],['cake-portrait',430,932,'',false],
        ['cake-vector',1440,900,'&ultraVector',false],['cake-missing-art',1440,900,'',true],
      ]) {
        await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        await send('Network.setBlockedURLs',{urls:['*://relay.*/*','*600.wtf*','*primal.net*','*nos.lol*',...(failure?['*/pickups/*','*/models/*']:[])]});
        await send('Page.navigate',{url:`${baseUrl}?combat&daily&cakes${query}`});
        for(let i=0;i<120;i++){if(await evaluate('!!window.neonSentinelDebugFrame'))break;await delay(100);}
        await delay(1200); await advance(1);
        const start=await evaluate('neonSentinelDebugFrame()');
        if(start.beacons.length!==6||new Set(start.beacons.map(b=>b.spriteIndex)).size!==6)throw new Error(`${name}: cake variants missing`);
        const probe=await evaluate('neonSentinelPresentationCheck()');
        if(!probe.stateUnchanged||!probe.cameraUnchanged||probe.rngCalls)throw new Error(`${name}: rendering changed play`);
        if(start.presentation.sculptedArt['cake-piece']!==(failure?'failed':'ready'))throw new Error(`${name}: cake loading failed`);
        if(start.presentation.renderer==='mesh') {
          await evaluate(`import(performance.getEntriesByType('resource').map(e=>e.name).find(u=>/\\/src\\/mesh-overlay\\.ts/.test(u))).then(m=>window.ultraMesh=m)`);
          const variants={...start.beacons[0]};
          const paths=[];
          for(let i=0;i<6;i++) {
            await evaluate(`ultraMesh.renderMeshOverlay({...neonSentinelDebugFrame(),beacons:[${JSON.stringify({...variants,spriteIndex:i})}],lowCost:false})`);
            const diag=await evaluate('ultraMesh.getMeshDiagnostics()');
            if(!failure&&!diag.billboardArt[`cake-piece:${i}`]?.endsWith(`cake-piece-${i+1}.png`))throw new Error(`${name}: wrong cake texture ${i}`);
            paths.push(diag.pickupPaths['cake-piece']);
          }
          await evaluate('ultraMesh.renderMeshOverlay({...neonSentinelDebugFrame(),lowCost:false})');
          await screenshot(`${out}/${name}-high.png`);
          await evaluate('ultraMesh.renderMeshOverlay({...neonSentinelDebugFrame(),lowCost:true,reducedEffects:true})');
          await screenshot(`${out}/${name}-low.png`);
          cakeResults.push({name,paths,probe});
        } else {
          // Canvas uses the same loaded, index-selected images as Three.
          const urls=await evaluate(`import(performance.getEntriesByType('resource').map(e=>e.name).find(u=>/\\/src\\/authored-sprites\\.ts/.test(u))).then(m=>Array.from({length:6},(_,i)=>m.sculptedImage('cake-piece',i)?.src))`);
          if(!failure&&urls.some((u,i)=>!u?.endsWith(`cake-piece-${i+1}.png`)))throw new Error('Canvas cake variants lost');
          await screenshot(`${out}/${name}.png`);
          cakeResults.push({name,urls,probe});
        }
        await evaluate("ultraKey('ArrowLeft',true);ultraKey('Space',true)"); await advance(40);
        await evaluate("ultraKey('ArrowLeft',false);ultraKey('ArrowRight',true)"); await advance(90);
        await evaluate("ultraKey('ArrowRight',false);ultraKey('Space',false)");
        const end=await evaluate('neonSentinelDebugFrame()');
        const collected=Array.from({length:6},(_,i)=>i).filter(i=>!end.beacons.some(b=>b.spriteIndex===i));
        if(collected.length!==6||end.phase!=='playing')throw new Error(`${name}: collected only ${collected.join(',')}`);
        cakeResults.at(-1).collectedVariants=collected;
        await screenshot(`${out}/${name}-collected.png`);
        console.log(`${name}: six variants rendered and collected`);
      }
      writeFileSync(`${out}/cake-results.json`,JSON.stringify(cakeResults,null,2));
    }
  }
  const results = [];
  for (const [name, width, height, failure] of (process.argv.includes('--flight-only') || familiesOnly || selectionOnly || contactsOnly ? [] : [
    ['desktop', 1440, 900, false], ['portrait', 430, 932, false], ['landscape', 932, 430, false],
    ...(!baseline ? [['missing-assets',1440,900,true],['saved-vector',430,932,false],['no-webgl',932,430,false]] : []),
  ])) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Network.setBlockedURLs', { urls: ['*://relay.*/*', '*://main.relay.*/*', '*600.wtf*', '*primal.net*', '*nos.lol*', ...(failure ? ['*/pickups/*','*/models/*'] : [])] });
    await send('Page.navigate', { url: `${baseUrl}?combat&daily${name === 'saved-vector' ? '&ultraVector' : name === 'no-webgl' ? '&ultraNoWebGL' : ''}` });
    for (let i=0;i<150;i++) { if (await evaluate('!!window.neonSentinelDebugFrame')) break; await delay(100); }
    await delay(1000); // Allow cold module/texture completion without advancing play.
    if (!baseline && !['saved-vector','no-webgl'].includes(name)) {
      for (let i=0;i<80;i++) {
        if (await evaluate("window.neonSentinelDebugFrame().presentation?.renderer === 'mesh'")) break;
        await delay(100);
      }
      if (!await evaluate("window.neonSentinelDebugFrame().presentation?.renderer === 'mesh'")) throw new Error(`${name}: mesh did not initialise: ${consoleErrors.join('\n')}`);
    }
    await evaluate('ultraAdvance(1)');
    await screenshot(`${out}/${baseline ? 'before' : 'after'}-${name}-pickups.png`);
    await evaluate("ultraKey('Space', true); ultraKey('ArrowRight', true)");
    await advance(120);
    await evaluate("ultraKey('Space',false); ultraKey('ArrowRight',false)");
    const frame = await evaluate('window.neonSentinelDebugFrame()');
    if (!baseline) {
      const probe = await evaluate('window.neonSentinelPresentationCheck()');
      if (!probe.stateUnchanged || !probe.cameraUnchanged || probe.rngCalls !== 0) throw new Error('Rendering changed state/RNG');
      if (failure && frame.presentation?.mesh?.hull !== 'failed') throw new Error('Missing hull did not take the fallback path');
    }
    const state = { ship: frame.ship, citizens: frame.citizens, enemies: frame.enemies.map(({hp,maxHp,...e})=>e), beacons: frame.beacons, lasers: frame.lasers, enemyShots: frame.enemyShots, timeLeft:frame.timeLeft, wave:frame.wave, combo:frame.combo, trace: { ...frame.trace,runId:undefined } };
    const stem = `${baseline ? 'before' : 'after'}-${name}`;
    writeFileSync(`${out}/${stem}.json`, JSON.stringify(state, null, 2));
    if (!['saved-vector','no-webgl'].includes(name)) await screenshot(`${out}/${stem}.png`);
    let equivalent = null;
    if (!baseline && !failure && ['desktop','portrait','landscape'].includes(name)) {
      equivalent = JSON.stringify((() => { const s=JSON.parse(readFileSync(`${reference}/before-${name}.json`)); s.enemies=s.enemies.map(({hp,maxHp,...e})=>e); return s; })()) === JSON.stringify(JSON.parse(JSON.stringify(state)));
      if (!equivalent) throw new Error(`${name}: fixed-input game trace changed`);
    }
    await evaluate("ultraKey('Escape',true); ultraKey('Escape',false); ultraAdvance(1)");
    const paused = await evaluate('window.neonSentinelDebugFrame()');
    await advance(12);
    const held = await evaluate('window.neonSentinelDebugFrame()');
    const pauseFrozen = paused.t === held.t;
    if (!baseline && (!pauseFrozen || held.phase !== 'paused')) throw new Error(`${name}: pause animation did not freeze`);
    if (['saved-vector','no-webgl'].includes(name) && frame.presentation?.renderer !== 'vector') throw new Error(`${name}: missing vector fallback`);
    results.push({ name, width, height, equivalent, pauseFrozen, shotsFired:frame.trace.shotsFired, shotsHit:frame.trace.shotsHit, renderer: frame.presentation ?? null });
    console.log(`${name}: trace=${equivalent}, pause=${pauseFrozen}, renderer=${frame.presentation?.renderer}`);
    writeFileSync(`${out}/${baseline ? 'before' : 'after'}-results.json`, JSON.stringify(results,null,2));
    if (!baseline && name === 'desktop') {
      await evaluate(`(async () => { const url=performance.getEntriesByType('resource').map(e=>e.name).find(u=>/\\/src\\/visual-settings\\.ts/.test(u)); const s=await import(url); s.setReducedEffects(true); })()`);
      await evaluate("ultraKey('Escape',true); ultraKey('Escape',false)");
      await advance(60);
      const reduced = await evaluate('window.neonSentinelDebugFrame()');
      if (reduced.presentation?.reducedEffects !== true) throw new Error('Reduced effects not active');
      await screenshot(`${out}/after-reduced.png`);
      const saved = await evaluate("localStorage.getItem('neonsentinel:visual:v2')");
      await evaluate("window.ultraContext = document.getElementById('game3d').getContext('webgl2').getExtension('WEBGL_lose_context'); ultraContext.loseContext()");
      await delay(150);
      await evaluate('ultraAdvance(1)');
      const lost = await evaluate('window.neonSentinelDebugFrame()');
      if (lost.presentation?.renderer !== 'vector') throw new Error('Context loss did not fall back');
      if (saved !== await evaluate("localStorage.getItem('neonsentinel:visual:v2')")) throw new Error('Context loss changed saved preferences');
      await screenshot(`${out}/after-vector.png`);
      await evaluate("ultraContext.restoreContext()");
      await delay(300);
      await evaluate('ultraAdvance(1)');
      if ((await evaluate('window.neonSentinelDebugFrame()')).presentation?.renderer !== 'mesh') throw new Error('Context restore did not recover');
      await screenshot(`${out}/after-restored.png`);
    }
  }
  if (!baseline && !familiesOnly && !selectionOnly && !coreOnly && !contactsOnly) {
    // Exercise the actual menu and wounded-boss scene, including render quality
    // selection and GLB-only failure. The quality comparison renders a copy of
    // the real scene frame; it never writes to the game's authoritative state.
    const flightResults=[];
    await send('Network.setBlockedURLs',{urls:['*://relay.*/*','*600.wtf*','*primal.net*','*nos.lol*']});
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:baseUrl});
    for(let i=0;i<120;i++) { if(await evaluate('!!window.neonSentinelDebugFrame')) break; await delay(100); }
    await delay(1000);
    for(const [kind,key] of [['interceptor','Digit1'],['guardian','Digit2'],['heavy','Digit3']]) {
      await evaluate(`ultraKey('${key}',true); ultraKey('${key}',false); ultraAdvance(1)`);
      const frame=await evaluate('window.neonSentinelDebugFrame()');
      if(frame.ship.shipClass!==kind || frame.presentation.mesh?.flightArt[kind]?.state!=='ready') throw new Error(`${kind}: menu art missing`);
      await screenshot(`${out}/flight-title-${kind}.png`);
      flightResults.push({name:`title-${kind}`,presentation:frame.presentation});
    }
    await evaluate("ultraKey('Digit2',true); ultraKey('Digit2',false); ['ArrowDown','ArrowDown','Enter'].forEach(k=>{ultraKey(k,true);ultraKey(k,false)})");
    await evaluate(`new Promise((resolve,reject)=>{
      const started=Date.now();
      const check=()=>{const overlay=document.getElementById('v4v'); const later=document.getElementById('v4v-later');
        if(overlay && !overlay.hidden && later){later.click();resolve(true);return;}
        if(Date.now()-started>12000){reject(new Error('Guest launch ask missing'));return;}setTimeout(check,100);};check();
    })`);
    for(let i=0;i<80;i++) {
      await advance(6);
      if(await evaluate("window.neonSentinelDebugFrame().phase==='playing'")) break;
      await delay(100);
    }
    await evaluate("ultraKey('Space',true); ultraKey('ArrowRight',true)");
    await advance(90);
    await evaluate("ultraKey('Space',false); ultraKey('ArrowRight',false)");
    const guardian=await evaluate('window.neonSentinelDebugFrame()');
    if(guardian.phase!=='playing' || guardian.ship.shipClass!=='guardian' || guardian.trace.shotsFired<1) throw new Error('Guardian menu launch did not reach actual flight');
    await screenshot(`${out}/flight-guardian-playing.png`);
    flightResults.push({name:'guardian-menu-launch',presentation:guardian.presentation,shotsFired:guardian.trace.shotsFired});
    await evaluate("ultraKey('Escape',true);ultraKey('Escape',false);ultraKey('KeyQ',true);ultraKey('KeyQ',false);ultraAdvance(1)");
    const returned=await evaluate('window.neonSentinelDebugFrame()');
    if(returned.phase!=='title' || returned.presentation.mesh.enemyGroups!==0 || returned.presentation.mesh.citizenGroups!==0) throw new Error('Quit retained old actor groups');
    for(const [name,width,height,query,glbFailure] of [
      ['boss-desktop',1440,900,'',false],['boss-portrait',430,932,'',false],
      ['boss-landscape',932,430,'',false],['boss-vector',1440,900,'&ultraVector',false],
      ['boss-missing-glb',1440,900,'',true],
    ]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await send('Network.setBlockedURLs',{urls:['*://relay.*/*','*600.wtf*','*primal.net*','*nos.lol*',...(glbFailure?['*/models/*.glb']:[])]});
      await send('Page.navigate',{url:`${baseUrl}?autostart&boss&wounded${query}`});
      for(let i=0;i<120;i++) { if(await evaluate('!!window.neonSentinelDebugFrame')) break; await delay(100); }
      await delay(1000);
      await advance(30); // Finish spawn invulnerability without changing rules.
      // Pilot toward the actual carrier until its complete silhouette fits the
      // visible crop. This is ordinary keyboard input, with no state injection.
      for(let i=0;i<90;i++) {
        const f=await evaluate('window.neonSentinelDebugFrame()');
        const boss=f.enemies.find(e=>e.type==='carrier');
        if(!boss) throw new Error('Carrier disappeared before art capture');
        let dx=boss.x-f.ship.x;
        if(dx>f.worldW/2) dx-=f.worldW;
        if(dx< -f.worldW/2) dx+=f.worldW;
        const dy=boss.y-f.ship.y;
        const approach=Math.min(145,f.viewport.visibleW*.14);
        if(Math.abs(dx)<approach && Math.abs(dy)<32) break;
        const horizontal=Math.abs(dx)>approach?(dx>0?'ArrowRight':'ArrowLeft'):null;
        const vertical=Math.abs(dy)>24?(dy>0?'ArrowDown':'ArrowUp'):null;
        await evaluate(`['ArrowRight','ArrowLeft','ArrowUp','ArrowDown'].forEach(k=>ultraKey(k,k===${JSON.stringify(horizontal)}||k===${JSON.stringify(vertical)}))`);
        await advance(6);
      }
      await evaluate("['ArrowRight','ArrowLeft','ArrowUp','ArrowDown'].forEach(k=>ultraKey(k,false))");
      let frame=await evaluate('window.neonSentinelDebugFrame()');
      if(!frame.carrier?.visible || !frame.carrier?.wounded) throw new Error(`${name}: boss fixture missing`);
      const probe=await evaluate('window.neonSentinelPresentationCheck()');
      if(!probe.stateUnchanged || !probe.cameraUnchanged || probe.rngCalls) throw new Error(`${name}: presentation changed play`);
      if(name!=='boss-vector') {
        if(!frame.presentation.mesh.flightArt.carrier.bakeReady) throw new Error(`${name}: carrier bake missing`);
        if(glbFailure && (frame.presentation.mesh.flightArt.carrier.state!=='failed' || frame.presentation.mesh.flightBossPath!=='baked')) throw new Error('GLB failure lost authored boss');
        await evaluate(`import(performance.getEntriesByType('resource').map(e=>e.name).find(u=>/\\/src\\/mesh-overlay\\.ts/.test(u))).then(m=>window.ultraMesh=m)`);
        await evaluate('ultraMesh.renderMeshOverlay({...window.neonSentinelDebugFrame(),lowCost:false})');
        await screenshot(`${out}/${name}-mesh.png`);
        const high=await evaluate('ultraMesh.getMeshDiagnostics()');
        await evaluate('ultraMesh.renderMeshOverlay({...window.neonSentinelDebugFrame(),lowCost:true,reducedEffects:true})');
        await screenshot(`${out}/${name}-baked.png`);
        const low=await evaluate('ultraMesh.getMeshDiagnostics()');
        if(low.flightBossPath!=='baked' || low.flightShipPath!=='baked') throw new Error(`${name}: low quality lost models`);
        flightResults.push({name,high,low});
      } else {
        await screenshot(`${out}/${name}.png`);
        flightResults.push({name,presentation:frame.presentation});
      }
      // Existing barrage and hits remain live after quality changes.
      await evaluate("ultraKey('Space',true)");
      await advance(60);
      await evaluate("ultraKey('Space',false); ultraKey('ArrowRight',false)");
      frame=await evaluate('window.neonSentinelDebugFrame()');
      flightResults.at(-1).shotsFired=frame.trace.shotsFired;
      flightResults.at(-1).shotsHit=frame.trace.shotsHit;
      flightResults.at(-1).carrier=frame.carrier;
      if(frame.trace.shotsFired<1) throw new Error(`${name}: firing did not run`);
      await screenshot(`${out}/${name}-playing.png`);
      console.log(`${name}: authored art and live firing passed (${frame.trace.shotsHit} hits)`);
    }
    writeFileSync(`${out}/flight-results.json`,JSON.stringify(flightResults,null,2));
  }
  if (!baseline && !process.argv.includes('--flight-only') && !selectionOnly && !coreOnly && !contactsOnly) {
    const familyResults=[];
    const alienKinds=['abductor','hunter','jammer','forgery','spammer','sybil','troll'];
    const pickupKinds=['rose','cake-piece','whole-cake','600b','life','shield','relay','charge','zap','net','cult','fourtwenty','scooter','multi','timelock'];
    for (const [name,width,height,query,failure] of [
      ['families-desktop',1440,900,'',null],['families-portrait',430,932,'',null],
      ['families-landscape',932,430,'',null],['families-vector',1440,900,'&ultraVector',null],
      ['families-glb-failure',1440,900,'','glb'],['families-missing-assets',1440,900,'','all'],
    ]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await send('Network.setBlockedURLs',{urls:['*://relay.*/*','*600.wtf*','*primal.net*','*nos.lol*',...(failure==='all'?['*/models/*','*/pickups/*']:failure==='glb'?['*/models/*.glb']:[])]});
      await send('Page.navigate',{url:`${baseUrl}?combat&daily&artfamilies${query}`});
      for(let i=0;i<120;i++){if(await evaluate('!!window.neonSentinelDebugFrame'))break;await delay(100);}
      await delay(700);
      await advance(1);
      // Advance only the render clock once, then allow lazy GLBs to settle
      // without advancing combat, RNG, pickup TTLs or attack timers.
      await delay(1500);
      const probe=await evaluate('window.neonSentinelPresentationCheck()');
      if(!probe.stateUnchanged || !probe.cameraUnchanged || probe.rngCalls)throw new Error(`${name}: presentation changed play`);
      let frame=await evaluate('window.neonSentinelDebugFrame()');
      const ready=Object.values(frame.presentation.sculptedArt);
      if(failure==='all' ? ready.some(s=>s!=='failed') : ready.some(s=>s!=='ready'))throw new Error(`${name}: sprite states inconsistent`);
      if(name!=='families-vector') {
        await evaluate(`import(performance.getEntriesByType('resource').map(e=>e.name).find(u=>/\\/src\\/mesh-overlay\\.ts/.test(u))).then(m=>window.ultraMesh=m)`);
        await evaluate('ultraMesh.renderMeshOverlay({...window.neonSentinelDebugFrame(),lowCost:false})');
        const high=await evaluate('ultraMesh.getMeshDiagnostics()');
        for(const kind of alienKinds.filter(k=>k!=='troll')) {
          const state=high.flightArt[kind].state;
          if(state!==(failure?'failed':'ready'))throw new Error(`${name}: ${kind} model ${state}`);
        }
        for(const kind of pickupKinds)if(high.pickupPaths[kind]!== (failure==='all'?'procedural':'baked'))throw new Error(`${name}: ${kind} pickup missing`);
        if(!failure && alienKinds.some(k=>high.alienPaths[k]!== (k==='troll'?'baked':'mesh')))throw new Error(`${name}: alien mesh paths missing`);
        await screenshot(`${out}/${name}-high.png`);
        await evaluate('ultraMesh.renderMeshOverlay({...window.neonSentinelDebugFrame(),lowCost:true,reducedEffects:true})');
        const low=await evaluate('ultraMesh.getMeshDiagnostics()');
        if(failure!=='all' && alienKinds.some(k=>low.alienPaths[k]!=='baked'))throw new Error(`${name}: alien baked paths missing`);
        if(high.sculptedBillboards>21 || low.sculptedBillboards>21)throw new Error('Unbounded sculpture materials');
        await screenshot(`${out}/${name}-low.png`);
        familyResults.push({name,high,low,probe});
      } else {
        await screenshot(`${out}/${name}.png`);
        familyResults.push({name,presentation:frame.presentation,probe});
      }
      // Fly and fire through the actual collection/attack loop. A renderer
      // quality switch must not stop attacks or conceal remaining pickups.
      await evaluate("ultraKey('Space',true); ultraKey('ArrowRight',true); ultraKey('ArrowUp',true)");
      await advance(120);
      await evaluate("['Space','ArrowRight','ArrowUp'].forEach(k=>ultraKey(k,false))");
      frame=await evaluate('window.neonSentinelDebugFrame()');
      if(frame.trace.shotsFired<1 || frame.phase!=='playing')throw new Error(`${name}: play stopped`);
      familyResults.at(-1).shotsFired=frame.trace.shotsFired;
      familyResults.at(-1).shotsHit=frame.trace.shotsHit;
      familyResults.at(-1).remainingPickups=frame.beacons.length;
      const collected=pickupKinds.filter(kind=>!frame.beacons.some(b=>b.kind===kind));
      if(!collected.length)throw new Error(`${name}: no real pickup collected`);
      familyResults.at(-1).collectedKinds=collected;
      await screenshot(`${out}/${name}-playing.png`);
      console.log(`${name}: all alien/pickup paths and live input passed`);
    }
    writeFileSync(`${out}/family-results.json`,JSON.stringify(familyResults,null,2));
  }
  if (errors.length) throw new Error(`Browser exceptions: ${JSON.stringify(errors)}`);
  if(results.length) writeFileSync(`${out}/${baseline ? 'before' : 'after'}-results.json`, JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
  }
} finally {
  ws?.close();
  chrome.kill('SIGTERM');
  await Promise.race([new Promise(r=>chrome.once('exit',r)), delay(3000)]);
  rmSync(chromeProfile,{recursive:true,force:true});
}
