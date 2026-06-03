/**
 * GradText — the signature gradient-text wrapper (white -> blue -> ice).
 *
 * Wraps children in the chosen element with the `.grad` class (+ `--sheen` /
 * `--mark` variants). The background-clipped-text technique + the no-clip
 * fallback both live in tokens.css (`.grad` rule + the `@supports` block), so
 * this component is pure markup. Used for: wordmark, the welcome headline accent,
 * the balance hero number, the AI-account number, the handle input echo.
 */
import type { ElementType, ReactNode } from 'react';

type GradVariant = 'grad' | 'sheen' | 'mark';

export interface GradTextProps {
  /** the element to render — default 'span'. e.g. 'h1', 'b', 'em'. */
  as?: ElementType;
  /** gradient flavor: base | a brighter moving sheen | the logo/wordmark mix. */
  variant?: GradVariant;
  className?: string;
  children?: ReactNode;
}

const VARIANT_CLASS: Record<GradVariant, string> = {
  grad: 'grad',
  sheen: 'grad grad--sheen',
  mark: 'grad grad--mark',
};

export function GradText({ as, variant = 'grad', className, children }: GradTextProps) {
  const Tag = (as ?? 'span') as ElementType;
  const cls = className ? `${VARIANT_CLASS[variant]} ${className}` : VARIANT_CLASS[variant];
  return <Tag className={cls}>{children}</Tag>;
}
