/**
 * THE WALLET'S COPY + DEMO FIGURES — every user-facing word in one place (the
 * copy/config law: components never hardcode copy). The demo blocks feed the
 * DEV-only `?demo=1` preview seam; production renders real on-chain data and
 * the honest strings below. Demo figures are pre-reconciled so the math always
 * adds up on screen:
 *
 *   WALLET   top-up $500.00 − Spotify $11.99 − Netflix $15.99 − coffee $12.02
 *            = $460.00 (pre-booking) → flight $240.00 → $220.00.
 *   BUSINESS $8,920.10 + $3,560.40 = $12,480.50 month; week bars sum $2,840;
 *            receipt $50.00 gross − $1.00 fee (2%) = $49.00 net.
 *
 * Consumer-vocabulary laws hold everywhere: "sub-account" (never leash/pot),
 * no tech jargon, the custody phrase VERBATIM, no pricing copy — the only fee
 * on any surface lives INSIDE the business receipt artifact (trust proof).
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
  recentLabel: 'Recent',
} as const;

// ── WALLET — chat-first + history + the books ──────────────────────────────────

export const WALLET = {
  handle: 'alice@suize',
  /** the masthead shows the TOTAL (wallet + sub-account) — owner-locked */
  totalLabel: 'Total',
  composer: 'Ask your wallet anything…',
  composerOff: 'Your AI is off — flip it back on when you need it.',
  newChat: 'New chat',

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

  /** PRODUCTION chip — honest (the conversational layer is roadmap) */
  prodChip: 'What can you do?',
  /** DEMO empty-thread suggestion chips */
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
    your: {
      label: 'Your money',
      amount: 1240.0,
      note: 'Only you can move it. Suize never touches it.',
      /** the classic wallet verbs live on the MAIN account */
      actions: ['Add funds', 'Send'] as const,
    },
    agent: {
      label: 'Agent balance',
      note: 'What your AI can spend — the sub-account balance is its cap.',
      /** the sub-account is a shared 1-of-2 multisig; either you or the agent can move it */
      fund: 'Fund',
      withdraw: 'Withdraw',
      pause: 'Pause',
      resume: 'Resume',
      pausedNote: 'Paused — your agent won’t spend until you resume.',
      /** shown before the sub-account exists (the agent's key isn't known until it signs in once) */
      empty: 'Your AI’s own spending balance — you fund it, cap it, and sweep it back any time.',
      emptyCta: 'Connect your sub-account',
    },
    subsTitle: 'Subscriptions',
    subsMeta: 'Approved once · they renew themselves',
    subs: [
      { name: 'Netflix', perMonth: 15.99, renews: 'renews in 24 days' },
      { name: 'Spotify', perMonth: 11.99, renews: 'renews in 9 days' },
    ],
    cancel: 'Cancel',
    /** the deck footnote — the bold lead + the tail (custody law, verbatim core) */
    custodyLead: 'Fully non-custodial',
    custodyTail:
      ' — your keys never leave your machine. Every payment is signed by your own login; Suize never signs for you.',
    activityTitle: 'Activity',
    activityMeta: 'Read straight from chain · every row checkable',
    verify: 'verify',
    /** an optimistic row still settling on-chain (shown until the chain confirms it) */
    confirming: 'confirming…',
    /** honest production empty states */
    emptySubs: 'No subscriptions yet — approve one once and it renews on its own.',
    emptyActivity: 'Nothing yet — every move lands here, checkable on-chain.',
    /** newest first; the booked flight prepends LIVE on confirm. Each row answers
        BOTH "to whom" (the handle/merchant) and "when exactly" — the inline stamp is
        date+time, the full to-the-second timestamp rides the hover title. */
    activity: [
      { what: 'Received', who: 'mom@suize', when: '12 Jun 19:22', whenTitle: '12 Jun 2026, 19:22:40', amount: 200.0 },
      { what: 'Paid', who: 'bluebottle@suize', when: '11 Jun 08:14', whenTitle: '11 Jun 2026, 08:14:09', amount: -12.02 },
      { what: 'Sent', who: 'alex@suize', when: '9 Jun 21:05', whenTitle: '9 Jun 2026, 21:05:33', amount: -40.0 },
      { what: 'Paid', who: '0x087a…6e86', when: '8 Jun 14:53', whenTitle: '8 Jun 2026, 14:53:10', amount: -0.5 },
      { what: 'Renewed', who: 'netflix@suize', when: '7 Jun 09:01', whenTitle: '7 Jun 2026, 09:01:55', amount: -15.99 },
      { what: 'Subscribed', who: 'netflix@suize', when: '7 Jun 09:00', whenTitle: '7 Jun 2026, 09:00:42', amount: -15.99 },
      { what: 'Topped up', when: '21 May 18:04', whenTitle: '21 May 2026, 18:04:33', amount: 500.0 },
    ] as { what: string; who?: string; when: string; whenTitle?: string; amount: number | null }[],
    flightRow: { what: 'Paid', who: 'united@suize', when: 'now', whenTitle: 'just now', amount: -240.0 },
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
    copied: 'Copied',
    request: 'Request an exact amount',
    requestPlaceholder: '0.00',
    create: 'Create request link',
    /** person-to-person requests ride the FREE rail verb (spend) — this is the
     *  wallet surface, NEVER the merchant pay-link (which takes the 2%). */
    linkBase: 'wallet.suize.io/',
    /** the network warning — short; on Sui you don't "lose" USDC sent to a Sui
     *  address, so no false scare tail, just the rule that matters */
    network: 'Send only USDC on Sui',
    more: 'More ways to add',
    soonTag: 'Soon',
    soon: ['Bank transfer', 'Apple Pay', 'Card'],
  },
  send: {
    title: 'Send',
    to: 'To',
    toPlaceholder: 'name@suize · name.sui · 0x address · email · phone',
    found: 'looks right',
    addressReady: 'address · ready',
    /** email/phone are DETECTED but direct delivery is coming soon — the flow
     *  routes to a claimable link instead (consumer words, no tech names). */
    emailSoon: 'Sending to emails is coming soon.',
    phoneSoon: 'Sending to phone numbers is coming soon.',
    amount: 'Amount',
    cta: 'Send',
    claimCta: 'Create a claim link',
    claimAlt: 'Send as a claim link',
    claimBase: 'wallet.suize.io/claim/',
    claimNote: 'Anyone with this link can claim the money — share it however you like.',
    sent: 'Sent',
    /** off-ramp destinations — DETECTED roadmap, shown as quiet "Soon" chips so the
     *  user knows cash-out is coming (consumer words, no tech names). */
    payoutsLabel: 'Cash out',
    payouts: ['To bank account', 'To credit card'],
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

// ── THE AGENT — arm / fund / kill (the sub-account: a shared 1-of-2 multisig) ──
// Consumer-vocabulary: the "agent balance" is its hard cap; the honest caveat is
// delegated-spend, NOT custody — within its balance the agent can spend, you cap it
// by funding and you exit by withdrawing (one tap, your wallet signs alone).

export const AGENT = {
  fund: {
    title: 'Fund your agent',
    sub: 'Move money from your wallet into the sub-account. Its balance is the cap — fund only what you’re comfortable letting it spend.',
    cta: 'Fund',
  },
  withdraw: {
    title: 'Withdraw to your wallet',
    sub: 'Pull money back from the sub-account into your wallet — instant, and signed by you alone.',
    label: 'In your sub-account',
    cta: 'Withdraw',
    empty: 'Nothing to withdraw',
    working: 'Withdrawing…',
  },
} as const;

// ── BUSINESS · CONSOLE — the sectioned, tabbed merchant view ───────────────────

export const CONSOLE = {
  tabs: [
    { id: 'overview', label: 'Overview' },
    { id: 'revenue', label: 'Revenue' },
    { id: 'subscriptions', label: 'Subscriptions' },
    { id: 'profile', label: 'Profile' },
  ] as const,
  /** PROFILE — the public brand identity (a Business Profile NFT). Its logo + name show
   *  in the agents directory; the full card (banner + description + site) runs your ads. */
  profile: {
    eyebrow: 'Public brand',
    title: 'Your business profile',
    blurb:
      'One identity, reused everywhere agents see you — your logo and name in the directory, your full card on any ad you run.',
    fields: {
      name: { label: 'Business name', placeholder: 'Acme AI' },
      website: { label: 'Website', placeholder: 'https://acme.ai' },
      imageUrl: { label: 'Logo image URL', placeholder: 'https://…/logo.png' },
      bannerUrl: { label: 'Banner image URL', placeholder: 'https://…/banner.png' },
      description: {
        label: 'Description',
        placeholder: 'What you sell to agents — one or two lines.',
        fromSite: 'Pulled from your website',
        fetching: 'Reading your website…',
        empty: "Add your website above — we'll use its description.",
        noneFound: 'No description found on that site.',
      },
    },
    mint: 'Create profile · $0.10',
    edit: 'Save changes · $0.10',
    editProfile: 'Edit profile',
    cancel: 'Cancel',
    feeNote: 'A one-time $0.10, paid from your wallet — keeps the directory clean.',
    minting: 'Signing…',
    nameRequired: 'Add a business name first.',
    livePreview: 'Directory preview',
    mintedNote: 'Live — your profile is on-chain and already powering your directory row.',
  },
  balance: {
    label: 'Available to spend',
    amount: 4250.0,
    note: 'Your USDC — yours to move, anytime.',
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
  /** honest production empty states */
  emptyLedger: 'No charges yet — they land here the moment an agent pays you.',
  emptyRenewals: 'No subscriptions yet — they appear here as agents subscribe to you.',
  emptyRevenue: 'No revenue yet — the chart draws itself as you get paid.',
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
  /** PRODUCTION empty-thread line (no revenue to narrate yet) */
  chatEmpty: 'Once charges land, ask me anything about them here.',
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
  /** PRODUCTION reply — honest until real charges exist to narrate */
  prodReply:
    'Nothing to report yet — the moment an agent pays you, I can break it all down here.',
} as const;

// ── THE SUBSCRIBE CONFIRM POPUP (/confirm-subscribe) — the suite's recurring gate ─
// Opened by other *.suize.io products via the bridge; this window builds-what-it-
// displays and signs locally. Strings only — flow in bridge/ConfirmSubscribe.

export const CONFIRM = {
  label: 'Payment request',
  unitsDetail: 'USDC on Sui',
  fromLead: 'Paying from',
  /** CTA — the amount is appended ("Pay $0.50"). */
  approve: 'Pay',
  decline: 'Cancel',
  working: { build: 'Preparing your payment…', submit: 'Settling on-chain…' },
  paid: 'Paid — you can close this window.',
  cancelled: 'Cancelled — nothing was paid.',
  retry: 'Try again',
  signInLead: 'Sign in to confirm this payment.',
  signInCta: 'Continue with Google',
  noOpener: 'This window opens from a Suize payment page — nothing to confirm here.',
  waiting: 'Reading the payment request…',
} as const;

// ── money formatting (the broadsheet number) ───────────────────────────────────

export function money(n: number): string {
  const a = Math.abs(n);
  // a sub-cent amount must never collapse to "$0.00" (that reads as nothing moved) —
  // show up to USDC's 6 decimals so a real tiny transfer stays truthful.
  const maxFrac = a > 0 && a < 0.01 ? 6 : 2;
  return '$' + a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: maxFrac });
}

export function signedMoney(n: number): string {
  return (n < 0 ? '−' : '+') + money(n);
}
