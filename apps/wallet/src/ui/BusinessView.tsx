/**
 * REDESIGN LAB — BUSINESS · ATRIUM (the owner-liked layout). The corporate
 * room: the revenue band (THE big gradient number, the customers/agents split,
 * the stat strip), the recent-charges ledger with ONE opened receipt artifact
 * (the fee printed = the trust proof, the only fee on screen), and the
 * analytics chat as the sticky right column (see BizChat).
 */
import { BUSINESS, money } from './copy';
import { Spark } from './bits';
import { BizChat } from './BizChat';

export function BusinessView() {
  return (
    <div className="rd-biz">
      <header className="rd-mast">
        <div className="rd-mast__left">
          <span className="rd-wordmark" aria-label="Suize">
            SUIZE
          </span>
          <span className="rd-mast__sep" aria-hidden="true" />
          <span className="rd-label">{BUSINESS.eyebrow}</span>
        </div>
        <div className="rd-mast__right">
          <span className="rd-mast__handle">{BUSINESS.merchant}</span>
        </div>
      </header>

      <div className="rd-biz__scroll">
        <div className="rd-biz__wrap">
          <section className="rd-biz__band">
            <div>
              <span className="rd-biz__monthlabel rd-label">
                <Spark />
                {BUSINESS.monthLabel}
              </span>
              <div className="rd-biz__big">{money(BUSINESS.monthTotal)}</div>
              <div className="rd-biz__delta">{BUSINESS.delta}</div>
            </div>
            <div className="rd-biz__split">
              {BUSINESS.split.map((s) => (
                <div className={`rd-line${'hot' in s && s.hot ? ' rd-line--hot' : ''}`} key={s.label}>
                  <span className="rd-line__body">{s.label}</span>
                  <span className="rd-line__dots" />
                  <span className="rd-line__amt">{money(s.amount)}</span>
                </div>
              ))}
              <div className="rd-biz__stats">
                {BUSINESS.stats.map((s) => (
                  <div className="rd-biz__stat" key={s.k}>
                    <b>{s.v}</b>
                    <span>{s.k}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <div className="rd-rule" />

          <div className="rd-biz__grid">
            <section className="rd-sec">
              <div className="rd-sec__head">
                <h3 className="rd-sec__title">{BUSINESS.ledgerTitle}</h3>
                <span className="rd-sec__meta">{BUSINESS.ledgerMeta}</span>
              </div>
              <div className="rd-rule" />
              <Ledger />
            </section>

            <BizChat className="rd-bizchat rd-glass" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** the charges ledger + the one opened receipt — shared by both variants */
export function Ledger() {
  return (
    <div>
      {BUSINESS.ledger.map((row) => (
        <div key={`${row.payer}-${row.when}`}>
          <div className="rd-line">
            <span className="rd-line__body">
              <span className="rd-money" style={{ fontSize: 11.5 }}>
                {row.payer}
              </span>
              {' · '}
              {row.memo}
            </span>
            <span className="rd-line__when">{row.when}</span>
            <span className="rd-line__dots" />
            <span className="rd-line__amt">+{money(row.amount)}</span>
            <a className="rd-line__verify" href="#verify" onClick={(e) => e.preventDefault()}>
              {BUSINESS.verify} ↗
            </a>
          </div>
          {'open' in row && row.open ? (
            <div className="rd-receipt">
              <div className="rd-receipt__head">{BUSINESS.receipt.title}</div>
              <div className="rd-receipt__rows">
                {BUSINESS.receipt.rows.map((r) => (
                  <div className="rd-line" key={r.k}>
                    <span
                      className="rd-line__body"
                      style={'strong' in r && r.strong ? undefined : { fontWeight: 400, color: 'var(--rd-fg-2)' }}
                    >
                      {r.k}
                    </span>
                    <span className="rd-line__dots" />
                    <span className="rd-line__amt">{r.v}</span>
                  </div>
                ))}
              </div>
              <div className="rd-receipt__foot">{BUSINESS.receipt.foot}</div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
