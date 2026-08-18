import "server-only";

/** Minimal in-process fixed-window rate limiter.
 *
 * Scope and honesty about it: this counts attempts per serverless instance,
 * not globally. On Vercel that means a determined attacker spread across
 * many cold starts sees a higher effective ceiling than the number below.
 * It is still the difference between "guess ADMIN_PASSWORD at request rate"
 * and "guess it slowly" — and it costs no extra infrastructure. If this
 * store ever holds real money, move the counter into Postgres or Upstash;
 * the call sites won't change.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 5_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
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
