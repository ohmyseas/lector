# lector

Personal Spanish-learning reading app. Sibling of [dieciseis](https://github.com/ohmyseas/dieciseis).

Live: https://lector-ohmyseas.vercel.app

## Setup

1. `npm install`
2. Set env vars in Vercel (dashboard → Project → Settings → Environment Variables):
   - `ANTHROPIC_API_KEY`
   - `ELEVENLABS_API_KEY`
   - `ELEVENLABS_VOICE_ID_NARRATOR`
   - `ELEVENLABS_VOICE_ID_KRAVTSOV`
3. `npx vercel --prod`

## Local dev

```
npx vercel dev
```

Open http://localhost:3000

## Smoke test

```
BASE=https://lector-ohmyseas.vercel.app node scripts/smoke-api.mjs
```

## Architecture

See [HANDOFF.md](./HANDOFF.md) for full architecture, storage layout, model routing, and known limitations.
