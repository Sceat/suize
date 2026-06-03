import { useEffect, useState } from 'react'

// Re-renders every `interval` ms so countdowns tick live. One timer per hook
// instance; the App uses a single shared instance near the top of the tree.
export const useNow = (interval = 1000): number => {
  const [now, set_now] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => set_now(Date.now()), interval)
    return () => clearInterval(id)
  }, [interval])
  return now
}
