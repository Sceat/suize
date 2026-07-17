export const SUI_TYPE = '0x2::sui::SUI'

export function middleTruncate(value: string, start = 14, end = 12): string {
  if (value.length <= start + end + 1) return value
  return `${value.slice(0, start)}…${value.slice(-end)}`
}

export function shortType(type: string): string {
  const genericStart = type.indexOf('<')
  const base = genericStart >= 0 ? type.slice(0, genericStart) : type
  const parts = base.split('::')
  const label = parts.length > 2 ? `${parts.at(-2)}::${parts.at(-1)}` : base
  return genericStart >= 0 ? `${label}<…>` : label
}

export function typeLabel(type: string): string {
  return type.split('::').at(-1)?.replace(/>+$/, '') || type
}

export function formatBalance(raw: string, decimals: number): string {
  const negative = raw.startsWith('-')
  const digits = negative ? raw.slice(1) : raw
  const padded = digits.padStart(decimals + 1, '0')
  const integer = decimals ? padded.slice(0, -decimals) : padded
  const fraction = decimals ? padded.slice(-decimals).replace(/0+$/, '') : ''
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`
}

export function balanceToInput(raw: string, decimals: number): string {
  const padded = raw.padStart(decimals + 1, '0')
  const integer = decimals ? padded.slice(0, -decimals) : padded
  const fraction = decimals ? padded.slice(-decimals).replace(/0+$/, '') : ''
  return `${integer}${fraction ? `.${fraction}` : ''}`
}

export function parseAmount(value: string, decimals: number): bigint {
  const trimmed = value.trim()
  if (!/^\d+(?:\.\d*)?$/.test(trimmed)) throw new Error('Enter a valid amount')
  const [integer, fraction = ''] = trimmed.split('.')
  if (fraction.length > decimals) {
    throw new Error(`This token supports ${decimals} decimal places`)
  }
  const units = BigInt(`${integer}${fraction.padEnd(decimals, '0')}`)
  if (units <= 0n) throw new Error('Amount must be greater than zero')
  return units
}

export function resolveMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const url = value.trim()
  if (!url) return null
  if (url.startsWith('ipfs://')) {
    return `https://ipfs.io/ipfs/${url.slice(7).replace(/^ipfs\//, '')}`
  }
  if (url.startsWith('walrus://')) {
    return `https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${url.slice(9)}`
  }
  if (/^https?:\/\//i.test(url) || url.startsWith('data:image/')) return url
  return null
}

export function messageFromError(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Something went wrong'
}
