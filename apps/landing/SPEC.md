# `apps/landing` — the Suize landing (SPEC)

> The marketing front door, **fully rebuilt 2026-06-10** around the consumer pivot
> (root `CLAUDE.md` LOCKED #6) and **deployed on Walrus through our own Deploy
> service** (dogfood — §8). The product, the rail, the two primitives, the custody
> posture, the honesty + consumer-vocabulary laws, and the network live in the repo
> `CLAUDE.md` — this SPEC **references, never redeclares** them. Where the older
> `marketing/DIRECTION.md` still sells dead approaches (the remote connector, the
> MCP-as-consumer-onboarding, "built on x402" tagging), **CLAUDE.md + this SPEC
> override it.**

**One job:** sell the two faces to their two audiences — the **consumer AI wallet**
(PAY) on the home, and **"start accepting payments from AI agents"** (CHARGE,
action-first) on `/for-business` — in consumer words, with illustrative artifacts
that are honest mockups, never false live claims.

Page title (locked, shipped): **"Suize — the AI wallet that makes life easier."**

---

## 0. Stack + where things live

- React 19 + Vite 7, Bun workspace (`@suize/landing`). Hand-authored CSS — no
  component library, no Tailwind. Deps: `gsap`, `lenis`, `ogl`, react/react-dom.
- **Hash router** (`useRoute`/`navigate` in `src/ui.jsx`) — routes live in the
  `#` fragment so **static hosting needs no rewrites** (load-bearing for Walrus
  serving; the worker never needs an SPA-fallback rule for deep links).
- **One motion clock** (`src/lib/motion.js`): GSAP ticker → Lenis → ScrollTrigger.
  `startMotion()` boots once in `App.jsx`; never start a second
  `requestAnimationFrame` loop (the pixel-melt's one self-terminating rAF is the
  sanctioned exception).
- **Copy/config law:** every label, URL, headline, and artifact string lives in
  `src/config.js` (`NAV`, `HOME`, `BUSINESS`, `PRICING`, `NOTIFICATIONS`,
  `ACTIVITY_ROWS`, `PRODUCTS`, `LINKS`, `ROOM_ACCENTS`) — components never
  hardcode copy or links.
- Theme system: `src/theme.css` (light broadsheet DEFAULT + dark alternate via
  `ThemeToggle`; the business route gets its own dark corporate room palette,
  `[data-room='business']`). Type triad shared with Crash/Deploy: Space Grotesk /
  Martian Mono / Newsreader (Google Fonts, in `index.html`).

Build gate: `bun run build` (in `apps/landing`) must stay green.

---

## 1. Information architecture (the 2026-06-10 IA)

The old "two doors / single-audience `/agents` + `/businesses` pages" IA is
**retired**. The home IS the consumer page; business got one named page.

**Nav** (`components/Nav.jsx`): `For users` (→`#/`) · `For business`
(→`#/for-business`) · `Products ▾` (the dropdown — **Deploy + Crash ONLY**; Wallet
and Charge ARE the two audience pages, never repeated as products) · `Pricing` ·
a route-aware CTA (home: **Access your wallet** → `wallet.suize.io`; business:
**Start earning**). **No nav index numbers** (owner cut them).

| Route | Page | Component | Job |
|---|---|---|---|
| `/` | **HOME — the consumer AI wallet** (PAY) | `pages/Landing` | conversation-first hero + the four home beats (§3) |
| `/for-business` | **CHARGE** | `pages/Businesses` | "Start accepting payments from AI agents." (§4) |
| `/deploy` | featured real merchant | `pages/Deploy` | full product room (ship flow + the double-hash integrity beat) |
| `/crash` | product stub | `pages/ProductStub` | light room; never featured on the home |
| `/pricing` | pricing | `pages/Pricing` | **EVERY number lives here** (§5) |

**Deleted pages + redirects:** the standalone `/wallet` and `/checkout` pages are
retired; `App.jsx` `HASH_REDIRECTS` maps old inbound links so nothing 404s —
`#/agents`→`#/`, `#/wallet`→`#/` (the home covers the wallet), `#/businesses` and
`#/checkout`→`#/for-business`.

---

## 2. The HOME hero (`/`) — `components/Hero.jsx` (conversation-first)

The hero leads with a **real chat thread inside wallet chrome** — intelligence +
memory + payment in one artifact:

- **Badge:** `Built on Sui` (true, plain). **NO testnet label anywhere on the
  page** — the testnet/non-custodial disclaimers live in the footer only
  (mainnet-ready sales landing, `CLAUDE.md` L2 law).
- **Headline:** `The AI wallet that` / `makes life easier.` — the hot word
  `easier` takes the gradient clip. Sub: *"Tell it what you want. It remembers
  you, finds the best option across thousands of services, and pays — you just
  approve."* + the reach line *"Access thousands of supported services."*
- **The chat thread** (`HOME.hero.convo`): you ask it to watch SF flight prices →
  it commits to watching → **"Booked — direct to SFO, $240, paid from your
  balance."**
- **Wallet chrome on the chat pane:** label `Your agent wallet`, an
  **Agent-enabled toggle** (on), and a live balance — **$460.00 ticks down to
  $220.00** (easeOutCubic, brief highlight) the moment the booked message lands,
  so the chat and the money are ONE surface. Both numbers come from config; the
  balance is the user's OWN illustrative money, never a Suize price. Reduced
  motion → starts settled at $220.
- CTAs: `Access your wallet` (primary) / `See how it works` (ghost → `#leash`).
  Quiet proof line: *"Spends only what you fund. Switch it off in one tap."*
- **`components/HeroScene.jsx`** — the ONE shader moment: a dialed-back, bounded
  OGL scene behind the hero only. The global page shader is **retired** (owner:
  it stole focus); `components/Backdrop.jsx` is a pure-CSS editorial surface
  (paper + subtle film grain + faint vignette).

---

## 3. The home beats — `components/HomeBeats.jsx`

Order: sub-accounts → capabilities → confirm → log → trust/closer. Every beat's
copy is in `HOME` (config).

1. **Sub-accounts** (`LeashBeat` — internal name only; the rendered word is
   **sub-account**, per the consumer-vocabulary laws): the two balance CARDS are
   the centerpiece — `Your balance · $1,240.00 · "Your money. Suize never touches
   it."` vs `Agent sub-account · $100.00 · "What your AI can spend — it can't go
   past it."` — head *"You set the allowance. It can't go over."*, top-up /
   pull-back flow line, three trust chips (`No bank.` `No setup headache.`
   `Fully decentralized.`).
2. **Capabilities** (`CapabilitiesBeat`): five cards — it remembers you · it acts
   everywhere · it pays safely · you're in control · free to start. ("Thousands of
   services" is a bold aspirational placeholder; "free to start / a smarter AI" is
   the tier story WITHOUT model names or prices.)
3. **The confirm moment** (`ConfirmBeat` + `components/ConfirmSequence.jsx`): an
   animated **real iOS-notification → confirm → logged** sequence driven by the
   `NOTIFICATIONS` deck (kinds: smart-find / subscription / cancel / order / save;
   a `save`-tone card LEADS). The notification subject is the USER's own agent
   finding/deciding; the sequence shows "a tap is all it takes."
4. **The activity log** (`LogBeat` + `components/ActivityLog.jsx`): the alive
   ledger from `ACTIVITY_ROWS` — the green `+$9.99 saved` row and the red
   `You hit kill — agent stopped` row are the two hero rows (flash once on land);
   green/red are reserved for true status. Head: *"Fully transparent. You stay in
   control."*
5. **Trust zone + closer** (`TrustCloser`): the VERBATIM custody phrase *"fully
   non-custodial — your keys never leave your machine"*; the consumer-side
   trusted-by marquee is **intentionally empty** (trusted-by moved to the business
   page — "trusted by thousands of companies" is off-pitch for consumers). Closer:
   two floating serif lines — **"Sit back and relax." / "Your AI handles the
   rest."** — then the CTA + the bridge *"Run a business? Get paid by agents →"*.

---

## 4. `/for-business` — the CHARGE page (`pages/Businesses.jsx`)

The dark **corporate deep-blue room** (`data-room='business'` on `<html>`).
Spine: hero → revenue stream → charge → speed → proof → close. Copy in `BUSINESS`.

- **Hero** (`BusinessHero`): **`Start accepting payments` / `from AI agents.`**
  (action-first, owner-locked — get-paid-by-agents is the PRIMARY value; the hot
  phrase is line 2). Sub: one line, agents pay you directly, one-off or
  subscription, no KYB, live in minutes. The marketplace reach — *"And get
  recommended to millions of customers along the way."* — is a SECONDARY
  supporting line, never the lead (discovery surface = roadmap).
- **Standards-only integrations strip** (`IntegrationsStrip`): *"402-shaped —
  works with any site that can take a payment, built for the same standards as
  Stripe, Coinbase, and Google AP2."* **NO platform names/logos** (no
  Shopify/WooCommerce — `CLAUDE.md` LOCKED #7) and never "on x402".
- **The revenue-stream panel** (`components/PaymentLane.jsx` — internal name
  only; the playful conveyor is **long gone**): a merchant-wallet **revenue
  dashboard** — a monthly revenue total with a `+31%` delta, ONE stacked bar
  (human-customer baseline in calm ink + the **agentic stream stacked and
  HIGHLIGHTED** on top), and a two-row ledger split (`Customers` / `AI agents`)
  summing to a higher total. Figures are illustrative merchant revenue, never a
  Suize tier/fee. Motion = the shared scroll reveal only (no loops, no timers).
- **Charge / Speed / Proof beats** (`BusinessBeats`): the snippet beside the
  receipt it produces; three speed cards (live in minutes · instant USDC ·
  subscriptions renew themselves); three proof facts (seconds / every fee printed
  on the receipt / non-custodial) + a `See pricing →` link — **no pricing numbers
  on this page**.
- **Close** (`CloseBeat`): the **"Trusted by thousands"** marquee — **PLACEHOLDER
  fictional names** (Globex, Initech, Hooli…; TODO swap for real logos before
  launch); the honesty line *"402-shaped, x402-compatible by design — the payer
  needs nothing Suize-specific."*; the FOMO closer **"Agents are already
  spending." / "Don't get left out."**; bridge back to the consumer home.

---

## 5. `/pricing` — the only place a price exists

`PRICING` in config is the canonical copy: the consumer tiers — **Free** (the full
AI wallet, free to start, no card) and **"Smarter AI"** (`$9.99/mo` — **FLAG:
PLACEHOLDER, owner to confirm**; described only as "a smarter AI", **no model
names in rendered copy**) — plus the rail rows (send/transfer **Free** · get paid
by an agent **2%** · setup **$0**). *(Drift note: `pages/Pricing.jsx` still
hardcodes the rail rows and predates the tier config — reconcile the render to
`PRICING` in a follow-up.)* No price string may appear on any other page.

---

## 6. Design laws (the rebuild's enforced DNA)

- **Light default**; the business room is the one sanctioned dark corporate
  palette; `ThemeToggle` flips the global theme.
- **Glassmorphism buttons/cards**, rounded ~12px — the house surface treatment.
- **Banned:** diode/pulse dots · device mockups (no phone frames) · nav index
  numbers · tech jargon user-facing (MemWal / model names / zkLogin / MCP /
  Walrus — consumer words only, `CLAUDE.md` vocabulary laws) · pricing outside
  `/pricing` · "leash"/"pot" in rendered copy (the word is **sub-account**) ·
  purple/pink SaaS gradients · emoji in UI chrome.
- **Shader discipline:** the one subtle shader is hero-bounded (`HeroScene`);
  NO global/background shader (retired — it stole focus).
- **Nav:** ara.so-style **scroll-retracting island** — expanded at top, condenses
  to a compact glass island on scroll-down, re-expands on scroll-up;
  direction-aware + hysteretic; **scroll-only** (no timers).
- **Route transition:** the **digital pixel-melt** — a canvas grid of dithered
  blocks tinted to the incoming room accent, scatter-in then per-block melt-away
  (~640ms, one self-terminating rAF); reduced-motion → clean CSS accent fade.
- **Reveals are scroll-scrubbed** through the one Lenis+GSAP clock; everything
  respects `prefers-reduced-motion`.
- Green/red are reserved for true status (saved / killed); money is mono.

---

## 7. Honesty laws on this surface (calibrated honesty is LAW)

1. **Mainnet-ready SALES landing** (`CLAUDE.md` L2, owner 2026-06-09): NO testnet
   labels on-page AND no "live on mainnet" claim while `account.move` is
   unpublished. Every artifact (chat, balances, notifications, log, revenue
   panel) is an **illustrative product mockup** — amounts are the user's/merchant's
   own illustrative money, never a Suize price, and never imply a live feed.
2. The conversational AI + provider integrations are largely **ROADMAP**
   (`CLAUDE.md` PAY) — the page sells the product honestly as what it will be,
   shows mockups, and claims no live agent volume.
3. Custody phrase VERBATIM in the trust zone: *"fully non-custodial — your keys
   never leave your machine."* The `LOCKED_RECORD_TIP` translates "saved
   on-chain" without naming the storage tech.
4. **402-shaped, x402-compatible by design** — never "on x402"; integrations strip
   is standards-only (§4).
5. The dead remote connector (`connect.suize.io`, "no install", "paste one URL")
   and the "Install the Suize MCP" consumer onboarding are **never reintroduced**
   (L1, LOCKED #6).

**KNOWN LIE TO FIX — `public/llms.txt`:** the served `suize.io/llms.txt` (also
`<link rel="alternate">` in `index.html`) is a **stale pre-pivot draft** — it
still describes `set_agent` (removed on-chain), a "zero install" remote-MCP
connector (DEAD), and the old onboarding. Rewrite it to the current narrative
(or pull the file + link) — it is the one machine-facing surface still telling
the old story.

---

## 8. Deploy state (dogfood — shipped through our own Deploy)

- **LIVE on Walrus via the Suize Deploy service** (testnet): on-chain `Site`
  `0xc96dd1621f41ccc957887925ea98756dc617543deb3e6fa9d00d1839e47b9d0c`, served
  hash-verified by the deploy-worker at
  `https://50qfse0t2krlxbu9zvbx0xfz8m9ccssa0g7dt8lrx4oopads0c.suize.site`.
  Storage: 30 epochs ≈ 1 month (renewal = a re-deploy or the future
  storage-renewal subscription). The deploy ran **auth-only** (the $0.50 charge
  gate is bypassed until `account` publishes — `apps/deploy/SPEC.md`).
- The hash router means the static bundle serves correctly with no rewrite rules.
- **og.png** (1200×630) + full Open Graph / Twitter meta shipped in `index.html`.
- **Vercel is the LEGACY path** (`scripts/deploy.sh` + `vercel.json`) — kept until
  `suize.io` cuts over, not the canonical deploy.
