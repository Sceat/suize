import { defineConfig } from 'tsup'

// Bundle @suize/mcp to a single ESM entry the `suize-mcp` bin runs under node.
// The workspace packages (@suize/x402, @suize/shared) are bundled IN so no
// `workspace:^` leaks into the published tree; they carry only @mysten/sui as a
// real dep, which stays external. The real npm deps (@mysten/sui, nanotar) stay
// EXTERNAL so they resolve from node_modules.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node18',
  platform: 'node',
  clean: true,
  // node shebang on the bin so `npx -y @suize/mcp` / a direct exec works.
  banner: { js: '#!/usr/bin/env node' },
  // Bundle the workspace deps; keep the heavy real npm deps external.
  noExternal: ['@suize/x402', '@suize/shared'],
  external: ['@mysten/sui', 'nanotar'],
})
