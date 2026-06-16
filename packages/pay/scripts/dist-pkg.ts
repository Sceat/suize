// Generate the PUBLISHED manifest inside dist/ and copy the README there.
//
// Why: the workspace root package.json stays SOURCE-based (main/exports → src),
// because 13 workspace files import @suize/pay from src and the whole monorepo
// is src-resolved (no build step). We publish a SEPARATE, self-contained dist/
// — `npm publish packages/pay/dist` — whose manifest points at the compiled JS,
// so `npm i @suize/pay` works on plain Node. The two manifests never collide:
// src for us, dist for the registry.
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const dist = join(root, 'dist')

if (!existsSync(join(dist, 'index.js')) || !existsSync(join(dist, 'subs.js')) || !existsSync(join(dist, 'webhook.js'))) {
  throw new Error('dist/index.js + dist/subs.js + dist/webhook.js must exist — run tsup first (this script runs after it)')
}

const src = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const manifest = {
  name: src.name,
  version: src.version,
  description: src.description,
  type: 'module',
  main: './index.js',
  module: './index.js',
  types: './index.d.ts',
  exports: {
    '.': { types: './index.d.ts', import: './index.js' },
    './subs': { types: './subs.d.ts', import: './subs.js' },
    './webhook': { types: './webhook.d.ts', import: './webhook.js' },
  },
  sideEffects: false,
  keywords: src.keywords,
  license: src.license,
  engines: { node: '>=18' },
}

writeFileSync(join(dist, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
const readme = join(root, 'README.md')
if (existsSync(readme)) copyFileSync(readme, join(dist, 'README.md'))

console.log(`dist/ manifest written: ${manifest.name}@${manifest.version} (exports . + ./subs → compiled JS)`)
