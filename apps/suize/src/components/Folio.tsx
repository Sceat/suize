// The folio strip — sticky masthead rule with the running edition date.

const edition = (() => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `EDITION · ${d.getFullYear()}·${p(d.getMonth() + 1)}·${p(d.getDate())}`
})()

export function Folio() {
  return (
    <div className="folio">
      <div className="wrap folio__in">
        <span>SUIZE — THE PERMANENT AGENTIC WEB</span>
        <div className="folio__mid">
          <span>Pressed to Walrus</span>
          <span>Built on Sui</span>
          <span>Open source</span>
        </div>
        <span className="mono">{edition}</span>
      </div>
    </div>
  )
}
