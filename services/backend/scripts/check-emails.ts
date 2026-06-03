import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const LIMIT = Number(process.env.CHECK_EMAILS_LIMIT ?? "10");

const redis = new Redis(REDIS_URL, {
  lazyConnect: false,
  maxRetriesPerRequest: 1,
  connectTimeout: 5000,
});

redis.on("error", (err) => {
  console.error(`\n  cannot reach ${REDIS_URL}\n  ${err.message}`);
  console.error("\n  hint: bring Tailscale up — the cluster service is only reachable on the tailnet.\n");
  process.exit(1);
});

const fmtTs = (ms: number) =>
  new Date(ms).toISOString().replace("T", " ").slice(0, 19);

try {
  const total = await redis.zcard("waitlist:_index");
  console.log(`\nWaitlist signups: ${total}\n`);

  if (total === 0) {
    console.log("(no entries yet)\n");
    process.exit(0);
  }

  const rows = await redis.zrevrange("waitlist:_index", 0, LIMIT - 1, "WITHSCORES");
  const emails: string[] = [];
  const timestamps: number[] = [];
  for (let i = 0; i < rows.length; i += 2) {
    emails.push(rows[i]!);
    timestamps.push(Number(rows[i + 1]));
  }

  const payloads = emails.length
    ? await redis.mget(...emails.map((e) => `waitlist:${e}`))
    : [];

  const shown = Math.min(total, LIMIT);
  const pad = Math.max(...emails.map((e) => e.length));

  console.log(`Latest ${shown}:\n`);
  for (let i = 0; i < emails.length; i++) {
    let intent = "";
    try { intent = String(JSON.parse(payloads[i] ?? "{}").intent ?? "").slice(0, 80); } catch {}
    const tail = intent ? `  — ${intent}` : "";
    console.log(`  ${fmtTs(timestamps[i]!)}  ${emails[i]!.padEnd(pad)}${tail}`);
  }
  console.log();
} finally {
  await redis.quit();
}
