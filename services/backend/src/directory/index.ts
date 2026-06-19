// Directory module — the backend half of `agents.suize.io`: a PUBLIC, MERCHANT-
// AGNOSTIC directory of live on-chain Suize x402 payments. Everything is read LIVE
// from chain (read-through cached); we store NO payment state (the chain is the
// database). The single `queryTransactionBlocks({ ToAddress: treasury })` enumerates
// every x402 payment that CREDITS THE TREASURY (every fee-bearing / registered-
// merchant payment); free-tier single-output payments have no treasury anchor and
// are intentionally absent. So the directory needs ZERO per-merchant config.
//
//   GET  /feed?limit=N         → recent payments (read-through ~8s)
//   GET  /rankings?limit=N      → merchants by volume (deeper scan, ~30s)
//   GET  /stats                 → { visitorsToday }
//   POST /stats/visit           → bump the UTC-day visitor counter
//   GET  /ads/slots             → all ad slots (price/holder/creative + minNextBid)
//   GET  /ads/slots/:key        → one slot + a bid descriptor (402 when ?x402=1 + JSON Accept)
//   GET  /directory.json        → { merchants, slots, feed } (the agent catalog)
//   GET  /directory.okf         → a minimal OKF markdown bundle (the "we speak OKF" flag)
//
// Style mirrors the facilitator/mcp/deploy modules: a route matcher (first non-null
// wins), the shared json() helper, the `config` object for network. Reads are public,
// so the caches are the only abuse guard (bounded, short-TTL); no per-IP limiter.
import type { Server } from "bun";
import {
  PACKAGE_IDS,
  AD_SLOT_DEFS,
  DIRECTORY_PAYTO,
  USDC_TYPES,
  caip2,
  type SuiNetwork,
} from "@suize/shared";
import { config } from "../config";
import { json, text, corsHeaders } from "../http";
import {
  treasuryAddress,
  readPayments,
  resolveHandles,
  resolveProfiles,
  type DirectoryPayment,
  type ProfileView,
} from "./chain";
import { readSlots, cheapestSlotKey, type DirectorySlot } from "./slots";

const ASSET = USDC_TYPES[config.suiNetwork as SuiNetwork];
const NETWORK = caip2(config.suiNetwork);

const err = (error: string, status: number, origin: string | null): Response =>
  json({ error }, status, origin);

// ---------------------------------------------------------------------------
// Read-through caches — bounded, short-TTL. Public data; the cache is the only
// load guard (a burst of feed hits collapses onto ONE chain scan per TTL window).
// ---------------------------------------------------------------------------

const FEED_TTL_MS = 8_000;
const RANKINGS_TTL_MS = 30_000;
const SLOTS_TTL_MS = 8_000;

type Cached<T> = { at: number; value: T };

// On a load FAILURE we briefly remember the error (a SHORT negative cache) so an RPC
// outage doesn't make every request re-run the full chain scan with no backoff —
// requests within the window rethrow the SAME error fast (preserving its type, so a
// TreasuryUnresolved still 503s via the handlers).
const NEG_CACHE_MS = 2_500;

/** Single-flight read-through: concurrent callers within the TTL share ONE chain
 * read (and ONE in-flight promise), so a feed burst never fans out to N RPC calls.
 * A failed load is negative-cached for NEG_CACHE_MS (fast rethrow, no re-scan). */
const readThrough = <T>(ttlMs: number, load: () => Promise<T>) => {
  let cache: Cached<T> | null = null;
  let failure: { at: number; error: unknown } | null = null;
  let inflight: Promise<T> | null = null;
  return async (): Promise<T> => {
    if (cache && Date.now() - cache.at < ttlMs) return cache.value;
    if (failure && Date.now() - failure.at < NEG_CACHE_MS) throw failure.error;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const value = await load();
        cache = { at: Date.now(), value };
        failure = null;
        return value;
      } catch (e) {
        failure = { at: Date.now(), error: e };
        throw e;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
};

// ── /feed payload — recent payments enriched with handles ─────────────────────────
export type FeedEntry = {
  digest: string;
  payer: string;
  payerHandle: string | null;
  merchant: string;
  merchantHandle: string | null;
  gross: string;
  fee: string;
  feeBps: number;
  timestampMs: number;
};

const MAX_FEED = 200;
const DEFAULT_FEED = 50;
const DEFAULT_RANKINGS = 20;

/** Enrich raw payments with reverse-resolved handles (cached, resilient). */
const enrich = async (payments: DirectoryPayment[]): Promise<FeedEntry[]> => {
  const handles = await resolveHandles(
    payments.flatMap((p) => [p.payer, p.merchant]),
  );
  return payments.map((p) => ({
    digest: p.digest,
    payer: p.payer,
    payerHandle: handles.get(p.payer.toLowerCase()) ?? null,
    merchant: p.merchant,
    merchantHandle: handles.get(p.merchant.toLowerCase()) ?? null,
    gross: p.gross,
    fee: p.fee,
    feeBps: p.feeBps,
    timestampMs: p.timestampMs,
  }));
};

// The feed caches the DEEPEST page we ever serve (MAX_FEED), and each request slices
// its own `limit` off the front — one chain scan covers every limit in the window.
// EXCLUDE first-party rows (merchant == treasury: a deploy charge / a self-pay attributes
// merchant = treasury in parsePayment). The feed shows AGENT→MERCHANT payments only —
// the treasury is NEVER a displayed party (no "→ sceat@suize" rows), exactly like
// /rankings excludes it. On a sparse testnet this can empty the feed; that is honest.
const loadFeed = readThrough(FEED_TTL_MS, async (): Promise<FeedEntry[]> => {
  const treasury = await treasuryAddress();
  if (!treasury) throw new TreasuryUnresolved();
  const payments = await readPayments(treasury, MAX_FEED, MAX_FEED * 3);
  const treasuryKey = treasury.toLowerCase();
  const thirdParty = payments.filter((p) => p.merchant.toLowerCase() !== treasuryKey);
  // Newest-first is the scan's natural order (descending paging); re-assert it explicitly
  // so the feed survives an RPC quirk or any future phase-2 parallelization reorder.
  return (await enrich(thirdParty)).sort((a, b) => b.timestampMs - a.timestampMs);
});

// ── /rankings payload — merchants aggregated by volume ────────────────────────────
export type RankingEntry = {
  merchant: string;
  handle: string | null;
  /** total gross volume (atomic USDC string). */
  volume: string;
  count: number;
  /** The merchant's resolved BusinessProfile (directory shows name + logo). Null if none. */
  profile: ProfileView | null;
};

// Aggregate a DEEPER scan (up to ~400 qualifying txs) into per-merchant volume+count,
// sorted by volume desc. Cached ~30s — a heavier read than the feed.
const RANKINGS_SCAN = 400;
const loadRankings = readThrough(RANKINGS_TTL_MS, async (): Promise<RankingEntry[]> => {
  const treasury = await treasuryAddress();
  if (!treasury) throw new TreasuryUnresolved();
  const payments = await readPayments(treasury, RANKINGS_SCAN, RANKINGS_SCAN * 3);

  // EXCLUDE first-party Suize revenue: a deploy charge (full amount → treasury, no
  // positive non-treasury leg) attributes merchant = treasury in parsePayment. That's
  // fine for /feed, but the treasury is NOT a third-party merchant to advertise — it
  // must not rank, populate directory.json's `merchants`, or seed the OKF "Pay <x>"
  // bundle (all three read from here). The /feed keeps showing them, by design.
  const treasuryKey = treasury.toLowerCase();
  const agg = new Map<string, { volume: bigint; count: number }>();
  for (const p of payments) {
    const key = p.merchant.toLowerCase();
    if (key === treasuryKey) continue;
    const cur = agg.get(key) ?? { volume: 0n, count: 0 };
    cur.volume += BigInt(p.gross);
    cur.count += 1;
    agg.set(key, cur);
  }
  const handles = await resolveHandles(agg.keys());
  const profiles = await resolveProfiles(agg.keys());
  return [...agg.entries()]
    .map(([merchant, v]) => ({
      merchant,
      handle: handles.get(merchant) ?? null,
      volume: v.volume.toString(),
      count: v.count,
      profile: profiles.get(merchant) ?? null,
    }))
    .sort((a, b) => (BigInt(b.volume) > BigInt(a.volume) ? 1 : BigInt(b.volume) < BigInt(a.volume) ? -1 : 0));
});

// ── /ads/slots payload ────────────────────────────────────────────────────────────
export type SlotsPayload = { slots: DirectorySlot[]; cheapest: string };

const loadSlots = readThrough(SLOTS_TTL_MS, async (): Promise<SlotsPayload> => {
  const slots = await readSlots();
  return { slots, cheapest: cheapestSlotKey(slots) };
});

/** A sentinel: the treasury can't resolve → the directory is fail-closed (503). */
class TreasuryUnresolved extends Error {
  constructor() {
    super("treasury@suize unresolved — directory unavailable");
    this.name = "TreasuryUnresolved";
  }
}

// ---------------------------------------------------------------------------
// Visitor counter — an in-memory, UTC-day counter (resets at UTC midnight). NO DB,
// NO persistence (a restart resets it — acceptable for a vanity metric). A plain
// module-level map keyed by the UTC date string, pruned to the current day.
// ---------------------------------------------------------------------------

const utcDay = (): string => new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const visitors = new Map<string, number>();

const bumpVisitor = (): number => {
  const day = utcDay();
  const next = (visitors.get(day) ?? 0) + 1;
  visitors.set(day, next);
  // Prune stale days so the map never grows unbounded (keep only today).
  for (const k of visitors.keys()) if (k !== day) visitors.delete(k);
  return next;
};

const visitorsToday = (): number => visitors.get(utcDay()) ?? 0;

// ---------------------------------------------------------------------------
// Route handlers.
// ---------------------------------------------------------------------------

const clampLimit = (raw: string | null, def: number, max: number): number => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
};

const handleFeed = async (url: URL, origin: string | null): Promise<Response> => {
  const limit = clampLimit(url.searchParams.get("limit"), DEFAULT_FEED, MAX_FEED);
  try {
    const all = await loadFeed();
    return json({ payments: all.slice(0, limit) }, 200, origin);
  } catch (e) {
    if (e instanceof TreasuryUnresolved) return err(e.message, 503, origin);
    console.error("[directory/feed]", (e as Error).message);
    return err("feed unavailable: chain unreadable", 502, origin);
  }
};

const handleRankings = async (url: URL, origin: string | null): Promise<Response> => {
  const limit = clampLimit(url.searchParams.get("limit"), DEFAULT_RANKINGS, 200);
  try {
    const all = await loadRankings();
    return json({ merchants: all.slice(0, limit) }, 200, origin);
  } catch (e) {
    if (e instanceof TreasuryUnresolved) return err(e.message, 503, origin);
    console.error("[directory/rankings]", (e as Error).message);
    return err("rankings unavailable: chain unreadable", 502, origin);
  }
};

const handleStats = (origin: string | null): Response =>
  json({ visitorsToday: visitorsToday() }, 200, origin);

const handleVisit = (origin: string | null): Response =>
  json({ visitorsToday: bumpVisitor() }, 200, origin);

const handleSlots = async (origin: string | null): Promise<Response> => {
  try {
    const payload = await loadSlots();
    return json(payload, 200, origin);
  } catch (e) {
    console.error("[directory/slots]", (e as Error).message);
    return err("slots unavailable: chain unreadable", 502, origin);
  }
};

/** The bid descriptor a client (human or agent) needs to build the `auction::bid`
 * move call against a slot — the on-chain ids + the coin + the next-bid floor. */
const bidDescriptor = (slot: DirectorySlot) => ({
  // bid<T>(version, slot, config, payment, clock, ctx) — the version gate is the first arg.
  target: PACKAGE_IDS.AUCTION.TARGETS.BID,
  versionObject: PACKAGE_IDS.AUCTION.VERSION_OBJECT,
  configObject: PACKAGE_IDS.AUCTION.CONFIG_OBJECT,
  slotObject: slot.slotId,
  coinType: ASSET,
  minNextBid: slot.minNextBid,
});

const handleSlotByKey = async (
  req: Request,
  reqUrl: URL,
  key: string,
  origin: string | null,
): Promise<Response> => {
  // Validate the key against the known defs (404 on an unknown key).
  if (!AD_SLOT_DEFS.some((d) => d.key === key)) {
    return err("unknown slot", 404, origin);
  }
  let slot: DirectorySlot | undefined;
  try {
    const payload = await loadSlots();
    slot = payload.slots.find((s) => s.key === key);
  } catch (e) {
    console.error("[directory/slot]", (e as Error).message);
    return err("slot unavailable: chain unreadable", 502, origin);
  }
  if (!slot) return err("unknown slot", 404, origin);

  const bid = bidDescriptor(slot);

  // The AGENT-DISCOVERABLE x402 challenge: a JSON-Accept client asking `?x402=1`
  // gets a 402 with the bid framed as a PaymentRequirements `accepts` entry (the
  // payTo is the directory's own payout address; the actual bid is an
  // `auction::bid` moveCall, noted in `extra`). Humans / non-x402 clients get a 200.
  const accept = req.headers.get("accept") ?? "";
  const wantsX402 =
    reqUrl.searchParams.get("x402") === "1" && accept.includes("application/json");
  if (wantsX402) {
    return json(
      {
        x402Version: 2,
        accepts: [
          {
            scheme: "exact",
            network: NETWORK,
            amount: slot.minNextBid,
            asset: ASSET,
            payTo: DIRECTORY_PAYTO,
            maxTimeoutSeconds: 120,
            // DISCOVERY HINT, not a /settle-able exact challenge: the bid settles via an
            // `auction::bid` moveCall (see `bid` below), NOT a vanilla send_funds, and this
            // entry carries no `extra.outputs` fee split. Build the bid from the descriptor.
            extra: { note: "bid via auction::bid moveCall — see the `bid` descriptor; not a /settle exact" },
          },
        ],
        slot,
        bid,
      },
      402,
      origin,
    );
  }

  return json({ slot, bid }, 200, origin);
};

const handleDirectoryJson = async (origin: string | null): Promise<Response> => {
  try {
    const [feed, rankings, slots] = await Promise.all([
      loadFeed(),
      loadRankings(),
      loadSlots(),
    ]);
    return json(
      {
        merchants: rankings,
        slots,
        feed: feed.slice(0, 20),
      },
      200,
      origin,
    );
  } catch (e) {
    if (e instanceof TreasuryUnresolved) return err(e.message, 503, origin);
    console.error("[directory/json]", (e as Error).message);
    return err("directory unavailable: chain unreadable", 502, origin);
  }
};

/** Short hex form for a label when an address has no handle (0x1234…cdef). */
const shortAddr = (addr: string): string =>
  addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;

/**
 * A minimal OKF (Open Knowledge Format) bundle as markdown — ONE index doc that
 * lists each merchant as a section with YAML-ish frontmatter. This plants the "we
 * speak Google's OKF" flag; it is deliberately simple (a generated string), not a
 * full OKF spec implementation.
 */
const handleDirectoryOkf = async (origin: string | null): Promise<Response> => {
  let rankings: RankingEntry[];
  try {
    rankings = await loadRankings();
  } catch (e) {
    if (e instanceof TreasuryUnresolved) return text(e.message, 503, origin);
    console.error("[directory/okf]", (e as Error).message);
    return text("directory unavailable: chain unreadable", 502, origin);
  }

  const lines: string[] = [
    "# Suize Agent Commerce Directory",
    "",
    "A merchant-agnostic directory of live on-chain Suize x402 payments, read live from Sui.",
    "Each merchant below accepts USDC payments from any agent on the Suize rail.",
    "",
  ];
  for (const m of rankings) {
    const title = m.handle ?? shortAddr(m.merchant);
    lines.push(
      "---",
      "type: Suize Merchant",
      `title: ${title}`,
      `payTo: ${m.merchant}`,
      `tags: [suize, x402, agent-commerce, sui]`,
      `volume: ${m.volume}`,
      "---",
      `## ${title}`,
      `Pay ${title} in USDC via the Suize x402 rail. Address: ${m.merchant}.`,
      "",
    );
  }
  // OKF is markdown — serve it as text/markdown (the shared text() helper is
  // text/plain), with the same CORS policy as the rest of the backend.
  return new Response(lines.join("\n"), {
    status: 200,
    headers: { "Content-Type": "text/markdown; charset=utf-8", ...corsHeaders(origin) },
  });
};

// ---------------------------------------------------------------------------
// Route matcher — same shape as the facilitator/mcp/deploy modules. First
// non-null wins; non-directory paths return null so the chain continues.
// ---------------------------------------------------------------------------

const SLOT_KEY_RE = /^\/ads\/slots\/([A-Za-z0-9-]{1,40})$/;

export const handleDirectoryRoute = (
  req: Request,
  reqUrl: URL,
  origin: string | null,
  _server?: Server<unknown>,
): Promise<Response> | Response | null => {
  const { pathname } = reqUrl;
  if (req.method === "GET" && pathname === "/feed") return handleFeed(reqUrl, origin);
  if (req.method === "GET" && pathname === "/rankings") return handleRankings(reqUrl, origin);
  if (req.method === "GET" && pathname === "/stats") return handleStats(origin);
  if (req.method === "POST" && pathname === "/stats/visit") return handleVisit(origin);
  if (req.method === "GET" && pathname === "/ads/slots") return handleSlots(origin);
  if (req.method === "GET") {
    const m = SLOT_KEY_RE.exec(pathname);
    if (m) return handleSlotByKey(req, reqUrl, m[1], origin);
  }
  if (req.method === "GET" && pathname === "/directory.json") return handleDirectoryJson(origin);
  if (req.method === "GET" && pathname === "/directory.okf") return handleDirectoryOkf(origin);
  return null;
};

/** Boot-log surface (mirrors facilitatorInfo / mcpInfo). */
export const directoryInfo = {
  network: NETWORK,
  routes: [
    "GET /feed",
    "GET /rankings",
    "GET /stats",
    "POST /stats/visit",
    "GET /ads/slots",
    "GET /ads/slots/:key",
    "GET /directory.json",
    "GET /directory.okf",
  ],
  slotCount: AD_SLOT_DEFS.length,
  auctionPublished: PACKAGE_IDS.AUCTION.PACKAGE !== "0x0",
} as const;
