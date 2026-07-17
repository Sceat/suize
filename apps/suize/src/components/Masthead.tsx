// The masthead — the Hashgraph wordmark + one positioning line, then the double
// rule + the single narrative tagline. (Trimmed: no "Gasless · Non-custodial"
// microline — that lives in the value strip where it earns its place.)

export function Masthead() {
  return (
    <header className="wrap mast">
      <div className="mast__top">
        <h1 className="nameplate">Suize</h1>
        <p className="mast__est">Websites your agent ships itself.</p>
      </div>
      <div className="mast__rule" />
      <div className="mast__rule--thin" />
      <p className="mast__tagline">
        <span>An agent pays. A website goes live on Walrus.</span>
        <em>Keep it for years, or throw it away tomorrow.</em>
      </p>
    </header>
  )
}
