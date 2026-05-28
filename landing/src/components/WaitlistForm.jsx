import { useEffect, useRef, useState } from 'react'
import WaitlistSuccessOverlay from './WaitlistSuccessOverlay'

const API_URL = import.meta.env.VITE_API_URL || ''
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''

let scriptPromise = null

function loadTurnstileScript () {
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true; s.defer = true
    s.onload = () => resolve()
    s.onerror = () => { scriptPromise = null; reject(new Error('turnstile script failed to load')) }
    document.head.appendChild(s)
  })
  return scriptPromise
}

const ERROR_MESSAGES = {
  'invalid email': "That email doesn't look right.",
  'invalid json': "Something glitched. Try again.",
  'missing turnstile token': "Please complete the captcha.",
  'captcha failed': "Captcha didn't validate — try again.",
  'captcha service unreachable': "Captcha service is down — try again in a moment.",
  'storage unavailable': "Our storage hiccuped. Try again in a moment.",
  'too many requests': "Too many tries — give it a minute.",
}
const FALLBACK_ERROR = "Something flickered. Try again?"

export default function WaitlistForm ({ compact = false, placeholderEmail = 'agent@example.com' }) {
  const [email, setEmail] = useState('')
  // idle | verifying | sending | success | error
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [alreadyOnList, setAlreadyOnList] = useState(false)
  const [showOverlay, setShowOverlay] = useState(false)
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  // Form snapshot taken at submit time so the captcha callback uses what the user typed,
  // not whatever state React has on the re-render after `verifying` is set.
  const pendingRef = useRef(null)

  const resetWidget = () => {
    if (window.turnstile && widgetIdRef.current) {
      try { window.turnstile.reset(widgetIdRef.current) } catch {}
    }
  }

  const submitWithToken = async (token) => {
    const snapshot = pendingRef.current
    if (!snapshot) return
    pendingRef.current = null

    setStatus('sending')
    setError('')

    if (!API_URL) {
      await new Promise((r) => setTimeout(r, 600))
      setAlreadyOnList(false)
      setStatus('success')
      setShowOverlay(true)
      return
    }

    let res
    try {
      res = await fetch(`${API_URL}/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...snapshot, turnstileToken: token }),
        signal: AbortSignal.timeout(8000),
      })
    } catch (err) {
      setStatus('error')
      setError(err.name === 'TimeoutError' || err.name === 'AbortError'
        ? "Network's slow — try again."
        : FALLBACK_ERROR)
      resetWidget()
      return
    }

    let data = {}
    try { data = await res.json() } catch {}

    if (!res.ok) {
      const code = (data && data.error) ? String(data.error).toLowerCase() : ''
      setStatus('error')
      setError(ERROR_MESSAGES[code] || FALLBACK_ERROR)
      resetWidget()
      return
    }

    setAlreadyOnList(data && data.alreadyOnList === true)
    setStatus('success')
    setShowOverlay(true)
  }

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    let cancelled = false
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (t) => submitWithToken(t),
          'error-callback': () => {
            pendingRef.current = null
            setStatus('error')
            setError(ERROR_MESSAGES['captcha failed'])
          },
          'expired-callback': () => {},
          appearance: 'interaction-only',
          execution: 'execute',
          theme: 'dark',
          size: 'flexible',
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current) } catch {}
        widgetIdRef.current = null
      }
    }
  }, [])

  const onSubmit = (e) => {
    e.preventDefault()
    if (!email || !email.includes('@')) {
      setStatus('error')
      setError('We need an email to send updates.')
      return
    }

    pendingRef.current = { email, source: 'suize-landing' }
    setError('')

    if (!TURNSTILE_SITE_KEY) {
      submitWithToken('')
      return
    }

    if (!window.turnstile || !widgetIdRef.current) {
      pendingRef.current = null
      setStatus('error')
      setError(ERROR_MESSAGES['captcha service unreachable'])
      return
    }

    setStatus('verifying')
    try {
      window.turnstile.reset(widgetIdRef.current)
      window.turnstile.execute(widgetIdRef.current)
    } catch {
      pendingRef.current = null
      setStatus('error')
      setError(ERROR_MESSAGES['captcha failed'])
    }
  }

  if (status === 'success') {
    return (
      <>
        <div className="neu max-w-md p-5 sm:p-6">
          <p className="font-mono text-sm text-[color:var(--color-sui-bright)]">
            {alreadyOnList ? "> You're already in. The droplet remembers." : '> Logged. The droplet remembers.'}
          </p>
          <p className="mt-2 text-xs text-[color:var(--color-ink-dim)] leading-relaxed">
            {alreadyOnList ? "We've got you. " : "You're on the waitlist. "}We'll email you once — when{' '}
            <code className="font-mono text-[color:var(--color-sui-bright)]">/ask</code> goes live.
          </p>
        </div>
        {showOverlay && (
          <WaitlistSuccessOverlay
            alreadyOnList={alreadyOnList}
            onClose={() => setShowOverlay(false)}
          />
        )}
      </>
    )
  }

  const busy = status === 'verifying' || status === 'sending'
  const buttonLabel = status === 'verifying' ? 'verifying…' : status === 'sending' ? 'sending…' : 'get early access to /ask'

  return (
    <form onSubmit={onSubmit} className="w-full max-w-md">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={placeholderEmail}
          aria-label="Email"
          className="neu-inset flex-1 min-w-0 px-4 py-3 font-mono text-sm
                     text-[color:var(--color-ink)]
                     placeholder:text-[color:var(--color-ink-mute)]
                     outline-none focus:border-[color:var(--color-sui)]
                     transition-colors"
        />
        <button
          type="submit"
          disabled={busy}
          className="neu-btn px-5 py-3 font-mono text-sm font-bold uppercase tracking-wider
                     disabled:opacity-60 disabled:cursor-not-allowed
                     whitespace-nowrap"
        >
          {buttonLabel}
        </button>
      </div>

      {/* Turnstile container — invisible unless Cloudflare flags the request
          for interaction (then a small inline widget appears here). */}
      {TURNSTILE_SITE_KEY && <div ref={containerRef} />}

      {status === 'error' && (
        <p className="mt-2 font-mono text-xs text-red-300">&gt; {error}</p>
      )}
      {!compact && (
        <p className="mt-3 font-mono text-[10px] text-[color:var(--color-ink-mute)] uppercase tracking-widest">
          early access to the agentic RPC for Sui · we email once when /ask goes live
        </p>
      )}
    </form>
  )
}
