/**
 * Theme system — ThemeProvider + useTheme + ThemeToggle.
 *
 * Light is the DEFAULT. The pre-paint inline script in index.html reads
 * localStorage['suize-theme'] and sets `document.documentElement.dataset.theme`
 * BEFORE this module loads, so there's never a flash. This provider then mirrors
 * that attribute into React state and owns the toggle (flip attr + persist +
 * rewrite <meta name="theme-color">).
 *
 * Because WE own the toggle, AmbientField can re-seed off `theme` from useTheme
 * instead of a MutationObserver.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Moon, Sun } from 'lucide-react';
import { ICON_STROKE } from './icons';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'suize-theme';
const META_COLOR: Record<Theme, string> = { light: '#F6F8FA', dark: '#04070e' };

interface ThemeCtx {
  theme: Theme;
  toggle(): void;
  setTheme(t: Theme): void;
}

const ThemeContext = createContext<ThemeCtx | null>(null);

/** Read the current theme from the DOM (set pre-paint) — light if unset. */
function readInitial(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function applyTheme(t: Theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', META_COLOR[t]);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitial);

  // keep the DOM attribute + meta + storage in sync with state.
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* storage may be unavailable (private mode); ignore */
    }
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggle = useCallback(() => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')), []);

  const value = useMemo<ThemeCtx>(() => ({ theme, toggle, setTheme }), [theme, toggle, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>');
  return ctx;
}

/**
 * ThemeToggle — the 42px glass circle. Moon in light (tap -> dark), sun in dark.
 * `aria-pressed` reflects the dark state. Lives top-right in the TopBar.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isDark}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={className}
      style={{
        width: 42,
        height: 42,
        borderRadius: 999,
        display: 'grid',
        placeItems: 'center',
        border: '1px solid var(--hair)',
        background: 'color-mix(in srgb, var(--paper-2) 70%, transparent)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        color: 'var(--ink-2)',
        cursor: 'pointer',
        transition:
          'border-color .5s var(--e-quart), color .5s var(--e-quart), background .5s, transform .5s var(--e-spring)',
      }}
    >
      {isDark ? (
        <Sun size={18} strokeWidth={ICON_STROKE} aria-hidden />
      ) : (
        <Moon size={18} strokeWidth={ICON_STROKE} aria-hidden />
      )}
    </button>
  );
}
