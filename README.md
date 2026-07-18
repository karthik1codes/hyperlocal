<div align="center">

<img src="public/mascot.webp" width="120" alt="Bento Cards mascot">

# Hyperlocal × Bento Cards

**Rate city-level problems out of 99 — then bet them as live predictions.**

Turn a messy local question into a FIFA Ultimate Team–style scout card, backed by local news and a [Bento.fun](https://bento.fun) YES/NO market. Global books miss asymmetric city knowledge; this app mints it.

[![CI](https://github.com/karthik1codes/hyperlocal/actions/workflows/ci.yml/badge.svg)](https://github.com/karthik1codes/hyperlocal/actions/workflows/ci.yml)

</div>

<br/>

## Why hyper-local over public markets

Public books (Polymarket-scale) optimize for global volume — elections, crypto, macro. City outcomes rarely list: thin liquidity, messy resolution, no worldwide audience.

**Hyperlocal** opens a focused book around verifiable local news so locals can price what they already know — metro deadlines, campus fees, protest outcomes — before (or without) a national catalog caring.

---

## What it does

| Flow | What you get |
|------|----------------|
| **Hyper-local lab** (`/`) | Region + problem → crawl → YES/NO card → shareable FUT plate; side pack mixes local mints + live Bento markets |
| **Open as prediction** | Private Bento YES/NO duel from a `local-…` card (~6 min on-chain open floor) |
| **Club / debate** (`/club`) | Scout agents + LLM debate over your squad |

Without API keys, baked demo markets (`demo-btc-100k`, …) still load so you can click around.

---

## Pipeline

```text
Region + local problem
        │
        ▼
   OpenAI sharpens crawl query
        │
        ▼
   Chromium / Anakin fetches local news
   (+ Reddit / X when available)
        │
        ▼
   LLM drafts Will…? YES/NO + options
        │
        ▼
   Score card (PAC–PHY → OVR / 99)
   + FUT plate art + optional TTS
        │
        ▼
   Share /local-… card
        │
        ▼
   Bento createDuel (private credits)
   → wait ~6 min → estimateBuy → placeBet
```

1. **Input** — City/region + problem (text or speech).
2. **Sharpen** — OpenAI turns slang into a strong news crawl.
3. **Fetch** — Local Playwright Chrome by default, or Anakin remote browser (`LOCAL_NEWS_BROWSER=anakin`). Falls back to Anakin Search / HTTP.
4. **Draft** — Binary prediction grounded in the article.
5. **Card** — Market-style signals → football stats, finish (Bronze → Icon), shareable art.
6. **Bento** — Optional live private prediction; bets open after the platform’s start-time floor (~5 min + buffer → **~6 min**).

---

## Quick start

```bash
npm install
# Create .env (see below) — optional for demos only
npx playwright install chromium   # needed for local news crawl
npm run dev                       # http://localhost:3000
```

### Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm start` | Serve production build |
| `npm run lint` | ESLint |
| `npm test` | Vitest (unit tests in `tests/`) |

Node **20+** recommended.

---

## Environment

Create a `.env` or `.env.local` in the project root. **Never commit secrets.**

### Core (live Bento)

```bash
BENTO_BUILDER_API_KEY=           # live markets + create/bet
BENTO_URL=https://…              # optional; defaults to Bento API host
# Public URL used in share links / OG / sitemap.
# Local: http://localhost:3000  ·  Production: https://your-domain (never leave as localhost on Vercel)
NEXT_PUBLIC_SITE_URL=http://localhost:3000
REDIS_URL=                       # optional card cache + counters
```

### Hyper-local research

```bash
# LLM draft / plate / TTS (preferred path today)
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
OPENAI_IMAGE_MODEL=gpt-image-1
# OPENAI_TTS_MODEL=tts-1
# OPENAI_TTS_VOICE=nova

# News browser: local (default) | anakin
LOCAL_NEWS_BROWSER=local
# ANAKIN_API_KEY=                # if LOCAL_NEWS_BROWSER=anakin
# ANAKIN_BROWSER_WS=wss://api.anakin.io/v1/browser-connect
# LOCAL_NEWS_HEADED=true
# LOCAL_NEWS_ANAKIN_FALLBACK=true

# Optional Gemini path (legacy / alternate)
# GEMINI_API_KEY=
```

### Betting timing

```bash
# Private market open delay (ms). Clamped to ≥ 6 minutes.
# BENTO_MARKET_OPEN_DELAY_MS=360000
```

| Without… | Behavior |
|----------|----------|
| `BENTO_BUILDER_API_KEY` | Demo cards only; no live create/bet |
| `OPENAI_API_KEY` | Template card from news hit (weaker draft/art) |
| Browser / Anakin | Hyper-local research unavailable |

---

## How rating works

Six market signals map to football stats:

| Stat | Signal (gloss) |
|------|----------------|
| **PAC** | Recent betting volume / activity |
| **SHO** | Total volume / biggest pool |
| **PAS** | Unique participants / reach |
| **DRI** | Category / tag range |
| **DEF** | Engagement depth |
| **PHY** | Lifetime volume vs age |

- **Overall** is the headline (1–99). Raw stats cap near **88**; the **90s** need legacy/track record.
- **Position** and **archetype** come from stat shape, not a hand pick.
- **Finish ladder:** Bronze → Silver → Gold → In-Form → TOTY → Icon.

Hyper-local cards use the same plate language after research; native Bento duels re-scout as the book moves (Redis cache ~30 min when configured).

---

## Routes (handy)

| Path | Role |
|------|------|
| `/` | Hyper-local lab + SideCardFan pack (local + live markets) |
| `/[id]` or `/u/[id]` | Card report + bet UI |
| `/club` | Squad + scout agents |
| `/club/debate` | Multi-agent debate |
| `/api/local/research/stream` | SSE research progress |
| `/api/local/publish` | Open local card as Bento prediction |

Embed-style URLs still work for market ids: `/{id}` (report), card images via `/api/card-image/...`.

---

## Stack

**Next.js 16** · **React 19** · **TypeScript** · **Tailwind 4** · **Vitest** · **Playwright** · **[@bento.fun/sdk](https://bento.fun)** · Redis (optional) · OpenAI · Anakin (optional)

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Before a PR:

```bash
npm run lint && npm run build && npm test
```

## License

[MIT](./LICENSE)
