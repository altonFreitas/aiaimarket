import "server-only";

/** One funnel for server-side errors worth knowing about.
 *
 * TWO DESTINATIONS, and the second one is the point. Structured JSON still
 * goes to stdout, which on Vercel lands in the runtime logs and is
 * searchable. But logs are a place you go and look, and nobody looks --
 * so a production bug was invisible until a customer complained, which for
 * a payment failure means finding out from the person whose money is
 * missing.
 *
 * ERROR_WEBHOOK_URL sends it somewhere a person already reads: a Slack or
 * Discord incoming webhook, the same shape the payment reconciliation cron
 * already uses. No new vendor, no SDK to keep patched, no client bundle
 * cost. Set it and errors arrive; leave it unset and this behaves exactly
 * as it did.
 *
 * It is DELIBERATELY not Sentry. Sentry is better at this and should
 * replace it the day someone is willing to own an account -- and when they
 * are, it is still an edit to this one function, which was always the
 * reason for the indirection.
 */

export interface ErrorContext {
  scope: string;
  [key: string]: unknown;
}

/** Keys whose values must never reach a log line. Payment and auth code
 * paths pass whole objects around; this is the backstop that stops a
 * secret riding along into log storage. */
const REDACT = /^(password|pass|secret|token|apiPassword|authorization|cookie|totp_secret|card|pan|cvv|cvc)$/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[deep]";
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

export function reportError(err: unknown, context: ErrorContext): void {
  const payload = {
    level: "error",
    at: new Date().toISOString(),
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack?.split("\n").slice(0, 8).join("\n") : undefined,
    ...(redact(context) as Record<string, unknown>),
  };
  // Single-line JSON: greppable, and parsed as structured data by every log
  // platform worth using.
  console.error(JSON.stringify(payload));
  void alertSomebody("error", payload);
}

/** Notable-but-not-broken events: a rejected webhook signature, an amount
 * mismatch, a rate limit tripping. These are the early warning that
 * something is being probed. */
export function reportWarning(message: string, context: ErrorContext): void {
  const payload = {
    level: "warn", at: new Date().toISOString(), message,
    ...(redact(context) as Record<string, unknown>),
  };
  console.warn(JSON.stringify(payload));
  // Warnings are the early sign of something being probed -- a rejected
  // webhook signature, an amount that does not match, a limit tripping --
  // so they go the same way. ALERT_WARNINGS=0 turns that half off for a
  // shop where they are too frequent to be read.
  if (process.env.ALERT_WARNINGS !== "0") void alertSomebody("warn", payload);
}

/** How many alerts may leave this instance per minute.
 *
 * A loop that reports on every iteration is exactly the failure worth being
 * told about, and exactly the one that would post a thousand messages into
 * a chat channel and get the webhook muted -- taking the alerting down at
 * the moment it was working. Per instance, like everything else that counts
 * in memory, and that is fine here: the goal is not an exact budget, it is
 * that one bad minute cannot cost the whole channel. */
const ALERT_BUDGET = 20;
let alertWindowStart = 0;
let alertsSent = 0;

/** Fire-and-forget, and it never throws.
 *
 * An error inside the error reporter must not become the error anybody
 * sees, and must never replace the original on its way up the stack --
 * which is why every caller does `void` and this catches everything. */
async function alertSomebody(level: "error" | "warn", payload: Record<string, unknown>) {
  const url = (process.env.ERROR_WEBHOOK_URL || "").trim();
  if (!url) return;

  const now = Date.now();
  if (now - alertWindowStart > 60_000) { alertWindowStart = now; alertsSent = 0; }
  if (++alertsSent > ALERT_BUDGET) return;

  const mark = level === "error" ? "\u26d4" : "\u26a0\ufe0f";
  const where = String(payload.scope || "unknown");
  const text = `${mark} ${String(payload.message || "")}\n`
    + "```" + JSON.stringify({ ...payload, stack: undefined }, null, 1).slice(0, 1500) + "```";

  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Slack and Discord both accept { content } or { text }; sending both
      // means one URL works for either without a second variable saying
      // which it is.
      body: JSON.stringify({ text: `[${where}] ${text}`, content: `[${where}] ${text}` }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Nothing to do and nowhere to say it. Reporting a failure to report
    // would be the same call again.
  }
}
