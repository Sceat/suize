// The masthead — nameplate + establishment line + the double rule.

export function Masthead() {
  return (
    <header className="wrap mast">
      <div className="mast__top">
        <h1 className="nameplate">Suize</h1>
        <div className="mast__est">
          <div>
            <b>The publish button</b>
          </div>
          <div>for the agentic web.</div>
          <div style={{ marginTop: 8, color: 'var(--fg-4)' }}>Gasless · Non-custodial</div>
        </div>
      </div>
      <div className="mast__rule" />
      <div className="mast__rule--thin" />
      <div className="mast__tagline">
        <span>An agent pays. A website goes live.</span>
        <em>Content-addressed on Walrus — yours to keep, extend, or let expire.</em>
      </div>
    </header>
  )
}
