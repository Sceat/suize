// =============================================================================
// The real shape the front-page gallery renders. Today it is fed by typed
// placeholder rows (src/data.ts); T-005b swaps that source for live chain reads
// (facilitator /supported + on-chain SiteCreated events) with NO change here.
// =============================================================================

export type Privacy = 'public' | 'unlisted' | 'private'

/** A preview archetype — the faux-page composition shown in the card thumbnail.
 * T-005b derives this from the manifest's entry doc; today it is authored. */
export type Preview = 'folio' | 'docs' | 'status' | 'landing' | 'deck' | 'locked'

export interface DeploySite {
  /** On-chain Site object id (0x…). */
  siteId: string
  /** Display title. */
  name: string
  /** The served host, e.g. `ambswap.suize.site` (or a phrase for private sites). */
  host: string
  /** Full served URL. */
  url: string
  /** Total pressed size, bytes. */
  sizeBytes: number
  /** Absolute Walrus epoch the storage lease ends at; `null` = permanent (funded
   * pool, never expires). `epochsRemaining()` derives the live countdown. */
  expiresAtEpoch: number | null
  /** Settlement tx digest (0x…); `null` when no public receipt is shown. */
  receiptDigest: string | null
  privacy: Privacy

  // --- presentation (editorial framing; T-005b derives from manifest/events) ---
  /** Dateline kicker — Featured / Docs / Terminal / Status / Portfolio / … */
  category: string
  /** Relative press time, e.g. `2h ago`. */
  pressedAgo: string
  /** Pressed by an agent over the 402 rail (vs. a human via the wallet door). */
  viaAgent: boolean
  preview: Preview
  /** The span-2 lead story on the front page. */
  lead?: boolean
  /** Lead-only editorial subhead. */
  sub?: string
}
