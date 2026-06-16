import { PACKAGE_IDS, USDC_TYPE, TREASURY_SUINS_NAME } from '@suize/shared';
import type { TrackPage } from './types';

// ── live, real, reachable surfaces (verified up 2026-06-15) ──────────────────
const sv = (path: string) => `https://testnet.suivision.xyz/${path}`;
const npm = (pkg: string) => `https://www.npmjs.com/package/${pkg}`;

export const LIVE = {
  facilitator: 'https://api.suize.io',
  wallet: 'https://wallet.suize.io',
  deploy: 'https://deploy.suize.io',
  agents: 'https://agents.suize.io',
  polysui: 'https://polysui.suize.io',
  demoSite:
    'https://5nqcy919skmvrysyy152vtx3dk5x5w6rip30rc7m5qos7t96kc.suize.site',
  tx: (digest: string) => sv(`txblock/${digest}`),
  pkg: (id: string) => sv(`package/${id}`),
  usdc: USDC_TYPE,
  treasuryName: TREASURY_SUINS_NAME,
  subsPkg: PACKAGE_IDS.SUBS.PACKAGE,
  deployPkg: PACKAGE_IDS.DEPLOY.PACKAGE,
  auctionPkg: PACKAGE_IDS.AUCTION.PACKAGE,
  crashPkg: PACKAGE_IDS.CRASH.PACKAGE,
};

// The page IS the journey. Vision sold big; every proof point is literally true
// on testnet today (claim ladder still governs: no "on x402"/"official"/"mainnet").

export const tracks: TrackPage[] = [
  // ════════════════════════════════════ DeFi & Payments → SUIZE (the rail) ══
  {
    id: 'suize',
    tab: 'Suize',
    track: 'DeFi & Payments',
    trackline: 'Programmable money on Sui — payments that are financial actions, not static transfers.',
    productName: 'The building blocks for agentic payments on Sui.',
    pitch:
      'Every AI agent that can hold USDC on Sui can pay any merchant — gasless, in one atomic transaction, with the fee enforced on-chain. The x402 “exact” payment layer for the agentic economy on Sui.',
    proof: [
      'We authored the x402 “exact” scheme for Sui — open PRs upstream (#2615 + #2616)',
      'A live x402 facilitator for Sui — /verify /settle /build /terms /supported /tx',
      'The fee is enforced at verify — a merchant cannot zero it',
      '21/21 end-to-end green on real Sui testnet',
      '@suize/pay + @suize/mcp — published on npm',
      'Zero gas · zero custody · zero database — the chain is the ledger',
    ],
    journey: [
      {
        actor: 'Agent',
        title: 'Hits a paid endpoint',
        overview:
          'Any agent — a Sui-native one with its own key, or a Suize wallet session — calls a merchant’s endpoint with no payment attached yet.',
        points: [
          'The payer needs nothing Suize-specific — no SDK, no account, no signup.',
          'The merchant added one middleware to gate the route. That’s the entire integration.',
        ],
        tech: [
          { kind: 'npm', label: '@suize/pay', note: 'the ~60-line merchant middleware — answers 402, verifies the retry', href: npm('@suize/pay') },
        ],
      },
      {
        actor: 'Merchant',
        title: 'Answers 402 — the payment challenge',
        overview:
          'The merchant mints an x402 V2 “exact” PaymentRequired. This single response is the whole contract — the agent reads it and knows exactly what to pay, to whom, with what idempotency.',
        points: [
          'What it carries: scheme=exact · network · the amount · the asset (native USDC) · payTo · and extra.outputs — the exact declared split the agent must reproduce on-chain.',
          'Idempotency rides the payment-identifier extension — a stable id, so a retry is never a double charge.',
          'What the agent extracts: the outputs it must credit, the buildUrl, and the payment id.',
          'Two ways to respond: call POST /build for unsigned gasless bytes, OR self-build the send_funds PTB with @x402/sui (the Sui scheme we authored). The agent is never locked into our tooling.',
        ],
        tech: [
          { kind: 'endpoint', label: '402 PaymentRequired', note: 'the x402 V2 “exact” challenge — the whole contract in one response' },
          { kind: 'spec', label: '@x402/sui', note: 'the x402 “exact” Sui scheme we authored — open upstream (PR #2616)', href: 'https://github.com/x402-foundation/x402/pull/2616' },
        ],
        artifact: {
          caption: 'the real challenge — live from api.suize.io',
          body: `{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "sui:testnet",
    "amount": "1000000",
    "asset": "0x…::usdc::USDC",
    "payTo": "0xMERCHANT…",
    "extra": {
      "outputs": [
        { "to": "0xMERCHANT…", "amount": "980000" },
        { "to": "0xTREASURY…", "amount":  "20000" }
      ],
      "buildUrl": "https://api.suize.io/build"
    }
  }],
  "extensions": {
    "payment-identifier": { "info": { "id": "pay_…" } }
  }
}`,
        },
      },
      {
        actor: 'Agent',
        title: 'Builds the gasless payment',
        overview:
          'The agent assembles one Programmable Transaction Block — a send_funds per declared output, gas budget zero. Pay + fee + receipt become a single atomic financial action.',
        points: [
          '0x2::balance::send_funds for each output — the merchant leg and the treasury fee leg — in ONE atomic transaction.',
          'setGasBudget(0) forces Sui’s protocol-level gasless election — no gas token, ever.',
          'This is the “programmable money” the track asks for: not three transfers, one composable action.',
        ],
        tech: [
          { kind: 'primitive', label: 'Sui Address-Balances', note: 'protocol-level gasless: gasPayment=[] · gasPrice=0' },
          { kind: 'spec', label: '@x402/sui · buildGaslessOutputs', note: 'one send_funds per declared output, gas budget 0' },
        ],
      },
      {
        actor: 'Agent',
        title: 'Signs locally — two doors, one wire',
        overview:
          'The agent signs the bytes itself and presents them in the X-PAYMENT header. Keys never leave the client.',
        points: [
          'Door 1 — Sui-native: the agent signs with its own Ed25519 / Secp256k1 key.',
          'Door 2 — Suize: the agent signs with its Suize zkLogin session via @suize/mcp.',
          'Same wire for both doors. The recovered signer IS the payer — no proxy, no custody.',
        ],
        tech: [
          { kind: 'npm', label: '@suize/mcp', note: 'the agent wallet — 6 tools, signs with the local zkLogin session', href: npm('@suize/mcp') },
        ],
      },
      {
        actor: 'Facilitator',
        title: '/verify — the fee is physics',
        overview:
          'Keyless and stateless. The facilitator simulates the signed transaction and refuses anything that does not pay exactly right.',
        points: [
          'Simulates over gRPC (no broadcast) and asserts the balance-change set matches the canonical split EXACTLY — assertOutputsExact.',
          'The fee is recomputed server-side and enforced: skip the treasury leg and the payment fails verify. A merchant cannot zero it.',
          'Recovers the payer from the signature and checks payer == sender — no proxy debits.',
          'Replay guard: a digest already executed on-chain is rejected before settle.',
        ],
        tech: [{ kind: 'endpoint', label: 'POST /verify', note: 'simulate · assertOutputsExact · recoverPayer · replay guard' }],
      },
      {
        actor: 'Facilitator',
        title: '/settle — keyless broadcast',
        overview:
          'The facilitator broadcasts the agent’s own signed transaction. It never holds a key and never stores a payment record.',
        points: [
          'Idempotent by digest — replay the same payload and you get the first result back, never a second charge.',
          'No webhooks, no session store, no server-minted ids. The chain is the database.',
        ],
        tech: [{ kind: 'endpoint', label: 'POST /settle', note: 'keyless gRPC broadcast · idempotent by digest' }],
      },
      {
        actor: 'Sui',
        title: 'The balance change IS the receipt',
        overview:
          'The settled transaction’s balance-change set is the receipt — public, verifiable, the fee visible. And the recurring half rides the same rail.',
        points: [
          'Merchant credited, treasury fee leg credited, payer debited exactly the listed price.',
          'Recurring: subs::subscription makes a subscription a soulbound on-chain object — push renewals the user signs each period, cancel = delete the object.',
        ],
        tech: [
          { kind: 'module', label: 'subs::subscription', note: 'published testnet — the on-chain recurring rail (push, user-signed, cancel = delete)', href: sv(`package/${PACKAGE_IDS.SUBS.PACKAGE}`) },
        ],
      },
    ],
    actions: [
      { label: 'Live facilitator', href: 'https://api.suize.io/supported', primary: true },
      { label: '@suize/pay on npm', href: npm('@suize/pay') },
    ],
    live: true,
    subProducts: [
      {
        name: 'The Agents Directory',
        tagline: 'agents.suize.io — the discovery layer for agent commerce on Sui.',
        points: [
          'Because every payment carves a fee-leg to one treasury, the entire stream of agent commerce is readable on-chain — merchant-agnostic, no opt-in.',
          'A live feed of every payment, per-merchant volume rankings, and an on-chain ad auction merchants bid into to get discovered.',
          'The ad sale is itself a payment on the rail — it appears in the directory’s own feed. A flywheel that monetizes itself.',
          '(The on-chain auction is live on testnet; the public feed deploys with its backend route group.)',
        ],
        tech: [
          { kind: 'module', label: 'auction::auction', note: 'the directory’s on-chain ad market — King-of-the-Hill, $50 genesis', href: sv(`package/${PACKAGE_IDS.AUCTION.PACKAGE}`) },
        ],
        actions: [{ label: 'Open agents.suize.io', href: 'https://agents.suize.io' }],
      },
    ],
    stack: [
      { kind: 'spec', label: '@x402/sui · upstream', note: 'the Sui “exact” scheme we authored — open PRs on x402-foundation/x402 (#2615 spec + #2616 mechanism)', href: 'https://github.com/x402-foundation/x402/pull/2616' },
      { kind: 'npm', label: '@suize/pay', note: 'the ~60-line merchant middleware — live on npm (0.3.1)', href: npm('@suize/pay') },
      { kind: 'npm', label: '@suize/mcp', note: 'the agent wallet — 6 tools, live on npm (0.2.3)', href: npm('@suize/mcp') },
      { kind: 'endpoint', label: 'api.suize.io', note: 'the live x402 facilitator for Sui' },
      { kind: 'module', label: 'subs::subscription', note: 'the on-chain recurring rail — published testnet', href: sv(`package/${PACKAGE_IDS.SUBS.PACKAGE}`) },
    ],
    roadmap: [
      'Mainnet — treasury + USDC + modules go live (payments need zero new publishes)',
      'The x402 Sui “exact” scheme, merged upstream',
      'Platform plugins — Shopify, WooCommerce',
    ],
  },

  // ════════════════════════════════════════════ Walrus → DEPLOY ══════════════
  {
    id: 'deploy',
    tab: 'Deploy',
    track: 'Walrus',
    trackline: 'Walrus as a verifiable data platform agents drive themselves.',
    productName: 'Vercel for agents.',
    pitch:
      'An AI agent ships a production website to the decentralized web in one paid request — owned by whoever paid, served from Walrus, cryptographically verified against Sui on every byte.',
    proof: [
      'Shipped our OWN production landing this way',
      'Pay → mint → serve, end-to-end on testnet',
      'The site’s owner = the address that paid — the payment is the login',
      'Double-hash verified by a Cloudflare worker on every request',
    ],
    journey: [
      {
        actor: 'Agent',
        title: 'POSTs a built site',
        overview: 'An agent uploads a tarball of the site artifact to /deploy — no account, no key, no dashboard.',
        points: ['Built to be driven by agents, not people — the whole flow is one HTTP call.', 'No signup gate: the payment that follows IS the authentication.'],
        tech: [{ kind: 'endpoint', label: 'POST /deploy', note: 'multipart: name + site.tar' }],
      },
      {
        actor: 'Deploy',
        title: 'Answers 402 — pay $0.50, you own it',
        overview: 'Deploy is the first merchant on the rail. The 402 says: pay, and whoever pays becomes the on-chain owner of the site.',
        points: ['The same x402 challenge as every merchant — a single $0.50 output.', 'No nonce, no login — the recovered payer becomes Site.owner.'],
        tech: [{ kind: 'npm', label: '@suize/pay', note: 'the merchant middleware speaking the 402', href: npm('@suize/pay') }],
      },
      {
        actor: 'Deploy',
        title: 'Settles first, then stores',
        overview: 'The payment settles BEFORE any storage work — we never spend bytes on an unpaid deploy.',
        points: ['verify → settle → only then touch Walrus.', 'A replayed payment can never mint a second site (the digest is locked on-chain).'],
        tech: [{ kind: 'endpoint', label: 'POST /settle', note: 'keyless · idempotent by digest' }],
      },
      {
        actor: 'Walrus',
        title: 'Stores the artifact',
        overview: 'The site lands on Walrus as a quilt + manifest — durable, portable, content-addressed, not locked to any platform.',
        points: ['Every file is content-addressed; any prior deploy is fetchable back by id.', 'This is the artifact-driven workflow Walrus is built for.'],
        tech: [{ kind: 'primitive', label: 'Walrus', note: 'the decentralized blob store — quilt + manifest' }],
      },
      {
        actor: 'create_site',
        title: 'Mints an immutable Site',
        overview: 'A Move call mints the on-chain Site: owner, the Walrus ids, and the manifest hash (the manifest itself carries a sha256 per file).',
        points: ['DeployerCap-gated — only a paid deploy can mint, so every field is service-attested.', 'The settled digest is recorded in a registry — one payment mints exactly one site, ever.'],
        tech: [{ kind: 'module', label: 'deploy_sui::site', note: 'immutable shared Site · SiteDigestRegistry · DeployerCap', href: sv(`package/${PACKAGE_IDS.DEPLOY.PACKAGE}`) }],
      },
      {
        actor: 'Worker',
        title: 'Serves it — hash-verified, every request',
        overview: 'A Cloudflare worker resolves the host to the on-chain Site and re-verifies the Walrus bytes against the chain before serving a single byte.',
        points: ['Manifest blob vs the on-chain manifest_hash; each file vs its sha256.', 'A mismatch returns 502 — never the wrong bytes. Verifiable hosting.'],
        tech: [{ kind: 'primitive', label: 'deploy-worker (CF)', note: 'host → siteId → on-chain Site → double-hash verify' }],
      },
    ],
    actions: [
      { label: 'Open the deployed demo site', href: LIVE.demoSite, primary: true },
      { label: 'deploy.suize.io', href: LIVE.deploy },
      { label: 'deploy_sui on-chain', href: sv(`package/${PACKAGE_IDS.DEPLOY.PACKAGE}`) },
    ],
    live: true,
    stack: [
      { kind: 'primitive', label: 'apps/deploy', note: 'the agent-native deploy service' },
      { kind: 'module', label: 'deploy_sui', note: 'the immutable Site + domain registry — published testnet', href: sv(`package/${PACKAGE_IDS.DEPLOY.PACKAGE}`) },
      { kind: 'primitive', label: 'deploy-worker', note: 'the Cloudflare edge that hash-verifies every request' },
      { kind: 'primitive', label: 'Walrus', note: 'the decentralized data layer' },
      { kind: 'npm', label: '@suize/pay', note: 'the x402 middleware gating the deploy', href: npm('@suize/pay') },
    ],
    roadmap: [
      'Mainnet — a republish away (the flagship demo)',
      'Custom domains, agent-owned',
      'MemWal — agent memory + a verifiable action-log on Walrus',
    ],
  },

  // ════════════════════════════════════════════ DeepBook → POLYSUI ═══════════
  {
    id: 'polysui',
    tab: 'PolySui',
    track: 'DeepBook Predict',
    trackline: 'Build on DeepBook Predict — Sui’s vol-surface prediction protocol.',
    productName: 'Read the tide. Take a side.',
    pitch:
      'A consumer prediction market on Sui — one-tap, gasless BTC up/down on DeepBook Predict, a vault that takes the other side, and a payment rail an agent can pay its way into.',
    proof: [
      'DeepBook Predict integration, end-to-end on testnet',
      'Gasless one-tap bets + live cash-out',
      'Permissionless auto-claim — no keeper',
      'A 3% rake, atomic and non-bypassable',
    ],
    journey: [
      {
        actor: 'Player',
        title: 'Signs in with Google',
        overview: 'No wallet, no extension, no gas. zkLogin derives the address locally and the player is in.',
        points: ['The lowest-friction onboarding on the track — a tap, not a seed phrase.', 'Gas is sponsored, so the first bet costs nothing but the stake.'],
        tech: [{ kind: 'primitive', label: 'zkLogin + Enoki sponsor', note: 'gasless sign-in + sponsored writes' }],
      },
      {
        actor: 'Player',
        title: 'One-tap UP or DOWN',
        overview: 'A single tap places a gasless bet on whether BTC is up or down over a rolling 15-minute window.',
        points: ['Movement is the product — live odds, a draining countdown, a cash-out that ticks.', 'The bet-ticket binds to the live quote, so the price you see is the price you get.'],
        tech: [{ kind: 'primitive', label: 'DeepBook Predict', note: 'rolling sub-hour BTC oracles · vol-surface pricing' }],
      },
      {
        actor: 'Router',
        title: 'Skims 3%, routes to Predict',
        overview: 'Every action flows through PolySui’s router, which carves its 3% rake atomically inside the bet.',
        points: ['The 3% rake is non-bypassable: the gasless path is allowlisted to router::* only.', 'One sponsored transaction does it all — deposit, quote, mint.'],
        tech: [{ kind: 'module', label: 'router (PolySui)', note: 'the non-bypassable rake gateway — version-gated', href: sv(`package/${PACKAGE_IDS.CRASH.PACKAGE}`) }],
      },
      {
        actor: 'DeepBook Predict',
        title: 'Prices + settles',
        overview: 'Predict’s vol-surface engine prices the contract and settles it at expiry.',
        points: ['Real on-chain settlement against a live BTC oracle.', 'No off-chain sportsbook — the market structure is on Sui.'],
        tech: [{ kind: 'primitive', label: 'predict::mint / redeem', note: 'the on-chain contract lifecycle' }],
      },
      {
        actor: 'Player',
        title: 'Cash out live, or auto-claim',
        overview: 'Exit early at the live value, or the win auto-claims on your next visit — permissionless, no keeper needed.',
        points: ['Cash-out reads the live manager balance via devInspect — a real number, not an estimate.', 'A winning position auto-claims with no operator in the loop.'],
        tech: [{ kind: 'primitive', label: 'router::cash_out / claim', note: 'live exit + permissionless settle-redeem' }],
      },
    ],
    actions: [
      { label: 'Open PolySui (live)', href: LIVE.polysui, primary: true },
      { label: 'PolySui router on-chain', href: sv(`package/${PACKAGE_IDS.CRASH.PACKAGE}`) },
    ],
    subProducts: [
      {
        name: '“Be the House” — the PLP vault',
        tagline: 'Supply liquidity, take the other side of every trade, earn the spread.',
        points: [
          'A real PLP LP utility: supply quote, redeem, and watch a live NAV — on-chain LP economics anyone can audit.',
          'The composable, institutional half of the product — the same vault outside LPs can underwrite.',
          'A backtested strategy + sim curve is the next layer.',
        ],
        tech: [{ kind: 'primitive', label: 'predict::supply (PLP)', note: 'the vault that takes the other side' }],
      },
    ],
    stack: [
      { kind: 'module', label: 'PolySui router', note: 'the rake gateway — live on testnet', href: sv(`package/${PACKAGE_IDS.CRASH.PACKAGE}`) },
      { kind: 'primitive', label: 'DeepBook Predict', note: 'the vol-surface prediction protocol' },
      { kind: 'primitive', label: 'PLP vault', note: '“Be the House” — on-chain LP economics' },
      { kind: 'primitive', label: 'zkLogin + Enoki', note: 'gasless onboarding + sponsored writes' },
    ],
    roadmap: [
      'Vault backtest / simulation curve',
      'An agent that trades it from a capped wallet',
      'Mainnet on Predict, day one',
    ],
  },

  // ════════════════════════════════════════════ Agentic Web → PAY ════════════
  {
    id: 'pay',
    tab: 'PAY',
    track: 'Agentic Web',
    trackline: 'AI agents that deeply leverage Sui primitives — beyond simple integrations.',
    productName: 'An AI agent with a wallet it can’t overspend.',
    pitch:
      'A non-custodial AI wallet that gives an agent real spending power inside hard, on-chain limits — fund it, it acts across many intents, you confirm, and one tap claws it all back.',
    proof: [
      'Google sign-in — keys never leave the machine',
      'A 1-of-2 multisig sub-account — the balance IS the cap',
      'The number wall — the AI never sets an on-chain number',
      'One-tap sweep — revoke anytime',
    ],
    journey: [
      {
        actor: 'Human',
        title: 'Signs in with Google',
        overview: 'zkLogin derives the keypair locally. Fully non-custodial — nothing to phish, nothing to lose.',
        points: ['No seed phrase, no extension — a consumer onboarding.', 'The key never leaves the machine; Suize never signs an owner transaction.'],
        tech: [{ kind: 'primitive', label: 'in-app zkLogin', note: 'the sole signer, local to the client' }],
      },
      {
        actor: 'Human',
        title: 'Funds the agent',
        overview: 'The human funds a 1-of-2 multisig sub-account. The balance you fund IS the hard cap — physics, not a setting the agent can change.',
        points: ['Members are {human, agent}, threshold 1 — so the human can sweep it alone, anytime.', 'The agent literally cannot spend a cent more than you funded. The leash is on-chain.'],
        tech: [{ kind: 'primitive', label: '1-of-2 multisig', note: 'the agent allowance address — balance = the ceiling' }],
      },
      {
        actor: 'Human',
        title: 'Tells the agent a goal',
        overview: 'Plain English: pay someone, start a subscription, deploy a site, check the balance. One conversational agent, many intents.',
        points: ['A versatile in-house agent — not a single-trick bot.', 'It reads your balance, subscriptions and activity to ground its proposals.'],
        tech: [{ kind: 'primitive', label: 'the in-house agent (Claude)', note: 'reads state, proposes tools, narrates' }],
      },
      {
        actor: 'Agent',
        title: 'Proposes the action',
        overview: 'The AI narrates and proposes a tool call. It never emits an on-chain amount, address, or signature.',
        points: ['The brain is walled off from the money path entirely.', 'Its suggestion is exactly that — a suggestion, never a transaction.'],
        tech: [{ kind: 'primitive', label: 'fenced inference', note: 'the brain returns narration + a proposed tool, nothing on-chain' }],
      },
      {
        actor: 'Wallet',
        title: 'Re-derives the numbers — you confirm',
        overview: 'The number wall: the wallet computes the real amount, recipient and fee from chain truth, shows you a card, and signs locally on confirm.',
        points: ['The AI’s words never become the transaction — the wallet owns every on-chain number.', 'This separation is the whole safety story the track rewards: autonomy you can trust.'],
        tech: [{ kind: 'primitive', label: 'the number wall', note: 'on-chain numbers come from chain truth, never the LLM' }],
      },
      {
        actor: 'Human',
        title: 'Revokes anytime',
        overview: 'One tap sweeps the entire sub-account balance back to the human. The agent’s address is a multisig you co-own.',
        points: ['Delegated-spend, never custody — you fund it, you can always claw it back.', 'Cancel a subscription = delete its on-chain object. Nothing reaches into your funds.'],
        tech: [{ kind: 'module', label: 'subs::subscription', note: 'push renewals, user-signed; cancel = delete', href: sv(`package/${PACKAGE_IDS.SUBS.PACKAGE}`) }],
      },
    ],
    actions: [
      { label: 'Open the live wallet', href: LIVE.wallet, primary: true },
      { label: '@suize/mcp on npm', href: npm('@suize/mcp') },
    ],
    stack: [
      { kind: 'primitive', label: 'wallet app', note: 'the consumer AI wallet — live at wallet.suize.io' },
      { kind: 'primitive', label: 'in-house agent (Claude)', note: 'proposes + narrates, fenced from money' },
      { kind: 'primitive', label: '1-of-2 multisig', note: 'the capped, revocable sub-account' },
      { kind: 'npm', label: '@suize/mcp', note: 'the agent door — live on npm (0.2.3)', href: npm('@suize/mcp') },
      { kind: 'module', label: 'subs::subscription', note: 'the on-chain recurring rail', href: sv(`package/${PACKAGE_IDS.SUBS.PACKAGE}`) },
    ],
    roadmap: [
      'Full autonomous execute — the full-auto dial',
      'A verifiable Walrus action-log of everything the agent did',
      'Cross-service reach — flights, food, subscriptions',
    ],
  },
];
