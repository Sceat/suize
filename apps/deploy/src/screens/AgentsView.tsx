import { DEPLOY_API_URL } from '../config'
import { CopyButton, IconBack } from '../ui'

// ============================================================================
// DEPLOY FROM YOUR AGENT — a FIRST-CLASS instructions surface (SPEC §8), not a
// footnote. Suize Deploy is a B2A product: any third-party agentic system
// (Claude, Claude Code, Codex, a custom loop) deploys with copy-paste clarity.
// Every block is real (it uses the LIVE VITE_DEPLOY_API_URL) and copyable.
//
// The contract is gasless but AUTHENTICATED: every deploy carries a fresh
// signature, so there is no anonymous deploy path (an unsigned POST /deploy 401s).
//   gasless  — the backend's service wallet pays SUI (gas) + WAL (storage);
//   signed   — fetch GET /auth/nonce, sign buildDeployAuthMessage(nonce), POST
//              { nonce, signature }; the backend recovers the signer AS the owner;
//   open     — no API key / waitlist today (payments will gate it later, SPEC §12).
//
// The clean agent path is the Suize MCP (OAuth) — it handles the Google login +
// per-deploy signing for the agent, so the tool call stays one line. Below we show
// the raw signed HTTP flow (what MCP does under the hood) honestly.
// ============================================================================

// The public-facing base in the copy text. We show https://api.suize.io (the
// real backend host) when VITE_DEPLOY_API_URL is still the local default, so
// the snippets read as production-real; otherwise we echo the configured URL
// verbatim (so a custom backend host flows straight into every block).
const API = DEPLOY_API_URL.startsWith('http://localhost')
  ? 'https://api.suize.io'
  : DEPLOY_API_URL

const CURL = `# ILLUSTRATIVE — a deploy is SIGNED, and curl can't produce a Sui
# personal-message signature on its own. Use the TS / MCP path below to sign;
# this shows the WIRE SHAPE the signed POST must carry. A plain unsigned POST
# (no nonce/signature) is rejected with 401 — there is no anonymous deploy.

# 1. tar your built static output (the dist/ contents, not its parent)
tar -cf site.tar -C ./dist .

# 2. fetch a fresh single-use nonce
curl -sS ${API}/auth/nonce            # -> { "nonce": "…" }

# 3. sign "Suize Deploy\\ndeploy\\n::<nonce>" as a base64 personal-message
#    signature. The signature can only come from an Enoki / zkLogin (Google
#    login) signer — the dashboard, or the Suize MCP (OAuth, coming). curl
#    alone can't produce it; see the TS / MCP path to sign in code.

# 4. POST the tar with { nonce, signature } — gasless; the backend recovers the
#    signer AS the on-chain owner (\`name\` just labels the deploy).
curl -sS -X POST ${API}/deploy \\
  -F "name=my-site" \\
  -F "site.tar=@site.tar;type=application/x-tar" \\
  -F "nonce=THE_NONCE_FROM_STEP_2" \\
  -F "signature=BASE64_SIG_FROM_STEP_3"

# -> { "url": "https://<sub>.suize.site", "siteId": "0x…",
#      "subdomain": "<sub>", "version": 1, "digest": "0x…" }`

const TS = `// Node 18+ / Bun. A deploy is gasless but SIGNED: fetch a nonce, sign the
// canonical deploy message, POST { nonce, signature }. The backend recovers the
// signer AS the on-chain owner. \`site.tar\` is your BUILT static output (no build step).
import { readFileSync } from 'node:fs'

const API = '${API}'

// \`signer\` is an Enoki / zkLogin (Google login) signer — the sole signer.
// The Suize MCP (OAuth, coming) provisions this Enoki signer per-user: it runs
// the Google login + per-deploy signing for the agent, so the agent never holds
// any secret. The zkLogin address it signs from becomes the on-chain owner.
declare const signer: { signPersonalMessage(m: Uint8Array): Promise<{ signature: string }> }

// 1. fetch a fresh single-use nonce
const { nonce } = await fetch(\`\${API}/auth/nonce\`).then(r => r.json())

// 2. sign the canonical deploy message: \`Suize Deploy\\ndeploy\\n::<nonce>\`
//    (this is buildDeployAuthMessage(nonce) from @suize/shared — keep it EXACT)
const message = new TextEncoder().encode(\`Suize Deploy\\ndeploy\\n::\${nonce}\`)
const { signature } = await signer.signPersonalMessage(message)

// 3. POST the tar with { nonce, signature }
const tar = readFileSync('site.tar') // e.g. \`tar -cf site.tar -C dist .\`
const form = new FormData()
form.append('name', 'my-site')
form.append('site.tar', new Blob([tar], { type: 'application/x-tar' }), 'site.tar')
form.append('nonce', nonce)
form.append('signature', signature) // base64 personal-message signature

const res = await fetch(\`\${API}/deploy\`, { method: 'POST', body: form })
if (!res.ok) throw new Error(\`deploy failed: \${res.status} \${await res.text()}\`)

const { url, siteId, version, digest } = await res.json()
console.log('live at', url) // https://<sub>.suize.site`

const MCP = `{
  "name": "deploy_site",
  "description": "Deploy a built static site to Suize Deploy (Walrus-backed, gasless). Returns the live URL. Each deploy is immutable: a re-deploy mints a fresh site at a new URL. The deploy is signed — the Suize MCP (OAuth) handles the Google login + signing for you.",
  "inputSchema": {
    "type": "object",
    "required": ["name", "siteTarBase64"],
    "properties": {
      "name": { "type": "string", "description": "Human label for the deploy" },
      "siteTarBase64": { "type": "string", "description": "base64 of a .tar of the built static output (dist/ contents)" }
    }
  }
}

// Reference handler (Node/Bun) — wire into your MCP server's tool dispatch. The
// deploy is gasless but SIGNED: fetch a nonce, sign the canonical message, POST
// { nonce, signature }. \`signer\` is the Enoki / zkLogin (Google login) signer the
// Suize MCP (OAuth, coming) provisions per-user — the sole signer, so the agent
// holds no secret. The zkLogin address it signs from becomes the on-chain owner.
// So the agent just calls the tool and the Google login + per-deploy signing happen
// for it.
async function deploy_site({ name, siteTarBase64 }, signer) {
  const { nonce } = await fetch('${API}/auth/nonce').then(r => r.json())
  const message = new TextEncoder().encode(\`Suize Deploy\\ndeploy\\n::\${nonce}\`)
  const { signature } = await signer.signPersonalMessage(message)

  const form = new FormData()
  form.append('name', name)
  form.append(
    'site.tar',
    new Blob([Buffer.from(siteTarBase64, 'base64')], { type: 'application/x-tar' }),
    'site.tar',
  )
  form.append('nonce', nonce)
  form.append('signature', signature)
  const res = await fetch('${API}/deploy', { method: 'POST', body: form })
  if (!res.ok) throw new Error(await res.text()) // unsigned/invalid -> 401
  return await res.json() // { url, siteId, subdomain, version, digest }
}`

// A typeset GALLEY: a window-chrome bar (lamps + lang tag) over a line-numbered
// manuscript slab. Comment lines (# … / // …) are rendered as muted marginalia.
const Galley = ({ code, lang }: { code: string; lang: string }) => {
  const lines = code.replace(/\n$/, '').split('\n')
  return (
    <div className="dx-galley">
      <div className="dx-galley__bar" aria-hidden="true">
        <span className="dx-galley__lamp" />
        <span className="dx-galley__lamp" />
        <span className="dx-galley__lamp" />
        <span className="dx-galley__tag">{lang}</span>
      </div>
      <pre className="dx-code">
        <code>
          {lines.map((line, i) => {
            const trimmed = line.trimStart()
            const isComment =
              trimmed.startsWith('#') || trimmed.startsWith('//')
            return (
              <span
                key={i}
                className={`dx-code__ln${isComment ? ' is-comment' : ''}`}
              >
                <span className="dx-code__src">{line || ' '}</span>
              </span>
            )
          })}
        </code>
      </pre>
    </div>
  )
}

const Block = ({
  title,
  hint,
  copyLabel,
  code,
  lang,
}: {
  title: string
  hint?: React.ReactNode
  copyLabel: string
  code: string
  lang: string
}) => (
  <div className="dx-panel">
    <div className="dx-codehead">
      <h2 className="dx-panel__title" style={{ margin: 0 }}>
        {title}
      </h2>
      <CopyButton value={code} label={copyLabel} />
    </div>
    {hint && <p className="dx-hint" style={{ marginBottom: 14 }}>{hint}</p>}
    <Galley code={code} lang={lang} />
  </div>
)

export const AgentsView = ({ onBack }: { onBack: () => void }) => (
  <>
    <button type="button" className="dx-back" onClick={onBack}>
      <IconBack /> All sites
    </button>

    <div className="dx-pagehead">
      <div>
        <p className="ed-eyebrow">Built for agents</p>
        <h1 className="dx-pagehead__title">Deploy from your agent</h1>
      </div>
    </div>

    <p className="dx-lede" style={{ marginTop: '-8px', marginBottom: 28 }}>
      Any agentic system — Claude, Claude Code, Codex, a custom loop — deploys a
      static site to the permanent web over HTTP. It's gasless (the backend pays
      SUI + WAL) but signed: every deploy carries a fresh signature, so there's no
      anonymous deploy. The clean path is the Suize MCP (OAuth, coming), which
      handles the login + signing for the agent. The examples below are live.
    </p>

    <div className="dx-panel">
      <h2 className="dx-panel__title">The contract</h2>
      <p className="dx-hint" style={{ marginTop: 0 }}>
        Send a built static site as a tarball with a fresh signature, get back a
        live URL. Auth is one round-trip: <code>GET /auth/nonce</code> → sign{' '}
        <code>buildDeployAuthMessage(nonce)</code> → POST with{' '}
        <code>nonce</code> + <code>signature</code>. The backend recovers the
        signer and uses it AS the on-chain owner; an unsigned/invalid POST 401s.
      </p>
      <div className="dx-rows" style={{ marginTop: 16 }}>
        <div className="dx-row">
          <span className="dx-row__k">Endpoint</span>
          <span className="dx-row__v">
            <code>POST {API}/deploy</code>{' '}
            <CopyButton value={`${API}/deploy`} label="Copy endpoint" />
          </span>
        </div>
        <div className="dx-row">
          <span className="dx-row__k">Body</span>
          <span className="dx-row__v">
            <code>multipart: name + site.tar + nonce + signature</code>
          </span>
        </div>
        <div className="dx-row">
          <span className="dx-row__k">Auth</span>
          <span className="dx-row__v">
            <code>base64 personal-message sig over deploy::nonce</code>
          </span>
        </div>
        <div className="dx-row">
          <span className="dx-row__k">Returns</span>
          <span className="dx-row__v">
            <code>{'{ url, siteId, subdomain, version, digest }'}</code>
          </span>
        </div>
      </div>
      <div className="dx-tags">
        <span className="dx-tag is-bull">Gasless</span>
        <span className="dx-tag is-bull">Signed</span>
        <span className="dx-tag">Open · no API key today</span>
      </div>
      <p className="dx-hint">
        The backend's service wallet pays SUI (gas) + WAL (storage), so the agent
        holds no funds — but it does sign: a deploy proves ownership with a
        nonce-fresh signature (Google login → a Suize wallet → sign the nonce).
        The hosted <b>Suize MCP (OAuth)</b> does this for the agent end-to-end —
        it's the clean path. Payments will gate this route later; for now it's open.
      </p>
    </div>

    <Block
      title="curl"
      lang="shell"
      hint="Illustrative — a deploy needs a signature curl can't produce. Shows the wire shape; sign in the TS / MCP path."
      copyLabel="Copy curl"
      code={CURL}
    />

    <Block
      title="TypeScript / JavaScript"
      lang="ts"
      hint="Node 18+ or Bun — built-in fetch + FormData, no dependencies."
      copyLabel="Copy TS snippet"
      code={TS}
    />

    <Block
      title="MCP tool — deploy_site"
      lang="json · ts"
      hint={
        <>
          Hand any agentic system a <code>deploy_site</code> tool pointed at this
          API. Add it to your MCP server's tool list, then tell{' '}
          <b>Claude Code / Codex</b>:{' '}
          <i>"deploy this built site with the deploy_site tool."</i> The hosted{' '}
          <b>Suize MCP (OAuth, coming)</b> provisions the signer per-user, so the
          login + per-deploy signing happen for the agent — this handler shows what
          it does under the hood.
        </>
      }
      copyLabel="Copy MCP tool spec"
      code={MCP}
    />
  </>
)
