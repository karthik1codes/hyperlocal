# Contributing to Bento Cards

Thanks for wanting to help — bug fixes, sharper scoring, betting UX, and docs are all welcome.

## Getting started

Bento Cards is a [Next.js](https://nextjs.org) (App Router) app in TypeScript, styled with Tailwind. You'll need **Node 20+** and **npm**.

```bash
npm install
npm run dev          # http://localhost:3000
```

Out of the box it runs on baked demo markets (`demo-btc-100k`, `demo-lakers-celtics`, …), so you can build and click around **without any secrets**.

### Environment (optional)

Create a `.env.local` only if you want live markets or the counter:

```bash
# Live Bento market scouting. Without it, the app serves baked demo cards.
BENTO_BUILDER_API_KEY=...

# Optional: absolute site URL used in metadata / share links.
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Optional: scout counter + card cache. Fully functional without it.
REDIS_URL=redis://localhost:6379
```

## Before you open a PR

```bash
npm run lint
npm run build
npm test
```

- **Tests** live in `tests/` (vitest). Add or adjust tests for scoring or pure logic you touch.
- **Types** are strict — the build fails on type errors.

## Conventions

- **Commits**: [Conventional Commits](https://www.conventionalcommits.org) — e.g. `feat(scoring): …`, `fix(og): …`, `docs: …`.
- **Style**: match the surrounding code; comments explain the *why*, not the *what*.
- Keep PRs focused. For anything visual (cards, OG images), a before/after screenshot helps.

Found a security issue? Please **don't** open a public issue — see [SECURITY.md](./SECURITY.md).

## Licensing

By contributing, you agree that your contributions are licensed under the project's [LICENSE](./LICENSE).
