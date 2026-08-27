import "server-only";
import { reportError } from "@/lib/observability";
import type { NotifyProvider, SendResult } from "../types";

/* ---------------------------------------------------------------------------
 * Twilio SMS.
 *
 * The obvious first choice: one account, global reach, and a REST API that
 * needs no SDK -- this adapter is a single form-encoded POST.
 *
 * Two things to check before committing to it for a Timor-Leste store:
 *
 *   * International SMS into +670 is billed per SEGMENT, and Tetun and
 *     Portuguese accents halve what fits in one (see lib/sms.ts). Price the
 *     real message, not a 160-character assumption.
 *   * A local carrier gateway (Telemor, Telkomcel, Timor Telecom) is usually
 *     cheaper and better-delivered for +670 than an international route.
 *     That is what the httpSms provider alongside this one exists for -- it
 *     takes a plain URL and needs no code change.
 * ------------------------------------------------------------------------ */

const TIMEOUT_MS = 15_000;

function env() {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID || "",
    authToken: process.env.TWILIO_AUTH_TOKEN || "",
    // Either a purchased number in +E.164, or a Messaging Service SID
    // (starts with MG) if you use one -- Twilio accepts either here.
    from: process.env.TWILIO_FROM || "",
  };
}

export const twilioSms: NotifyProvider = {
  id: "twilio",
  channel: "sms",

  isConfigured() {
    const { accountSid, authToken, from } = env();
    return Boolean(accountSid && authToken && from);
  },

  async send(toPhone: string, body: string): Promise<SendResult> {
    const { accountSid, authToken, from } = env();
    if (!accountSid || !authToken || !from) {
      return { ok: false, error: "Twilio is not configured" };
    }

    const form = new URLSearchParams({ To: toPhone, Body: body });
    // A Messaging Service is passed under a different key than a plain
    // number. Getting this wrong is a 400 with an unhelpful message.
    if (from.startsWith("MG")) form.set("MessagingServiceSid", from);
    else form.set("From", from);

    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }
      );

      const text = await res.text();
      if (!res.ok) {
        // Twilio's body names the actual problem -- an unreachable carrier,
        // an unverified number on a trial account, a bad From. Kept verbatim
        // on the notification row, because "failed" with no reason is a row
        // nobody can act on.
        return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 500)}` };
      }

      let providerRef: string | undefined;
      try {
        providerRef = (JSON.parse(text) as { sid?: string }).sid;
      } catch {
        // A 2xx we cannot parse still sent the message. Losing the sid is a
        // smaller problem than reporting a real send as a failure and having
        // someone send it a second time.
      }
      return { ok: true, providerRef };
    } catch (err) {
      reportError(err, { scope: "twilioSms.send" });
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
