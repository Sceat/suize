// ============================================================================
// Canonical links + copy constants for the landing. One place for every URL +
// product so the page / nav / footer / dropdown never drift.
// Positioning: "Revolut + Stripe for the agentic web." NO "standard".
// PRICING RULE: a fee may appear ONLY inside a rendered receipt artifact (the
// hero proof / snippet receipt — where the emitted fee IS the trust proof);
// NEVER as marketing copy in a headline, fact-row, caption, blurb, or CTA.
// All prices ($0.50, $19.99, 2%) live ONLY on the /pricing page.
// ============================================================================

// The local-MCP install command — the package name (@suize/mcp) is the one
// place brand-blue lands in the connect card. The MCP runs Google/Enoki zkLogin
// and signs LOCALLY; keys never leave the user's machine (fully non-custodial).
export const MCP_PACKAGE = '@suize/mcp'
export const MCP_INSTALL = `npx ${MCP_PACKAGE}`

export const LINKS = {
  wallet: 'https://wallet.suize.io',
  // the business "start earning" door — the in-app docs page IS the merged
  // how-it-works + quickstart (the one-liner snippet + the MCP card live there).
  // The old docs.suize.io site is DEAD — never link it, never resurrect a
  // separate quickstart link.
  checkout: '/docs',
  deploy: 'https://deploy.suize.io',
  crash: 'https://crash.suize.io',
  docs: '/docs',
  llms: '/llms.txt',
  // primary CTA — start the onboarding at the wallet.
  start: 'https://wallet.suize.io',
}

// NAV — the persistent header. Labels + links live here (LOCKED #14: never
// hardcode a label or URL in the component). The header is: two AUDIENCE entries
// (For users → the PAY home · For business → the CHARGE page), a Products
// dropdown (the ADDITIONAL products only — Deploy + Crash; Wallet & Charge are
// the two audience pages, never repeated as products), then Pricing.
//
// Docs left the navbar (owner cut it) — #/docs stays reachable from every
// business-page CTA (LINKS.checkout) and the footer Learn column (LINKS.docs).
export const NAV = {
  // Plain editorial nav (owner cut the 01/02/… index numbers — no `no` field).
  // The Products dropdown + Pricing are rendered AFTER these audience links in
  // Nav.jsx (Products is the menu trigger, not a plain link).
  links: [
    { label: 'For users', href: '/' },
    { label: 'For business', href: '/business' },
  ],
  // the Products dropdown — ADDITIONAL products only (Deploy + Crash). Wallet &
  // Charge are covered by the For users / For business audience pages, so they
  // are intentionally NOT here. `routes` are the in-app product detail pages.
  products: {
    label: 'Products',
    routes: ['deploy', 'crash'],
  },
  // Pricing — its own top-level link, rendered last.
  pricing: { label: 'Pricing', href: '/pricing' },
  // ONE CTA, every route — same label, same door (the wallet). The route-aware
  // home/business variant is dead; the business page's own section CTAs carry
  // the merchant door (#/docs via LINKS.checkout).
  cta: { label: 'Access wallet', href: LINKS.wallet },
}

// ============================================================================
// THE PAY HOME — every word the agentic home renders, in one place (LOCKED #14
// + design_consensus §5 the LOCKED COPY). The home spine is FEAR → LEASH →
// LIVE MOMENT → PROOF; each beat ends in the same CTA so it drills in.
//
// HONESTY (non-negotiable, baked into the strings, not bolted on later):
//  · Suize ships NO AI. The notification SUBJECT is the USER's own agent doing
//    the finding/cancelling; Suize only narrates the money moment. Never
//    "Suize found a flight."
//  · Every artifact is a `Testnet sample` — account.move is UNPUBLISHED, so no
//    string may imply mainnet-live.
//  · Dollar figures live ONLY inside illustrative artifacts (the living-wallet
//    balance/feed, notifications, the log) — a `balance` is the user's OWN money,
//    not a Suize price. They never collide with a /pricing tier ($0.50/$19.99/2%),
//    and NO pricing copy appears anywhere on this page.
// ============================================================================
export const HOME = {
  hero: {
    // The trust mark (gojiberry-style social-proof badge). NO "testnet" here —
    // the testnet + non-custodial disclaimers live in the FOOTER only. This is
    // a true, plain trust signal: the rails run on Sui.
    badge: 'Built on Sui',
    // PIVOT: the home is now a SELF-CONTAINED CONSUMER AI WALLET — you talk to
    // it, it remembers you, it acts across thousands of services and pays. The
    // hot word `easier` takes the --grad-hot clip. Monkey-simple, no jargon.
    h1: ['The AI wallet that', 'makes life easier.'],
    // the word inside the headline that takes the gradient clip
    hot: 'easier',
    sub: 'Tell it what you want. It remembers you, finds the best option across thousands of services, and pays — you just approve.',
    // the supporting "reach" line beneath the sub (NEW — the breadth promise).
    services: 'Access thousands of supported services.',
    cta: { label: 'Access your wallet', href: LINKS.start },
    ghost: { label: 'See how it works', href: '#leash' },
    // CONVERSATION-FIRST CENTERPIECE (NEW). The hero now leads with a real
    // chat: you ask in plain words → the AI shows intelligence (it watches +
    // decides) + memory (it knows you) + payment (it pays from your balance).
    // `who` is 'you' | 'ai'; render as a chat thread, not a notification stack.
    convo: [
      {
        who: 'you',
        text: "I'm going to SF next week — watch flight prices and book the cheapest direct one.",
      },
      {
        who: 'ai',
        text: "On it. I'll check every day and grab the best direct option the moment it drops.",
      },
      {
        who: 'ai',
        text: 'Booked — direct to SFO, $240, paid from your balance. ✈️',
      },
    ],
    // the one-switch "Agent enabled" control surfaced beside the convo (kept).
    toggle: { label: 'Agent enabled', on: true },
    // Wallet chrome on the hero chat pane (the owner: "convey it's a wallet,
    // not just a chat — add a balance"). `balance` is the USER's OWN funded
    // money, NOT a Suize price/tier — and it must COVER the $240 flight in
    // `convo` so the demo adds up ($460 − $240 = $220 after the booked
    // message lands). `feed` is legacy (unused by the chat hero).
    wallet: {
      label: 'Your agent wallet',
      balance: '$460.00',
      toggle: { label: 'Agent enabled', on: true },
      feed: [
        { to: 'Flight · SFO', amount: '-$240.00' },
        { to: 'Netflix', amount: '-$15.99' },
        { to: 'Uber Eats', amount: '-$32.40' },
        { to: 'Spotify', amount: '-$11.99' },
      ],
    },
    // the quiet one-line proof beside the CTAs (NO star rating — owner removed
    // it as nonsense). A plain, true trust mark.
    proof: 'Spends only what you fund. Switch it off in one tap.',
  },
  // THE PRODUCT POWERS (NEW SECTION) — the five things that make this a real
  // consumer AI wallet, not "an MCP for your agent". Render as a tight grid of
  // {title, body} cards. Order matters: memory → reach → safety → control →
  // free-to-start. Numbers ("thousands") are bold aspirational placeholders.
  capabilities: [
    {
      title: 'It remembers you.',
      body: 'Your preferences, your passport, your cards — it learns what you like and gets smarter the more you use it. Yours, and only yours.',
    },
    {
      title: 'It acts everywhere.',
      body: 'Thousands of supported services — flights, subscriptions, food, and more. Ask in plain words and it gets it done.',
    },
    {
      title: 'It pays safely.',
      body: 'Fully non-custodial. You fund a balance, it spends only within it, and you see every cent it moves.',
    },
    {
      title: "You're in control.",
      body: 'Flip Agent enabled off anytime, and pull every cent back to your own wallet in one tap. It only ever spends what you funded.',
    },
    {
      title: 'Free to start.',
      body: 'Free to use, no card needed — the full AI wallet, from your very first message.',
    },
  ],
  // BEAT 1 — SUB-ACCOUNTS (owner-locked; REPLACES the empty "Money, without the
  // baggage" 3-point filler). This makes the control CONCRETE: your OWN money
  // sits in your account Suize never touches; you give your AI a SEPARATE,
  // capped sub-account it can never overspend — top up or pull back anytime.
  // Visual agents render the two balance CARDS as the centerpiece, the 3 trust
  // points as supporting chips. Dollar figures are the USER's OWN illustrative
  // funds — NOT a Suize price.
  balances: {
    eyebrow: 'Sub-accounts',
    head: "You set the allowance. It can't go over.",
    sub: 'You keep your money. You give your AI a sub‑account, capped at whatever you choose — it can never overspend it. Top it up or pull it back anytime.',
    your: {
      label: 'Your balance',
      amount: '$1,240.00',
      note: 'Your money. Suize never touches it.',
    },
    agent: {
      label: 'Agent sub‑account',
      amount: '$100.00',
      note: "What your AI can spend — it can't go past it.",
    },
    flow: 'Top up or pull back, anytime.',
    points: [
      'No bank.',
      'No setup headache.',
      'Fully decentralized.',
    ],
    cta: { label: 'Try it free', href: LINKS.start },
  },
  // BEAT 2 — THE CONFIRM MOMENT (the emotional peak). NOT a title — built as an
  // animated REAL iOS notification → confirm → receipt sequence (a UI moment).
  // The eyebrow/sub stay quiet; the sequence carries the beat.
  confirm: {
    eyebrow: 'A tap is all it takes',
    sub: 'It books the flight, renews Netflix, orders dinner — then waits for your thumb. One tap to say yes, and it is done, paid, and logged.',
    sampleTag: 'Your assistant, your call',
    cta: { label: 'See it in action', href: LINKS.start },
  },
  // BEAT 3 — THE ACTIVITY LOG (proof, alive).
  log: {
    eyebrow: 'See everything it does',
    head: 'Fully transparent. You stay in control.',
    sub: 'Every move your AI makes shows up here — what it bought, when, and for how much. Nothing hidden, nothing you can’t check later.',
    sampleTag: '',
    cta: { label: 'See a sample wallet', href: LINKS.wallet },
  },
  // BEAT 4 — TRUST ZONE + CLOSER.
  trust: {
    // TRUSTED-BY moved to BUSINESS (the rail is what merchants trust). On the
    // consumer home the "trusted by thousands of companies" claim is off-pitch —
    // so the marquee is intentionally EMPTY here. Keys kept (not deleted) so
    // TrustCloser keeps resolving without a runtime crash; an empty title +
    // empty list render nothing.
    marqueeTitle: '',
    marquee: [],
    benefit: 'Your money stays yours — always.',
    // VERBATIM, locked — must appear exactly in the trust zone (CLAUDE.md).
    custody: 'fully non-custodial — your keys never leave your machine',
    // the close — a 2-line title rendered as two floating serif lines.
    // Sit-back-and-relax energy: dead-simple, no metaphor — you relax, the AI
    // handles the money. (Alt: "Money, handled." / "Sit back and relax.")
    closer: ['Sit back and relax.', 'Your AI handles the rest.'],
    cta: { label: 'Get started free', href: LINKS.start },
    bridge: { label: 'Run a business? Get paid by agents →', href: '/business' },
  },
}

// ============================================================================
// THE CHARGE PAGE (/for-business) — THE INVERTED CURRENT. The same ocean, the
// current reversed: not descending to leash a spender — RISING to receive.
// Every word the merchant page renders lives here (LOCKED #14). The spine is
// REFRAME → CHARGE → SPEED → PROOF → CLOSE; each station ends in the same sharp
// "Start earning now" CTA so it drills in.
//
// HONESTY (non-negotiable, baked into the strings):
//  · CLAIM LADDER — ALLOWED: "gasless", "x402-compatible by design", "implements
//    the merged x402 Sui exact scheme", "we run a live x402 facilitator for Sui".
//    FORBIDDEN until the mechanism PR MERGES: "on x402", "official x402
//    facilitator", "the default Sui facilitator" (as fact).
//  · No Deploy reference on this page — Deploy is its own product page; the
//    business pitch proves charge-side value (speed, every-fee-on-the-receipt,
//    custody).
//  · NO pricing copy anywhere in this config (no 2% / $0.50 / $19.99). Pricing
//    lives ONLY on the /pricing page. The fee $ amounts inside the illustrative
//    receipt are a JSX artifact owned by the business agent — not config copy.
// ============================================================================
export const BUSINESS = {
  hero: {
    eyebrow: 'Charge',
    // PIVOT (owner-locked): ACTION-FIRST headline — the first value is GET PAID
    // BY AI AGENTS, framed as a thing you start doing right now. The hot phrase
    // `from AI agents.` (line 2) takes the clip. Getting recommended is a
    // SECONDARY beat below.
    h1: ['Start accepting payments', 'from AI agents.'],
    hot: 'from AI agents.',
    sub: 'Drop in one line and let agents pay you directly — one-off payments and subscriptions, gasless. No KYB, no payments stack, live in minutes.',
    // secondary line — the marketplace reach, now a supporting beat (NOT the lead).
    secondary: 'And get recommended to millions of customers along the way.',
    chip: 'Sample receipt, real proof',
    cta: { label: 'Integrate now', href: LINKS.checkout },
    ghost: { label: 'See how charging works ↓', href: '#charge' },
  },
  // STANDARDS-ONLY strip (owner-locked: NO platform logos yet — no Shopify /
  // WooCommerce names). A plain "plugs in anywhere" reassurance grounded in the
  // open standards we share with the incumbents (402-shaped + AP2). A build
  // agent renders this as a single eyebrow + line; no logo wall.
  integrations: {
    eyebrow: 'Plugs in anywhere',
    line: 'x402-compatible by design — works with any site that can take a payment, built for the same standards as Stripe, Coinbase, and Google AP2.',
  },
  // TRUSTED-BY moved HERE from the home (LOCKED: the rail is the merchant trust
  // signal). Title + the 12 funny placeholder names. TODO: PLACEHOLDER stub
  // names — swap for real customer logos before launch. Consumed by BusinessBeats
  // CloseBeat (BUSINESS.close.marquee) too; this block is the canonical source
  // a new "trusted" station can read as BUSINESS.trust.{marqueeTitle,marquee}.
  trust: {
    // TRUSTED-BY emptied 2026-06-14 (owner): no fake company names ship — shipping
    // Globex/Initech/etc as social proof is dishonest. Keys kept so BusinessBeats
    // keeps resolving; an empty title + empty list render nothing. Restore ONLY
    // with REAL customer logos.
    marqueeTitle: '',
    marquee: [],
  },
  // BEAT 0.5 — THE FACTORIO PAYMENT-LANE (owner-locked centerpiece). Concept:
  // agent payments are ALREADY streaming past on a conveyor/timeline; you plug
  // in one line and start pulling them into your balance. The business agent
  // reads this for the conveyor section head/sub/CTA.
  //
  // (the `integrations` block above renders the standards strip; the line is the
  // x402-compatible-by-design claim, no platform names — claim ladder.)
  lane: {
    eyebrow: 'Already flowing',
    head: 'The money is already moving.',
    sub: 'A new stream of revenue is already flowing past your business. Plug in and draw from it.',
    cta: { label: 'Plug into the stream', href: LINKS.checkout },
  },
  // BEAT 1 — THE CHARGE. The snippet rises beside the receipt it produces.
  charge: {
    eyebrow: 'One line, settled in seconds',
    head: 'Charge an agent. Get paid now.',
    sub: 'Paste the line, read the receipt. USDC lands in seconds — every payment verifiable on-chain.',
    sampleTag: 'Your service, real settlement',
    cta: { label: 'Get paid by agents', href: LINKS.checkout },
  },
  // BEAT 2 — LIVE IN MINUTES. The four SPEED facts as floating depth-labels.
  speed: {
    eyebrow: 'From paste to paid',
    head: 'Start earning now.',
    sub: 'No sales call, no integration sprint, no payments stack to write. Paste one snippet on your service and you are live in minutes.',
    cards: [
      {
        focal: '01',
        title: 'Go live in minutes.',
        note: 'No sales call, no integration sprint — paste the snippet and you are charging.',
      },
      {
        focal: '02',
        title: 'Settle instantly in USDC.',
        note: 'Money lands on-chain in seconds. No payouts to schedule, no chasing.',
      },
      {
        focal: '03',
        title: 'Subscriptions, built in.',
        note: 'Your customer approves once and pays every month on their own signature — nothing reaches into their account.',
      },
    ],
    cta: { label: 'Go live in minutes', href: LINKS.checkout },
  },
  // BEAT 3 — THE PROOF. Charge-side proof only — settlement speed, every fee
  // printed on the receipt (NO pricing numbers here — pricing copy lives ONLY on
  // /pricing; the receipt $ amounts are a JSX artifact the business agent owns),
  // non-custodial. NO Deploy reference (Deploy is its own product page).
  proof: {
    eyebrow: 'Shown, not claimed',
    head: 'One-off or recurring. Settled the same way.',
    sub: 'Every charge lands in USDC in seconds, and the fee is printed right on the receipt — never a surprise. Funds settle to you on-chain; we never custody a cent.',
    facts: [
      ['Seconds', 'USDC settles on-chain, no payout wait'],
      ['On the receipt', 'every fee is printed, never a surprise'],
      ['Non-custodial', 'funds settle to you — we hold nothing'],
    ],
    link: { label: 'See pricing →', href: '/pricing' },
    cta: { label: 'Watch it settle', href: LINKS.checkout },
  },
  // BEAT 4 — THE CLOSE. Urgency that's true, the back-bridge to PAY.
  close: {
    // TRUSTED-BY emptied 2026-06-14 (owner): no fake company names ship. Empty
    // title + list render nothing; restore with REAL customer logos when we have them.
    marqueeTitle: '',
    marquee: [],
    // claim-ladder honesty line, surfaced plainly at the floor (NO "snippet is a
    // preview / SDK not shipped" caveat — owner cut it; the JSX caveat is removed
    // by the business agent).
    honest: 'Gasless, x402-compatible by design — the payer needs nothing Suize-specific.',
    // §6 locked close — a FOMO 2-liner, rendered as two floating serif lines.
    closer: ['Agents are already spending.', "Don't get left out."],
    cta: { label: 'Start accepting payments', href: LINKS.checkout },
    bridge: { label: 'Want the assistant that pays for you? →', href: '/' },
  },
}

// ============================================================================
// PRICING (NEW data source — the /pricing page currently hardcodes its rows;
// this is the canonical copy a build agent should render). The consumer wallet
// is FREE — there is NO paid wallet tier (owner 2026-06-14: Haiku-only, no wallet
// sub for now; the "$9.99 Smarter AI" placeholder is DELETED, never reintroduce
// without owner sign-off). The rail rows (send free, charge 2%) are unchanged.
// ============================================================================
export const PRICING = {
  // the consumer wallet tiers — FREE only (no paid wallet sub for now).
  tiers: [
    {
      id: 'free',
      name: 'Free',
      model: 'Free to start',
      price: '$0',
      per: 'forever',
      blurb: 'The full AI wallet — talk to it, it remembers you, it pays. Free to start, no card.',
      cta: { label: 'Access your wallet', href: LINKS.start },
    },
  ],
  // the rail rows (unchanged) — the one place a fee may appear as marketing copy.
  rows: [
    { k: 'Send / transfer money', v: 'Free', free: true },
    { k: 'Get paid by an agent (Charge)', v: '2% · 1¢ min' },
    { k: 'Setup / account', v: '$0' },
  ],
  close: 'No seats. No hidden fees. No sales call.',
}

// ============================================================================
// THE DOCS PAGE (#/docs) — the demoable visual explainer; docs + quickstart
// MERGED (the snippet card + the MCP card ARE the quickstart — no separate
// quickstart page/link exists anywhere). Serves hackathon judges AND any
// technical or non-technical reader: every section leads monkey-simple, the
// mechanics (402, USDC, MCP, Sui — sanctioned ON THIS PAGE ONLY) come second.
//
// HONESTY + VOCABULARY (non-negotiable, baked into the strings):
//  · NO Suize pricing numbers anywhere (no 2% / $0.50) — the fee line is
//    "the fee is printed on every receipt" + a link to #/pricing. A MERCHANT's
//    own example price (price: '0.10' in the snippet) IS allowed — it's their
//    number, not a Suize fee.
//  · Consumer words: "sub-account" / "allowance" — NEVER "leash" / "pot".
//  · No testnet labels. ZERO status-talk: a surface is documented as it works
//    today (@suize/pay, the x402 402 loop, POST /verify + /settle, the hosted
//    pay page, subscriptions), or it is ABSENT from the page — never "coming
//    soon" / "rolling out" / "not yet".
//  · NO webhooks, NO dashboard, NO sessions, NO API keys — they don't exist
//    (deleted by design; the chain is the database). Settlement notice = your
//    own /verify call, or reading the on-chain balance changes yourself.
// ============================================================================
export const DOCS = {
  hero: {
    eyebrow: 'Docs · How it works',
    h1: 'How Suize works.',
    sub: 'One payment rail. Agents pay businesses; humans give their AI money it can’t overspend. Here’s the whole machine.',
  },

  // SECTION 1 — the onboarding ladder (THE centerpiece): four precise tiers,
  // high-level (no code) → low-level, each stating WHO it's for, WHAT YOU DO,
  // WHAT SUIZE DOES, and HOW YOU KNOW YOU'RE PAID. Tier 3 keeps the one-liner
  // snippet + the animated five-step 402 loop as its demo (approved — never
  // touch the animation). Naming Stripe is allowed ONLY for coexistence
  // (`coexist`), never as an integration claim. ZERO status-talk: a tier is
  // documented as it works today, or it is absent (platform plugins don't
  // ship → no Tier 4).
  merchant: {
    marker: 'The onboarding ladder',
    eyebrow: 'For business',
    head: 'Get paid, whatever your stack.',
    sub: 'Three ways in — from a link you paste to a line you ship. Every one lands on the same rail and prints the same receipt.',
    // the three fact-column labels every tier renders
    labels: {
      you: 'What you do',
      suize: 'What Suize does',
      paid: 'How you know you’re paid',
    },
    tiers: [
      {
        tier: 'Tier 1',
        title: 'No code — a pay-link.',
        who: 'For hosted stores, link-in-bio sellers — anyone.',
        you: 'A pay-link is just a URL carrying your address and your price — paste it anywhere: your site, your emails, your llms.txt.',
        suize: 'Agents read the terms and pay through the rail without a human; humans tap to pay on the hosted pay page.',
        paid: 'Check /verify — or read your payments straight off the chain. Your history is public cryptographic record.',
      },
      {
        tier: 'Tier 2',
        title: 'One call — POST /verify.',
        who: 'For any backend, any language — it’s one plain HTTP call.',
        you: 'Return 402 with your x402 payment terms. The agent pays gaslessly through Suize and retries with an X-PAYMENT header. You hand that to the facilitator and serve when it says paid.',
        code: 'POST api.suize.io/verify  { paymentPayload, paymentRequirements }',
        suize: 'Verifies the agent’s gasless payment against your own configured price and address, then settles it on-chain.',
        paid: 'verify says valid — you serve. No webhook, no session, no key.',
        note: 'amount is a decimal USDC string — your price. Your address is your account; no signup, no API key.',
      },
      {
        tier: 'Tier 3',
        title: 'One line — gate your API.',
        who: 'For API-first builders selling to agents programmatically.',
        you: 'npm i @suize/pay, paste the middleware.',
        suize: 'Everything between “pay me” and “paid”.',
        paid: '/verify answers paid ✓ — then your code serves.',
        note: 'Works in Bun, Hono, and Next (fetch-style) plus Express — any Node/Bun backend; any other language via the plain x402 HTTP flow.',
        // renders the real @suize/pay snippet + the animated 402 loop beneath
        demo: true,
      },
    ],
    // the coexistence note — Stripe named for COEXISTENCE only, never as an
    // integration claim.
    coexist: {
      title: 'Already on Stripe?',
      body: 'Keep it. Stripe serves your card customers; Suize adds the buyer they don’t — AI agents paying USDC. One verify call tells your fulfillment code a payment landed, and the settlement lives on-chain. One more payment method, not a migration.',
    },
    snippet: {
      file: 'your-server.js',
      tag: 'x402',
      // the copy-button payload — the FULL real path (npm-published @suize/pay);
      // the price is the MERCHANT's own example number, never a Suize fee.
      code: "npm i @suize/pay\n\nimport { suize } from '@suize/pay'\napp.use(suize({ to: '0xYOU', price: '0.10' })) // your price, decimal USDC",
    },
    steps: [
      {
        title: 'An agent calls your API',
        desc: 'Any AI agent asks for your service, like any other client would.',
        tag: 'GET /report',
      },
      {
        title: 'Your server answers 402',
        desc: 'Your one line replies with an x402 payment challenge: what to pay, in what, and where.',
        tag: '402 · accepts[]',
        challenge: true,
      },
      {
        title: 'The agent pays through Suize',
        desc: 'The agent signs a gasless USDC transfer and retries with an X-PAYMENT header. It settles on Sui in seconds.',
        tag: 'USDC · settled on Sui',
      },
      {
        title: 'Your snippet asks “did they?”',
        desc: 'It hands the payment to the facilitator’s verify; Suize confirms the payment landed on the rail.',
        tag: 'verify → paid ✓',
      },
      {
        title: 'Content served',
        desc: 'The agent gets what it paid for. You were paid first.',
        tag: '200 OK',
      },
    ],
    // the pretty x402 payment-challenge JSON rendered inside step 2 — the
    // `accepts[0]` PaymentRequirements an agent reads (real x402 V2 shape).
    challenge: {
      status: '402 Payment Required',
      fields: [
        ['scheme', 'exact'],
        ['network', 'sui'],
        ['asset', 'USDC'],
        ['payTo', '0xYOU'],
        ['amount', '…'],
      ],
    },
    caption:
      'Your code never touches a wallet. It says “pay me”, then asks “did they?”. Suize does everything between.',
  },

  // SECTION 2 — three doors onto the same rail.
  ways: {
    marker: 'Three doors, one rail',
    eyebrow: 'Any agent can pay',
    head: 'Three ways an agent pays.',
    sub: 'Blockchain-fluent or not — every agent has a door onto the rail.',
    cards: [
      {
        glyph: 'sign',
        title: 'It signs, we settle.',
        body: 'Suize builds the gasless transfer — no gas token needed; the agent just signs it, and Suize verifies and settles it on-chain. For any agent with a key and zero blockchain skills.',
      },
      {
        glyph: 'direct',
        title: 'It pays directly.',
        body: 'An agent that already speaks Sui pays the rail itself. Suize indexes the receipt.',
      },
      {
        glyph: 'human',
        title: 'It asks its human.',
        body: 'The agent hands its user a pay-link. One tap on the confirm page settles it.',
      },
    ],
    foot: 'Every payment lands on the same rail and prints the same receipt — the fee visible, the proof on-chain.',
    fee: 'The fee is printed on every receipt.',
    pricing: { label: 'See pricing →', href: '/pricing' },
  },

  // SECTION 3 — the consumer half: the sub-account + the controls.
  consumer: {
    marker: 'The consumer half',
    eyebrow: 'For you',
    head: 'Your AI has money. You have the controls.',
    sub: 'You give your assistant a sub-account — an allowance with hard edges. It spends; you stay in charge.',
    controls: [
      {
        title: 'The sub-account',
        body: 'You fund it from your own money. Your AI can spend up to what you put in — and never a cent past it.',
      },
      {
        title: 'The confirm dial',
        body: 'Confirm each payment, auto-approve under $X, or let it run — you pick how much autonomy it gets.',
      },
      {
        title: 'Subscriptions',
        body: 'Approve a recurring bill once. Each renewal is paid on your own signature — nobody reaches into your account — and cancel is deleting it on-chain.',
      },
      {
        title: 'The record',
        body: 'Everything it does is logged, and every receipt is yours to check.',
      },
    ],
    // the small glass wallet motif beside the controls (illustrative, no numbers)
    wallet: {
      label: 'Agent sub-account',
      toggle: 'Agent enabled',
      meter: { spent: 'spent', cap: 'your cap' },
      dial: ['Confirm each', 'Auto under $X', 'Full auto'],
      allowance: { name: 'Music streaming', note: 'subscription · renews on your signature' },
      revoke: 'Cancel',
    },
  },

  // SECTION 4 — the MCP door (the detached-agent surface: a SEPARATE funded
  // address — a second Google sign-in — whose balance IS the cap; the human
  // funds it and can sweep it. Present-tense, no status-talk).
  mcp: {
    marker: 'The MCP door',
    eyebrow: 'Bring your own assistant',
    head: 'Use it with Claude or Codex.',
    sub: 'One command. Sign in with Google to give your assistant its own funded account — its balance is the cap, fund it and sweep it back anytime — and it pays through the same rail, under the same dials.',
    command: 'claude mcp add suize',
    prompt: '$',
    tools: ['suize_pay', 'suize_balance', 'suize_receipts'],
    note: 'Your assistant gets three tools — pay, check the balance, read the receipts. Same rail, same controls, same record.',
  },

  // SECTION 5 — the close: two doors out.
  close: {
    head: 'That’s the whole machine.',
    business: { label: 'Start accepting payments', href: '/business' },
    consumer: { label: 'Access your wallet', href: LINKS.start },
    pricing: { label: 'Pricing →', href: '/pricing' },
  },
}

// THE NOTIFICATION DECK — the iOS "tap to confirm" cards (design_consensus §5).
// PIVOT: these now show INTELLIGENCE + variety (not "your AI paid X") — the AI
// finds, decides, remembers, and only then asks. `meta.kind` differentiates the
// notification type for the visual agent (smart-find / subscription / cancel /
// order / save). `tone` ('save' | 'buy') still drives the card colour family;
// `tone: 'save'` LEADS the deck. Dollar figures are illustrative sample numbers
// inside the card artifact (never a real /pricing tier).
export const NOTIFICATIONS = [
  {
    id: 'cancel',
    tone: 'save',
    kind: 'cancel',
    title: 'Found a duplicate subscription you forgot about',
    body: "You're paying for two cloud plans. Cancel the unused one?",
    yes: 'Cancel it',
    no: 'Keep it',
    // the row that prepends to the log on confirm
    logged: { what: 'Cancelled a duplicate subscription', amount: '+$9.99 saved', kind: 'save' },
  },
  {
    id: 'flight',
    tone: 'buy',
    kind: 'smart-find',
    title: 'Found a direct SFO flight $80 cheaper',
    body: 'Same seat, watched it all week — it just dropped. Book it?',
    yes: 'Book it',
    no: 'Not now',
    logged: { what: 'Booked a direct flight to SF', amount: '−$240.00', kind: 'spend' },
  },
  {
    id: 'reprice',
    tone: 'save',
    kind: 'save',
    title: 'Your flight got cheaper after you booked',
    body: 'Prices dropped — I can move you to the same seat and save $40.',
    yes: 'Move it',
    no: 'Leave it',
    logged: { what: 'Re-booked your flight at a lower price', amount: '+$40.00 saved', kind: 'save' },
  },
  {
    id: 'order',
    tone: 'buy',
    kind: 'order',
    title: 'Your usual sushi order, ready to go',
    body: 'Friday night — same spot, same order as last time. Send it?',
    yes: 'Order it',
    no: 'Not tonight',
    logged: { what: 'Ordered your usual sushi', amount: '−$32.00', kind: 'spend' },
  },
  {
    id: 'sub',
    tone: 'buy',
    kind: 'subscription',
    title: 'Netflix renews tomorrow',
    body: '$15.99 to keep it. Renew it automatically from now on?',
    yes: 'Renew it',
    no: 'Cancel',
    logged: { what: 'Renewed Netflix', amount: '−$15.99', kind: 'spend' },
  },
]

// THE ACTIVITY ROWS — the alive ledger (design_consensus §5 the winners). The
// green saver row and the red kill row are the two hero/shareable rows; they
// flash once on land (`hero: true`). `kind` drives the amount colour: only
// `save` (green) and `kill` (red) leave the calm --fg ramp — true status only.
export const ACTIVITY_ROWS = [
  {
    id: 'r-sub',
    what: 'Cancelled an unused subscription',
    when: '3 hrs ago',
    amount: '+$9.99 saved',
    kind: 'save',
    hero: true,
  },
  {
    id: 'r-flight',
    what: 'Booked a flight to SF',
    when: '2 min ago',
    amount: '−$214.00',
    kind: 'spend',
  },
  {
    id: 'r-domain',
    what: 'Renewed your domain',
    when: '1 hr ago',
    amount: '−$12.00',
    kind: 'spend',
  },
  {
    id: 'r-limit',
    what: 'You raised the limit to $500',
    when: 'Yesterday',
    amount: '—',
    kind: 'note',
  },
  {
    id: 'r-kill',
    what: 'You hit kill — agent stopped',
    when: 'Yesterday',
    amount: '—',
    kind: 'kill',
    hero: true,
  },
]

// The `Locked record` chip tooltip — the consumer-safe translation of
// "saved on-chain" WITHOUT naming the storage tech (owner: no jargon) and
// WITHOUT the mainnet-immutability overclaim the brand-keeper vetoed.
export const LOCKED_RECORD_TIP =
  'A receipt saved on-chain — checkable, not editable.'

// Per-room accent token overrides — the "four rooms" of one house. Each detail
// page sets these CSS vars so the whole chassis re-tints to that product's
// temperature within the blue family (Crash = the sanctioned green pulse).
export const ROOM_ACCENTS = {
  wallet: {
    '--room-accent': '#4da2ff',
    '--room-accent-deep': '#2e7bd6',
    '--room-accent-bright': '#7ac4ff',
    '--room-accent-wash': 'rgba(77,162,255,0.09)',
    '--room-accent-glow': 'rgba(77,162,255,0.45)',
    '--room-accent-hair': 'rgba(77,162,255,0.34)',
  },
  checkout: {
    '--room-accent': '#3fd2c0',
    '--room-accent-deep': '#1f9e91',
    '--room-accent-bright': '#74ead9',
    '--room-accent-wash': 'rgba(63,210,192,0.09)',
    '--room-accent-glow': 'rgba(63,210,192,0.42)',
    '--room-accent-hair': 'rgba(63,210,192,0.34)',
  },
  deploy: {
    '--room-accent': '#8b94ff',
    '--room-accent-deep': '#5c63d6',
    '--room-accent-bright': '#aab0ff',
    '--room-accent-wash': 'rgba(139,148,255,0.09)',
    '--room-accent-glow': 'rgba(139,148,255,0.42)',
    '--room-accent-hair': 'rgba(139,148,255,0.34)',
  },
  crash: {
    '--room-accent': '#34d399',
    '--room-accent-deep': '#1f9d72',
    '--room-accent-bright': '#6ee7b7',
    '--room-accent-wash': 'rgba(52,211,153,0.09)',
    '--room-accent-glow': 'rgba(52,211,153,0.42)',
    '--room-accent-hair': 'rgba(52,211,153,0.34)',
  },
}

// The ADDITIONAL products — the two beyond the audience pages. Wallet (PAY) and
// Charge (CHARGE) are NOT here: they ARE the For users / For business pages, so
// listing them again would double up. These are the extra products an agent can
// pay for ON the rail. `route` opens the in-app detail page; `external` opens
// the live product. `tint` drives the per-room accent (Crash = the sanctioned
// status-green exception).
export const PRODUCTS = [
  {
    id: 'deploy',
    name: 'Deploy',
    side: 'CHARGE',
    verb: 'BUILD · SHIP · RENEW',
    desc: 'Let your agent put your website on the blockchain — live in seconds.',
    route: '/deploy',
    external: LINKS.deploy,
    tint: 'rgba(139,148,255,0.5)',
    tintFg: '#9ba3ff',
    tintEdge: 'rgba(139,148,255,0.34)',
  },
  {
    id: 'crash',
    name: 'Crash',
    side: 'CHARGE',
    verb: 'PLAY · SETTLE · EARN',
    desc: 'One tap: call Bitcoin up or down, live.',
    route: '/crash',
    external: LINKS.crash,
    tint: 'rgba(52,211,153,0.5)',
    tintFg: '#34d399',
    tintEdge: 'rgba(52,211,153,0.34)',
  },
]
