import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// DEV-ONLY bytecode server for the #/publish operator tool. `apply: 'serve'` +
// `configureServer` means this middleware exists ONLY on the dev server — it is
// never part of any build output. GET /__publish/bytecode runs
// `sui move build --dump-bytecode-as-base64` against packages/move-deploy
// (resolved from THIS file's location, never cwd) and streams the JSON straight
// back, so the owner opens #/publish → Connect → Publish with nothing to paste.
const MOVE_PKG = resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/move-deploy')

function publishBytecodePlugin(): Plugin {
  return {
    name: 'suize-publish-bytecode',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__publish/bytecode', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end()
          return
        }
        execFile(
          'sui',
          ['move', 'build', '--dump-bytecode-as-base64', '--path', MOVE_PKG],
          { maxBuffer: 32 * 1024 * 1024 },
          (err, stdout, stderr) => {
            res.setHeader('content-type', 'application/json')
            if (err) {
              // Tail of stderr is where `sui move build` puts the real reason.
              res.statusCode = 500
              const tail = (stderr || String(err)).trim().split('\n').slice(-8).join('\n')
              res.end(JSON.stringify({ error: tail }))
              return
            }
            res.statusCode = 200
            res.end(stdout.trim())
          },
        )
      })
    },
  }
}

// suize.io — the flagship Dispatch front page. Unique dev port 5184
// (crash 5173, deploy 5183).
export default defineConfig({
  plugins: [react(), publishBytecodePlugin()],
  server: {
    host: true,
    port: 5184,
  },
})
