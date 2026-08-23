export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    service: 'lector',
    ts: Date.now(),
    voices: {
      narrator: !!process.env.ELEVENLABS_VOICE_ID_NARRATOR,
      kravtsov: !!process.env.ELEVENLABS_VOICE_ID_KRAVTSOV
    },
    llmConfigured: !!process.env.ANTHROPIC_API_KEY,
    ttsConfigured: !!process.env.ELEVENLABS_API_KEY
  });
}
