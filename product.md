# Suize

> *Agentic RPC for Sui. One MCP endpoint. Plain English in. Structured answer out, with a convergence score. Paid per call in gasless USDsui via x402.*

---

## What Suize is

Suize is the agentic RPC for Sui. A single MCP endpoint where an autonomous agent asks anything about the chain in plain English, gets a structured answer with a stated convergence score, and pays for the call in gasless USDsui via x402. No SDK, no API key, no human in any step of the loop. One provider, one pipeline, one contract with the caller.

---

## One pipeline. Convergence is the contract.

There is no tier system. There is no upfront classifier deciding "this is a factual query, this is a semantic query." Every question, from "what is the balance of 0xabc" to "is this protocol suspicious," runs through the same interpretive pipeline.

The pipeline always produces two things:

1. The answer.
2. A `convergence` score between 0.0 and 1.0, reporting how interpretive the answer turned out to be.

Convergence is *emergent*, not declared. Suize does not predict it. The pipeline runs, and the score falls out of how much interpretation the answer actually required. Crisp questions about chain state converge near 1.0 because there is one right answer and the type system makes it unambiguous. Judgment-laden questions converge lower because multiple defensible answers exist.

Worked examples:

- *"Balance of 0xabc"* converges near 1.0. Chain state is unambiguous, the object exists, the number is the number.
- *"Top 5 holders of $DEEP with balance > $100k"* converges near 0.95. The holder set and balances are crisp facts; only the threshold semantics and ranking introduce a thin layer of interpretation.
- *"Top 5 memecoins worth caring about"* converges near 0.7. The chain has the data, but "worth caring about" is heavy interpretation: volume, age, holder distribution, deployer history, social signal proxies, all weighted.
- *"Is this protocol suspicious?"* converges near 0.5. Fundamentally a judgment call. The pipeline says so out loud rather than pretending otherwise.

The agent reads the score and decides how much to trust the answer. The agent does not have to know in advance what kind of question it asked. That is the whole point.

---

## `consensus: N`

The verification dial. The agent passes `consensus: N` on any call, range 1 to 10, default 1.

`N` runs that many interpretation passes in parallel and reconciles them. For questions where the interpretation collapses to a deterministic lookup, Suize may internally collapse redundant passes as an optimization. The agent never sees this. The contract is "you paid for N passes, you get the convergence guarantee of N passes."

**Total-divergence honesty.** When the N passes disagree heavily, Suize returns all variants with a low convergence score attached. It never silently picks a winner. The agent gets the disagreement surface, not a smoothed-over consensus that hides the underlying spread. If five passes say five different things, the response carries all five and a convergence near 0.

**Pricing is linear.** N passes cost N times the base. The multiplier is surfaced in the x402 quote before payment, so the agent commits to the cost knowingly. Default is `N=1`, which ships fast and cheap; agents escalate `N` for high-stakes calls where they want the variance bound.

This is the verification primitive. Convergence is the reporting primitive. Together they are the entire correctness story.

---

## Two separate promises

Honesty here is two distinct guarantees. They are often conflated and should not be.

1. **Suize never fabricates facts.** Chain state we return is chain state. Citations carry checkpoint numbers, object IDs, type tags. The LLM is never in the data path. If the graph does not know, the response says so structurally.

2. **Suize openly interprets semantics.** Where interpretation happens, it happens with versioned weights, stated confidence, and citations to the inputs. The convergence score reports the depth of interpretation. Interpretation is a feature, not a bug, and it is labeled.

"We don't hallucinate" is the first promise. "We are deterministic" is something Suize is not, and would not pretend to be, on questions that are not deterministic in the first place. Keeping these two apart is what makes the contract trustworthy.

---

## How agents reach Suize

Agents discover Suize through MCP. Tool listing returns a self-describing schema, an x402 price quote endpoint, and the single `/ask` tool. No marketing site as front door. No signup. No key issuance. No sales motion.

```
POST /ask
{
  "intent": "<plain English question, 500 char cap>",
  "consensus": 1,
  "x_payment": "<signed gasless USDsui transfer to @suize.sui>"
}

→ MCP-compatible JSON-RPC response
{
  "content": [{ "type": "text", "text": "<markdown answer for the agent's LLM>" }],
  "structuredContent": {
    "answer": { ... },
    "convergence": 0.94,
    "as_of_checkpoint": 47821934,
    "citations": [ ... ],
    "variants": null
  }
}
```

One round-trip. Atomic intent and payment. The x402 verifier settles the gasless USDsui transfer into an address accumulator before the pipeline runs. If the agent escalated `consensus`, the multiplier is in the quote it signed against.

The intent field is capped at 500 characters. Longer questions are rejected with a structured `{ error: "intent_too_long", max_chars: 500 }` before the pipeline runs. Flat base pricing requires bounded input. Agents that need more chain multiple atomic calls, which is what they do anyway.

Every field carries `as_of`, `source`, `confidence`. Every response carries a `freshness_ms` watermark. No bare numbers.

### What Suize does not do

The system owns its boundaries:

- No predictions. Historical signals, not forecasts.
- No recommendations as advice. Decision-support data; the agent decides.
- No off-chain context. Twitter, news, prices on other chains are out of scope.
- No signed transactions. Suize is the query layer, not the signer. Agents build their own PTBs.

This is the only honest posture for a substrate that agents will compose into larger workflows.

---

## Why Sui specifically

The interpretive pipeline is tractable on Sui in a way it is not on any account-based chain. Four properties stack:

1. **Persistent typed object IDs.** A `Pool<USDC,SUI>` keeps the same ID from `transfer::share_object` through every mutation to `object::delete`. That is a stable referent. EVM has no equivalent; calldata is opaque and state lives in account-keyed slots with no persistent typed identity.

2. **Deterministic PTB ASTs.** Programmable Transaction Blocks expose their command sequence, type arguments, and emitted event types as a structured tree the chain itself commits to. Every PTB hashes to a deterministic signature. That signature is the substrate for clustering, classification, and semantic discovery without anyone hand-labeling protocols.

3. **Move type system as semantic substrate.** Move's type graph gives a distance metric. `Coin<USDC>` is closer to `Coin<USDT>` than to `Pool<X,Y>`. The type system is finite and strict, so clusters of PTBs by type-quotient signature provably refine any human-curated taxonomy in the limit. The chain's own type system is what makes interpretation tractable.

4. **250ms checkpoint finality.** The graph stays within a quarter-second of the chain. The freshness watermark on every response is meaningful, not aspirational.

These four properties together are why the pipeline works here. The same pipeline cannot be ported to an account-based chain without rebuilding the substrate that makes it work.

---

## Pricing

$0.05 base per call in gasless USDsui via x402. `consensus: N` multiplies linearly: N times $0.05. The multiplier is surfaced in the x402 quote before the agent signs the payment.

No subscription. No API key. No top-up. No invoicing. The payment is the auth. The auth is the rate limit. The price quote is the SLA.

---

## How it works under the hood

The internals, demoted from the headline because the contract above is what the agent buys.

### Architecture

```
┌────────────────────────────────────────────────────┐
│  POST /ask  { intent, consensus, x_payment }       │
└────────────────────┬───────────────────────────────┘
                     ↓
┌────────────────────────────────────────────────────┐
│  x402 verifier (signed USDsui via gasless tx)      │
│  Settles into address balance accumulator          │
└────────────────────────────────────────────────────┘
                     ↓
┌────────────────────────────────────────────────────┐
│  Intent parser  (self-hosted Qwen 2.5 1.5B FT)     │
│  English → typed JSON AST, ~40ms                   │
└────────────────────────────────────────────────────┘
                     ↓
┌────────────────────────────────────────────────────┐
│  Planner / validator  (Rust, ~3ms)                 │
│  AST → execution DAG  (rejects uncompilable plans) │
│  Fan-out across N consensus passes                 │
└────────────────────────────────────────────────────┘
                     ↓
   ┌─────────────┼───────────────┬────────────────┐
   ↓             ↓               ↓                ↓
┌─────────┐ ┌────────────┐ ┌──────────────┐ ┌────────────┐
│FalkorDB │ │Checkpoint  │ │Sui fullnode  │ │Vector idx  │
│graph +  │ │tailer →    │ │RPC (hot      │ │(Display<T> │
│aggs +   │ │warm rollups│ │state at      │ │embeddings) │
│Object-  │ │(24h vol,   │ │current       │ │            │
│omics    │ │net flow)   │ │checkpoint)   │ │            │
└─────────┘ └────────────┘ └──────────────┘ └────────────┘
                     ↓
┌────────────────────────────────────────────────────┐
│  Reconciler                                        │
│  Merge N passes, compute convergence,              │
│  emit variants on total divergence                 │
└────────────────────────────────────────────────────┘
                     ↓
┌────────────────────────────────────────────────────┐
│  Response synthesizer  (same Qwen)                 │
│  markdown summary + structured JSON                │
│  freshness watermark + plan_used + citations       │
└────────────────────────────────────────────────────┘
                     ↓
┌────────────────────────────────────────────────────┐
│  MCP JSON-RPC 2.0 response                         │
└────────────────────────────────────────────────────┘
```

Single graph store. Self-hosted small LLM at the edges only. Direct read-through to Sui RPC for hot state. The LLM is never in the data path. It parses English into a typed AST on the way in, and renders structured results into prose on the way out. Determinism lives in the middle.

### Objectomics: the brain underneath

Every object on Sui writes its own autobiography. A `Pool<USDC,SUI>` has a persistent ID from creation through every mutation to deletion. That is a *case* in van der Aalst's process-mining sense, and a row van der Aalst's Inductive Miner can chew on without modification.

This is process mining for blockchains, a 25-year-old academic field, finally well-defined because Sui is the first chain with persistent typed object IDs that survive mutations.

### Typed PTB fingerprinting

Every Programmable Transaction Block hashes to a deterministic signature:

```
sig(ptb) = hash(
  [command_types],         // TransferObjects, SplitCoins, MoveCall, ...
  [module::function],      // 0xcetus::pool::swap_exact_in
  [type_arguments],        // Coin<USDC>, Coin<SUI>, ...
  [event_types_emitted]
)
```

Two PTBs with the same signature have the same shape. Distance metric uses Move's type graph. Clustering uses connected components on a minhash LSH graph. No human writes "MINT" or "STAKE." The categories discover themselves.

### Intent Atoms

An **Intent Atom** is the maximal connected subgraph of a single PTB such that every object touched is created or consumed within the subgraph, and the type-flow is irreducible: removing any command breaks a typed dependency.

Every PTB decomposes uniquely into a forest of intent atoms. That is a parser, not a heuristic. Clusters of isomorphic intent atoms are emergent protocol primitives. Hot potatoes, Sui's linear-typed atomic composition pattern, are the strict ability-set=∅ case: a sub-genre, not the engine.

### Type-Quotient Convergence

> On a typed blockchain with finite type universe, emergent clustering of PTBs by type-quotient signature provably refines any human-curated protocol taxonomy in the limit.

Plain English: because Move's type system is finite and strict, the clusters cannot be coarser than any taxonomy a human could write, only finer. New protocols extend the ontology automatically.

### LLM footprint

One small model: Qwen 2.5 1.5B Instruct, fine-tuned on Sui intent-to-AST pairs. Two invocations per `/ask` call:

```
1. PARSE       English intent → structured JSON AST
               ~200 tokens in, ~30 tokens out, 30–50ms

2. SYNTHESIZE  graph result + intent → markdown summary
               ~500 tokens in, ~150 tokens out, 50–80ms
```

The model never sees raw chain data, never ranks, never decides. It is the grammar engine. The graph is the truth engine. Determinism in between. The cost asymmetry against any fast-follower funded on frontier-model APIs is structural, not clever.

### Where knowledge lives

| Knowledge type                                              | Where it lives                                                    | Update cadence                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------- |
| Domain knowledge ("what is a PTB," "Cetus is a DEX")        | Fine-tuned into the 1.5B model + small static reference in prompt | Months                            |
| Chain state (current TVL, prices, listings, balances)       | FalkorDB, populated by indexer                                    | Every checkpoint (~250ms)         |
| Emergent semantics (Objectomics clusters, intent atoms)     | FalkorDB, updated continuously by the type-quotient pipeline      | Per checkpoint as new PTBs deploy |

The LLM has no memory of chain state. That split is the whole architecture.

---

## The bet

Made by agents, for agents. Every chain explorer, every indexer, every RPC client was built assuming a human is the receiving end. When the receiving end is an LLM-driven agent that discovers tools via MCP, evaluates them by querying their schema, pays via x402, and consumes structured output back into its loop, every default of the existing stack is wrong.

| Old default                  | Suize default                                |
| ---------------------------- | -------------------------------------------- |
| Marketing site as front door | MCP registry as front door                   |
| API key + signup             | x402 micropayment per call                   |
| SDK + docs                   | One endpoint, self-describing schema         |
| Sales motion                 | Discoverable via tool listing                |
| Monthly subscription         | Per-call micropayment in gasless USDsui      |
| Human-readable dashboard     | Structured JSON + markdown summary           |
| Sub-minute freshness OK      | Sub-second freshness with watermark          |
| Best-effort answers          | Convergence-scored answers, divergence shown |
| Categories curated quarterly | Categories emerge per checkpoint             |

Between now and the end of 2027, the dominant consumer of on-chain data stops being humans clicking explorers and starts being autonomous agents executing on behalf of humans. The infrastructure built for the old default collapses under the new load. Whoever has the agent-native layer becomes the default endpoint, and that position compounds: every query teaches Objectomics more about how PTBs cluster.

---

*Last updated 2026-05-28. Scope locked for Sui Overflow 2026.*
