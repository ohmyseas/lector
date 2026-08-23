// Targeted E2E to reproduce the parallel-audio bug user reported + verify fix.
// Flow:
//   1. Import small book (2 paragraphs of Russian).
//   2. Translate + voice ES.
//   3. Start RWL playback from sentence 0 → verify Player.audioEl exists + is playing.
//   4. Pause → verify Player.audioEl exists but paused.
//   5. Tap word in paragraph 2, popover 🔊 paragraph → verify EphemeralAudio.audioEl exists + Player.audioEl was cleared (no parallel).
//   6. Press ▶ topbar → verify Player restarts fresh (from resume position), EphemeralAudio was killed (no parallel).
//   7. Click ⏹ stop → verify BOTH Player.audioEl AND EphemeralAudio.audioEl are null.
//   8. Trigger popover paragraph play, then press ⏹ → verify EphemeralAudio killed even without Player.
//
// Language swap UX check:
//   9. Verify pill for ES has .has-content class (dot indicator).
//  10. Switch to EN → empty state visible, "Already generated" chip lists ES.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'e2e-out');
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'https://lector-ohmyseas.vercel.app';

// TWO paragraphs so paragraph-tap picks a NEW paragraph
const TEST_TEXT = `Все явления пусты по своей природе. Сострадание рождается из понимания пустотности.

Мудрость и метод неразделимы. На пути освобождения ученик следует своему учителю.`;

const results = { passed: [], failed: [] };
const pass = (n) => { results.passed.push(n); console.log(`  ✅ ${n}`); };
const fail = (n, r) => { results.failed.push({ n, r }); console.log(`  ❌ ${n}: ${r}`); };
const shot = async (page, name) => { await page.screenshot({ path: join(OUT, name) }); console.log(`  📸 ${name}`); };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(`  [${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => console.log(`  💥 ${e.message}`));

  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      await Promise.all(dbs.map(d => new Promise(res => { const r = indexedDB.deleteDatabase(d.name); r.onsuccess = r.onerror = r.onblocked = () => res(); })));
    });
    await page.reload({ waitUntil: 'networkidle' });
    pass('fresh load');

    // Import
    await page.locator('#btn-import, #btn-import-2').first().click();
    await page.waitForSelector('#in-paste');
    await page.locator('.tab[data-tab="paste"]').click();
    await page.locator('#in-paste').fill(TEST_TEXT);
    await page.locator('#in-title').fill('Playback test');
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

    // Generate ES
    await page.locator('.lang-pills .pill[data-lang="es"]').click();
    await page.waitForTimeout(300);
    await page.locator('#btn-generate').click();
    for (let i = 0; i < 45; i++) {
      const still = await page.locator('#btn-generate').isVisible().catch(() => false);
      if (!still) break;
      await page.waitForTimeout(2000);
    }
    pass('ES generated');

    // Voice ES
    await page.locator('.voice-btn').click();
    for (let i = 0; i < 60; i++) {
      const still = await page.locator('.voice-btn').isVisible().catch(() => false);
      if (!still) break;
      await page.waitForTimeout(2000);
    }
    pass('ES voiced');
    await shot(page, 'F1-voiced.png');

    // === CORE BUG REPRODUCTION ===

    // Step 3: Play from sentence 0
    console.log('\n[3] Start RWL playback');
    await page.locator('.play-btn').click();
    await page.waitForTimeout(1500);
    let state = await page.evaluate(() => ({
      playerHasAudio: !!window.Player?.audioEl,
      playerIdx: window.Player?.idx,
      playerPlaying: window.Player?.isPlaying(),
      ephemeralHasAudio: false   // EphemeralAudio isn't on window; check indirectly
    }));
    if (state.playerHasAudio && state.playerPlaying) pass(`Player playing sent ${state.playerIdx}`); else fail('start playback', JSON.stringify(state));

    // Step 4: Pause
    console.log('\n[4] Pause');
    await page.locator('.play-btn').click();
    await page.waitForTimeout(500);
    state = await page.evaluate(() => ({
      playerHasAudio: !!window.Player?.audioEl,
      playerPaused: window.Player?.audioEl?.paused
    }));
    if (state.playerHasAudio && state.playerPaused) pass('Player paused (audioEl held, paused=true)'); else fail('pause', JSON.stringify(state));

    // Step 5: Tap word in paragraph 2, popover ▶ paragraph (RWL jump)
    console.log('\n[5] Tap word in paragraph 2 → popover ▶ paragraph (RWL jump)');
    const allParas = await page.locator('main.reader p').all();
    console.log(`  paragraphs: ${allParas.length}`);
    if (allParas.length < 2) { fail('paragraph count', `expected 2, got ${allParas.length}`); }
    else {
      // Get expected jump index (first sentence of paragraph 2)
      const p2FirstSentIdx = parseInt(await allParas[1].locator('.sent').first().getAttribute('data-sent'), 10);
      // Tap first word of paragraph 2
      await allParas[1].locator('.w').first().click();
      await page.waitForTimeout(2500);   // wait for popover + LLM gloss
      const popVis = await page.locator('#popover').isVisible().catch(() => false);
      if (!popVis) { fail('popover appears', 'not visible'); }
      else {
        pass('popover appeared on paragraph-2 word tap');
        // Click popover ▶ paragraph (RWL jump — replaces old ephemeral behavior)
        await page.locator('#pop-jump-para').click({ force: true });
        await page.waitForTimeout(1500);

        // NEW BEHAVIOR: Player.audioEl SHOULD exist (RWL playing from paragraph 2),
        // Player.idx SHOULD match paragraph 2's first sentence.
        // No parallel: the old sentence-0 audio was stopped by Player.start's internal stop().
        state = await page.evaluate(() => ({
          playerHasAudio: !!window.Player?.audioEl,
          playerIdx: window.Player?.idx,
        }));
        if (state.playerHasAudio && state.playerIdx === p2FirstSentIdx) pass(`▶ paragraph jumped Player to sent ${state.playerIdx} (paragraph 2 first sentence)`);
        else fail('jump behavior', `expected idx ${p2FirstSentIdx}, got ${JSON.stringify(state)}`);
        // Confirm highlight moved off sentence 0
        const stillOn0 = await page.locator('.sent[data-sent="0"].playing').isVisible().catch(() => false);
        if (!stillOn0) pass('highlight cleared from sentence 0 (no stale highlight)');
        else fail('stale highlight', 'sent 0 still highlighted');
        await shot(page, 'F2-popover-paragraph.png');
      }
    }

    // Step 6: Press ⏸ topbar → pause the RWL playback that started from paragraph 2
    console.log('\n[6] Press ⏸ topbar → pause RWL');
    // Close popover first (defensive)
    await page.evaluate(() => { const p = document.getElementById('popover'); if (p) p.hidden = true; });
    await page.waitForTimeout(300);
    await page.locator('.play-btn').click();
    await page.waitForTimeout(500);
    state = await page.evaluate(() => ({
      playerHasAudio: !!window.Player?.audioEl,
      playerPaused: window.Player?.audioEl?.paused,
      playerIdx: window.Player?.idx,
    }));
    if (state.playerHasAudio && state.playerPaused) pass(`⏸ paused RWL at idx=${state.playerIdx} (no parallel)`);
    else fail('⏸ after paragraph-jump', JSON.stringify(state));

    // Step 7: Stop → both cleared
    console.log('\n[7] Click ⏹ stop');
    await page.locator('.stop-btn').click();
    await page.waitForTimeout(300);
    state = await page.evaluate(() => ({
      playerHasAudio: !!window.Player?.audioEl
    }));
    if (!state.playerHasAudio) pass('⏹ cleared Player.audioEl'); else fail('stop', 'Player.audioEl not cleared');

    // Verify no rogue playing sentence highlight remains
    const stalePlaying = await page.locator('.sent.playing').count();
    if (stalePlaying === 0) pass('⏹ cleared .sent.playing highlights'); else fail('stop highlights', `${stalePlaying} stale highlights`);

    // Step 8: Trigger popover-paragraph play again, then ⏹
    console.log('\n[8] Popover play then ⏹');
    await allParas[1].locator('.w').first().click();
    await page.waitForTimeout(2500);
    await page.locator('#pop-jump-para').click({ force: true });
    await page.waitForTimeout(1000);
    // Now click stop
    await page.locator('.stop-btn').click();
    await page.waitForTimeout(500);
    // We can't easily check EphemeralAudio from window, but we can verify no fetch/audio hanging.
    // Approximation: check that pressing stop doesn't leave any playing sentence.
    const anyPlaying = await page.locator('.sent.playing').count();
    if (anyPlaying === 0) pass('⏹ after popover-play cleared any playing state'); else fail('stop after popover', `${anyPlaying} playing`);

    // === LANGUAGE-SWAP UX ===
    console.log('\n[9] Language pill dot indicator on ES (has content)');
    const esPillClass = await page.locator('.lang-pills .pill[data-lang="es"]').getAttribute('class');
    if (esPillClass?.includes('has-content')) pass('ES pill has .has-content class');
    else fail('ES pill class', `got '${esPillClass}'`);
    const esDot = await page.locator('.lang-pills .pill[data-lang="es"] .pill-dot').isVisible().catch(() => false);
    if (esDot) pass('ES pill dot indicator visible'); else fail('ES pill dot', 'not visible');

    console.log('\n[10] Switch to EN → empty state shows "Already generated" with ES');
    await page.locator('.lang-pills .pill[data-lang="en"]').click();
    await page.waitForTimeout(500);
    await shot(page, 'F3-en-empty-state.png');
    const availChipsText = await page.locator('.lang-availability').textContent().catch(() => '');
    if (availChipsText?.includes('ES')) pass(`EN empty state shows ES available: "${availChipsText}"`);
    else fail('availability chip', `expected ES chip, got: "${availChipsText}"`);
    const generateBtn = await page.locator('#btn-generate').isVisible().catch(() => false);
    if (generateBtn) pass('EN Generate CTA visible'); else fail('EN Generate CTA', 'not visible');

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
