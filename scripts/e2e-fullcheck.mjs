// FULL END-TO-END check.
// Uses a small pasted Dharma paragraph as a test-book so translate + voice cost is minimal.
// Verifies: import + translate ES + voice ES + play ES with word-highlight, then voice + play RU.
// Also imports real Gampopa to verify auto-subdivide produces many chapters.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'e2e-out');
mkdirSync(OUT, { recursive: true });

const BASE = process.env.BASE || 'https://lector-ohmyseas.vercel.app';

const TEST_TEXT = `Все явления пусты по своей природе. Сострадание рождается из понимания пустотности. Мудрость и метод неразделимы. На пути освобождения ученик следует своему учителю.`;

const shot = async (page, name) => {
  const p = join(OUT, name);
  await page.screenshot({ path: p, fullPage: false });
  console.log(`  📸 ${name}`);
};

const results = { passed: [], failed: [] };
const pass = (name) => { results.passed.push(name); console.log(`  ✅ ${name}`); };
const fail = (name, reason) => { results.failed.push({ name, reason }); console.log(`  ❌ ${name}: ${reason}`); };

const consoleLog = [];
const networkLog = [];

async function runFlow(page) {
  try {
    console.log('\n=== SETUP ===');
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      await Promise.all(dbs.map(d => new Promise(res => {
        const req = indexedDB.deleteDatabase(d.name);
        req.onsuccess = req.onerror = req.onblocked = () => res();
      })));
    });
    await page.reload({ waitUntil: 'networkidle' });
    pass('app loads with wiped state');
    await shot(page, 'A1-loaded.png');

    console.log('\n=== TEST 1: Paste tiny book, translate + voice ES + play ES ===');
    await page.locator('#btn-import, #btn-import-2').first().click();
    await page.waitForSelector('#in-paste', { timeout: 5000 });
    await page.locator('.tab[data-tab="paste"]').click();
    await page.locator('#in-paste').fill(TEST_TEXT);
    await page.locator('#in-title').fill('Test tiny book');
    await page.locator('#in-author').fill('Test author');
    await page.locator('#in-lang').selectOption('ru');
    await page.locator('#in-detect').click();
    await page.waitForSelector('#chapter-list li', { timeout: 10000 });
    const ch1Count = await page.locator('#chapter-list li').count();
    console.log(`  detected ${ch1Count} chapters from tiny paste (expected 1)`);
    if (ch1Count === 1) pass('tiny paste → 1 chapter'); else fail('tiny paste chapters', `expected 1 got ${ch1Count}`);
    await page.locator('#in-confirm').click();
    await page.waitForSelector('.book-card', { timeout: 5000 });
    pass('import confirmed → library card visible');
    await shot(page, 'A2-imported.png');

    await page.locator('.book-card').first().click();
    await page.waitForSelector('.chapters li[data-cid]', { timeout: 5000 });
    await page.locator('.chapters li[data-cid]').first().click();
    await page.waitForTimeout(300);
    await shot(page, 'A3-reader.png');

    const ruBody = await page.locator('main.reader').textContent();
    if (ruBody?.includes('пусты')) pass('RU source text renders in reader'); else fail('RU source text', 'not found in reader');

    console.log('  switching to ES + generating...');
    await page.locator('.lang-pills .pill[data-lang="es"]').click();
    await page.waitForTimeout(500);
    await shot(page, 'A4-es-empty.png');

    const genVisible = await page.locator('#btn-generate').isVisible().catch(() => false);
    if (!genVisible) { fail('Generate button', 'not visible after ES switch'); return; }
    pass('Generate button visible on ES empty state');

    await page.locator('#btn-generate').click();
    const genStart = Date.now();
    let genDone = false;
    for (let i = 0; i < 45; i++) {
      const genGone = await page.locator('#btn-generate').isVisible().catch(() => false);
      if (!genGone) { genDone = true; break; }
      const prog = await page.locator('#gen-progress').textContent().catch(() => '');
      if (i % 5 === 0) console.log(`    t+${((Date.now()-genStart)/1000).toFixed(1)}s ${prog}`);
      if (prog.startsWith('Error:')) { fail('ES translation', prog); return; }
      await page.waitForTimeout(2000);
    }
    if (!genDone) { fail('ES translation', 'timeout waiting for completion'); return; }
    pass(`ES translation completed in ${((Date.now()-genStart)/1000).toFixed(1)}s`);
    await shot(page, 'A5-es-generated.png');

    const esBody = await page.locator('main.reader').textContent();
    if (esBody && esBody.length > 50 && !esBody.includes('пусты')) {
      pass(`ES text renders (${esBody.length} chars)`);
      console.log(`    ES preview: ${esBody.slice(0, 200).replace(/\n/g,' ')}`);
    } else {
      fail('ES text render', 'expected Spanish text, got: ' + (esBody?.slice(0,100) ?? '(empty)'));
    }

    console.log('  voicing ES chapter...');
    const voiceBtn = page.locator('.voice-btn');
    const voiceBtnExists = await voiceBtn.isVisible().catch(() => false);
    if (!voiceBtnExists) { fail('Voice ES button', 'not visible after ES generation'); return; }
    pass('Voice ES button visible');
    const voiceLabel = await voiceBtn.textContent();
    if (voiceLabel?.includes('ES')) pass('Voice button labeled with (ES B1)'); else fail('Voice ES label', `got '${voiceLabel}'`);

    await voiceBtn.click();
    const voiceStart = Date.now();
    let voiceDone = false;
    for (let i = 0; i < 60; i++) {
      const btnGone = await voiceBtn.isVisible().catch(() => false);
      if (!btnGone) { voiceDone = true; break; }
      const label = await voiceBtn.textContent().catch(() => '');
      if (i % 3 === 0) console.log(`    t+${((Date.now()-voiceStart)/1000).toFixed(1)}s ${label}`);
      if (label?.startsWith('Error:')) { fail('ES voicing', label); return; }
      await page.waitForTimeout(2000);
    }
    if (!voiceDone) { fail('ES voicing', 'timeout waiting for completion'); return; }
    pass(`ES voicing completed in ${((Date.now()-voiceStart)/1000).toFixed(1)}s`);
    await shot(page, 'A6-es-voiced.png');

    const playBtn = page.locator('.play-btn');
    const playDisabled = await playBtn.getAttribute('disabled');
    if (playDisabled === null) pass('Play button ENABLED after voicing'); else fail('Play button state', 'still disabled after voicing');

    console.log('  playing ES + observing highlight...');
    await playBtn.click();
    await page.waitForTimeout(3000);
    const playing = await page.locator('.sent.playing').count();
    const wnow = await page.locator('.wnow').count();
    if (playing > 0) pass(`.sent.playing highlight appears (count=${playing})`); else fail('sentence highlight', 'no .sent.playing after 3s of play');
    if (wnow > 0) pass(`.wnow word highlight tracking (count=${wnow})`); else console.log(`  ⚠️ .wnow count=0 — may be between words`);
    await shot(page, 'A7-es-playing.png');

    await playBtn.click();
    await page.waitForTimeout(500);

    console.log('\n=== TEST 2: Switch to RU, voice RU, play RU ===');
    await page.locator('.lang-pills .pill[data-lang="ru"]').click();
    await page.waitForTimeout(500);
    await shot(page, 'B1-ru.png');

    const ruBody2 = await page.locator('main.reader').textContent();
    if (ruBody2?.includes('пусты')) pass('RU source text still renders after ES round-trip'); else fail('RU text after swap', 'lost source text');

    const ruVoiceBtn = page.locator('.voice-btn');
    const ruVoiceVisible = await ruVoiceBtn.isVisible().catch(() => false);
    if (!ruVoiceVisible) { fail('Voice RU button', 'not visible on RU display'); return; }
    const ruLabel = await ruVoiceBtn.textContent();
    if (ruLabel?.includes('RU')) pass('Voice button labeled with (RU)'); else fail('Voice RU label', `got '${ruLabel}'`);

    await ruVoiceBtn.click();
    const ruVoiceStart = Date.now();
    let ruVoiceDone = false;
    for (let i = 0; i < 60; i++) {
      const btnGone = await ruVoiceBtn.isVisible().catch(() => false);
      if (!btnGone) { ruVoiceDone = true; break; }
      const label = await ruVoiceBtn.textContent().catch(() => '');
      if (i % 3 === 0) console.log(`    t+${((Date.now()-ruVoiceStart)/1000).toFixed(1)}s ${label}`);
      if (label?.startsWith('Error:')) { fail('RU voicing', label); return; }
      await page.waitForTimeout(2000);
    }
    if (!ruVoiceDone) { fail('RU voicing', 'timeout'); return; }
    pass(`RU voicing completed in ${((Date.now()-ruVoiceStart)/1000).toFixed(1)}s`);
    await shot(page, 'B2-ru-voiced.png');

    const ruPlayBtn = page.locator('.play-btn');
    const ruPlayDisabled = await ruPlayBtn.getAttribute('disabled');
    if (ruPlayDisabled === null) pass('RU Play button enabled after voicing'); else fail('RU Play btn', 'disabled');
    await ruPlayBtn.click();
    await page.waitForTimeout(3000);
    const ruPlaying = await page.locator('.sent.playing').count();
    if (ruPlaying > 0) pass(`RU .sent.playing highlight (count=${ruPlaying})`); else fail('RU highlight', 'no .sent.playing');
    await shot(page, 'B3-ru-playing.png');
    await ruPlayBtn.click();

    console.log('\n=== TEST 3: Import real Gampopa, verify subdivision produces many chapters ===');
    await page.evaluate(() => window.nav('library'));
    await page.waitForTimeout(500);
    await shot(page, 'C1-lib.png');

    await page.locator('#btn-import').click();
    await page.waitForSelector('.tab[data-tab="bundled"]', { timeout: 5000 });
    await page.locator('.tab[data-tab="bundled"]').click();
    await page.waitForSelector('#in-bundled:visible', { timeout: 5000 });
    await page.locator('#in-bundled').selectOption('/books/gampopa.txt');
    await page.locator('#in-title').fill('Gampopa full');
    await page.locator('#in-author').fill('Джé Гампопа');
    await page.locator('#in-lang').selectOption('ru');
    await page.locator('#in-detect').click();
    await page.waitForSelector('#chapter-list li', { timeout: 20000 });
    const gCount = await page.locator('#chapter-list li').count();
    console.log(`  Gampopa detected chapters: ${gCount}`);
    if (gCount >= 15) pass(`Gampopa subdivided to ${gCount} chapters (>=15)`); else fail('Gampopa subdivision', `expected >=15 got ${gCount}`);
    await shot(page, 'C2-gampopa-chapters.png');

    await page.evaluate(() => window.nav('library'));
  } catch (err) {
    fail('flow crash', err.message + '\n' + (err.stack || ''));
    await shot(page, 'CRASH.png').catch(()=>{});
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-ES' });
  const page = await context.newPage();

  page.on('console', msg => {
    consoleLog.push(`[${msg.type()}] ${msg.text()}`);
    if (msg.type() === 'error') console.log('  💥 console error: ' + msg.text());
  });
  page.on('pageerror', err => {
    consoleLog.push(`[pageerror] ${err.message}`);
    console.log('  💥 pageerror: ' + err.message);
  });
  page.on('response', async (resp) => {
    if (resp.url().includes('/api/')) {
      networkLog.push(`${resp.status()} ${resp.request().method()} ${resp.url().split('?')[0]}`);
    }
  });

  try {
    await runFlow(page);
  } finally {
    writeFileSync(join(OUT, 'console.log'), consoleLog.join('\n'), 'utf-8');
    writeFileSync(join(OUT, 'network.log'), networkLog.join('\n'), 'utf-8');
    console.log(`\n=================================================`);
    console.log(`RESULTS: ${results.passed.length} passed / ${results.failed.length} failed`);
    if (results.failed.length) {
      console.log(`\nFAILURES:`);
      for (const f of results.failed) console.log(`  ✗ ${f.name}: ${f.reason}`);
      process.exitCode = 1;
    }
    console.log(`\nlogs → ${OUT}`);
    await browser.close();
  }
})();
