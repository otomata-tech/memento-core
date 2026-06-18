/**
 * Application-level rate limiting (issue #67, finding #2 security audit). Fixed-window
 * counter per (user, bucket), backed by Postgres (table `mem_rate_limits`, state
 * shared across the stateless Edge isolates). Targets the costly side-effecting
 * verbs: invitations (GoTrue emails), createOrg, global search.
 *
 * Application-level defense (per `sub` AND per verb); complementary to a possible
 * Cloudflare WAF by IP (see docs/deployment-edge.md). The limiter is NOT an
 * authorization barrier: it bounds throughput, not the right.
 */
import { sql } from "drizzle-orm";
import { db } from "./db.ts";

/** Throughput exceeded — mapped to 429 (REST) / agent message (MCP) at the boundaries. */
export class RateLimitError extends Error {}

/** Caps per bucket: { max calls, window in seconds }. */
export const LIMITS = {
  invite: { max: 20, windowSec: 3600 }, // invitation emails (grant + members)
  create_org: { max: 10, windowSec: 3600 },
  search_global: { max: 60, windowSec: 60 },
  // Public search: only AUTHENTICATED calls are counted (empty sub =
  // no-op, see assertWithinLimit); anonymous traffic is bounded by the Cloudflare/IP WAF.
  search_public: { max: 60, windowSec: 60 },
  // Public agent (chat mode of a public KB). Anonymous and costly surface (LLM):
  // throughput bounded PER IP (assertWithinLimitByKey, counted even without a sub) + a GLOBAL
  // daily TOKEN cap (recordUsage/currentUsage) that bounds the bill regardless
  // of the number of IPs. budget `max` = total_tokens/day (env AGENT_DAILY_TOKEN_BUDGET).
  agent_ip_min: { max: 8, windowSec: 60 },
  agent_ip_hour: { max: 40, windowSec: 3600 },
  agent_budget: { max: Number(Deno.env.get("AGENT_DAILY_TOKEN_BUDGET") ?? "2000000"), windowSec: 86400 },
} as const;

export type Bucket = keyof typeof LIMITS;

/**
 * Atomically increments the current window's counter by `by` and returns the
 * total. Window aligned on the server clock (Postgres now()) to avoid
 * clock-skew between isolates. `key` = counting identity (sub, IP, or global key).
 */
async function bumpWindow(key: string, bucket: Bucket, by: number): Promise<number> {
  const { windowSec } = LIMITS[bucket];
  const rows = await db.execute<{ count: number }>(sql`
    INSERT INTO mem_rate_limits (sub, bucket, window_start, count)
    VALUES (
      ${key}, ${bucket},
      to_timestamp(floor(extract(epoch from now()) / ${windowSec}) * ${windowSec}),
      ${by}
    )
    ON CONFLICT (sub, bucket, window_start)
    DO UPDATE SET count = mem_rate_limits.count + ${by}
    RETURNING count
  `);
  return Number(rows[0]?.count ?? 0);
}

function limitError(bucket: Bucket): RateLimitError {
  const { max, windowSec } = LIMITS[bucket];
  return new RateLimitError(
    `too many requests (${bucket}): maximum ${max} per ${Math.round(windowSec / 60) || 1} min — try again later`,
  );
}

/** Throughput per `sub` (user). Anonymous (empty sub) = no-op: already rejected by
 *  the upstream auth, or bounded by the WAF/IP. */
export async function assertWithinLimit(sub: string, bucket: Bucket): Promise<void> {
  if (!sub) return;
  if (await bumpWindow(sub, bucket, 1) > LIMITS[bucket].max) throw limitError(bucket);
}

/** Throughput per arbitrary NON-empty key (e.g. IP on an anonymous surface). Unlike
 *  assertWithinLimit, always counts — it's the anti-burst bound for anonymous traffic. */
export async function assertWithinLimitByKey(key: string, bucket: Bucket): Promise<void> {
  if (!key) return;
  if (await bumpWindow(key, bucket, 1) > LIMITS[bucket].max) throw limitError(bucket);
}

/** Current window total (without incrementing) — to check a cap before
 *  incurring a cost (e.g. daily token budget). */
export async function currentUsage(key: string, bucket: Bucket): Promise<number> {
  const { windowSec } = LIMITS[bucket];
  const rows = await db.execute<{ count: number }>(sql`
    SELECT count FROM mem_rate_limits
    WHERE sub = ${key} AND bucket = ${bucket}
      AND window_start = to_timestamp(floor(extract(epoch from now()) / ${windowSec}) * ${windowSec})
  `);
  return Number(rows[0]?.count ?? 0);
}

/** Adds measured consumption (e.g. LLM tokens) to the window counter. */
export async function recordUsage(key: string, bucket: Bucket, amount: number): Promise<void> {
  if (amount > 0) await bumpWindow(key, bucket, amount);
}
