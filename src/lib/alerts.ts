import "server-only";
import { reportError } from "@/lib/observability";

/** Outbound alerting for things a human needs to know about now.
 *
 * Deliberately dependency-free: it POSTs a JSON message to whatever webhook
 * URL is configured, which covers Slack, Discord (append /slack to the
 * Discord webhook URL) and every log drain worth using. Adding Sentry or
 * similar later means editing this one function, not hunting for call
 * sites.
 *
 * The distinction from observability.ts is intent, not severity:
 * reportError() writes a record for someone reading logs afterwards; this
 * interrupts a person. Only things that genuinely need a human — money
 * stuck in an unknown state, a webhook being probed — should come through
 * here, or it becomes noise nobody reads.
 */

const WEBHOOK = process.env.ALERT_WEBHOOK_URL || "";

export function alertsConfigured(): boolean {
  return Boolean(WEBHOOK);
}

/**
 * Never throws and never blocks the caller's real work. An alert failing to
 * send must not be the reason a payment reconciliation run dies.
 */
export async function sendAlert(title: string, lines: string[]): Promise<void> {
  if (!WEBHOOK) return;

  const text = [`*${title}*`, ...lines].join("\n");
  try {
    await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `text` is the field Slack and Discord (via /slack) both read.
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    reportError(err, { scope: "sendAlert", title });
  }
}
