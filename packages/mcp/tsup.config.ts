import { defineConfig } from 'tsup'

// Bundle @suize/mcp to a single ESM entry the `suize-mcp` bin runs under node.
// @suize/x402 is a workspace package published ALONGSIDE this one, but bundling it
// in keeps the install graph flat (no workspace:^ leaking into a published tree) —
// it has only @mysten/sui as its own dep, which we externalize here too. The real
// npm deps (@mysten/*, nanotar) stay EXTERNAL so they resolve from node_modules.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node18',
  platform: 'node',
  clean: true,
  // node shebang on the bin so `npx -y @suize/mcp` / a direct exec works.
  banner: { js: '#!/usr/bin/env node' },
  // Bundle the workspace dep; keep the heavy real npm deps external.
  noExternal: ['@suize/x402'],
  external: ['@mysten/sui', '@mysten/enoki', 'nanotar'],
})
