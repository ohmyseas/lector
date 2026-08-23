// E2E: verify edit book flow (title / author / description) from BOTH entry points:
// 1. Library card ✏️ button → goes straight to edit mode
// 2. Book detail header ✏️ icon → toggles into edit mode

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'e2e-out');
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'https://lector-ohmyseas.vercel.app';

const results = { passed: [], failed: [] };
const pass = (n) => { results.passed.push(n); console.log(`  ✅ ${n}`); };
const fail = (n, r) => { results.failed.push({ n, r }); console.log(`  ❌ ${n}: ${r}`); };
const shot = async (page, name) => { await page.screenshot({ path: join(OUT, name) }); console.log(`  📸 ${name}`); };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => console.log(`  💥 pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') console.log(`  💥 console.error: ${m.text()}`); });

  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      await Promise.all(dbs.map(d => new Promise(res => { const r = indexedDB.deleteDatabase(d.name); r.onsuccess = r.onerror = r.onblocked = () => res(); })));
    });
    await page.reload({ waitUntil: 'networkidle' });

    // Import a book
    await page.locator('#btn-import, #btn-import-2').first().click();
    await page.waitForSelector('#in-paste');
    await page.locator('.tab[data-tab="paste"]').click();
    await page.locator('#in-paste').fill('Все явления пусты по своей природе.');
    await page.locator('#in-title').fill('Original Title');
    await page.locator('#in-author').fill('Original Author');
    await page.locator('#in-lang').selectOption('ru');
    await page.locator('#in-detect').click();
    await page.waitForSelector('#chapter-list li');
    await page.locator('#in-confirm').click();
    await page.waitForSelector('.book-card');
    pass('book imported');
    await shot(page, 'E1-imported.png');

    // Test 1: Library card ✏️ button visible + jumps into edit mode
    console.log('\n[1] Library card edit button → edit mode');
    const editBtn = page.locator('.book-edit').first();
    const editVisible = await editBtn.isVisible().catch(() => false);
    if (editVisible) pass('library card ✏️ button visible'); else fail('library ✏️', 'not visible');
    await editBtn.click();
    await page.waitForSelector('#edit-title', { timeout: 3000 });
    pass('nav to book?edit=true opened edit mode');
    await shot(page, 'E2-edit-mode.png');

    // Verify fields prefilled
    const titleVal = await page.locator('#edit-title').inputValue();
    const authorVal = await page.locator('#edit-author').inputValue();
    if (titleVal === 'Original Title') pass('title prefilled correctly'); else fail('title prefill', titleVal);
    if (authorVal === 'Original Author') pass('author prefilled correctly'); else fail('author prefill', authorVal);

    // Fill new values
    await page.locator('#edit-title').fill('Edited Title');
    await page.locator('#edit-author').fill('New Author Name');
    await page.locator('#edit-description').fill('A short description added later');
    await page.locator('#btn-save-book').click();
    await page.waitForTimeout(600);

    // Verify view mode shows updated values
    const shownTitle = await page.locator('.book-heading h1').textContent();
    const shownAuthor = await page.locator('.book-heading .author').textContent();
    if (shownTitle === 'Edited Title') pass('title updated in view'); else fail('title view', shownTitle);
    if (shownAuthor?.includes('New Author Name')) pass('author updated in view'); else fail('author view', shownAuthor);
    if (shownAuthor?.includes('A short description')) pass('description shown next to author'); else fail('description view', shownAuthor);
    await shot(page, 'E3-view-after-save.png');

    // Verify persisted via Storage
    const stored = await page.evaluate(async () => {
      const books = await window.Storage.books.list();
      return books[0];
    });
    if (stored.title === 'Edited Title') pass('Storage.books persisted new title');
    if (stored.author === 'New Author Name') pass('Storage.books persisted new author');
    if (stored.description === 'A short description added later') pass('Storage.books persisted description');

    // Test 2: Book detail ✏️ toggles edit mode
    console.log('\n[2] Book detail ✏️ icon → toggles edit mode');
    const detailEditBtn = page.locator('#btn-edit-book');
    const detailEditVisible = await detailEditBtn.isVisible().catch(() => false);
    if (detailEditVisible) pass('book detail ✏️ visible in view mode'); else fail('detail ✏️', 'not visible');
    await detailEditBtn.click();
    await page.waitForSelector('#edit-title', { timeout: 3000 });
    pass('clicking ✏️ opened edit mode');

    // Cancel this time
    await page.locator('#btn-cancel-edit').click();
    await page.waitForTimeout(400);
    const backToView = await page.locator('.book-heading h1').textContent();
    if (backToView === 'Edited Title') pass('Cancel returned to view without changes'); else fail('cancel', backToView);

    // Test 3: Reload page — verify persisted across page reload
    console.log('\n[3] Reload page — data persists');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.book-card');
    const cardTitle = await page.locator('.book-card h2').textContent();
    const cardAuthor = await page.locator('.book-card .author').textContent();
    if (cardTitle === 'Edited Title') pass('library card shows edited title after reload'); else fail('reload title', cardTitle);
    if (cardAuthor?.includes('New Author Name') && cardAuthor?.includes('A short description')) pass('library card shows edited author + description after reload');
    else fail('reload author/desc', cardAuthor);
    await shot(page, 'E4-after-reload.png');

    // Test 4: Empty title is rejected
    console.log('\n[4] Empty title rejected');
    page.on('dialog', async d => { await d.accept(); });
    await page.locator('.book-edit').first().click();
    await page.waitForSelector('#edit-title');
    await page.locator('#edit-title').fill('');
    await page.locator('#btn-save-book').click();
    await page.waitForTimeout(500);
    // Should still be in edit mode (save was rejected)
    const stillEditing = await page.locator('#edit-title').isVisible().catch(() => false);
    if (stillEditing) pass('empty title rejected — still in edit mode'); else fail('empty rejection', 'save went through');

  } catch (err) {
    fail('crash', err.message);
    await shot(page, 'CRASH.png').catch(()=>{});
  } finally {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`RESULTS: ${results.passed.length} passed / ${results.failed.length} failed`);
    if (results.failed.length) {
      console.log('\nFAILURES:');
      results.failed.forEach(f => console.log(`  ✗ ${f.n}: ${f.r}`));
      process.exitCode = 1;
    }
    await browser.close();
  }
})();
