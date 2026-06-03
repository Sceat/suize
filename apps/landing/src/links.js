/**
 * Outbound product links — the single source of truth for where the front-door
 * sends people. The built marketing site points at the production sub-domains
 * (DOMAIN MAP: suize.io = this landing · wallet.suize.io · crash.suize.io).
 *
 * For local development you can override either of these without touching
 * components by setting VITE_WALLET_URL / VITE_CRASH_URL in .env.local
 * (e.g. VITE_WALLET_URL=http://localhost:5173 while running the wallet app).
 *
 * "Access wallet" == sign in: the wallet's onboarding opens with Google login,
 * so the primary CTA simply lands the user on the wallet front door.
 */
export const WALLET_URL = import.meta.env.VITE_WALLET_URL || 'https://wallet.suize.io'
export const CRASH_URL = import.meta.env.VITE_CRASH_URL || 'https://crash.suize.io'

/** The recurring primary call-to-action label. */
export const ACCESS_WALLET_LABEL = 'Access wallet'
