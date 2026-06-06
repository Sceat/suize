/**
 * @suize/system — the wallet design system (extractable module, replaces ether/).
 *
 * One barrel for the whole system. Zero app-local deps besides the data-type
 * import in WalletShell. Consumers import primitives from here and `@import` the
 * tokens once at their CSS root:
 *
 *   import { Button, Field, WalletShell, AmbientField, Loader } from '../system';
 *   // and once, in styles: @import '../system/tokens.css';
 */

// ambient + chrome
export { AmbientField } from './AmbientField';
export { Loader } from './Loader';
export type { LoaderProps } from './Loader';
export { Logo } from './Logo';
export type { LogoProps } from './Logo';
export { GradText } from './GradText';
export type { GradTextProps } from './GradText';
export { Wordmark } from './Wordmark';
export type { WordmarkProps } from './Wordmark';

// theme
export { ThemeProvider, useTheme, ThemeToggle } from './theme';
export type { Theme } from './theme';

// primitives
export {
  Button,
  Field,
  Eyebrow,
  Pill,
  HealthDot,
  ModeSwitch,
  CopyButton,
} from './primitives';
export type {
  ButtonProps,
  ButtonVariant,
  ButtonSize,
  FieldProps,
  FieldState,
  Mode,
} from './primitives';

// journal shell (THE shell — replaces the old WalletShell/HomeSimple/HomeAdvanced UI)
export { JournalShell, Masthead } from './JournalShell';
export type {
  JournalShellProps,
  JournalSlots,
  JournalPresence,
} from './JournalShell';

// journal home (the wiring container that composes the leaves into the shell slots)
export { JournalHome } from './JournalHome';
export type { JournalHomeProps } from './JournalHome';

// icons (curated lucide set + stroke constant)
export * from './icons';
