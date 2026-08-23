// Isolate PT translation bug: fresh wipe, import Russian, ONLY generate PT.
// Log every step + capture any console errors.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'e2e-out');
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'https://lector-ohmyseas.vercel.app';
const TEST_TEXT = `Все явления пусты по своей природе. Сострадание рождается из понимания пустотности.`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  page.on('console', m => console.log(`  [${m.type()}] ${m.text()}`));
  page.on('pageerror', e => console.log(`  [pageerror] ${e.message}`));
  page.on('response', r => { if (r.url().includes('/api/')) console.log(`  net: ${r.status()} ${r.request().method()} ${r.url().split('?')[0]}`); });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    await Promise.all(dbs.map(d => new Promise(res => { const r = indexedDB.deleteDatabase(d.name); r.onsuccess = r.onerror = r.onblocked = () => res(); })));
  });
  await page.reload({ waitUntil: 'networkidle' });

  await page.locator('#btn-import, #btn-import-2').first().click();
  await page.waitForSelector('#in-paste');
  await page.locator('.tab[data-tab="paste"]').click();
  await page.locator('#in-paste').fill(TEST_TEXT);
  await page.locator('#in-title').fill('PT test');
  await page.locator('#in-author').fill('X');
  await page.locator('#in-lang').selectOption('ru');
  await page.locator('#in-detect').click();
  await page.waitForSelector('#chapter-list li');
  await page.locator('#in-confirm').click();
  await page.waitForSelector('.book-card');
  await page.locator('.book-card').first().click();
  await page.waitForSelector('.chapters li[data-cid]');
  await page.locator('.chapters li[data-cid]').first().click();
  await page.waitForTimeout(500);

  console.log('\n=== switching to PT ===');
  await page.locator('.lang-pills .pill[data-lang="pt"]').click();
  await page.waitForTimeout(500);
  const genVis = await page.locator('#btn-generate').isVisible();
  console.log('  Generate visible:', genVis);

  console.log('\n=== clicking Generate PT ===');
  await page.locator('#btn-generate').click();
  const t0 = Date.now();
  for (let i = 0; i < 30; i++) {
    const btn = await page.locator('#btn-generate').isVisible().catch(() => false);
    const prog = await page.locator('#gen-progress').textContent().catch(() => '');
    console.log(`  t+${((Date.now()-t0)/1000).toFixed(1)}s btnVisible=${btn} progress="${prog}"`);
    if (!btn) { console.log('  ✓ Generate button gone'); break; }
    await page.waitForTimeout(2000);
  }
  const ch = await page.evaluate(async () => {
    const books = await window.Storage.books.list();
    if (!books.length) return null;
    const chs = await window.Storage.chapters.list(books[0].id);
    if (!chs.length) return null;
    const c = await window.Storage.chapters.get(chs[0].id);
    return {
      hasPtVersion: !!c.versions?.pt,
      ptTextPreview: (c.versions?.pt || '').slice(0, 120),
      versionsKeys: Object.keys(c.versions || {})
    };
  });
  console.log('\n=== chapter storage state ===');
  console.log('  ', JSON.stringify(ch, null, 2));

  await browser.close();
})();
