export default function handler(req, res) {
  const env = process.env;
  res.status(200).json({
    ok: true,
    service: 'lector',
    ts: Date.now(),
    voices: {
      narrator: !!env.ELEVENLABS_VOICE_ID_NARRATOR,
      kravtsov: !!env.ELEVENLABS_VOICE_ID_KRAVTSOV,
      es: !!env.ELEVENLABS_VOICE_ID_ES_NARRATOR,
      en: !!env.ELEVENLABS_VOICE_ID_EN_NARRATOR,
      ru: !!env.ELEVENLABS_VOICE_ID_RU_NARRATOR,
      pt: !!env.ELEVENLABS_VOICE_ID_PT_NARRATOR
    },
    llmConfigured: !!env.ANTHROPIC_API_KEY,
    ttsConfigured: !!env.ELEVENLABS_API_KEY
  });
}
