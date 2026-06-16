# Agentic Web

Build AI-native agents and autonomous workflows that deeply leverage Sui primitives to create more powerful, secure, and composable systems beyond simple integrations.

Agentic Web Problem Statement

- 1st Place: $30,000
- 2nd Place: $15,000
- 3rd Place: $10,000
- 4th Place: $7,500

# Agentic Web Problem Statement

The Agentic Web track rewards projects that use Sui as a meaningful part of the AI stack — not as a payment rail bolted on at the end. Every submission must show why Sui specifically (Move objects, zkLogin, PTBs, Deepbook, Walrus, or Seal) makes the AI component better, safer, or more composable. Generic LLM wrappers that happen to hold SUI will not place.

### Sub-track 1: Autonomous Risk Guardian

DeFi protocols run on static risk parameters. A de-peg or flash crash makes them dangerously stale within seconds. Build a live risk monitor for a Sui lending or perpetuals protocol that ingests oracle price feeds, runs an AI risk model, and autonomously executes a parameter adjustment or market pause via a Move policy object — with every action logged on-chain and reversible by a DAO override.

- **Must have:** live price feed, visible AI risk score, at least one autonomous on-chain action, human override mechanism.

### Sub-track 2: Autonomous Agent Wallet

AI agents are stuck at the "approve" wall — every action needs a human signature. Build an agent wallet on Sui using zkLogin or a Move policy object that grants an AI agent a capped budget and protocol scope (e.g. "max 500 USDC, Deepbook only, expires 24h"). The agent must autonomously execute a strategy, enforce its own ceiling, and produce an on-chain activity log. Owner revocation must be demonstrable.

- **Must have:** real Deepbook orders, self-enforced budget ceiling, on-chain activity log, owner revocation demo.

### Sub-track 3: Intent Engine

Users shouldn't need to know what a liquidity pool is. Build an intent engine that parses a plain-English financial goal, compiles it into a Sui PTB, and before signing, runs a guardian check that surfaces risks (high slippage, concentration, stale pools) in plain language. The user must explicitly confirm before execution. A swap chatbot with no guardian layer is not an intent engine.

- **Must have:**  text → PTB → execution flow, human-readable PTB preview, guardian catching at least 2 risk classes, explicit confirmation step.
