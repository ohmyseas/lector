# lector — Handoff Document

Design spec: `d:/Antigravity/docs/superpowers/specs/2026-08-22-lector-design.md`

---

## 1. One-file architecture rationale

`index.html` contains all HTML, CSS, and JavaScript inline — no build step, no bundler, no framework. This mirrors the `dieciseis` sibling project and is a deliberate choice:

- Zero deployment friction: push to `main`, Vercel auto-deploys in ~30s.
- No transpilation means the file you edit is exactly what runs in the browser.
- Single-file diffs are reviewable in GitHub without context-switching.
- The only runtime dependency is `localforage` (loaded from CDN via `<script src>`).

Two Vercel serverless functions live in `api/`:

```
api/llm.js     — Anthropic proxy (Sonnet 4.6 / Haiku 4.5)
api/tts.js     — ElevenLabs proxy (Multilingual v2 / Flash v2.5)
api/health.js  — env-var sanity check, read-only
```

API keys never touch the browser. All key configuration happens in Vercel env vars.

---

## 2. Storage keys layout

Three named localForage instances (IndexedDB backend):

```
lector.meta
  books:index              → string[]         (ordered book IDs)
  book:{id}                → Book object
  chapters:{bookId}        → string[]         (ordered chapter IDs)
  chapter:{id}             → Chapter meta (no text bodies)
  vocab:index              → string[]         (vocab entry IDs)
  vocab:{id}               → VocabEntry
  setting:{key}            → any              (displayLang:bookId, level:bookId, vocabFilter)

lector.text
  chapter:{id}:source      → string           (original import text)
  chapter:{id}:ru          → string
  chapter:{id}:en          → string
  chapter:{id}:es:A2       → string
  chapter:{id}:es:B1       → string
  chapter:{id}:es:B2       → string
  chapter:{id}:es:C1       → string

lector.audio
  __lru__                  → [{key, ts, size}]  (LRU eviction index)
  {chapterId}:{sentHash}:{voiceId}  → {blob: Blob, timings: [{word, startSec, endSec}], size, ts}
```

Sentence audio is keyed by a 16-char SHA-1 prefix of `sentenceText|voiceId`. This makes cache hits stable across re-imports if the text is identical.

---

## 3. Model routing table

| Task | Model | Where |
|---|---|---|
| Chapter translation (RU/EN → ES at CEFR level) | `claude-sonnet-4-6` | `api/llm.js` |
| Frank sentence breakdown | `claude-sonnet-4-6` | `api/llm.js` |
| Tap-to-gloss (single word in context) | `claude-haiku-4-5` | `api/llm.js` |
| Glossary extraction (optional helper) | `claude-haiku-4-5` | `api/llm.js` |
| Chapter narration (pre-generated, cached) | `eleven_multilingual_v2` | `api/tts.js` |
| On-tap ephemeral sentence playback | `eleven_flash_v2_5` | `api/tts.js` |

To swap a model, change the relevant constant in `api/llm.js` or `api/tts.js` — no `index.html` changes needed.

---

## 4. How to add a book

### A. Paste text

Library → "Import book" → "Paste text" tab. Paste UTF-8 text, fill in Title / Author / Source language, click "Detect chapters", review the split, click "Confirm import".

### B. Upload .txt

Same flow via "Upload .txt" tab. Accepts `.txt` files up to browser memory limits (~50 MB safe in Chrome).

### C. Bundled (pre-loaded on server)

Drop a `.txt` file into `public/books/`. Add an `<option>` entry to the "Bundled" `<select>` in the import screen (`index.html`, search for `in-bundled`). The bundled option fetches the file via `GET /books/filename.txt`.

```html
<option value="/books/newbook.txt">Author — Title</option>
```

### Chapter splitting heuristics (in order, first match wins)

1. Markdown H2 headers: `^## `
2. Markdown H3 headers: `^### `
3. Chapter-word regex: `Глава|ГЛАВА|Часть|Chapter|CHAPTER|Capítulo|CAPÍTULO` followed by a number

If none match, the entire text becomes one chapter. Use the Merge/Split UI in the import preview to fix bad splits.

---

## 5. Known limitations (v1)

1. **Single-device** — IndexedDB is browser-local. Laptop and phone have independent libraries, audio caches, and vocab lists. Cross-device sync is a v2 concern (Vercel KV or Supabase).

2. **No Anki push** — Vocab exports to TSV only. User imports manually via Anki "File → Import". AnkiConnect direct push deferred to v2.

3. **Recite is Chrome-only** — `SpeechRecognition` / `webkitSpeechRecognition` is not implemented in Firefox or Safari as of v1 ship date. The button silently no-ops (shows an alert) on unsupported browsers.

4. **Mobile long-press UX may need iteration** — The 600ms threshold works well on Android Chrome. On iOS Safari, `touchstart` passive listeners fire correctly but the system long-press may race with the custom menu. If the native iOS context menu appears, increase the threshold to 700ms or call `e.preventDefault()` on `contextmenu` event (note: requires removing `passive: true`).

5. **No EPUB import** — Paste or `.txt` upload only. EPUB parsing (unzip + XML parse) deferred to v2.

6. **Audio cache is per-browser** — Clearing browser data wipes all voiced audio. There is an explicit "Wipe everything" button in Settings for intentional resets.

7. **Level regeneration is destructive** — Switching CEFR level for a chapter overwrites the cached ES translation for that level. There is no undo; re-generation costs one Sonnet call per paragraph.
