// Footer colophon — watermark, link columns, legal line. Every link is a real,
// reachable target (no href="#" dead ends — a public page's links must resolve).

const REPO = 'https://github.com/Sceat/suize'

export function Colophon() {
  return (
    <footer className="colophon">
      <div className="wrap">
        <div className="colophon__wm">Suize</div>
        <div className="colophon__cols">
          <div className="col">
            <div className="col__h">Open source</div>
            <a href={REPO} target="_blank" rel="noopener noreferrer">github.com/Sceat/suize →</a>
            <a href={`${REPO}/tree/master/services/facilitator`} target="_blank" rel="noopener noreferrer">the x402 facilitator →</a>
            <a href={`${REPO}/tree/master/packages/mcp`} target="_blank" rel="noopener noreferrer">the deploy MCP →</a>
          </div>
          <div className="col">
            <div className="col__h">Build</div>
            <a href={`${REPO}#readme`} target="_blank" rel="noopener noreferrer">Documentation →</a>
            <a href="https://github.com/x402-foundation/x402" target="_blank" rel="noopener noreferrer">The x402 spec →</a>
            <a href="https://www.walrus.xyz" target="_blank" rel="noopener noreferrer">Walrus storage →</a>
          </div>
          <div className="col">
            <div className="col__h">The rail</div>
            <a href={`${REPO}/tree/master/services/facilitator#readme`} target="_blank" rel="noopener noreferrer">How settlement works →</a>
            <a href={`${REPO}/tree/master/packages/pay#readme`} target="_blank" rel="noopener noreferrer">Merchant integration →</a>
            <a href="https://github.com/MystenLabs/seal" target="_blank" rel="noopener noreferrer">Privacy &amp; Seal →</a>
          </div>
        </div>
        <div className="colophon__legal">
          <span>Suize: pressed to Walrus, settled on Sui.</span>
          <span>Non-custodial. Your keys never leave your machine.</span>
        </div>
      </div>
    </footer>
  )
}
