import { DEPLOY_API_URL } from '../config'
import { CopyButton, IconBack } from '../ui'

// ============================================================================
// DEPLOY FROM YOUR AGENT — a FIRST-CLASS instructions surface (SPEC §8), not a
// footnote. Suize Deploy is a B2A product: any third-party agentic system
// (Claude, Claude Code, Codex, a custom loop) deploys with copy-paste clarity.
// Every block is real (it uses the LIVE VITE_DEPLOY_API_URL) and copyable.
//
// The contract is intentionally dumb: one open HTTP endpoint, no SDK, no auth.
//   gasless  — the backend's service wallet pays SUI (gas) + WAL (storage);
//   keyless  — the agent signs nothing and holds nothing;
//   open     — no API key today (payments will gate it later, see SPEC §12).
// ============================================================================

// The public-facing base in the copy text. We show https://deploy.suize.io as
// the canonical prod host when VITE_DEPLOY_API_URL is still the local default,
// so the snippets read as production-real; otherwise we echo the configured URL
// verbatim (so a custom backend host flows straight into every block).
const API = DEPLOY_API_URL.startsWith('http://localhost')
  ? 'https://deploy.suize.io'
  : DEPLOY_API_URL

const CURL = `# tar your built static output (the dist/ contents, not its parent)
tar -cf site.tar -C ./dist .

# POST it — gasless, keyless, no API key. \`name\` labels the deploy;
# \`owner\` is OPTIONAL best-effort attribution (a Sui address).
curl -sS -X POST ${API}/deploy \\
  -F "name=my-site" \\
  -F "site.tar=@site.tar;type=application/x-tar" \\
  -F "owner=0xYOUR_SUI_ADDRESS_OPTIONAL"

# -> { "url": "https://<sub>.deploy.suize.io", "siteId": "0x…",
#      "subdomain": "<sub>", "version": 1, "digest": "0x…" }`

const TS = `// Node 18+ / Bun. No SDK — one fetch against the open endpoint.
// \`site.tar\` is a tarball of your BUILT static output (pre-built; no build step).
import { readFileSync } from 'node:fs'

const API = '${API}'

const tar = readFileSync('site.tar') // e.g. \`tar -cf site.tar -C dist .\`
const form = new FormData()
form.append('name', 'my-site')
form.append('site.tar', new Blob([tar], { type: 'application/x-tar' }), 'site.tar')
// form.append('owner', '0xYOUR_SUI_ADDRESS') // optional attribution

const res = await fetch(\`\${API}/deploy\`, { method: 'POST', body: form })
if (!res.ok) throw new Error(\`deploy failed: \${res.status} \${await res.text()}\`)

const { url, siteId, version, digest } = await res.json()
console.log('live at', url) // https://<sub>.deploy.suize.io`

const MCP = `{
  "name": "deploy_site",
  "description": "Deploy a built static site to Suize Deploy (Walrus-backed, gasless + keyless). Returns the live URL. Each deploy is immutable: a re-deploy mints a fresh site at a new URL.",
  "inputSchema": {
    "type": "object",
    "required": ["name", "siteTarBase64"],
    "properties": {
      "name": { "type": "string", "description": "Human label for the deploy" },
      "siteTarBase64": { "type": "string", "description": "base64 of a .tar of the built static output (dist/ contents)" },
      "owner": { "type": "string", "description": "Optional Sui address for attribution" }
    }
  }
}

// Reference handler (Node/Bun) — wire into your MCP server's tool dispatch:
async function deploy_site({ name, siteTarBase64, owner }) {
  const form = new FormData()
  form.append('name', name)
  form.append(
    'site.tar',
    new Blob([Buffer.from(siteTarBase64, 'base64')], { type: 'application/x-tar' }),
    'site.tar',
  )
  if (owner) form.append('owner', owner)
  const res = await fetch('${API}/deploy', { method: 'POST', body: form })
  if (!res.ok) throw new Error(await res.text())
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
      Any agentic system — Claude, Claude Code, Codex, a custom loop — presses a
      static site to the permanent web with a single HTTP call. No SDK, no key,
      no signature. The galleys below are live against this backend.
    </p>

    <div className="dx-panel">
      <h2 className="dx-panel__title">The contract</h2>
      <p className="dx-hint" style={{ marginTop: 0 }}>
        One open HTTP endpoint. Send a built static site as a tarball, get back a
        live URL. There is no SDK to install and no key to provision.
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
            <code>multipart: name + site.tar (+ owner?)</code>
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
        <span className="dx-tag is-bull">Keyless</span>
        <span className="dx-tag">Open · no API key today</span>
      </div>
      <p className="dx-hint">
        The backend's service wallet pays SUI (gas) + WAL (storage); your agent
        signs nothing and holds nothing. <code>owner</code> is optional
        attribution only. Payments will gate this route later — for now it's
        open.
      </p>
    </div>

    <Block
      title="curl"
      lang="shell"
      hint="Tar a built folder and POST it. Drop the snippet straight into a shell."
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
          <i>"deploy this built site with the deploy_site tool."</i>
        </>
      }
      copyLabel="Copy MCP tool spec"
      code={MCP}
    />
  </>
)
