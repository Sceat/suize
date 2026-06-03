/**
 * Icon system — a curated, named re-export of lucide-react.
 *
 * Call-sites import icons FROM HERE (never from 'lucide-react' directly) so the
 * whole app shares one curated set and one stroke weight. Icons paint with
 * `currentColor`, so they're theme-free — set the color on the parent.
 *
 * NO emojis anywhere in the app — every glyph is a lucide icon from this list.
 * Usage:  <Send size={16} strokeWidth={ICON_STROKE} className="text-cyan" />
 */
export {
  Lock,
  ShieldCheck,
  Activity,
  HeartPulse,
  Send,
  ArrowLeftRight,
  ArrowUp,
  ArrowDown,
  Wallet,
  Coins,
  Plus,
  Copy,
  Check,
  X,
  ChevronDown,
  Search,
  ExternalLink,
  Moon,
  Sun,
  BadgeCheck,
  CreditCard,
  Landmark,
  Smartphone,
  Pause,
  Play,
} from 'lucide-react';

/** Brand-consistent stroke weight for every icon. Pass as `strokeWidth`. */
export const ICON_STROKE = 1.75;
