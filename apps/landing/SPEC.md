# `apps/landing` — the Suize landing (SPEC)

> The marketing front door, **fully rebuilt 2026-06-10** around the consumer pivot
> (root `CLAUDE.md` LOCKED #6) and **deployed on Walrus through our own Deploy
> service** (dogfood — §8). The product, the rail, the two primitives, the custody
> posture, the honesty + consumer-vocabulary laws, and the network live in the repo
> `CLAUDE.md` — this SPEC **references, never redeclares** them. Where the older
> `marketing/DIRECTION.md` still sells dead approaches (the remote connector, the
> MCP-as-consumer-onboarding, the retired `suize-402/1` wire, "built on x402"
> tagging), **CLAUDE.md + this SPEC override it.** The live rail is x402 V2 (the
> claim ladder in §7).

**One job:** sell the two faces to their two audiences — the **consumer AI wallet**
(PAY) on the home, and **"start accepting payments from AI agents"** (CHARGE,
action-first) on `/business` — in consumer words, with illustrative artifacts
that are honest mockups, never false live claims.

Page title (locked, shipped): **"Suize — the AI wallet that makes life easier."**

---

## 0. Stack + where things live

- React 19 + Vite 7, Bun workspace (`@suize/landing`). Hand-authored CSS — no
  component library, no Tailwind. Deps: `gsap`, `lenis`, `ogl`, react/react-dom.
- **Path router** (`useRoute`/`navigate` in `src/ui.jsx` — History API, NOT hash,
  since 2026-06-13) — clean URLs (`suize.io/business`, `/pricing`) so a social/
  crawler scrape of a path can serve a **per-route OG card** (a `#` fragment is
  never sent to the server, so it could never have a distinct card — the reason
  the hash router was dropped). `useRoute` reads `location.pathname` + a global
  click-interceptor pushState's internal `<a href="/…">` (skips modified clicks,
  `_blank`, downloads, and real files like `/llms.txt` via a `.ext` guard);
  `navigate()` pushState + dispatches `popstate`. **Deep links now NEED rewrites**
  (`vercel.json`): `/business`→`/business.html`, everything else→`/index.html`;
  legacy paths 308 (`/for-business`→`/business`, `/businesses`→`/business`,
  `/agents`,`/wallet`→`/`, `/checkout`→`/business`); old `#/…` hash links are
  converted to the path once on load in `App.jsx`. (Walrus dogfn serving would
  now need an SPA-fallback rule — Vercel is the live host.)
- **Per-route OG (2026-06-13):** TWO html entries, ONE SPA (vite
  `build.rollupOptions.input`): `index.html` (default PAY/wallet card) +
  `business.html` (the CHARGE/x402 card — "Suize for business — get paid by AI
  agents"; merchant copy law: 2% no-floor / no-KYB / no-chargebacks / instant /
  USDC, agents-first, standards-only "x402-compatible by design"). Both load the
  same `/src/main.jsx`; they differ only in static `<meta>`. A dev middleware
  maps `/business`→`business.html` for parity.
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

**Nav** (`components/Nav.jsx`): `For users` (→`/`) · `For business`
(→`/business`) · `Products ▾` (the dropdown — **Deploy + Crash ONLY**; Wallet
and Charge ARE the two audience pages, never repeated as products) · `Pricing` ·
a route-aware CTA (home: **Access your wallet** → `wallet.suize.io`; business:
**Start earning**). **No nav index numbers** (owner cut them).

| Route | Page | Component | Job |
|---|---|---|---|
| `/` | **HOME — the consumer AI wallet** (PAY) | `pages/Landing` | conversation-first hero + the four home beats (§3) |
| `/business` | **CHARGE** | `pages/Businesses` | "Start accepting payments from AI agents." (§4) |
| `/deploy` | featured real merchant | `pages/Deploy` | full product room (ship flow + the double-hash integrity beat) |
| `/crash` | product stub | `pages/ProductStub` | light room; never featured on the home |
| `/pricing` | pricing | `pages/Pricing` | **EVERY number lives here** (§5) |
| `/docs` | docs + quickstart (merged) | `pages/Docs` | the four-tier merchant onboarding ladder + the 402 loop (truth-locked below) |

**`#/docs` truth lock (2026-06-12, x402 V2):** the Tier-3 snippet is the REAL
`@suize/pay` middleware (`npm i @suize/pay` → `import { suize }` →
`app.use(suize({ to, price }))`; Bun/Hono/Next fetch-style + Express; any other
language via plain x402 HTTP). The merchant answers **402** with an x402 V2
`PaymentRequired` challenge and verifies via the facilitator's `POST /verify` +
`POST /settle` (`api.suize.io`) — **no webhooks/dashboard/sessions/API keys exist**
(the chain is the database). **ZERO status-talk** (no "coming soon"/"rolling out"):
a surface is documented as it works today, or it is ABSENT from the page. A
merchant's own example price (`'0.10'`) is allowed in snippets; Suize fees stay on
`/pricing` (the fee is **2% with a 1¢ minimum, merchant-absorbed** — the payer always
pays exactly the listed price).

**Deleted pages + redirects:** the standalone `/wallet` and `/checkout` pages are
retired; nothing 404s — path links 308 server-side (`vercel.json`:
`/agents`→`/`, `/wallet`→`/`, `/businesses`→`/business`, `/checkout`→`/business`,
`/for-business`→`/business`) and old `#/…` hash links convert to the path on load
(`App.jsx` `LEGACY_HASH`).

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
  phrase is line 2). Sub: one line, agents pay you directly — one-off AND
  subscriptions, no KYB, live in minutes. **NO status-talk** (the no-"coming-soon"
  law now applies to the landing too): both one-off and recurring are described as
  they work today. The marketplace reach — *"And get recommended to millions of
  customers along the way."* — is a SECONDARY supporting line, never the lead
  (discovery surface = roadmap).
- **Standards-only integrations strip** (`IntegrationsStrip`): *"works with any site
  that can take a payment, built for the same standards as Stripe, Coinbase, and
  Google AP2."* **NO platform names/logos** (no Shopify/WooCommerce — `CLAUDE.md`
  LOCKED #7). **x402 claim ladder (binding copy law):** ALLOWED — *"gasless,
  x402-compatible by design,"* *"implements the merged x402 Sui exact scheme,"*
  *"we run a live x402 facilitator for Sui."* FORBIDDEN until the mechanism PR
  MERGES — *"on x402," "official x402 facilitator," "the default Sui facilitator"*
  (as fact; may be stated as ambition).
- **The revenue-stream panel** (`components/PaymentLane.jsx` — internal name
  only; the playful conveyor is **long gone**): a merchant-wallet **revenue
  dashboard** — a monthly revenue total with a `+31%` delta, ONE stacked bar
  (human-customer baseline in calm ink + the **agentic stream stacked and
  HIGHLIGHTED** on top), and a two-row ledger split (`Customers` / `AI agents`)
  summing to a higher total. Figures are illustrative merchant revenue, never a
  Suize tier/fee. Motion = the shared scroll reveal only (no loops, no timers).
- **Charge / Speed / Proof beats** (`BusinessBeats`): the real `@suize/pay`
  one-liner beside the receipt it produces (its third row = `Verified · POST
  /verify · paid ✓`); three speed cards (live in minutes · instant USDC ·
  subscriptions — all present-tense, no status-talk); three proof facts (seconds /
  every fee printed on the receipt / non-custodial) + a `See pricing →` link — **no
  pricing numbers on this page**. Subscriptions phrasing is **push-not-pull**
  (CLAUDE.md): the user pays each period themselves, nobody reaches into their
  account, cancel = delete on-chain.
- **Close** (`CloseBeat`): the **"Trusted by thousands"** marquee — **PLACEHOLDER
  fictional names** (Globex, Initech, Hooli…; TODO swap for real logos before
  launch); the honesty line *"gasless, x402-compatible by design — the payer needs
  nothing Suize-specific."*; the FOMO closer **"Agents are already spending." /
  "Don't get left out."**; bridge back to the consumer home.

---

## 5. `/pricing` — the only place a price exists

`PRICING` in config is the canonical copy: the consumer tiers — **Free** (the full
AI wallet, free to start, no card) and **"Smarter AI"** (`$9.99/mo` — **FLAG:
PLACEHOLDER, owner to confirm**; described only as "a smarter AI", **no model
names in rendered copy**) — plus the rail rows (send/transfer **Free** · get paid
by an agent **2% (1¢ min)** · setup **$0**). The 2% is **merchant-absorbed** — the
payer always pays exactly the listed price. *(Drift note: `pages/Pricing.jsx` still
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
   labels on-page AND no "live on mainnet" claim while the rail is testnet-proven
   but not yet mainnet-published. Every artifact (chat, balances, notifications,
   log, revenue panel) is an **illustrative product mockup** — amounts are the
   user's/merchant's own illustrative money, never a Suize price, and never imply a
   live feed.
2. The conversational AI + provider integrations are largely **ROADMAP**
   (`CLAUDE.md` PAY) — the page sells the product honestly as what it will be,
   shows mockups, and claims no live agent volume.
3. Custody phrase VERBATIM in the trust zone: *"fully non-custodial — your keys
   never leave your machine."* The `LOCKED_RECORD_TIP` translates "saved
   on-chain" without naming the storage tech.
4. **The x402 claim ladder** (binding copy law — write at the rung true ON PUBLISH,
   ~June 18, when the upstream PRs are OPEN but not merged): ALLOWED — *"gasless"*
   (literally true — protocol-level), *"x402-compatible by design,"* *"implements
   the merged x402 Sui exact scheme,"* *"we run a live x402 facilitator for Sui."*
   FORBIDDEN until the mechanism PR MERGES — *"on x402," "official x402
   facilitator," "the default Sui facilitator"* as fact (may be an ambition). §4
   integrations strip obeys this.
5. **ZERO status-talk on the page** (now a landing law, not just llms.txt): no
   "coming soon," "soon," "roadmap," "will be able," "not yet," "pending." A
   feature is described as it works today, or it is ABSENT.
6. The dead remote connector (`connect.suize.io`, "no install", "paste one URL")
   and the "Install the Suize MCP" consumer onboarding are **never reintroduced**
   (L1, LOCKED #6).

**`public/llms.txt` — rewritten to the x402 V2 rail (the rail contract: the x402
V2 `PaymentRequired` challenge anatomy, the pay / get-paid doors, `@suize/pay`,
`/verify` + `/settle`, push-not-pull subscriptions) and **deployed at
`suize.io/llms.txt`**. Pay links point at the canonical `pay.suize.io`; zero
"coming soon"/status talk (the no-status-in-docs law — an unbuilt surface
answers at runtime instead). It is the hub every per-product llms.txt links
back to.

---

## 8. Deploy state (dogfood — shipped through our own Deploy)

- **LIVE on Walrus via the Suize Deploy service** (testnet): on-chain `Site`
  `0xc96dd1621f41ccc957887925ea98756dc617543deb3e6fa9d00d1839e47b9d0c`, served
  hash-verified by the deploy-worker at
  `https://50qfse0t2krlxbu9zvbx0xfz8m9ccssa0g7dt8lrx4oopads0c.suize.site`.
  Storage: 30 epochs ≈ 1 month (renewal = a re-deploy or the push-not-pull
  storage-renewal subscription). The deploy ran **auth-only** (the $0.50 x402
  charge gate arms once the Deploy treasury resolves — `apps/deploy/SPEC.md`).
- The path router (since 2026-06-13) needs the `vercel.json` rewrites/redirects
  above for deep links; the Walrus dogfood snapshot predates the cutover and is a
  point-in-time artifact (Vercel is the live host — `suize.io` apex canonical,
  `www` 308s to apex; nothing in the codebase links to `www`).
- **og.png** (1200×630) + full Open Graph / Twitter meta shipped in `index.html`.
- **Vercel is the LEGACY path** (`scripts/deploy.sh` + `vercel.json`) — kept until
  `suize.io` cuts over, not the canonical deploy.
