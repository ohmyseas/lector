/**
 * smoke-storage.mjs
 * Static-analysis smoke test for index.html Storage module.
 * Checks that all required identifiers / method signatures are present in the file.
 * Run: node scripts/smoke-storage.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const REQUIRED = [
  // localForage instances
  'LF_META',
  'LF_TEXT',
  'LF_AUDIO',
  "storeName: 'meta'",
  "storeName: 'text'",
  "storeName: 'audio'",
  // CDN script tag
  'localforage@1.10.0',
  // Storage namespace exported to window
  'window.Storage = Storage',
  // books store — namespace + each async method declaration
  "books: {",
  // list, get, put, delete in books block (they appear as async list/get/put/delete inside the books object)
  "async list()",                 // books.list
  "async get(id)",                // books.get
  "async put(book)",              // books.put (books)
  "async delete(id)",             // books.delete / chapters.delete
  // chapters store
  "chapters: {",
  "async list(bookId)",           // chapters.list
  "async get(id)",                // chapters.get (same sig, appears twice)
  "async put(chapter)",           // chapters.put
  // vocab store
  "vocab: {",
  "async list(filter",            // vocab.list
  "async put(entry)",             // vocab.put
  "async delete(word, bookId)",   // vocab.delete
  // audio store
  "audio: {",
  "async put(chapterId, sentenceHash, voiceId",  // audio.put
  "async get(chapterId, sentenceHash, voiceId",  // audio.get
  "async evictOldest(bytesToFree)",              // audio.evictOldest
  "async stats()",                               // audio.stats
  // settings store
  "settings: {",
  "async get(key",                // settings.get
  "async set(key",                // settings.set
  // router
  'window.nav = nav',
  "route('library'",
  "route('import'",
  "route('book'",
  "route('vocab'",
  "route('settings'",
  // library UI elements
  'btn-import',
  'btn-import-2',
  'btn-vocab',
  'btn-settings',
  'book-card',
  'Import your first book',
  // title
  '<title>lector</title>',
  // LRU audio management
  '__lru__',
  // uid helper
  'const uid =',
];

let pass = 0;
let fail = 0;
const failures = [];

for (const identifier of REQUIRED) {
  if (html.includes(identifier)) {
    pass++;
    console.log(`  OK  ${identifier}`);
  } else {
    fail++;
    failures.push(identifier);
    console.error(`  MISSING  ${identifier}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  console.error('\nFAIL — missing identifiers:', failures);
  process.exit(1);
} else {
  console.log('\nPASS — all required identifiers found in index.html');
}
