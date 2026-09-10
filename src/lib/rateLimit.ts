import "server-only";

/* Throttling, in two layers.
 *
 * WHAT WAS WRONG WITH ONE. The counter below is a Map inside one serverless
 * instance. On Vercel, concurrent requests land on different instances and
 * the attacker picks the concurrency -- so every limit in the application
 * was advisory, including the one in front of the admin password and the
 * one in front of getOrdersByPhone, which returns a customer's name and
 * order history for a phone number and nothing else.
 *
 * SO THERE ARE NOW TWO. The in-memory window still runs first, because it
 * is free and it stops an obvious flood before it reaches the database.
 * Whatever it lets through is then counted in Postgres, where every
 * instance is counting into the same row (supabase/rate-limits.sql).
 *
 * AND IT FAILS OPEN, deliberately. If the database cannot be reached the
 * shared count is skipped and the local answer stands. Failing closed would
 * mean a transient database blip stops people ordering -- turning a
 * security control into an outage -- and the fallback is not "no limit",
 * it is exactly the limit this file has enforced since it was written.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 5_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** The in-process window. Exported because it is the fallback, the local
 * gate, and the thing the unit tests can exercise without a database. */
export function rateLimitLocal(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  // Opportunistic sweep — this map must never grow without bound.
  if (buckets.size > MAX_TRACKED_KEYS) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    if (buckets.size > MAX_TRACKED_KEYS) buckets.clear();
  }

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

/** The real one: local first, then shared.
 *
 * Async now, which every call site already was -- they all `await
 * callerKey()` on the same line. */
export async function rateLimit(
  key: string, limit: number, windowSeconds: number
): Promise<RateLimitResult> {
  // Free, and it never has to be reached over a network. An instance that
  // has already seen more than the limit by itself is over it globally too,
  // so there is nothing to ask.
  const local = rateLimitLocal(key, limit, windowSeconds);
  if (!local.allowed) return local;

  try {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    const { data, error } = await supabaseAdmin().rpc("hit_rate_limit", {
      p_key: key, p_limit: limit, p_window_seconds: windowSeconds,
    });
    // No such function yet -- supabase/rate-limits.sql has not been run --
    // or the row came back in a shape this does not recognise. Either way
    // the local answer is what this file has always returned.
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row || typeof row.allowed !== "boolean") return local;
    return {
      allowed: row.allowed,
      remaining: Number(row.remaining) || 0,
      retryAfterSeconds: Number(row.retry_after) || 0,
    };
  } catch {
    return local;
  }
}

/** Best-effort caller identity for rate-limit keys. Behind Vercel,
 * x-forwarded-for is set by the platform and its FIRST entry is the real
 * client; later entries are attacker-controllable, so never read those. */
export async function callerKey(prefix: string): Promise<string> {
  const { headers } = await import("next/headers");
  const h = await headers();
  const fwd = h.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  return `${prefix}:${ip}`;
}
