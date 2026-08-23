import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL_SONNET = 'claude-sonnet-4-6';
const MODEL_HAIKU = 'claude-haiku-4-5';

const SYS = {
  gloss: (glossary, bookMeta) => `You are a Spanish reading tutor. The reader is looking at a sentence and tapped one word to understand it in context.

Book: ${bookMeta.title} by ${bookMeta.author}. Source language: ${bookMeta.sourceLang}.

Terminology (enforce exactly when relevant):
${glossary.map(g => `- ${g.term} → ${g.translation}`).join('\n') || '(none)'}

Output MUST be a raw JSON object — no markdown fences, no \`\`\`json, no prose before or after. Start your response with { and end with }.

Required shape: {"word": string, "lemma": string, "gloss": string, "note": string}.

Rules:
- If displayLang == "es": word is the tapped Spanish word as-is; lemma is dictionary form; gloss is a short translation into English (or Russian if book sourceLang == "ru"); note is a one-sentence usage / grammar tip.
- If displayLang == "ru" or "en": word is the SPANISH EQUIVALENT of the tapped word in this context (not the tapped word itself); lemma is Spanish dictionary form; gloss is the tapped word repeated as confirmation; note is a one-sentence usage tip on the Spanish equivalent. Vocab always flows toward Spanish.`,

  breakdown: (glossary, bookMeta) => `You are a Spanish reading tutor producing an Ilya-Frank-style interleaved breakdown of ONE sentence for a reader at CEFR B1.

Book: ${bookMeta.title} by ${bookMeta.author}. Source language: ${bookMeta.sourceLang}.

Terminology:
${glossary.map(g => `- ${g.term} → ${g.translation}`).join('\n') || '(none)'}

Output MUST be a raw JSON object — no markdown fences, no \`\`\`json, no prose. Start with { and end with }.

Required shape: {"chunks": [{"text": string, "gloss": string}, ...], "clean": string}.

Rules:
- Split the sentence into 2-4-word chunks preserving displayed-language word order.
- Each chunk's gloss is a literal translation into l1 (parenthetical style).
- "clean" is the full sentence translated fluently into l1 for meaning-check.`,

  translate_chunk: (glossary, bookMeta) => `You are translating a Buddhist text from ${bookMeta.sourceLang || '?'} to {{TARGET_LANG_NAME}}{{LEVEL_CLAUSE}}. Faithful to meaning, natural {{TARGET_LANG_NAME}}, level-appropriate vocabulary.

Book: ${bookMeta.title} by ${bookMeta.author}.

Terminology (enforce exactly):
${glossary.map(g => `- ${g.term} → ${g.translation}`).join('\n') || '(none)'}

Output MUST be a raw JSON object — no markdown fences, no \`\`\`json, no commentary. Start with { and end with }.

Required shape: {"text": string}.`
};

const LANG_NAMES = { es: 'Spanish', en: 'English', ru: 'Russian' };

function pickModel(task) {
  return task === 'gloss' ? MODEL_HAIKU : MODEL_SONNET;
}

function buildUser(task, input) {
  if (task === 'gloss') {
    return `Sentence: ${input.sentence}\nTapped word: ${input.tappedWord}\ndisplayLang: ${input.displayLang}`;
  }
  if (task === 'breakdown') {
    return `Sentence: ${input.sentence}\ndisplayLang: ${input.displayLang}\nl1: ${input.l1}`;
  }
  if (task === 'translate_chunk') {
    const target = input.targetLang || 'es';
    const targetName = { es: 'Spanish', en: 'English', ru: 'Russian' }[target] || 'Spanish';
    const levelHint = target === 'es' ? ` (${input.level || 'B1'})` : '';
    const prev = input.prevContext ? `Previous paragraph (context, do not translate):\n${input.prevContext}\n\n` : '';
    const next = input.nextContext ? `\n\nNext paragraph (context, do not translate):\n${input.nextContext}` : '';
    return `${prev}Translate to ${targetName}${levelHint}:\n${input.text}${next}`;
  }
  throw new Error(`unknown task ${task}`);
}

// Robust JSON extraction: try progressively looser approaches.
// Handles clean JSON, fenced JSON, and JSON embedded in prose.
function extractJson(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  // 1. Direct parse
  try { return JSON.parse(trimmed); } catch {}
  // 2. Strip markdown fences
  const nofence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try { return JSON.parse(nofence); } catch {}
  // 3. Extract substring between first { and last matching }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)); } catch {}
  }
  // 4. Try slicing to last balanced brace (handles trailing garbage)
  if (first >= 0) {
    let depth = 0, endAt = -1;
    for (let i = first; i < raw.length; i++) {
      const c = raw[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { endAt = i; break; } }
    }
    if (endAt > first) {
      try { return JSON.parse(raw.slice(first, endAt + 1)); } catch {}
    }
  }
  return null;
}

async function callModel(model, system, user, maxTokens) {
  const resp = await client.messages.create({
    model, max_tokens: maxTokens, system,
    messages: [{ role: 'user', content: user }]
  });
  const raw = resp.content[0]?.text ?? '';
  return { raw, usage: resp.usage };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const { task, input, glossary = [], bookMeta = {} } = req.body || {};
    if (!task || !input) return res.status(400).json({ error: 'task and input required' });
    if (!SYS[task]) return res.status(400).json({ error: `unknown task ${task}` });

    const model = pickModel(task);
    let system = SYS[task](glossary, bookMeta);
    if (task === 'translate_chunk') {
      const target = input.targetLang || 'es';
      const langName = LANG_NAMES[target] || 'Spanish';
      // Level only applies to Spanish (CEFR-graded reader). Other languages: straight translation.
      const levelClause = target === 'es' ? ` at CEFR ${input.level || 'B1'} level` : '';
      system = system
        .replaceAll('{{TARGET_LANG_NAME}}', langName)
        .replace('{{LEVEL_CLAUSE}}', levelClause);
    }
    const user = buildUser(task, input);
    const maxTokens = task === 'gloss' ? 400 : task === 'breakdown' ? 1500 : 4000;

    // First attempt
    let { raw, usage } = await callModel(model, system, user, maxTokens);
    let result = extractJson(raw);

    // Retry ONCE with a stronger reminder if parse fails
    if (result === null) {
      const strongerUser = `${user}\n\nREMINDER: Respond with JSON ONLY. Start with {, end with }, nothing else.`;
      const second = await callModel(model, system, strongerUser, maxTokens);
      raw = second.raw;
      usage = second.usage;
      result = extractJson(raw);
    }

    if (result === null) {
      return res.status(502).json({
        error: 'model returned non-JSON after retry',
        raw_preview: raw.slice(0, 200)
      });
    }

    res.status(200).json({ result, model, usage });
  } catch (e) {
    res.status(500).json({ error: 'llm proxy error', detail: (e.message || '').slice(0, 200) });
  }
}
