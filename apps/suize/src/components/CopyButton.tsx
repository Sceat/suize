import { useState } from 'react'

// The copy affordance on the agent door's mcp one-liner.
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="cmd__copy"
      type="button"
      aria-live="polite"
      onClick={() => {
        navigator.clipboard?.writeText(text)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1400)
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
