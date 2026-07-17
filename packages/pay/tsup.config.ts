import { defineConfig } from 'tsup'

// @suize/pay ships ONE entry point — the middleware (.). It
// compiles to ESM + .d.ts under dist/. The
// package is zero-dep, so there is nothing external to bundle; tsup just emits
// Node-runnable JS so `npm i @suize/pay` works on plain Node, not only Bun.
//
// The workspace itself keeps importing src/ (package.json main/exports → src);
// these dist artifacts are swapped in ONLY at publish time via publishConfig.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  treeshake: true,
  target: 'node18',
})
