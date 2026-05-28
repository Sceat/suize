# Suize

> *Ask Sui anything in plain English. One MCP endpoint. AI agents pay $0.01 USDsui per question.*

```bash
cd landing && npm install && npm run dev
```

A B2A (business-to-agent) infrastructure play built for the Sui Overflow 2026 hackathon.

---

## Repo layout

| Path | What |
|---|---|
| [product.md](product.md) | Living product specification — pitch, architecture, the bet |
| [intents.md](intents.md) | Notes on real agent intents we want to answer |
| [landing/](landing/) | React + Vite + Tailwind v4 waitlist landing page |

---

## Landing page

Stack: **React 19 · Vite 7 · Tailwind v4 · OGL** (custom fluid shader)

```bash
cd landing
npm install
cp .env.example .env.local   # optional — set VITE_API_URL + VITE_TURNSTILE_SITE_KEY
npm run dev                  # http://localhost:5173
npm run build                # production build → dist/
```

Production deploy: any static host. Vercel / Netlify / Cloudflare Pages all work — `landing/` is the project root, `npm run build` is the build command, `dist/` is the output.

---

## What this is

A single MCP endpoint where AI agents send a plain-English intent + an x402 USDsui micropayment, and receive structured Sui chain answers atomically. Under the hood: Objectomics (typed PTB fingerprinting + emergent taxonomy via process mining on Move's type system). See [product.md](product.md) for the full thesis.

---

*Made by one solo founder for Sui Overflow 2026. Reach the team: <fetch@sceat.xyz>.*
