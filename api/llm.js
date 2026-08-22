import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL_SONNET = 'claude-sonnet-4-6';
const MODEL_HAIKU = 'claude-haiku-4-5';

const SYS = {
  gloss: (glossary, bookMeta) => `You are a Spanish reading tutor. The reader is looking at a sentence and tapped one word to understand it in context.

Book: ${bookMeta.title} by ${bookMeta.author}. Source language: ${bookMeta.sourceLang}.

Terminology (enforce exactly when relevant):
${glossary.map(g => `- ${g.term} → ${g.translation}`).join('\n') || '(none)'}

Return STRICT JSON only: {"word": string, "lemma": string, "gloss": string, "note": string}.

Rules:
- If displayLang == "es": word is the tapped Spanish word as-is; lemma is dictionary form; gloss is a short translation into English (or Russian if book sourceLang == "ru"); note is a one-sentence usage / grammar tip.
- If displayLang == "ru" or "en": word is the SPANISH EQUIVALENT of the tapped word in this context (not the tapped word itself); lemma is Spanish dictionary form; gloss is the tapped word repeated as confirmation; note is a one-sentence usage tip on the Spanish equivalent. Vocab always flows toward Spanish.
- Never explain, never wrap in markdown, never add prose. JSON only.`,

  breakdown: (glossary, bookMeta) => `You are a Spanish reading tutor producing an Ilya-Frank-style interleaved breakdown of ONE sentence for a reader at CEFR B1.

Book: ${bookMeta.title} by ${bookMeta.author}. Source language: ${bookMeta.sourceLang}.

Terminology:
${glossary.map(g => `- ${g.term} → ${g.translation}`).join('\n') || '(none)'}

Return STRICT JSON only: {"chunks": [{"text": string, "gloss": string}, ...], "clean": string}.

Rules:
- Split the sentence into 2-4-word chunks preserving displayed-language word order.
- Each chunk's gloss is a literal translation into l1 (parenthetical style).
- "clean" is the full sentence translated fluently into l1 for meaning-check.
- No explanation, no markdown, JSON only.`,

  translate_chunk: (glossary, bookMeta) => `You are translating a Buddhist text from ${bookMeta.sourceLang} to Spanish at CEFR ${'{{LEVEL}}'} level. Faithful to meaning, natural Spanish, level-appropriate vocabulary.

Book: ${bookMeta.title} by ${bookMeta.author}.

Terminology (enforce exactly):
${glossary.map(g => `- ${g.term} → ${g.translation}`).join('\n') || '(none)'}

Return STRICT JSON only: {"text": string}. No commentary, no markdown fences.`
};

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
    const prev = input.prevContext ? `Previous paragraph (context, do not translate):\n${input.prevContext}\n\n` : '';
    const next = input.nextContext ? `\n\nNext paragraph (context, do not translate):\n${input.nextContext}` : '';
    return `${prev}Translate to Spanish (${input.level}):\n${input.text}${next}`;
  }
  throw new Error(`unknown task ${task}`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const { task, input, glossary = [], bookMeta = {} } = req.body || {};
    if (!task || !input) return res.status(400).json({ error: 'task and input required' });

    const model = pickModel(task);
    let system = SYS[task](glossary, bookMeta);
    if (task === 'translate_chunk') system = system.replace('{{LEVEL}}', input.level || 'B1');

    const resp = await client.messages.create({
      model,
      max_tokens: task === 'gloss' ? 400 : task === 'breakdown' ? 1500 : 4000,
      system,
      messages: [{ role: 'user', content: buildUser(task, input) }]
    });

    const raw = resp.content[0]?.text ?? '';
    let result;
    try { result = JSON.parse(raw); }
    catch { return res.status(502).json({ error: 'model returned non-JSON', raw }); }

    res.status(200).json({ result, model, usage: resp.usage });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
