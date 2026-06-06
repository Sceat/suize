// ===========================================================================
// Display formatters for the Deploy dashboard. Mirrors apps/crash/src/format.ts
// conventions (tabular mono numbers, compact magnitudes). Display ONLY.
// ===========================================================================

// Truncate a 0x… id/address to "0x12ab…cd34". Returns '' for a missing value.
export const fmt_id = (id: string | null | undefined): string => {
  if (!id) return ''
  return id.length <= 12 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`
}

// Byte count -> human size: "812 B", "12.4 KB", "3.1 MB". Binary (1024) units —
// what a static bundle's on-disk footprint reads as. A genuinely-absent value
// (null / undefined / non-finite / negative) renders as "—"; a present, real 0
// stays "0 B" (the picker uses this for live, present sizes).
export const fmt_bytes = (bytes: number | null | undefined): string => {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u += 1
  }
  const trimmed = v >= 10 ? Math.round(v).toString() : v.toFixed(1)
  return `${trimmed} ${units[u]}`
}

// A file count -> a plain integer string, or "—" when genuinely absent
// (null / undefined / non-finite / negative). A present, real 0 stays "0".
export const fmt_count = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n) || n < 0) return '—'
  return Math.round(n).toLocaleString('en-US')
}

// On-chain Site metadata is "absent" (not yet populated) when both size and
// file count are 0 — a REAL deploy always carries at least an index.html, so a
// {0,0} pair means the field wasn't read, not an empty site. Callers pass the
// raw value through these so absent metadata reads as "—" instead of a fake 0.
export const site_size = (sizeBytes: number, fileCount: number): string =>
  sizeBytes === 0 && fileCount === 0 ? '—' : fmt_bytes(sizeBytes)

export const site_files = (sizeBytes: number, fileCount: number): string =>
  sizeBytes === 0 && fileCount === 0 ? '—' : fmt_count(fileCount)

// A unix-ms timestamp -> "Jun 5, 2026" plus a relative hint isn't needed here;
// the cards show an absolute date. Returns '—' for a missing/0 timestamp.
export const fmt_date = (ms: number | null | undefined): string => {
  if (!ms || !Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// A unix-ms timestamp -> a compact relative age: "just now", "5m ago", "3h ago",
// "2d ago". Used as a secondary, calmer time signal next to the absolute date.
export const fmt_ago = (ms: number | null | undefined): string => {
  if (!ms || !Number.isFinite(ms)) return ''
  const diff = Date.now() - ms
  if (diff < 0) return 'just now'
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}
