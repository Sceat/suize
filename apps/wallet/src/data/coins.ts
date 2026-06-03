/**
 * SUPPORTED currencies — the SINGLE SOURCE OF TRUTH for coin types, decimals and
 * brand colors, plus SPONSORED_COINS (the single source for the gasless "Free" flag).
 *
 * The `type` field is the fully-qualified Move coin type used to match against
 * `getAllBalances` (see useHome.ts). Where a testnet package address is not yet
 * pinned it carries a clearly-marked `TESTNET_TODO` placeholder and MUST be
 * confirmed via `getCoinMetadata({ coinType })` on a faucet'd wallet before those
 * balances can be trusted (until then they read as 0 / display-only).
 *
 * Brand colors (SPEC §5.1):
 *   SUI #4DA2FF · USDC #2775CA · DEEP #7A5CFF · WAL #16C79A · USDSUI #1E8FE6
 *
 * Pin status (2026-06-02):
 *   SUI    — PINNED, verified (universal: 0x2::sui::SUI, 9 decimals)
 *   USDC   — PINNED, verified live via getCoinMetadata on testnet (decimals 6,
 *            symbol "USDC" — Circle's testnet USDC). LIVE for real sends.
 *   DEEP   — PINNED, verified live via getCoinMetadata on testnet
 *            (0x36dbef…::deep::DEEP, decimals 6, symbol "DEEP" — DeepBook Token).
 *   WAL    — PLACEHOLDER (TESTNET_TODO: testnet Walrus type not surfaced/verified)
 *   USDSUI — PLACEHOLDER (TESTNET_TODO: testnet type not surfaced/verified)
 */

/** The static shape of an entry in SUPPORTED (no live balance — that's merged in useHome). */
export interface CoinConfig {
  sym: string;
  name: string;
  type: string;
  decimals: number;
  color: string;
  /**
   * TESTNET display-only flag. true => the `type` is a `TESTNET_TODO` placeholder
   * (DEEP/WAL/USDSUI) that no on-chain coin matches, so the balance always reads 0
   * and the UI marks it as not-yet-live. false => the type is pinned + live
   * (SUI/USDC). Threaded onto `Currency.displayOnly` in useHome for the UI.
   */
  displayOnly: boolean;
}

/**
 * Sentinel prefix marking a coin type that is NOT yet pinned to a real testnet
 * package. Balances matched against these never resolve (no on-chain coin has this
 * type), so they safely read as 0 / display-only until confirmed. The suffix keeps
 * each placeholder type unique so Set/dedupe logic stays correct.
 *
 * Any coin carrying a TESTNET_TODO type MUST set `displayOnly: true`.
 */
const TESTNET_TODO = (sym: string) => `TESTNET_TODO::${sym.toLowerCase()}::${sym}`;

// ── Individual coin configs (exported so callers can reference a single type) ──

/** SUI — PINNED, verified, LIVE. The native gas coin. */
export const SUI: CoinConfig = {
  sym: 'SUI',
  name: 'Sui',
  type: '0x2::sui::SUI',
  decimals: 9,
  color: '#4DA2FF',
  displayOnly: false,
};

/**
 * USDC — PINNED, verified live on testnet (getCoinMetadata: decimals 6, symbol
 * "USDC" — Circle's testnet USDC). LIVE for real sponsored sends.
 */
export const USDC: CoinConfig = {
  sym: 'USDC',
  name: 'USD Coin',
  type: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
  decimals: 6,
  color: '#2775CA',
  displayOnly: false,
};

/**
 * DEEP — PINNED, verified live on testnet (getCoinMetadata: decimals 6, symbol
 * "DEEP" — "DeepBook Token"). This is DeepBook's testnet DEEP, the fee coin the
 * agent's swap vault pays taker fees with (swap::deposit_deep / agent_swap_*).
 */
export const DEEP: CoinConfig = {
  sym: 'DEEP',
  name: 'DeepBook',
  type: '0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP',
  decimals: 6,
  color: '#7A5CFF',
  displayOnly: false,
};

/**
 * WAL — TESTNET_TODO / display-only. Pin the Walrus testnet package addr (9
 * decimals) then flip `displayOnly:false`.
 */
export const WAL: CoinConfig = {
  sym: 'WAL',
  name: 'Walrus',
  type: TESTNET_TODO('WAL'),
  decimals: 9,
  color: '#16C79A',
  displayOnly: true,
};

/**
 * USDSUI — TESTNET_TODO / display-only. Pin the Sui-native stablecoin testnet type
 * (6 decimals) then flip `displayOnly:false`.
 */
export const USDSUI: CoinConfig = {
  sym: 'USDSUI',
  name: 'USD Sui',
  type: TESTNET_TODO('USDSUI'),
  decimals: 6,
  color: '#1E8FE6',
  displayOnly: true,
};

/**
 * The full supported set, in display order (SPEC §5.1). `useHome` merges live
 * balances onto this and re-sorts owned-first for the UI.
 */
export const SUPPORTED: CoinConfig[] = [SUI, USDC, DEEP, WAL, USDSUI];

/**
 * SPONSORED_COINS — the SINGLE SOURCE OF TRUTH for the gasless "Free" flag.
 *
 * A send is gasless (shows "Free") iff its coin type is in this set; the SAME set
 * drives the future routing decision (route through the backend's /sponsor+/execute).
 * Never let the UI claim "Free" while the send path forgets to sponsor — one set,
 * both consumers. Includes SUI so a gas-less zkLogin user can send SUI (the sponsor
 * pays gas; useHome.send splits the SUI from the sender's own coins, not the gas
 * coin — see buildTransferSuiSponsored), plus the stablecoins (USDC + USDSUI).
 */
export const SPONSORED_COINS: Set<string> = new Set([SUI.type, USDC.type, USDSUI.type]);
