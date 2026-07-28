// =============================================================================
// The real shape the front-page index renders, fed by live chain reads
// (src/live.ts → on-chain SiteCreated events). Pure data: the front page is a
// text index, so there are no presentation archetypes or embedded previews.
// =============================================================================

export type Privacy = 'public' | 'unlisted' | 'private'

export interface DeploySite {
  /** On-chain Site object id (0x…). */
  siteId: string
  /** Display title. */
  name: string
  /** The served host, e.g. `ambswap.suize.site` (or a phrase for private sites). */
  host: string
  /** Full served URL. */
  url: string
  /** Wall-clock ms the storage lease is paid through, read from the LIVE Site
   * object (so extends are reflected, unlike the create event); `null` =
   * permanent (funded pool, never expires). `timeLeft()` derives the countdown. */
  paidUntilMs: number | null
  /** Settlement tx digest (0x…); `null` when no public receipt is shown. */
  receiptDigest: string | null
  privacy: Privacy
  /** Relative press time, e.g. `2h ago`. */
  pressedAgo: string
}
