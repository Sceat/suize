# @suize/shared

The single source of truth for everything the Suize rail must agree on: network
resolution (`SUI_NETWORK` / `VITE_SUI_NETWORK`, only the exact string `mainnet` opts in,
everything else is testnet), on-chain package and object ids per network, prices
(`DEPLOY_PRICE_PER_MONTH_USDC`, `DEPLOY_SEALED_MULTIPLIER`, `DOMAIN_PRICE_PER_YEAR_USDC`),
Walrus and Seal constants, and the wire types shared across workers, apps, and the MCP.

Pure TypeScript, zero runtime dependencies. Nothing outside this package hardcodes an id,
a price, or a network: if a number appears in a quote, a doc, or a UI, it derives from
here. A drifted copy is a billing bug.

Not published to npm: workspace-internal, bundled into its consumers at build time.
