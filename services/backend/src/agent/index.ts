// Agent module — STUB.
//
// TODO: the wallet AI brain — per-cycle loop, signals, PTBs.
//   - Runs a periodic decision cycle (read signals -> decide -> build PTB -> sign/submit).
//   - Uses a SCOPED agent key that is a SEPARATE secret from the sponsor's
//     ENOKI_PRIVATE_API_KEY (e.g. AGENT_PRIVATE_KEY) — never reuse the sponsor key.
//   - Move targets it can call should be allow-listed just like the sponsor module.
//
// Intentionally does nothing yet so the unified backend boots without an agent.

export interface AgentHandle {
  stop: () => void;
}

/**
 * Placeholder entry point for the wallet agent. No-op until the agent logic and
 * its scoped key exist. Wire this into src/index.ts (guarded by an env flag)
 * once implemented.
 */
export function startAgent(): AgentHandle {
  console.log("[agent] stub — not started (no agent logic yet)");
  return {
    stop: () => {},
  };
}
