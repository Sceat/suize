/**
 * Shared primitives for the production wallet UI: the spark glyph, typing
 * dots, the iOS switch, chat rows, the Google mark, the branded decorative QR,
 * and the @name highlighter. All visual; the views own choreography + state.
 */
import type { ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { Who } from './copy';

/** the landing's four-point spark glyph — the family badge mark */
export function Spark() {
  return (
    <span className="rd-spark" aria-hidden="true">
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path
          d="M6 0c.45 2.7 2.3 4.55 5 5-2.7.45-4.55 2.3-5 5-.45-2.7-2.3-4.55-5-5 2.7-.45 4.55-2.3 5-5Z"
          fill="currentColor"
          style={{ color: 'var(--rd-blue)' }}
        />
      </svg>
    </span>
  );
}

/** three pulsing typing dots */
export function Dots() {
  return (
    <span className="rd-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

/** the iOS switch — the one sanctioned pill (it IS a switch) */
export function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`rd-switch${on ? ' is-on' : ''}`}
      onClick={onToggle}
    >
      <i />
    </button>
  );
}

/** one chat row — `you` right/gradient, `ai` left/quiet. `landed` drives the rise. */
export function Row({
  who,
  landed = true,
  children,
}: {
  who: Who;
  landed?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`rd-row rd-row--${who}${landed ? ' is-in' : ''}`}>
      <span className="rd-bubble">{children}</span>
    </div>
  );
}

/** a transient typing row (ai side) */
export function TypingRow() {
  return (
    <div className="rd-row rd-row--ai is-in">
      <span className="rd-bubble" style={{ display: 'inline-flex', alignItems: 'center' }}>
        <Dots />
      </span>
    </div>
  );
}

/** a day divider */
export function Divider({ label }: { label: string }) {
  return (
    <div className="rd-divider" aria-hidden="true">
      <span>{label}</span>
    </div>
  );
}

/** the Google G — the one foreign mark, official four-color glyph */
export function GoogleMark() {
  return (
    <span className="rd-gmark" aria-hidden="true">
      <svg viewBox="0 0 18 18" width="16" height="16">
        <path
          fill="#4285F4"
          d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62Z"
        />
        <path
          fill="#34A853"
          d="M9 18a8.6 8.6 0 0 0 5.96-2.18l-2.92-2.26a5.44 5.44 0 0 1-8.09-2.85H.96v2.33A9 9 0 0 0 9 18Z"
        />
        <path
          fill="#FBBC05"
          d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33Z"
        />
        <path
          fill="#EA4335"
          d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.96l3 2.33A5.36 5.36 0 0 1 9 3.58Z"
        />
      </svg>
    </span>
  );
}

// one inline pass: **bold**, *italic*, `code`, [text](url), and @names. Bold is
// tried before italic so `**x**` never reads as two single-asterisk spans.
const MD_INLINE =
  /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|https?:\/\/[^\s)]+|\*(?=\S)[^*\n]+?\*|[a-z0-9][a-z0-9-]*@[a-z0-9][a-z0-9-]*)/g;

function inlineMd(text: string, kb: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  MD_INLINE.lastIndex = 0;
  while ((m = MD_INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={`${kb}b${k}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code className="rd-md-code" key={`${kb}c${k}`}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t)!;
      out.push(
        <a className="rd-md-a" key={`${kb}a${k}`} href={link[2]} target="_blank" rel="noopener noreferrer">
          {link[1]}
        </a>,
      );
    } else if (t.startsWith('http')) {
      out.push(
        <a className="rd-md-a rd-md-url" key={`${kb}u${k}`} href={t} target="_blank" rel="noopener noreferrer">
          {t}
        </a>,
      );
    } else if (t.startsWith('*')) out.push(<em key={`${kb}i${k}`}>{t.slice(1, -1)}</em>);
    else
      out.push(
        <span className="rd-handle" key={`${kb}h${k}`}>
          {t}
        </span>,
      );
    last = MD_INLINE.lastIndex;
    k++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * rich — render the assistant's lightweight markdown. The bubble is a <span>, so
 * everything stays INLINE-safe (no block <p>/<ul>): inline marks via inlineMd,
 * `\n` → <br>, and `- `/`* `/`1. ` lines as • rows. The brain (Haiku) speaks
 * simple markdown; this keeps it readable in-bubble without pulling a parser dep.
 */
export function rich(text: string): ReactNode {
  if (!/[*`[\n]|https?:\/\/|[a-z0-9-]+@[a-z0-9-]/.test(text)) return text; // fast path: plain prose
  const nodes: ReactNode[] = [];
  text.split('\n').forEach((raw, i) => {
    if (i > 0) nodes.push(<br key={`br${i}`} />);
    const bullet = raw.match(/^\s*[-*]\s+(.*)$/);
    const num = raw.match(/^\s*(\d+)\.\s+(.*)$/);
    if (bullet) {
      nodes.push(
        <span className="rd-md-li" key={`li${i}`}>
          <span className="rd-md-bullet">•</span>
          {inlineMd(bullet[1], `li${i}`)}
        </span>,
      );
    } else if (num) {
      nodes.push(
        <span className="rd-md-li" key={`li${i}`}>
          <span className="rd-md-bullet">{num[1]}.</span>
          {inlineMd(num[2], `li${i}`)}
        </span>,
      );
    } else {
      nodes.push(...inlineMd(raw, `ln${i}`));
    }
  });
  return <>{nodes}</>;
}

/**
 * SuizeQr — a REAL, scannable QR. Encodes `value` (the wallet handle / address shown
 * on the copy row). Always DARK ink on a WHITE field with a quiet-zone margin, so it
 * scans on any phone regardless of the (dark) theme around it. Error-correction is set
 * to H (30% recovery) so the small centered Suize mark — excavated from the modules —
 * never breaks the scan. Re-renders when `value` changes.
 */
export function SuizeQr({ value, size = 148 }: { value: string; size?: number }) {
  const logo = Math.round(size * 0.2);
  return (
    <QRCodeSVG
      value={value}
      size={size}
      level="H"
      marginSize={4}
      bgColor="#ffffff"
      fgColor="#0a1b2e"
      title="Your Suize wallet QR"
      imageSettings={{ src: '/logo.png', height: logo, width: logo, excavate: true }}
    />
  );
}

