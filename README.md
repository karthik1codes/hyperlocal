<div align="center">

<img src="public/mascot.webp" width="120" alt="Bento Cards mascot">

# Bento Cards

**your Bento market, rated out of 99**

Turn any [Bento.fun](https://bento.fun) betting market into a FIFA-style player card. Scored from live market signals — volume, participants, category, and more.

</div>

<br/>

## Embed your card

Your card lives at a URL. Drop it anywhere — and it re-scouts itself as the market moves.

```md
[![My Bento card](https://YOUR_SITE/demo-btc-100k.png)](https://YOUR_SITE/demo-btc-100k)
```

| | |
|---|---|
| **`/<market-id>.png`** | your card, as a live image |
| **`/<market-id>`** | the full market report |
| **`?country=XX`** | override the flag (e.g. `?country=DZ`) |

<br/>

## Setup

```bash
npm install
cp .env.example .env.local   # if present
# Required for live markets:
#   BENTO_BUILDER_API_KEY=...
# Optional:
#   NEXT_PUBLIC_SITE_URL=https://your-domain
#   REDIS_URL=...
npm run dev
```

Without `BENTO_BUILDER_API_KEY`, the app serves baked demo markets (`demo-btc-100k`, `demo-lakers-celtics`, …).

<br/>

## How rating works

Six signals from a Bento market map to football stats. Your **overall** is the headline. Raw stats cap at **88** — the 90s are a legacy gate. Position and archetype come from your stat shape.

Every card walks out in a finish: Bronze → Silver → Gold → In-Form → TOTY → Icon.

<br/>

<div align="center">

**Built with** Next.js · TypeScript · Tailwind · Redis · [@bento.fun/sdk](https://bento.fun)

</div>
