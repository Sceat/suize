// Footer colophon — watermark, link columns, legal line.

export function Colophon() {
  return (
    <footer className="colophon">
      <div className="wrap">
        <div className="colophon__wm">Suize</div>
        <div className="colophon__cols">
          <div className="col">
            <div className="col__h">Open source</div>
            <a href="https://github.com/suize">github.com/suize →</a>
            <a href="https://github.com/suize">the x402 facilitator →</a>
            <a href="https://www.npmjs.com/package/@suize/mcp">npm · @suize/mcp →</a>
          </div>
          <div className="col">
            <div className="col__h">Build</div>
            <a href="#">Documentation →</a>
            <a href="#">The 402 spec →</a>
            <a href="#">Walrus storage →</a>
          </div>
          <div className="col">
            <div className="col__h">The rail</div>
            <a href="#">How settlement works →</a>
            <a href="#">Extend &amp; permanence →</a>
            <a href="#">Privacy &amp; Seal →</a>
          </div>
        </div>
        <div className="colophon__legal">
          <span>Suize — pressed to Walrus, settled on Sui.</span>
          <span>Non-custodial. Your keys never leave your machine.</span>
        </div>
      </div>
    </footer>
  )
}
