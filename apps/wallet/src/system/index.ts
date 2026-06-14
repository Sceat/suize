/**
 * @suize/system — the wallet's shared chrome, post-redesign (2026-06-10).
 *
 * The journal-era barrel (AmbientField / GradText / Wordmark / primitives /
 * JournalShell / JournalHome) is RETIRED with the legacy screens — the design
 * system now lives in `src/ui/rd.css` + the `ui/` components. What remains
 * here is the cross-cutting chrome the production app still mounts:
 *
 *   import { Loader, ICON_STROKE, Check, … } from '../system';
 */

// chrome
export { Loader } from './Loader';
export type { LoaderProps } from './Loader';
export { Logo } from './Logo';
export type { LogoProps } from './Logo';
export { CustomCursor } from './CustomCursor';

// theme
export { ThemeProvider, useTheme, ThemeToggle } from './theme';
export type { Theme } from './theme';

// icons (curated lucide set + stroke constant)
export * from './icons';
