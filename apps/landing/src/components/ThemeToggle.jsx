import { useEffect, useState } from 'react'
import { getTheme, toggleTheme, onThemeChange } from '../lib/theme'

// A small editorial sun/moon glyph that swaps with the theme. Inline SVG so it
// inherits currentColor and needs no asset.
const Glyph = ({ dark }) =>
  dark ? (
    // moon (currently dark → click goes to light)
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.2 9.4A5.4 5.4 0 0 1 6.6 2.8a5.6 5.6 0 1 0 6.6 6.6Z"
        fill="currentColor"
      />
    </svg>
  ) : (
    // sun (currently light → click goes to dark)
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="3.1" fill="currentColor" stroke="none" />
      <path d="M8 1.4v1.7M8 12.9v1.7M1.4 8h1.7M12.9 8h1.7M3.3 3.3l1.2 1.2M11.5 11.5l1.2 1.2M12.7 3.3l-1.2 1.2M4.5 11.5l-1.2 1.2" />
    </svg>
  )

// THEME TOGGLE — a tasteful nav control. The choice persists (localStorage) and
// applies across the landing AND every product room (it sets <html data-theme>).
export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => getTheme())
  useEffect(() => onThemeChange(setTheme), [])
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      className="sx-themetoggle"
      onClick={() => toggleTheme()}
      role="switch"
      aria-checked={dark}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light' : 'Dark'}
    >
      <span className="sx-themetoggle__glyph" aria-hidden="true">
        <Glyph dark={dark} />
      </span>
    </button>
  )
}
