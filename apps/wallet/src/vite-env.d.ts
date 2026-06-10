/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sui network selection — 'mainnet' opts in; anything else/unset = testnet (resolveNetwork). */
  readonly VITE_SUI_NETWORK?: string;
  /** Sui fullnode RPC override; unset = the public fullnode for VITE_SUI_NETWORK. */
  readonly VITE_SUI_RPC_URL?: string;
  readonly VITE_ENOKI_API_KEY?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_OAUTH_REDIRECT_PATH?: string;
  /** Backend WebSocket URL (e.g. ws://localhost:8099/ws dev, wss://api.suize.io/ws prod). */
  readonly VITE_WS_URL?: string;
  /**
   * The scoped AI agent's Sui address (0x…). The owner-minted AgentCap is transferred
   * here at account creation. Empty -> account creation throws "agent not configured"
   * (an owner action — the agent keypair lives off-chain in the helm, never in the
   * bundle). See env.ts AGENT_ADDRESS.
   */
  readonly VITE_AGENT_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
