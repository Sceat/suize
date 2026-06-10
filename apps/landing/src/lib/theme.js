// ============================================================================
// THEME — the dual-palette switch. LIGHT is the DEFAULT (the v3 editorial
// broadsheet, matching Crash / Deploy / Wallet); DARK is the cinema alternate.
//
// The choice persists in localStorage and is applied to <html data-theme>.
// First visit defaults to LIGHT — we deliberately do NOT follow
// prefers-color-scheme (founder lock: light by default). The attribute lives on
// <html> so it covers the landing AND every product room/route at once.
//
// boot() runs pre-React (in main.jsx) so there's no flash of the wrong theme.
// Subscribers (the shader, the nav toggle) listen via onThemeChange().
// ============================================================================

const KEY = 'suize-theme'
const listeners = new Set()

export function getStoredTheme() {
  if (typeof localStorage === 'undefined') return null
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dark' || v === 'light' ? v : null
  } catch {
    return null
  }
}

// the live theme = stored choice, else LIGHT (never prefers-color-scheme).
export function getTheme() {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr === 'dark' || attr === 'light') return attr
  }
  return getStoredTheme() || 'light'
}

// apply to <html> + persist + notify. Pass persist=false for the boot apply.
export function setTheme(theme, persist = true) {
  const next = theme === 'dark' ? 'dark' : 'light'
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', next)
    // keep the mobile browser chrome in sync with the page floor
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', next === 'dark' ? '#0a0c10' : '#fbfcfe')
  }
  if (persist) {
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* private mode — runtime still works, just not persisted */
    }
  }
  for (const fn of listeners) {
    try {
      fn(next)
    } catch {
      /* a bad subscriber never breaks the switch */
    }
  }
  return next
}

export function toggleTheme() {
  return setTheme(getTheme() === 'dark' ? 'light' : 'dark')
}

// subscribe to theme changes; returns an unsubscribe fn.
export function onThemeChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// boot — set the attribute as early as possible (pre-render) to avoid a flash.
export function boot() {
  setTheme(getStoredTheme() || 'light', false)
}
