const MODEL_ID = {
  multilingual_v2: 'eleven_multilingual_v2',
  flash_v2_5: 'eleven_flash_v2_5'
};

// Per-language voice slots. Falls back to legacy NARRATOR/KRAVTSOV for compat.
function pickVoice(name, lang) {
  const env = process.env;
  if (name === 'es') return env.ELEVENLABS_VOICE_ID_ES_NARRATOR || env.ELEVENLABS_VOICE_ID_NARRATOR;
  if (name === 'en') return env.ELEVENLABS_VOICE_ID_EN_NARRATOR || env.ELEVENLABS_VOICE_ID_NARRATOR;
  if (name === 'ru') return env.ELEVENLABS_VOICE_ID_RU_NARRATOR || env.ELEVENLABS_VOICE_ID_NARRATOR;
  if (name === 'kravtsov') return env.ELEVENLABS_VOICE_ID_KRAVTSOV;
  if (name === 'narrator' && lang) {
    if (lang === 'es') return env.ELEVENLABS_VOICE_ID_ES_NARRATOR || env.ELEVENLABS_VOICE_ID_NARRATOR;
    if (lang === 'en') return env.ELEVENLABS_VOICE_ID_EN_NARRATOR || env.ELEVENLABS_VOICE_ID_NARRATOR;
    if (lang === 'ru') return env.ELEVENLABS_VOICE_ID_RU_NARRATOR || env.ELEVENLABS_VOICE_ID_NARRATOR;
  }
  return env.ELEVENLABS_VOICE_ID_NARRATOR || env.ELEVENLABS_VOICE_ID_ES_NARRATOR;
}

// Bucket ElevenLabs character-level alignment into words by whitespace/punctuation boundaries.
function bucketWords(chars, starts, ends) {
  const WORD_BREAK = /[\s.,;:!?¡¿"'()\[\]«»—–…]/;
  const words = [];
  let buf = '', bufStart = null, bufEnd = null;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (WORD_BREAK.test(c)) {
      if (buf) {
        words.push({ word: buf, startSec: bufStart, endSec: bufEnd });
        buf = ''; bufStart = null; bufEnd = null;
      }
    } else {
      if (!buf) bufStart = starts[i];
      buf += c;
      bufEnd = ends[i];
    }
  }
  if (buf) words.push({ word: buf, startSec: bufStart, endSec: bufEnd });
  return words;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const {
      text,
      model = 'multilingual_v2',
      voice = 'narrator',
      lang,
      withTimestamps = false,
      previousRequestIds
    } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text required' });

    const modelId = MODEL_ID[model];
    if (!modelId) return res.status(400).json({ error: `unknown model ${model}` });
    const voiceId = pickVoice(voice, lang);
    if (!voiceId) return res.status(500).json({ error: `voice slot not configured (voice=${voice}, lang=${lang})` });

    const endpoint = withTimestamps
      ? `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`
      : `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

    const body = {
      text,
      model_id: modelId,
      output_format: 'mp3_44100_64',
      ...(previousRequestIds && previousRequestIds.length ? { previous_request_ids: previousRequestIds } : {})
    };

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'content-type': 'application/json',
        'accept': withTimestamps ? 'application/json' : 'audio/mpeg'
      },
      body: JSON.stringify(body)
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).json({
        error: `elevenlabs ${r.status}`,
        detail: errText.slice(0, 500),
        voiceId
      });
    }
    const requestId = r.headers.get('request-id') || r.headers.get('x-request-id') || '';

    if (withTimestamps) {
      const j = await r.json();
      const align = j.normalized_alignment || j.alignment;
      const timings = align
        ? bucketWords(align.characters, align.character_start_times_seconds, align.character_end_times_seconds)
        : [];
      return res.status(200).json({ audioBase64: j.audio_base64, timings, requestId });
    } else {
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('X-Request-Id', requestId);
      return res.status(200).send(buf);
    }
  } catch (e) {
    return res.status(500).json({ error: 'tts proxy error', detail: (e.message || '').slice(0, 200) });
  }
}
