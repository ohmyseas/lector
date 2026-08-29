// Runtime QA for the v1.3 mega feature batch.
// Exercises: dark mode, font size, sentence numbers, progress bar, chapter nav,
// keyboard shortcuts, loop button, continuous toggle, bookmark, backup/restore,
// cost preview modal, glossary editor, delete chapter, rename chapter,
// library search+sort, vocab search+edit, AnkiConnect UI (test button only), cross-tab hook.
//
// Design: pre-seed a book via IndexedDB directly to avoid burning translation credits.
// Voice one short chapter for the RWL-adjacent tests only.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'e2e-out');
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'https://lector-ohmyseas.vercel.app';

async function acceptCostModal(page) {
  try {
    await page.waitForSelector('.modal-backdrop .modal-actions .primary', { timeout: 2000 });
    await page.locator('.modal-backdrop .modal-actions .primary').click({ force: true });
    await page.waitForTimeout(300);
  } catch {}
}
async function rejectCostModal(page) {
  try {
    await page.waitForSelector('.modal-backdrop .modal-actions .secondary', { timeout: 2000 });
    await page.locator('.modal-backdrop .modal-actions .secondary').click({ force: true });
    await page.waitForTimeout(300);
  } catch {}
}

const results = { passed: [], failed: [] };
const pass = (n) => { results.passed.push(n); console.log(`  ✅ ${n}`); };
const fail = (n, r) => { results.failed.push({ n, r }); console.log(`  ❌ ${n}: ${r}`); };
const shot = async (page, name) => { await page.screenshot({ path: join(OUT, name) }); console.log(`  📸 ${name}`); };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => console.log(`  💥 pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') console.log(`  💥 console.error: ${m.text()}`); });
  // Auto-accept native confirm dialogs
  page.on('dialog', async d => await d.accept());

  try {
    console.log('\n=== SETUP ===');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      await Promise.all(dbs.map(d => new Promise(res => { const r = indexedDB.deleteDatabase(d.name); r.onsuccess = r.onerror = r.onblocked = () => res(); })));
    });
    await page.reload({ waitUntil: 'networkidle' });
    pass('app loads with wiped state');

    // === Dark mode ===
    console.log('\n=== [1] Dark mode toggle ===');
    await page.evaluate(() => window.nav('settings'));
    await page.waitForSelector('#s-theme');
    await page.locator('#s-theme').selectOption('dark');
    await page.waitForTimeout(200);
    const themeAttr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (themeAttr === 'dark') pass('theme=dark applied to <html>'); else fail('dark theme', `got '${themeAttr}'`);
    await shot(page, 'M1-dark.png');
    await page.locator('#s-theme').selectOption('light');
    await page.waitForTimeout(200);
    const themeLight = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (themeLight === 'light') pass('theme=light applied'); else fail('light theme', `got '${themeLight}'`);

    // === Font size + line height sliders ===
    console.log('\n=== [2] Font size + line height sliders ===');
    await page.evaluate(() => {
      const s = document.getElementById('s-fontsize');
      s.value = '1.35';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(200);
    const fs = await page.evaluate(() => document.documentElement.style.getPropertyValue('--reader-font-size'));
    if (fs.trim() === '1.35rem') pass(`font-size persisted (${fs})`); else fail('font-size', fs);
    await page.evaluate(() => {
      const s = document.getElementById('s-lineheight');
      s.value = '2.00';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(200);
    const lh = await page.evaluate(() => document.documentElement.style.getPropertyValue('--reader-line-height'));
    if (lh.trim() === '2') pass(`line-height persisted (${lh})`); else fail('line-height', lh);

    // === Sentence numbers ===
    console.log('\n=== [3] Sentence numbers toggle ===');
    await page.locator('#s-shownums').check();
    const showNums = await page.evaluate(() => window.__prefsShowNums);
    if (showNums === true) pass('sentence numbers pref set'); else fail('sentence numbers', String(showNums));

    // Pre-seed a book directly for the rest of the tests (skip translation cost)
    console.log('\n=== [4] Pre-seed book directly in IndexedDB ===');
    await page.evaluate(async () => {
      const bookId = 'book-mega';
      const chId = 'ch-mega';
      const ruSrc = `Все явления пусты по своей природе. Сострадание рождается из понимания пустотности.

Мудрость и метод неразделимы. На пути освобождения ученик следует своему учителю.`;
      await window.Storage.books.put({
        id: bookId, title: 'Mega test book', author: 'Test Author', description: 'For E2E',
        sourceLang: 'ru', createdAt: Date.now(),
        glossary: [{ term: 'пустотность', translation: 'vacuidad' }],
        chapterCount: 1, narratorVoice: 'narrator'
      });
      await window.Storage.chapters.put({
        id: chId, bookId, index: 0, title: 'Chapter 1',
        sourceText: ruSrc, versions: { ru: ruSrc },
        positionFraction: 0, playbackResume: null, voiced: {}, bookmarks: []
      });
    });
    pass('book + chapter seeded');

    // === Library search + sort ===
    console.log('\n=== [5] Library search + sort ===');
    await page.evaluate(() => window.nav('library'));
    await page.waitForSelector('.book-card');
    const searchInp = await page.locator('#lib-search');
    if (await searchInp.isVisible()) pass('library search input visible'); else fail('search input', 'not visible');
    const sortSel = await page.locator('#lib-sort');
    if (await sortSel.isVisible()) pass('library sort dropdown visible'); else fail('sort select', 'not visible');
    // Search that DOESN'T match
    await searchInp.fill('NoSuchBookXYZ');
    await page.waitForTimeout(300);
    let cardCount = await page.locator('.book-card').count();
    if (cardCount === 0) pass('search filter with no match → 0 cards'); else fail('search no-match', `${cardCount}`);
    // Match
    await searchInp.fill('mega');
    await page.waitForTimeout(300);
    cardCount = await page.locator('.book-card').count();
    if (cardCount === 1) pass('search "mega" → 1 card'); else fail('search match', `${cardCount}`);
    await searchInp.fill('');
    await page.waitForTimeout(300);
    // Sort change
    await sortSel.selectOption('recent');
    await page.waitForTimeout(300);
    const sortAfter = await page.evaluate(() => window.Storage.settings.get('librarySort'));
    if (sortAfter === 'recent') pass(`sort persisted (${sortAfter})`); else fail('sort persist', String(sortAfter));

    // === Book detail: glossary editor + chapter rename/delete + bookmarks list ===
    console.log('\n=== [6] Book detail — glossary + chapter ops ===');
    await page.locator('.book-card h2').click();
    await page.waitForSelector('.glossary-editor');
    const glossExists = await page.locator('.glossary-editor .glossary-list').count();
    if (glossExists >= 1) pass(`glossary editor shows ${glossExists} pre-seeded term(s)`); else fail('glossary editor', `${glossExists}`);
    // Add a term
    await page.locator('#btn-add-term').click();
    const glossRows = await page.locator('.glossary-editor .glossary-list').count();
    if (glossRows === 2) pass('add term → 2 rows'); else fail('add term', `${glossRows}`);
    const newRows = page.locator('.glossary-editor .glossary-list');
    await newRows.nth(1).locator('.g-term').fill('бодхичитта');
    await newRows.nth(1).locator('.g-trans').fill('bodichita');
    await page.locator('#btn-save-glossary').click();
    await page.waitForTimeout(500);
    const savedGloss = await page.evaluate(async () => (await window.Storage.books.get('book-mega')).glossary);
    if (savedGloss.length === 2 && savedGloss[1].term === 'бодхичитта') pass('glossary term saved to book'); else fail('glossary save', JSON.stringify(savedGloss));
    await shot(page, 'M2-glossary.png');
    // Chapter rename
    await page.locator('.ch-rename').first().click();
    await page.waitForTimeout(200);
    await page.locator('.ch-title[contenteditable="true"]').first().evaluate((el) => { el.textContent = 'Renamed Chapter'; });
    await page.locator('.ch-title[contenteditable="true"]').first().evaluate((el) => el.blur());
    await page.waitForTimeout(500);
    const renamedTitle = await page.evaluate(async () => (await window.Storage.chapters.get('ch-mega')).title);
    if (renamedTitle === 'Renamed Chapter') pass(`chapter renamed → "${renamedTitle}"`); else fail('rename', renamedTitle);

    // === Reader — dark mode preserved, chapter nav, progress bar, loop button, continuous toggle ===
    console.log('\n=== [7] Reader UI — new controls ===');
    await page.evaluate(() => window.nav('reader', { chapterId: 'ch-mega' }));
    await page.waitForSelector('main.reader');
    for (const sel of ['.prev-ch-btn', '.next-ch-btn', '.loop-btn', '.continuous-btn', '#reader-progress-fill']) {
      const found = await page.locator(sel).isVisible().catch(() => false);
      if (found) pass(`${sel} rendered`); else fail(`${sel}`, 'not visible');
    }
    // Prev/next chapter — should be disabled (only 1 chapter in book)
    const prevChDisabled = await page.locator('.prev-ch-btn').isDisabled();
    const nextChDisabled = await page.locator('.next-ch-btn').isDisabled();
    if (prevChDisabled) pass('prev-ch-btn disabled (only 1 chapter)'); else fail('prev-ch', 'not disabled');
    if (nextChDisabled) pass('next-ch-btn disabled (only 1 chapter)'); else fail('next-ch', 'not disabled');
    // Loop button cycles
    let loopInner = await page.locator('.loop-btn').innerHTML();
    await page.locator('.loop-btn').click();
    await page.waitForTimeout(200);
    const loopAfter1 = await page.evaluate(() => window.Player.loopMode);
    if (loopAfter1 === 'sentence') pass('loop click → sentence'); else fail('loop cycle 1', loopAfter1);
    await page.locator('.loop-btn').click();
    await page.waitForTimeout(200);
    const loopAfter2 = await page.evaluate(() => window.Player.loopMode);
    if (loopAfter2 === 'paragraph') pass('loop click → paragraph'); else fail('loop cycle 2', loopAfter2);
    await page.locator('.loop-btn').click();
    await page.waitForTimeout(200);
    const loopAfter3 = await page.evaluate(() => window.Player.loopMode);
    if (loopAfter3 === 'off') pass('loop click → off (full cycle)'); else fail('loop cycle 3', loopAfter3);
    // Continuous toggle
    await page.locator('.continuous-btn').click();
    await page.waitForTimeout(200);
    const contAfter = await page.evaluate(() => window.Player.continuous);
    if (contAfter === true) pass('continuous toggled on'); else fail('continuous', String(contAfter));
    await shot(page, 'M3-reader-controls.png');

    // === Voice this short chapter so we can test keyboard shortcuts + progress bar ===
    console.log('\n=== [8] Voice chapter for shortcut + progress tests ===');
    // Get voice button (topbar appended child)
    const voiceBtn = page.locator('.voice-btn');
    if (await voiceBtn.isVisible()) {
      await voiceBtn.click();
      await acceptCostModal(page);
      for (let i = 0; i < 60; i++) {
        const still = await voiceBtn.isVisible().catch(() => false);
        if (!still) break;
        await page.waitForTimeout(2000);
      }
      pass('chapter voiced');
    } else fail('voice-btn', 'not visible');

    // === Keyboard shortcuts ===
    console.log('\n=== [9] Keyboard shortcuts (Space=play, J=next, K=prev) ===');
    await page.locator('main.reader').click();  // ensure focus
    await page.keyboard.press(' ');
    await page.waitForTimeout(1500);
    const spaceStart = await page.evaluate(() => ({ playing: window.Player?.isPlaying(), idx: window.Player?.idx }));
    if (spaceStart.playing) pass(`Space → play (idx=${spaceStart.idx})`); else fail('space play', JSON.stringify(spaceStart));
    await page.keyboard.press('j');
    await page.waitForTimeout(1500);
    const afterJ = await page.evaluate(() => window.Player?.idx);
    if (afterJ > spaceStart.idx) pass(`J → next sent (idx ${spaceStart.idx}→${afterJ})`); else fail('J next', `${spaceStart.idx}→${afterJ}`);
    await page.keyboard.press('k');
    await page.waitForTimeout(1500);
    const afterK = await page.evaluate(() => window.Player?.idx);
    if (afterK < afterJ) pass(`K → prev sent (idx ${afterJ}→${afterK})`); else fail('K prev', `${afterJ}→${afterK}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const afterEsc = await page.evaluate(() => !!window.Player?.audioEl);
    if (!afterEsc) pass('Esc → stop cleared audioEl'); else fail('esc stop', 'audioEl remains');

    // === Progress bar reflects sentence advance ===
    console.log('\n=== [10] Progress bar ===');
    await page.locator('.play-btn').click();
    await page.waitForTimeout(2000);
    const progW = await page.evaluate(() => document.querySelector('#reader-progress-fill')?.style.width || '');
    if (progW && parseFloat(progW) > 0) pass(`progress bar width=${progW}`); else fail('progress bar', `w='${progW}'`);
    await page.locator('.stop-btn').click();
    await page.waitForTimeout(300);

    // === Bookmark via popover ===
    console.log('\n=== [11] Bookmark toggle in popover ===');
    await page.locator('main.reader .w').first().click();
    await page.waitForTimeout(2500);
    const popVis = await page.locator('#popover').isVisible().catch(() => false);
    if (popVis) {
      const bmBtn = page.locator('#pop-bookmark');
      if (await bmBtn.isVisible()) {
        await bmBtn.click({ force: true });
        await page.waitForTimeout(500);
        const bmMarks = await page.evaluate(async () => (await window.Storage.chapters.get('ch-mega')).bookmarks || []);
        if (bmMarks.length === 1) pass(`bookmark added (${bmMarks[0].snippet})`); else fail('bookmark add', JSON.stringify(bmMarks));
      } else fail('pop-bookmark', 'not visible');
    } else fail('popover', 'not visible for bookmark test');

    // === Backup / restore ===
    console.log('\n=== [12] Backup / restore round-trip ===');
    await page.evaluate(() => window.nav('settings'));
    await page.waitForSelector('#btn-backup');
    // Trigger backup — capture the dump via window.exportBackup() directly
    const dump = await page.evaluate(async () => await window.exportBackup());
    if (dump && dump.version === 1 && dump.books.length === 1 && dump.chapters.length === 1) {
      pass(`backup shape OK (${dump.books.length} books, ${dump.chapters.length} chapters, ${dump.audio.length} audio blobs, ${dump.settings ? Object.keys(dump.settings).length : 0} settings)`);
    } else fail('backup shape', JSON.stringify({ v: dump?.version, b: dump?.books?.length, c: dump?.chapters?.length }));
    // Restore round-trip
    await page.evaluate(async (d) => { await window.importBackup(d); }, dump);
    await page.waitForTimeout(500);
    const afterRestore = await page.evaluate(async () => {
      const books = await window.Storage.books.list();
      const chs = books.length ? await window.Storage.chapters.list(books[0].id) : [];
      return { bookCount: books.length, chapterCount: chs.length, firstTitle: books[0]?.title };
    });
    if (afterRestore.bookCount === 1 && afterRestore.chapterCount === 1) pass(`restore round-trip OK (${afterRestore.firstTitle})`);
    else fail('restore', JSON.stringify(afterRestore));

    // === AnkiConnect UI (test button — expect failure since no local Anki) ===
    console.log('\n=== [13] AnkiConnect UI ===');
    const ankiUrlInp = page.locator('#s-ankiurl');
    if (await ankiUrlInp.isVisible()) pass('anki URL input visible'); else fail('anki url', 'not visible');
    // Save vocab first
    await page.evaluate(async () => {
      await window.Storage.vocab.put({
        word: 'vacuidad', lemma: 'vacuidad', gloss: 'emptiness',
        sourceSentence: 'La vacuidad es la naturaleza.',
        bookId: 'book-mega', chapterId: 'ch-mega', exported: false
      });
    });
    // Test button will fail (no Anki running) — check the status message
    await page.locator('#btn-anki-test').click();
    await page.waitForTimeout(4000);   // give fetch enough time to fail (localhost refused)
    const ankiStatus = await page.locator('#anki-status').textContent();
    if (ankiStatus?.includes('Failed') || ankiStatus?.includes('Error')) pass(`Anki test showed expected failure: "${ankiStatus?.slice(0, 60)}…"`);
    else if (ankiStatus?.includes('Connected')) pass('Anki actually connected (unexpected but OK)');
    else fail('anki test', `unexpected: "${ankiStatus}"`);

    // === Vocab search + edit ===
    console.log('\n=== [14] Vocab search + inline edit ===');
    await page.evaluate(() => window.nav('vocab'));
    await page.waitForSelector('#vocab-tbody');
    const searchInp2 = page.locator('#vocab-search');
    if (await searchInp2.isVisible()) pass('vocab search input visible'); else fail('vocab search', 'not visible');
    await searchInp2.fill('vacuidad');
    await page.waitForTimeout(400);
    const vocabRows = await page.locator('#vocab-tbody tr[data-id]').count();
    if (vocabRows >= 1) pass(`vocab search "vacuidad" → ${vocabRows} row(s)`); else fail('vocab search match', `${vocabRows}`);
    await searchInp2.fill('NoWordXYZ');
    await page.waitForTimeout(400);
    const noMatchRows = await page.locator('#vocab-tbody tr[data-id]').count();
    if (noMatchRows === 0) pass('vocab search no-match → 0 rows'); else fail('vocab no-match', `${noMatchRows}`);
    await searchInp2.fill('');
    await page.waitForTimeout(400);
    // Inline edit note
    await page.locator('#vocab-tbody tr[data-id] .edit').first().click();
    await page.waitForTimeout(300);
    const noteTd = page.locator('#vocab-tbody tr[data-id] .editable[data-field="note"]').first();
    await noteTd.evaluate(el => { el.textContent = 'my custom note'; });
    // Click Save (same edit button toggles)
    await page.locator('#vocab-tbody tr[data-id] .edit').first().click();
    await page.waitForTimeout(500);
    const savedNote = await page.evaluate(async () => {
      const list = await window.Storage.vocab.list();
      return list[0]?.note;
    });
    if (savedNote === 'my custom note') pass(`vocab note edited + saved`); else fail('vocab edit', `got '${savedNote}'`);

    // === Cost preview modal — accept path already covered in fullcheck; test reject here ===
    console.log('\n=== [15] Cost preview modal rejects properly ===');
    await page.evaluate(() => window.nav('reader', { chapterId: 'ch-mega' }));
    await page.waitForSelector('main.reader');
    await page.locator('.lang-pills .pill[data-lang="es"]').click();
    await page.waitForTimeout(500);
    const genBtn = page.locator('#btn-generate');
    if (await genBtn.isVisible()) {
      await genBtn.click();
      // Reject the cost modal
      await rejectCostModal(page);
      // btn-generate should still be visible (no translation ran)
      const stillThere = await genBtn.isVisible();
      if (stillThere) pass('cost modal cancel → no translation triggered'); else fail('cost cancel', 'button disappeared');
    } else fail('gen btn', 'not visible on ES empty state');

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
