// End-to-end diagnostic: what happens when user tries to import + generate + read.
// Run: node scripts/e2e-diagnose.mjs
// Captures screenshots at each step + logs console + logs network to help pinpoint the bug.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'e2e-out');
mkdirSync(OUT, { recursive: true });

const BASE = process.env.BASE || 'https://lector-ohmyseas.vercel.app';
const shot = async (page, name) => {
  const p = join(OUT, name);
  await page.screenshot({ path: p, fullPage: false });
  console.log(`  📸 ${name}`);
};

const consoleLog = [];
const networkLog = [];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-ES' });
  const page = await context.newPage();

  page.on('console', msg => {
    const line = `[${msg.type()}] ${msg.text()}`;
    consoleLog.push(line);
    if (msg.type() === 'error' || msg.type() === 'warning') console.log('  ⚠️ ' + line);
  });
  page.on('pageerror', err => { consoleLog.push(`[pageerror] ${err.message}`); console.log('  💥 ' + err.message); });
  page.on('response', async (resp) => {
    const u = resp.url();
    if (u.includes('/api/')) {
      const line = `${resp.status()} ${resp.request().method()} ${u}`;
      networkLog.push(line);
      console.log(`  🌐 ${line}`);
    }
  });

  try {
    console.log('=== STEP 1: Load app ===');
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
    await shot(page, '01-loaded.png');

    console.log('=== STEP 2: Wipe any prior state (fresh run) ===');
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      await Promise.all(dbs.map(d => new Promise(res => {
        const req = indexedDB.deleteDatabase(d.name);
        req.onsuccess = req.onerror = req.onblocked = () => res();
      })));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await shot(page, '02-wiped.png');

    console.log('=== STEP 3: Click Import book ===');
    // Try the top-bar Import button first, else the empty-state one
    const importBtn = await page.locator('#btn-import, #btn-import-2').first();
    await importBtn.click();
    await page.waitForTimeout(500);
    await shot(page, '03-import-screen.png');

    console.log('=== STEP 4: Switch to Bundled tab + pick Gampopa ===');
    await page.locator('.tab[data-tab="bundled"]').click();
    await page.waitForTimeout(200);
    await page.locator('#in-bundled').selectOption('/books/gampopa.txt');
    await page.locator('#in-title').fill('Gampopa test');
    await page.locator('#in-author').fill('Джé Гампопа');
    await page.locator('#in-lang').selectOption('ru');
    await shot(page, '04-import-filled.png');

    console.log('=== STEP 5: Detect chapters ===');
    await page.locator('#in-detect').click();
    await page.waitForSelector('#chapter-list li', { timeout: 20000 });
    const chapterCount = await page.locator('#chapter-list li').count();
    console.log(`  detected ${chapterCount} chapters`);
    await shot(page, '05-chapters-detected.png');

    console.log('=== STEP 6: Confirm import ===');
    await page.locator('#in-confirm').click();
    await page.waitForSelector('.book-card', { timeout: 10000 });
    await shot(page, '06-back-in-library.png');

    console.log('=== STEP 7: Open first book ===');
    await page.locator('.book-card').first().click();
    await page.waitForSelector('.chapters li', { timeout: 5000 });
    await shot(page, '07-book-detail.png');

    console.log('=== STEP 8: Pick a small chapter (smallest) ===');
    // Find shortest chapter to keep translation cost minimal
    const chapters = await page.locator('.chapters li[data-cid]').all();
    let picked = 0;
    let minSize = Infinity;
    for (let i = 0; i < chapters.length; i++) {
      const idx = await chapters[i].getAttribute('data-cid');
      // We don't have sizes in DOM — approximate by title length. Just pick chapter 2 (skip front matter).
    }
    picked = Math.min(1, chapters.length - 1);
    console.log(`  picking chapter index ${picked}`);
    await chapters[picked].click();
    await page.waitForTimeout(500);
    await shot(page, '08-reader-opened.png');

    console.log('=== STEP 9: Check reader state before ES switch ===');
    const readerBody = await page.locator('main.reader').textContent();
    console.log(`  reader body length: ${readerBody?.length}`);
    console.log(`  reader body preview: ${readerBody?.slice(0, 200).replace(/\n/g, ' ')}`);

    console.log('=== STEP 10: Switch to ES pill ===');
    await page.locator('.lang-pills .pill[data-lang="es"]').click();
    await page.waitForTimeout(500);
    await shot(page, '09-switched-to-es.png');

    // Is Generate button visible?
    const genBtnVisible = await page.locator('#btn-generate').isVisible().catch(() => false);
    console.log(`  #btn-generate visible: ${genBtnVisible}`);

    if (genBtnVisible) {
      console.log('=== STEP 11: Click Generate ES B1 ===');
      const startTime = Date.now();
      await page.locator('#btn-generate').click();
      // Wait for progress or completion
      await page.waitForTimeout(2000);
      await shot(page, '10-generation-started.png');

      // Poll for completion (up to 3 min)
      let completed = false;
      for (let i = 0; i < 90; i++) {
        const progressText = await page.locator('#gen-progress').textContent().catch(() => '');
        const bodyLen = (await page.locator('main.reader').textContent())?.length || 0;
        if (i % 10 === 0) console.log(`  t+${((Date.now()-startTime)/1000).toFixed(1)}s progress="${progressText}" bodyLen=${bodyLen}`);
        // Completion signals: the page re-navs and #btn-generate disappears
        const genGone = await page.locator('#btn-generate').isVisible().catch(() => false);
        if (!genGone) {
          console.log(`  ✓ generate button gone at t+${((Date.now()-startTime)/1000).toFixed(1)}s`);
          completed = true;
          break;
        }
        if (progressText && progressText.startsWith('Error:')) {
          console.log(`  ✗ error: ${progressText}`);
          break;
        }
        await page.waitForTimeout(2000);
      }
      await shot(page, '11-post-generate.png');

      if (completed) {
        console.log('=== STEP 12: Verify ES text is rendered ===');
        const esBody = await page.locator('main.reader').textContent();
        console.log(`  ES body length: ${esBody?.length}`);
        console.log(`  ES body preview: ${esBody?.slice(0, 300).replace(/\n/g, ' ')}`);
      }
    } else {
      console.log('  ⚠️ Generate button NOT visible after switching to ES!');
      const emptyText = await page.locator('.empty').textContent().catch(() => '(no .empty)');
      console.log(`  .empty content: ${emptyText}`);
    }

    console.log('=== DONE ===');
  } catch (err) {
    console.error('CRASH:', err.message);
    await shot(page, 'crash.png').catch(() => {});
  } finally {
    writeFileSync(join(OUT, 'console.log'), consoleLog.join('\n'), 'utf-8');
    writeFileSync(join(OUT, 'network.log'), networkLog.join('\n'), 'utf-8');
    console.log(`\nlogs → ${OUT}`);
    await browser.close();
  }
})();
