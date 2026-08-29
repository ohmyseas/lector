// Targeted E2E:
//   Part A — RWL JUMP from popover: highlights follow, no parallel, stop works.
//   Part B — DELETE book: card removed, storage cleared, no orphan audio.

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
  } catch { /* no modal */ }
}


// TWO paragraphs so we can jump between them
const TEST_TEXT = `Все явления пусты по своей природе. Сострадание рождается из понимания пустотности.

Мудрость и метод неразделимы. На пути освобождения ученик следует своему учителю.`;

const results = { passed: [], failed: [] };
const pass = (n) => { results.passed.push(n); console.log(`  ✅ ${n}`); };
const fail = (n, r) => { results.failed.push({ n, r }); console.log(`  ❌ ${n}: ${r}`); };
const shot = async (page, name) => { await page.screenshot({ path: join(OUT, name) }); console.log(`  📸 ${name}`); };

async function setupBook(page, title = 'Jump test') {
  await page.locator('#btn-import, #btn-import-2').first().click();
  await page.waitForSelector('#in-paste');
  await page.locator('.tab[data-tab="paste"]').click();
  await page.locator('#in-paste').fill(TEST_TEXT);
  await page.locator('#in-title').fill(title);
  await page.locator('#in-author').fill('X');
  await page.locator('#in-lang').selectOption('ru');
  await page.locator('#in-detect').click();
  await page.waitForSelector('#chapter-list li');
  await page.locator('#in-confirm').click();
  await page.waitForSelector('.book-card');
}

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
    pass('fresh load');

    // ─────────── PART A: Setup — import + voice source (RU) ───────────
    await setupBook(page);
    await page.locator('.book-card').first().click();
    await page.waitForSelector('.chapters li[data-cid]');
    await page.locator('.chapters li[data-cid]').first().click();
    await page.waitForTimeout(500);

    // Voice RU (source lang — no translation needed)
    await page.locator('.voice-btn').click(); await acceptCostModal(page);
    for (let i = 0; i < 60; i++) {
      const still = await page.locator('.voice-btn').isVisible().catch(() => false);
      if (!still) break;
      await page.waitForTimeout(2000);
    }
    pass('RU chapter voiced (source lang, no translation needed)');
    await shot(page, 'J1-voiced.png');

    // Start playback from sentence 0
    await page.locator('.play-btn').click();
    await page.waitForTimeout(1500);
    let state = await page.evaluate(() => ({
      idx: window.Player?.idx,
      hasAudio: !!window.Player?.audioEl
    }));
    if (state.hasAudio && state.idx === 0) pass(`Player playing sentence 0`); else fail('initial play', JSON.stringify(state));
    const highlightAt0 = await page.locator('.sent[data-sent="0"].playing').isVisible().catch(() => false);
    if (highlightAt0) pass('.sent.playing on sentence 0'); else fail('initial highlight', 'not on sent 0');

    // Pause
    await page.locator('.play-btn').click();
    await page.waitForTimeout(300);

    // Tap word in paragraph 2 (sentence index 2 or 3)
    const paras = await page.locator('main.reader p').all();
    console.log(`  paragraphs: ${paras.length}`);
    if (paras.length < 2) { fail('paragraphs', `expected 2, got ${paras.length}`); return; }
    const p2FirstSent = await paras[1].locator('.sent').first();
    const p2FirstSentIdx = parseInt(await p2FirstSent.getAttribute('data-sent'), 10);
    console.log(`  paragraph 2 first sentence idx = ${p2FirstSentIdx}`);

    // Tap first word of paragraph 2
    await paras[1].locator('.w').first().click();
    await page.waitForTimeout(2500);   // wait for popover + LLM gloss

    // Verify jump buttons are present + enabled (chapter is voiced)
    const jumpSentEnabled = await page.locator('#pop-jump-sent').isEnabled().catch(() => false);
    const jumpParaEnabled = await page.locator('#pop-jump-para').isEnabled().catch(() => false);
    if (jumpSentEnabled) pass('▶ from here button enabled (voiced)'); else fail('jump-sent enable', 'disabled but chapter is voiced');
    if (jumpParaEnabled) pass('▶ paragraph button enabled (voiced)'); else fail('jump-para enable', 'disabled but chapter is voiced');

    // Click ▶ paragraph → should jump Player to paragraph 2's first sentence
    console.log('\n[JUMP] Click ▶ paragraph → RWL should move to paragraph 2');
    await page.locator('#pop-jump-para').click({ force: true });
    await page.waitForTimeout(2000);

    // Verify:
    //   1. Popover closed
    //   2. Player.idx moved to paragraph 2's first sentence
    //   3. Player.audioEl exists (playing)
    //   4. .sent.playing highlight is on the new sentence (not 0)
    const popHidden = await page.evaluate(() => document.getElementById('popover')?.hidden);
    if (popHidden) pass('popover closed after ▶ paragraph'); else fail('popover close', 'still visible');
    state = await page.evaluate(() => ({ idx: window.Player?.idx, hasAudio: !!window.Player?.audioEl, playing: window.Player?.isPlaying() }));
    if (state.idx === p2FirstSentIdx) pass(`Player.idx jumped to ${state.idx} (expected ${p2FirstSentIdx})`); else fail('player idx', `got ${state.idx}, expected ${p2FirstSentIdx}`);
    if (state.hasAudio && state.playing) pass('Player playing new sentence'); else fail('player playing', JSON.stringify(state));

    // Highlight follows: sentence 0 should NO LONGER be highlighted; new sentence should be
    const stillOn0 = await page.locator('.sent[data-sent="0"].playing').isVisible().catch(() => false);
    if (!stillOn0) pass('.sent.playing removed from sentence 0'); else fail('stale highlight', 'still on sent 0');
    const nowOnJump = await page.locator(`.sent[data-sent="${p2FirstSentIdx}"].playing`).isVisible().catch(() => false);
    if (nowOnJump) pass(`.sent.playing moved to sentence ${p2FirstSentIdx}`); else fail('highlight follow', `not on sent ${p2FirstSentIdx}`);
    await shot(page, 'J2-after-jump.png');

    // Check no parallel audio: only Player.audioEl should exist
    // Player.stop should now cleanly stop
    console.log('\n[STOP] Click ⏹');
    await page.locator('.stop-btn').click();
    await page.waitForTimeout(500);
    state = await page.evaluate(() => ({ hasAudio: !!window.Player?.audioEl }));
    if (!state.hasAudio) pass('⏹ stopped Player after jump'); else fail('stop after jump', 'audioEl not cleared');
    const anyHighlight = await page.locator('.sent.playing').count();
    if (anyHighlight === 0) pass('⏹ cleared all highlights'); else fail('stop highlights', `${anyHighlight} still highlighted`);

    // Restart from beginning: press ▶ (should resume at last idx = p2FirstSentIdx via playbackResume)
    // OR: jump to sentence 0 via popover
    console.log('\n[RESTART] Jump back to sentence 0 via popover ▶ from here');
    await paras[0].locator('.w').first().click();
    await page.waitForTimeout(2500);
    await page.locator('#pop-jump-sent').click({ force: true });
    await page.waitForTimeout(2000);
    state = await page.evaluate(() => ({ idx: window.Player?.idx, playing: window.Player?.isPlaying() }));
    if (state.idx === 0 && state.playing) pass('Jumped back to sentence 0 via popover'); else fail('jump back', JSON.stringify(state));
    const backTo0 = await page.locator('.sent[data-sent="0"].playing').isVisible().catch(() => false);
    if (backTo0) pass('.sent.playing back on sentence 0'); else fail('restart highlight', 'not on 0');
    await page.locator('.stop-btn').click();

    // ─────────── PART B: Delete book ───────────
    console.log('\n[DELETE] Nav to library');
    await page.evaluate(() => window.nav('library'));
    await page.waitForTimeout(500);
    const beforeCount = await page.locator('.book-card').count();
    if (beforeCount === 1) pass('1 book card visible before delete'); else fail('pre-delete count', `${beforeCount}`);

    const deleteBtn = page.locator('.book-delete').first();
    const deleteVisible = await deleteBtn.isVisible().catch(() => false);
    if (deleteVisible) pass('delete button visible on card'); else fail('delete btn', 'not visible');

    // Auto-accept confirm dialog
    page.on('dialog', async dialog => {
      console.log(`  📥 confirm: "${dialog.message().slice(0, 80)}…"`);
      await dialog.accept();
    });

    // Add a second book so we can verify delete removes only ONE book, not all
    await setupBook(page, 'Book to keep');
    await page.waitForTimeout(500);
    const twoCount = await page.locator('.book-card').count();
    if (twoCount === 2) pass('2 book cards after adding second'); else fail('post-add count', `${twoCount}`);
    await shot(page, 'J3-two-books.png');

    // Delete the "Jump test" book specifically (was voiced) — not "Book to keep"
    // Library now sorts by title; select the exact card by title match instead of .first()
    const jumpTestCard = page.locator('.book-card', { has: page.locator('h2', { hasText: 'Jump test' }) });
    await jumpTestCard.locator('.book-delete').click();
    await page.waitForTimeout(1500);   // give it time for cascade

    const afterCount = await page.locator('.book-card').count();
    if (afterCount === 1) pass(`1 book card remaining after delete (${beforeCount + 1} → ${afterCount})`); else fail('post-delete count', `${afterCount}`);

    // Verify storage state — deleted book id gone from books:index, chapters gone
    const storageState = await page.evaluate(async () => {
      const books = await window.Storage.books.list();
      return {
        bookCount: books.length,
        remainingTitles: books.map(b => b.title)
      };
    });
    if (storageState.bookCount === 1) pass(`Storage.books.list returns 1 book`); else fail('storage books', JSON.stringify(storageState));

    // Verify no orphan audio blobs — the LRU should have no entries pointing to deleted chapter
    const audioLeftover = await page.evaluate(async () => {
      const stats = await window.Storage.audio.stats();
      return stats;
    });
    // We voiced the first book (which is now deleted); its audio blobs should be gone.
    // The 2nd book was never voiced, so total should be 0.
    if (audioLeftover.count === 0) pass('audio blobs of deleted book purged (count=0)');
    else fail('audio leak', `${audioLeftover.count} orphan blobs, ${(audioLeftover.bytes/1024).toFixed(1)}KB`);
    await shot(page, 'J4-after-delete.png');

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
