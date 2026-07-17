import { useEffect, useState } from 'react'

// The hero's autotyping agent terminal. A calm ~12s loop that plays the one
// gesture the product IS: add the MCP server, publish a folder, get a live URL
// back. Pure transform/opacity + text swaps (no layout thrash: the body reserves
// six lines so the hero never resizes mid-loop). prefers-reduced-motion renders
// the final frame statically. It is a single role="img" so screen readers get
// one stable label, not the churning text. Skin ported from the approved mockup.

const MCP_CMD = 'claude mcp add suize -- npx -y @suize/mcp'
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

type Seg = { t: string; c?: string }
type Row = Seg[] // an empty array is a blank spacer line

const FINAL: Row[] = [
  [{ t: '$ ', c: 'ps' }, { t: MCP_CMD }],
  [{ t: '✓ ', c: 'ok' }, { t: 'suize connected', c: 'dim' }],
  [],
  [{ t: '› ', c: 'ps' }, { t: 'publish ./my-site', c: 'usr' }],
  [{ t: '✓ ', c: 'ok' }, { t: 'paid · stored on Walrus', c: 'dim' }],
  [{ t: '✓ ', c: 'ok' }, { t: 'live  ' }, { t: 'https://suize.io', c: 'url' }],
]

function Line({ segs, caret }: { segs: Row; caret?: boolean }) {
  return (
    <div className="tl">
      {segs.length === 0 && !caret ? ' ' : null}
      {segs.map((s, i) => (
        <span key={i} className={s.c}>
          {s.t}
        </span>
      ))}
      {caret && <span className="caret" />}
    </div>
  )
}

export function Terminal() {
  const [rows, setRows] = useState<Row[]>([])
  const [live, setLive] = useState<{ segs: Row; caret: boolean } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setRows(FINAL)
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const sleep = (ms: number) =>
      new Promise<void>((res) => {
        timer = setTimeout(res, ms)
      })

    async function type(prefix: Seg, text: string, cps: number, typed?: string) {
      for (let i = 0; i <= text.length; i++) {
        if (cancelled) return
        setLive({ segs: [prefix, { t: text.slice(0, i), c: typed }], caret: true })
        await sleep(cps + Math.random() * 30 - 10)
      }
      if (cancelled) return
      setRows((r) => [...r, [prefix, { t: text, c: typed }]])
      setLive(null)
    }

    async function spin(ms: number) {
      const t0 = Date.now()
      let k = 0
      while (Date.now() - t0 < ms) {
        if (cancelled) return
        setLive({
          segs: [
            { t: SPIN[k++ % SPIN.length] + ' ', c: 'spin' },
            { t: 'paying · storing on Walrus', c: 'dim' },
          ],
          caret: false,
        })
        await sleep(90)
      }
    }

    async function run() {
      while (!cancelled) {
        setRows([])
        setLive(null)
        await sleep(240)
        if (cancelled) return
        await type({ t: '$ ', c: 'ps' }, MCP_CMD, 46)
        if (cancelled) return
        await sleep(360)
        if (cancelled) return
        setRows((r) => [...r, [{ t: '✓ ', c: 'ok' }, { t: 'suize connected', c: 'dim' }]])
        await sleep(620)
        if (cancelled) return
        setRows((r) => [...r, []])
        await type({ t: '› ', c: 'ps' }, 'publish ./my-site', 58, 'usr')
        if (cancelled) return
        await sleep(300)
        if (cancelled) return
        await spin(1500)
        if (cancelled) return
        setRows((r) => [...r, [{ t: '✓ ', c: 'ok' }, { t: 'paid · stored on Walrus', c: 'dim' }]])
        setLive(null)
        await sleep(420)
        if (cancelled) return
        setRows((r) => [
          ...r,
          [{ t: '✓ ', c: 'ok' }, { t: 'live  ' }, { t: 'https://suize.io', c: 'url' }],
        ])
        await sleep(4200)
      }
    }

    run()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  const copy = () => {
    navigator.clipboard?.writeText(MCP_CMD)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div
      className="term"
      role="img"
      aria-label="Terminal: an agent installs Suize, publishes a folder, and a live URL comes back."
    >
      <div className="term__bar">
        <span className="term__tab">
          <b>agent</b> · zsh
        </span>
        <button className="term__copy" type="button" onClick={copy} aria-live="polite">
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <div className="term__body">
        {rows.map((segs, i) => (
          <Line key={i} segs={segs} />
        ))}
        {live && <Line segs={live.segs} caret={live.caret} />}
      </div>
    </div>
  )
}
