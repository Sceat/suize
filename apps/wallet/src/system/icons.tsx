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
  Brain,
  Sparkles,
  ShieldCheck,
  Activity,
  HeartPulse,
  Send,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  RefreshCw,
  SlidersHorizontal,
  ArrowUp,
  ArrowDown,
  Wallet,
  Coins,
  Plus,
  Minus,
  Circle,
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
  Mail,
  MessageCircle,
  Pause,
  Play,
  Pin,
  PinOff,
  Power,
  PauseCircle,
  AlertTriangle,
  Dices,
  CandlestickChart,
  QrCode,
  Share2,
  Link,
} from 'lucide-react';

/** The shape of every icon in this set (props: size, strokeWidth, className…). */
export type { LucideIcon as IconType } from 'lucide-react';

/** Brand-consistent stroke weight for every icon. Pass as `strokeWidth`. */
export const ICON_STROKE = 1.75;
