import "server-only";

/** One funnel for server-side errors worth knowing about.
 *
 * Right now this writes structured JSON to stdout, which on Vercel means it
 * lands in the runtime logs and is searchable. That is deliberately modest:
 * the point is that every call site is already in place, so wiring a real
 * service (Sentry, Axiom, Betterstack) later is an edit to THIS function
 * rather than a hunt through the codebase for places that should have been
 * reporting.
 *
 * Until something like that is wired up, a production bug on this store is
 * invisible until a customer complains -- which for a payment failure means
 * you find out from the person whose money is missing.
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
}

/** Notable-but-not-broken events: a rejected webhook signature, an amount
 * mismatch, a rate limit tripping. These are the early warning that
 * something is being probed. */
export function reportWarning(message: string, context: ErrorContext): void {
  console.warn(JSON.stringify({ level: "warn", at: new Date().toISOString(), message, ...(redact(context) as Record<string, unknown>) }));
}
