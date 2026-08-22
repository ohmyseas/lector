// Usage: BASE=https://lector-ohmyseas.vercel.app node scripts/smoke-api.mjs
// Or:    BASE=http://localhost:3000 node scripts/smoke-api.mjs   (after `npx vercel dev`)

const BASE = process.env.BASE || 'http://localhost:3000';

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json();
  console.log(path, r.status, JSON.stringify(j).slice(0, 300));
  if (!r.ok) process.exitCode = 1;
  return j;
}

// gloss
await post('/api/llm', {
  task: 'gloss',
  input: { tappedWord: 'vacuidad', sentence: 'La compasión surge de la comprensión de la vacuidad.', displayLang: 'es' },
  glossary: [{ term: 'пустотность', translation: 'vacuidad' }],
  bookMeta: { title: 'Test', author: 'Test', sourceLang: 'ru' }
});

// breakdown
await post('/api/llm', {
  task: 'breakdown',
  input: { sentence: 'La compasión surge de la comprensión de la vacuidad.', displayLang: 'es', l1: 'ru' },
  glossary: [],
  bookMeta: { title: 'Test', author: 'Test', sourceLang: 'ru' }
});

// translate_chunk
await post('/api/llm', {
  task: 'translate_chunk',
  input: { text: 'Все явления пусты по своей природе.', targetLang: 'es', level: 'B1' },
  glossary: [{ term: 'пустотность', translation: 'vacuidad' }],
  bookMeta: { title: 'Test', author: 'Test', sourceLang: 'ru' }
});

// --- TTS ---

// Ephemeral (Flash, no timestamps)
const r1 = await fetch(`${BASE}/api/tts`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text: 'Hola mundo, esto es una prueba.', model: 'flash_v2_5', voice: 'narrator', withTimestamps: false })
});
console.log('/api/tts flash', r1.status, r1.headers.get('content-type'), 'bytes:', (await r1.arrayBuffer()).byteLength);
if (!r1.ok) process.exitCode = 1;

// Chapter-style (Multilingual v2, timestamps)
const r2 = await fetch(`${BASE}/api/tts`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text: 'La compasión surge de la comprensión de la vacuidad.', model: 'multilingual_v2', voice: 'narrator', withTimestamps: true })
});
const j2 = await r2.json();
console.log('/api/tts multilingual+timestamps', r2.status, 'words:', j2.timings?.length, 'audio KB:', Math.round((j2.audioBase64?.length || 0) * 0.75 / 1024));
if (!r2.ok || !j2.timings?.length) process.exitCode = 1;
