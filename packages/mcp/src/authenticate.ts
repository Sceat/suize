// ============================================================================
// authenticate — the loopback half of the /agent-connect handshake.
//
// 1. Bind a ONE-SHOT http server on 127.0.0.1:<random port>/callback and mint a
//    128-bit `tok`.
// 2. Open the OS browser to
//    {WALLET_APP_URL}/agent-connect?cb=http://127.0.0.1:<port>/callback&tok=<tok>.
//    The user signs in with Google (zkLogin) on the wallet origin; the page mints
//    the proof for a FRESH agent address and POSTs the session payload — WITH
//    `tok` echoed in the body (and the user's main address as `mainAddress`) — to
//    the cb. ONLY a loopback cb is accepted. The address you get back is your
//    AGENT's own address (the wallet's Agent card asks you to paste + fund it).
// 3. Validate `tok` + the payload, persist to ~/.suize/session.json (0600),
//    close the server, return "authenticated as <address>".
//
// CSRF: the loopback listener answers ANY origin (Allow-Origin: *) for ~5 min,
// so a malicious web page that guesses the random port could POST its OWN valid
// zkLogin session and substitute the attacker's address. The `tok` is a shared
// secret only the legitimately-opened connect page ever sees (it rides the URL
// we opened) — a missing/mismatched `tok` is rejected 400 WITHOUT burning the
// one-shot, the same as a malformed payload. This closes the blind-POST window.
//
// CORS: the page is a cross-origin (https) document POSTing application/json
// to this loopback http server, so the preflight MUST succeed: OPTIONS → 204
// with Access-Control-Allow-Origin/-Headers (+ the Chrome Private-Network-
// Access header), and the POST response carries Allow-Origin too — the page
// reads `res.ok` to flip to "You're connected".
// ============================================================================

import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WALLET_APP_URL, SESSION_PATH } from './config'
import { saveSession, validateSessionPayload, type SuizeSession } from './session'

const AUTH_TIMEOUT_MS = 5 * 60 * 1000
const MAX_BODY_BYTES = 64 * 1024

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  // Chrome Private Network Access: a public https page reaching a loopback
  // address preflights with Access-Control-Request-Private-Network.
  'Access-Control-Allow-Private-Network': 'true',
}

const respond = (res: ServerResponse, status: number, body?: object): void => {
  res.writeHead(status, { ...CORS_HEADERS, 'content-type': 'application/json' })
  res.end(body ? JSON.stringify(body) : undefined)
}

const readBody = (req: IncomingMessage): Promise<string | null> =>
  new Promise(resolve => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        resolve(null)
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(null))
  })

/** Best-effort OS browser open (macOS `open` / win `start` / linux `xdg-open`). */
const openBrowser = (url: string): void => {
  const [cmd, ...args] =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url]
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {
      console.error(`[suize-mcp] could not open a browser — visit this URL to sign in: ${url}`)
    })
    child.unref()
  } catch {
    console.error(`[suize-mcp] could not open a browser — visit this URL to sign in: ${url}`)
  }
}

const runAuthenticate = (): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    // The shared CSRF secret — only the connect page we open in the browser
    // ever learns it (it rides the cb URL). The loopback POST must echo it.
    const tok = randomBytes(16).toString('hex')

    const server = createServer((req, res) => {
      void (async () => {
        if (req.method === 'OPTIONS') return respond(res, 204)
        const path = (req.url ?? '').split('?')[0]
        if (req.method !== 'POST' || path !== '/callback') {
          return respond(res, 404, { error: 'not found' })
        }
        const raw = await readBody(req)
        if (raw === null) return respond(res, 413, { error: 'body too large' })
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch {
          return respond(res, 400, { error: 'invalid JSON' })
        }
        // CSRF gate — a missing/mismatched `tok` is a blind cross-origin POST,
        // not our connect page. Reject WITHOUT burning the one-shot (same as a
        // malformed payload), so a probe can't kill an in-flight sign-in.
        const tokIn = (parsed as { tok?: unknown } | null)?.tok
        if (typeof tokIn !== 'string' || tokIn !== tok) {
          return respond(res, 400, { error: 'invalid or missing tok' })
        }
        const v = validateSessionPayload(parsed)
        // A malformed POST does NOT burn the one-shot — a stray probe must not
        // kill a sign-in that is still in flight in the browser.
        if (!v.ok) return respond(res, 400, { error: v.error })
        let session: SuizeSession
        try {
          saveSession(v.session)
          session = v.session
        } catch (e) {
          return respond(res, 500, { error: `could not persist the session: ${(e as Error).message}` })
        }
        respond(res, 200, { ok: true })
        finish(() =>
          resolve(
            `Authenticated as ${session.address} (${session.network}). ` +
              `The session signs locally until Sui epoch ${session.maxEpoch} ` +
              `(~${new Date(session.expiresAt).toISOString()}) and is stored at ${SESSION_PATH} (0600). ` +
              `Keys never left this machine — Suize servers never see them and never sign for the user. ` +
              `When it expires, run authenticate again.`,
          ),
        )
      })()
    })

    let done = false
    const finish = (settle: () => void): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      server.close()
      // close() waits for the keep-alive connection of the page; settle now.
      settle()
    }

    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            `Sign-in timed out after ${AUTH_TIMEOUT_MS / 60000} minutes — no session was received. ` +
              `Run the authenticate tool again (it opens ${WALLET_APP_URL}/agent-connect in the browser).`,
          ),
        ),
      )
    }, AUTH_TIMEOUT_MS)

    server.on('error', e => finish(() => reject(new Error(`loopback server failed: ${e.message}`))))

    // Port 0 = a random free port, bound to 127.0.0.1 ONLY.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      const cb = `http://127.0.0.1:${port}/callback`
      const url = `${WALLET_APP_URL}/agent-connect?cb=${encodeURIComponent(cb)}&tok=${tok}`
      console.error(`[suize-mcp] waiting for sign-in — if no browser opened, visit: ${url}`)
      openBrowser(url)
    })
  })

// One sign-in at a time: a second authenticate call joins the in-flight one
// instead of binding a second loopback server.
let inflight: Promise<string> | null = null
export const authenticate = (): Promise<string> => {
  if (!inflight) {
    inflight = runAuthenticate().finally(() => {
      inflight = null
    })
  }
  return inflight
}
