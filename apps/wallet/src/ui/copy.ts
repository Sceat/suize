/**
 * REDESIGN LAB — every word + every demo figure, in one place (the copy/config
 * law: components never hardcode copy). This is a DEV-ONLY design proposal
 * harness (`?preview=redesign`) — all figures are ILLUSTRATIVE demo data for
 * design review, pre-reconciled so the math always adds up on screen:
 *
 *   WALLET   top-up $500.00 − Spotify $11.99 − Netflix $15.99 − coffee $12.02
 *            = $460.00 (pre-booking) → flight $240.00 → $220.00 (the landing
 *            hero's exact 460→220 artifact, made functional).
 *   BUSINESS $8,920.10 (customers) + $3,560.40 (AI agents) = $12,480.50 month;
 *            week bars 320+410+380+460+510+390+370 = $2,840 vs $2,410 ≈ +18%;
 *            receipt artifact $50.00 gross − $1.00 fee (2%) = $49.00 net.
 *
 * Consumer-vocabulary laws hold even in demo copy: "sub-account" (never
 * leash/pot), no tech jargon, custody phrase VERBATIM, no pricing copy —
 * the only fee on any surface lives INSIDE the business receipt artifact
 * (the fee printed on the receipt IS the trust proof).
 */

// ── shared ─────────────────────────────────────────────────────────────────────

export const CUSTODY_LINE = 'fully non-custodial — your keys never leave your machine';

export type Who = 'you' | 'ai';

export interface ChatMsg {
  who: Who;
  text: string;
  /** optional day divider rendered ABOVE this message */
  divider?: string;
}

// ── ONBOARDING · JOURNEY — the refined REAL flow (hello → name → setting-up).
//    Mirrors the approved OnboardingShell beats; sign-in is merged into hello
//    (one less screen), and the setting-up loader becomes a calm build manifest.

export const JOURNEY = {
  hello: {
    /** the One-pane titles, in the Journey frame (owner-picked 2026-06-10) */
    eyebrow: 'Your AI wallet',
    /** serif display — `hot` inside line 2 takes the gradient + underline draw */
    h1: ['Meet the wallet', 'you talk to.'],
    hot: 'talk',
    lede: 'Tell it what you want. It remembers you, finds the best option, and pays — you just approve.',
    cta: 'Continue with Google',
    custody: CUSTODY_LINE,
  },
  name: {
    eyebrow: 'Pick your name',
    h2: ['Pick your ', 'name', '.'],
    note: 'This is how people send you money.',
    placeholder: 'yourname',
    suffix: '@suize',
    invalid: 'min 3 characters',
    free: 'available',
    ctaIdle: 'Pick a name',
    cta: (handle: string) => `Claim ${handle}`,
  },
  setup: {
    eyebrow: 'Almost there',
    h2: 'Setting up your wallet.',
    /** the build manifest — rows land one by one with a check */
    steps: [
      { label: 'Creating your wallet', note: 'on Sui, gasless' },
      { label: (name: string) => `Claiming ${name}@suize`, note: 'your name, yours forever' },
      { label: 'Securing your keys', note: 'they never leave this device' },
    ],
    done: (name: string) => `You're set, ${name}.`,
    cta: 'Open your wallet',
  },
} as const;

// ── THE ASSISTANT — the secondary chat panel every wallet variant docks ───────

export const ASSISTANT = {
  title: 'Your assistant',
  dock: 'Ask your wallet',
  recentLabel: 'Recent',
} as const;

// ── ONBOARDING · ONE PANE — the alternative conversational take ───────────────

export const ONBOARDING = {
  hello: {
    eyebrow: 'Your AI wallet',
    /** serif headline — the hot word takes the gradient clip ONCE */
    h1: ['Meet the wallet', 'you talk to.'],
    hot: 'talk',
    sub: 'Tell it what you want. It remembers you, finds the best option, and pays — you just approve.',
    cta: 'Continue with Google',
    custody: CUSTODY_LINE,
  },
  name: {
    aiAsk: "Hi — I'm your wallet. What should I call you?",
    placeholder: 'yourname',
    suffix: '@suize',
    /** shown once the typed name passes the (demo) availability check */
    free: 'is yours',
    cta: 'Claim your name',
  },
  ready: {
    aiDone: (name: string) =>
      `Done — you're ${name}@suize. Top up your sub-account whenever you're ready, then just tell me what you need.`,
    cta: 'Open your wallet',
  },
} as const;

// ── WALLET — chat-first + history + the books ──────────────────────────────────

export const WALLET = {
  handle: 'alice@suize',
  /** masthead balance label — the sub-account IS the hero number */
  balanceLabel: 'Sub-account',
  agentToggle: 'Agent enabled',
  agentOff: 'Agent off',
  composer: 'Ask your wallet anything…',
  composerOff: 'Your AI is off — flip it back on when you need it.',
  booksLabel: 'Books',
  newChat: 'New chat',
  historyTitle: 'Conversations',

  /** sub-account balance BEFORE the booking lands (the landing artifact) */
  balanceStart: 460.0,
  /** the flight amount the confirm card carries */
  flightAmount: 240.0,

  /** the seeded ACTIVE conversation — plays up to the confirm card, then waits */
  thread: [
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
      divider: 'Today',
      text: 'Found it — a direct to SFO just dropped to $240, $80 under the weekly average. Want me to book it?',
    },
  ] as ChatMsg[],

  confirmCard: {
    label: 'Confirm payment',
    merchant: 'United · SFO direct',
    detail: 'Thu · 9:40 AM · 1 traveler',
    amount: 240.0,
    source: 'from your sub-account',
    yes: 'Book it',
    no: 'Not now',
  },
  /** the payoff bubble after the confirm (the landing hero's third turn) */
  payoff: 'Booked — direct to SFO, $240, paid from your balance.',
  paidChip: 'Paid · logged',
  declined: 'No problem — I’ll keep watching and flag the next good drop.',

  /** DEMO scripted reply (the DEV seam only) */
  scriptedReply: 'Got it — I’ll take care of that and check with you before anything is paid.',
  /** PRODUCTION reply — honest: the conversational layer is still being built */
  prodReply:
    'I’m almost ready — soon I’ll handle this end to end. Your money already works: add funds, send, top up, withdraw, all live from this page.',

  /** empty-thread suggestion chips (a new chat) */
  chips: [
    'Watch flight prices to SF',
    'Cancel subscriptions I don’t use',
    'Order my usual sushi',
    'What did you pay this week?',
  ],

  /** the history rail — past conversations with short transcripts */
  history: [
    {
      id: 'sf',
      title: 'Trip to SF — flights',
      when: 'Today',
      live: true, // the seeded active thread
    },
    {
      id: 'subs',
      title: 'Subscriptions cleanup',
      when: 'Yesterday',
      transcript: [
        { who: 'you', text: 'Do I have subscriptions I’m not using?' },
        {
          who: 'ai',
          text: 'You’re paying for two cloud plans — one untouched for 3 months. Cancelled it, that’s $9.99 a month back.',
        },
      ] as ChatMsg[],
    },
    {
      id: 'dinner',
      title: 'Friday dinner',
      when: 'This week',
      transcript: [
        { who: 'you', text: 'Order my usual coffee to the office.' },
        { who: 'ai', text: 'Done — your usual order, $12.02, paid from your sub-account.' },
      ] as ChatMsg[],
    },
    {
      id: 'spend',
      title: 'Watch my spending',
      when: 'This week',
      transcript: [
        { who: 'you', text: 'Keep me under $100 a week on food.' },
        { who: 'ai', text: 'Will do — I’ll flag anything that would push you over before I pay it.' },
      ] as ChatMsg[],
    },
  ],

  /** THE BOOKS — the money surfaces: two pots, subscriptions, the trace */
  books: {
    title: 'Your books',
    your: {
      label: 'Your money',
      amount: 1240.0,
      note: 'Only you can move it. Suize never touches it.',
      /** the classic wallet verbs live on the MAIN account */
      actions: ['Add funds', 'Send'] as const,
      action: 'Top up sub-account', // legacy alternates (Minimal/Journal) still read this
    },
    agent: {
      label: 'Sub-account',
      note: 'What your AI can spend — it can’t go past it.',
      /** the sub-account moves against the main account */
      actions: ['Top up', 'Withdraw'] as const,
      action: 'Pull back', // legacy alternates (Minimal/Journal) still read this
    },
    subsTitle: 'Subscriptions',
    subsMeta: 'Approved once · renew on their own',
    subs: [
      { name: 'Netflix', perMonth: 15.99, renews: 'renews in 24 days' },
      { name: 'Spotify', perMonth: 11.99, renews: 'renews in 9 days' },
    ],
    cancel: 'Cancel',
    activityTitle: 'Activity',
    activityMeta: 'Read straight from chain · every row checkable',
    verify: 'verify',
    /** newest first; the booked flight prepends LIVE on confirm.
        `when` is compact so the single-line row never starves the body. */
    activity: [
      { what: 'Ordered your usual coffee', when: '2d', amount: -12.02 },
      { what: 'Subscription charged · Netflix', when: '6d', amount: -15.99 },
      { what: 'New subscription · Netflix', when: '6d', amount: null },
      { what: 'Subscription charged · Spotify', when: '21d', amount: -11.99 },
      { what: 'New subscription · Spotify', when: '21d', amount: null },
      { what: 'Topped up', when: '3w', amount: 500.0 },
      { what: 'Sub-account created', when: '3w', amount: null },
    ] as { what: string; when: string; amount: number | null }[],
    flightRow: { what: 'Booked · Flight to SFO', when: 'now', amount: -240.0 },
    custody: CUSTODY_LINE,
  },
} as const;

// ── THE MONEY ACTIONS — the sheets both faces share ────────────────────────────
// QR receive · zkSend link · exact-amount request/pay · the coming-soon ways
// (bank / Apple Pay / card). All demo-visual; the figures mutate live in the lab.

export const ACTIONS = {
  addFunds: {
    title: 'Add funds',
    sub: 'Receive to your wallet — scan, share, or request an exact amount.',
    copy: 'Copy',
    copied: 'Copied',
    request: 'Request an exact amount',
    requestPlaceholder: '0.00',
    create: 'Create request link',
    /** person-to-person requests ride the FREE rail verb (spend) — this is the
     *  wallet surface, NEVER the merchant pay-link (which takes the 2%). */
    linkBase: 'wallet.suize.io/',
    more: 'More ways to add',
    soonTag: 'Soon',
    soon: ['Bank transfer', 'Apple Pay', 'Card'],
  },
  send: {
    title: 'Send',
    to: 'To',
    toPlaceholder: 'name@suize · 0x address · email · phone',
    found: 'found',
    addressReady: 'address · ready',
    /** email/phone are DETECTED but direct delivery is coming soon — the flow
     *  routes to a claimable link instead (consumer words, no tech names). */
    emailSoon: 'Sending to emails is coming soon — share a claim link instead.',
    phoneSoon: 'Sending to phone numbers is coming soon — share a claim link instead.',
    amount: 'Amount',
    cta: 'Send',
    claimCta: 'Create a claim link',
    claimAlt: 'Send as a claim link',
    claimBase: 'wallet.suize.io/claim/',
    claimNote: 'Anyone with this link can claim the money — share it however you like.',
    sent: 'Sent · receipt logged',
  },
  topUp: {
    title: 'Top up sub-account',
    sub: 'Move money from your wallet into what your AI can spend.',
    cta: 'Top up',
  },
  withdraw: {
    title: 'Withdraw to your money',
    sub: 'Pull money back from the sub-account — instant, yours.',
    cta: 'Withdraw',
  },
  transfer: {
    title: 'Transfer to your wallet',
    sub: 'Move settled funds from your business to your own wallet.',
    cta: 'Transfer',
  },
  /** quick-amount chips on every amount input */
  quick: [20, 50, 100] as const,
  max: 'Max',
} as const;

// ── BUSINESS · CONSOLE — the sectioned, tabbed merchant view ───────────────────

export const CONSOLE = {
  tabs: [
    { id: 'overview', label: 'Overview' },
    { id: 'revenue', label: 'Revenue' },
    { id: 'subscriptions', label: 'Subscriptions' },
  ] as const,
  balance: {
    label: 'Available to spend',
    amount: 4250.0,
    note: 'Settled USDC — yours to move, anytime.',
    actions: ['Add funds', 'Send', 'Transfer'] as const,
  },
  /** MRR/ARR — ARR = MRR × 12 ($2,838.58 × 12 = $34,062.96, reconciled) */
  mrr: { k: 'MRR', v: '$2,838.58' },
  arr: { k: 'ARR', v: '$34,062.96' },
  /** last 12 months, $k — the last bar ≈ this month's $12,480.50 */
  months: {
    label: 'Revenue · last 12 months',
    bars: [4.2, 5.1, 4.8, 6.0, 6.9, 7.4, 8.2, 8.0, 9.1, 10.3, 11.6, 12.5],
    labels: ['J', 'A', 'S', 'O', 'N', 'D', 'J', 'F', 'M', 'A', 'M', 'J'],
  },
  renewalsHead: '38 renew this week · $742.10 on its own',
  renewals: [
    { payer: '0x9a3f…b4c5', plan: 'API subscription', amount: 19.99, when: 'in 2 days' },
    { payer: '0xb3c9…91ef', plan: 'API subscription', amount: 19.99, when: 'in 3 days' },
    { payer: '0x77aa…3c21', plan: 'Usage plan', amount: 49.0, when: 'in 5 days' },
    { payer: '0x08fe…442d', plan: 'API subscription', amount: 19.99, when: 'in 6 days' },
  ],
} as const;

// ── BUSINESS — revenue + the analytics chat ────────────────────────────────────

export const BUSINESS = {
  merchant: 'acme.dev',
  eyebrow: 'Suize Business',
  monthLabel: 'This month',
  monthTotal: 12480.5,
  delta: '+31% vs last month',
  split: [
    { label: 'Customers', amount: 8920.1 },
    { label: 'AI agents', amount: 3560.4, hot: true },
  ],
  stats: [
    { k: 'Active subscriptions', v: '142' },
    { k: 'Recurring / month', v: '$2,838.58' },
    { k: 'Agents seen this month', v: '214' },
  ],

  ledgerTitle: 'Recent charges',
  ledgerMeta: 'Settled in USDC · every fee on the receipt',
  verify: 'verify',
  ledger: [
    { payer: '0x9a3f…b4c5', memo: 'API subscription', amount: 19.99, when: '2 min ago' },
    { payer: '0x4d2e…0718', memo: 'One-off charge', amount: 50.0, when: '18 min ago', open: true },
    { payer: '0x77aa…3c21', memo: 'Usage top-up', amount: 120.0, when: '1 hr ago' },
    { payer: '0xb3c9…91ef', memo: 'API subscription', amount: 19.99, when: '3 hrs ago' },
    { payer: '0x08fe…442d', memo: 'One-off charge', amount: 8.4, when: '5 hrs ago' },
  ],
  /** the opened receipt — the ONE place a fee appears (the trust proof) */
  receipt: {
    title: 'Receipt',
    rows: [
      { k: 'Charge', v: '$50.00' },
      { k: 'Fee (2%)', v: '$1.00' },
      { k: 'Settled to you', v: '$49.00', strong: true },
    ],
    foot: 'Printed on every receipt · checkable on-chain',
  },

  chatTitle: 'Ask about your business',
  composer: 'Ask about revenue, agents, subscriptions…',
  /** seeded exchange — the analytics agent narrates READ-side data only */
  thread: [
    { who: 'you', text: 'How did this week compare to last?' },
    {
      who: 'ai',
      text: 'Up 18% — $2,840 this week against $2,410 last week. AI agents drove most of the growth: subscriptions renewed on their own and two new agents started paying you.',
    },
  ] as ChatMsg[],
  /** the bar artifact under the seeded answer — daily totals, sum = $2,840 */
  week: {
    label: 'This week · daily',
    bars: [320, 410, 380, 460, 510, 390, 370],
    days: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
  },
  chips: ['Top paying agents', 'Renewing this week', 'Largest charge this month'],
  /** scripted replies per chip (index-matched) */
  chipReplies: [
    {
      text: 'Your top paying agents this month:',
      list: [
        { k: '0x77aa…3c21', v: '$840.00' },
        { k: '0x9a3f…b4c5', v: '$612.50' },
        { k: '0xb3c9…91ef', v: '$445.00' },
      ],
    },
    {
      text: '38 subscriptions renew this week — $742.10 in recurring revenue, all on their own.',
    },
    {
      text: 'Your largest charge this month was $320.00 — a one-off from 0x77aa…3c21, 9 days ago.',
    },
  ],
  scriptedReply:
    'I can break that down — revenue, agents, subscriptions, refunds. Ask away.',
} as const;

// ── money formatting (the broadsheet number) ───────────────────────────────────

export function money(n: number): string {
  return (
    '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

export function signedMoney(n: number): string {
  return (n < 0 ? '−' : '+') + money(n);
}
