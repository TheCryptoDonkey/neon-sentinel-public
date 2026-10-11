// Verify recovery against an isolated candidate at its canonical origin.
// All publisher acknowledgements are simulated; fixture private keys remain in Node memory.
import { chromium } from 'playwright';
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const dist = process.env.NEON_TEST_DIST || new URL('../dist', import.meta.url).pathname;
const origin = 'https://neonsentinel.com';
const a = generateSecretKey(), b = generateSecretKey(), pa = getPublicKey(a), pb = getPublicKey(b);
let phase = 'setup';
let observedPage;
const run = (runId, pubkey, score) => ({ runId, playerMode: 'nostr', playerPubkey: pubkey, score, wave: 2, sats: 0, startedAt: Date.now() - 45000, finishedAt: Date.now(), durationMs: 45000, rescues: 2, knownRescues: 2, lost: 1, maxCombo: 5 });
const initial = [{ pubkey: pa, summary: run('saved-one', pa, 6326) }, { pubkey: pa, summary: run('saved-two', pa, 7644) }, { pubkey: pb, summary: run('other-account', pb, 9000) }];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' };
const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
const keys = 'neonsentinel:personal-score-outbox:v1';
let signatures = 0, claims = [], release;
let held = new Promise(resolve => release = resolve);
try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await context.route('**/*', route => route.request().method() === 'GET' ? route.continue() : route.abort());
    await context.routeWebSocket(/^wss?:/, socket => socket.close());
    await context.exposeFunction('__fixtureSign', async (template, pubkey) => { if (![27235, 30762].includes(template.kind))
        throw Error('Fixture signing kind denied'); signatures++; await held; return finalizeEvent(template, pubkey === pa ? a : b); });
    await context.addInitScript(({ initial, keys, pa }) => { if (location.origin !== 'https://neonsentinel.com')
        return; if (!localStorage.getItem('fixture-seeded')) {
        localStorage.setItem(keys, JSON.stringify(initial));
        localStorage.setItem('fixture-seeded', 'yes');
    } window.__fixtureLoginPubkey = pa; }, { initial, keys, pa });
    await context.route(origin + '/signet/signet-login-0.17.3.iife.js', async (route) => { await new Promise(resolve => setTimeout(resolve, 500)); return route.fulfill({ contentType: 'text/javascript', body: `const original=${JSON.stringify(pa)};const make=(pubkey,dead=false)=>({pubkey,method:'nip07',signer:{signEvent:template=>dead?Promise.reject(Error('fixture-signer-offline')):window.__fixtureSign(template,pubkey)}});window.__fixtureCallbackReads=0;window.__fixtureRestoreReads=0;window.Signet={handleRedirectCallback:async()=>{window.__fixtureCallbackReads++;const mode=sessionStorage.getItem('fixture-callback');return mode==='invalid'?{kind:'invalid'}:mode==='session'?{kind:'session',session:make(original,true)}:{kind:'no-callback'};},restoreSession:async()=>{window.__fixtureRestoreReads++;return make(original,true);},login:async()=>make(window.__fixtureLoginPubkey),logout:async()=>{}};` }); });
    await context.route(origin + '/api/claim', async (route) => {
        const request = route.request();
        const e = JSON.parse(Buffer.from(request.headers().authorization.slice(6), 'base64').toString());
        const payload = JSON.parse(request.postData());
        assert(verifyEvent(e));
        assert.equal(e.pubkey, pa);
        assert(e.tags.some(t => t[0] === 'payload' && t[1] === createHash('sha256').update(request.postData()).digest('hex')));
        claims.push({ pubkey: e.pubkey, payload });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, score_event_id: 'a'.repeat(64), published: { ok: claims.length === 1 ? 0 : 1, total: 7 } }) });
    });
    const assets = [];
    await context.route(origin + '/**', async (route) => { if (route.request().method() !== 'GET')
        return route.fallback(); const u = new URL(route.request().url()); if (u.pathname === '/signet/signet-login-0.17.3.iife.js')
        return route.fallback(); const file = resolve(dist, '.' + (u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname))); if (!file.startsWith(dist + '/'))
        return route.abort(); const body = await readFile(file).catch(() => null); if (!body)
        return route.abort(); if (u.pathname.startsWith('/assets/index-') && u.pathname.endsWith('.js'))
        assets.push({ path: u.pathname, sha256: createHash('sha256').update(body).digest('hex') }); await route.fulfill({ contentType: mime[extname(file)] || 'application/octet-stream', body }); });
    const page = await context.newPage();
    observedPage = page;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.locator('#score-recovery-open').waitFor({ state: 'visible', timeout: 60000 });
    phase = 'reload-and-account-isolation';
    await page.reload();
    await page.locator('#score-recovery-open').click();
    await page.locator('#score-recovery[open]').waitFor();
    assert.equal(await page.locator('#score-recovery-runs option').count(), 2);
    await page.locator('#score-recovery-runs').press('ArrowDown');
    assert.equal(await page.evaluate(() => document.body.dataset.neonPhase), 'title');
    const controls = await page.locator('#score-recovery button,#score-recovery select').evaluateAll(els => els.map(el => ({ id: el.id, height: el.getBoundingClientRect().height })));
    assert(controls.every(el => el.height >= 44));
    phase = 'wrong-account-reconnect';
    await page.evaluate(pubkey => window.__fixtureLoginPubkey = pubkey, pb);
    await page.locator('#score-recovery-reconnect').click();
    await page.locator('#score-recovery-status').filter({ hasText: 'Choose the original account with a working signer' }).waitFor();
    assert.equal(claims.length, 0);
    assert.equal(signatures, 0);
    phase = 'original-account-reconnect';
    await page.evaluate(pubkey => window.__fixtureLoginPubkey = pubkey, pa);
    await page.locator('#score-recovery-reconnect').click();
    await page.locator('#score-recovery-status').filter({ hasText: 'Original account connected' }).waitFor();
    await page.locator('#score-recovery-runs').selectOption('saved-one');
    phase = 'pending-approval';
    await page.locator('#score-recovery-retry').click();
    await page.waitForFunction(() => document.getElementById('score-recovery-retry').disabled);
    assert(await page.locator('#score-recovery-reconnect').isDisabled());
    assert(await page.locator('#score-recovery-runs').isDisabled());
    release();
    phase = 'unconfirmed-response-keeps-receipt';
    await page.locator('#score-recovery-status').filter({ hasText: 'PUBLICATION UNCONFIRMED' }).waitFor();
    assert.equal(claims.length, 1);
    assert.equal(signatures, 1);
    assert.equal((await page.evaluate(k => JSON.parse(localStorage.getItem(k)), keys)).length, 3);
    phase = 'confirmed-response-selective-clear';
    await page.locator('#score-recovery-retry').click();
    await page.locator('#score-recovery-status').filter({ hasText: 'selected saved run has been cleared' }).waitFor();
    const remaining = await page.evaluate(k => JSON.parse(localStorage.getItem(k)), keys);
    assert.equal(claims.length, 2);
    assert.deepEqual(remaining.map(r => r.summary.runId).sort(), ['other-account', 'saved-two']);
    assert(claims.every(c => c.payload.run_id === 'saved-one' && c.payload.score === 6326));
    await page.locator('#score-recovery-close').click();
    assert.equal(await page.evaluate(() => document.body.dataset.neonPhase), 'title');
    phase = 'invalid-callback-refuses-restored-account';
    await page.evaluate(() => sessionStorage.setItem('fixture-callback', 'invalid'));
    await page.reload();
    await page.waitForFunction(() => window.__fixtureCallbackReads > 0);
    assert(await page.locator('#score-recovery-open').isHidden());
    assert.equal(await page.evaluate(() => window.__fixtureRestoreReads), 0);
    phase = 'validated-callback-restores-selected-account';
    await page.evaluate(() => sessionStorage.setItem('fixture-callback', 'session'));
    await page.reload();
    await page.locator('#score-recovery-open').waitFor({state:'visible'});
    assert.equal(await page.evaluate(() => window.__fixtureRestoreReads), 0);
    await page.locator('#score-recovery-open').click();
    assert.equal(await page.locator('#score-recovery-runs option').count(), 1);
    assert.equal(await page.locator('#score-recovery-runs').inputValue(), 'saved-two');
    assert.deepEqual(errors, []);
    const result = { fixture: 'Private candidate recovery UI; canonical fixture Signet, seeded public receipts, all external writes and public relay sockets blocked. Simulated publisher acknowledgements, no real My Signet or publication.', assets, viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reload: true, sdkDelayedMs: 500, invalidCallbackRejected:true, validCallbackRestoresIdentity:true, accountIsolation: true, wrongAccountReconnectRejected: true, originalAccountReconnect: true, pendingControlsDisabled: true, unconfirmedReceiptRetained: true, exactConfirmedReceiptCleared: true, otherRunsPreserved: true, keyboardDoesNotStartGameFromDialog: true, minimumControlHeight: Math.min(...controls.map(c => c.height)), signatures, claims, physicalDevice: false, actualMySignet: false };
    await writeFile(process.env.NEON_RECOVERY_EVIDENCE || join(tmpdir(), 'neon-recovery-ui.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ phase, result: 'pass', assets }));
}
catch (error) {
    console.log(JSON.stringify({ phase, error: error.message, state: observedPage && !observedPage.isClosed() ? await observedPage.evaluate(k => ({ phase: document.body.dataset.neonPhase, button: document.getElementById('score-recovery-open')?.outerHTML, stored: JSON.parse(localStorage.getItem(k) || 'null'), hasSignet: !!window.Signet, signetMethod: typeof window.Signet?.restoreSession }), keys) : null }));
    process.exitCode = 1;
}
finally {
    await browser.close();
}
