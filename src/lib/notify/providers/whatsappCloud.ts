import "server-only";
import { reportError } from "@/lib/observability";
import type { NotifyProvider, SendResult } from "../types";

/* ---------------------------------------------------------------------------
 * WhatsApp Cloud API (Meta).
 *
 * Read this before switching it on -- the constraint below decides whether
 * this provider is useful to you at all:
 *
 *   WhatsApp does not let a business send free-form text to someone who has
 *   not messaged it in the last 24 hours. Outside that window only a
 *   PRE-APPROVED TEMPLATE may be sent. An order confirmation an hour after
 *   checkout is usually inside the window (the buyer messaged you to order);
 *   an "out for delivery" the next morning usually is not.
 *
 * So this adapter supports both shapes:
 *
 *   WHATSAPP_TEMPLATE_NAME unset  -> plain text. Free, no approval, but only
 *                                    lands inside the 24-hour window; outside
 *                                    it Meta returns an error, which is
 *                                    recorded on the notification row so the
 *                                    admin can send it by hand instead.
 *   WHATSAPP_TEMPLATE_NAME set    -> template message, one body parameter
 *                                    carrying the whole rendered text. Submit
 *                                    a template with a single {{1}} in its
 *                                    body to Meta for approval, then put its
 *                                    name here.
 *
 * Nothing here has been run against a live Meta business account -- it is
 * written from the Cloud API's documented request shape. Verify against your
 * own account before trusting it with real buyers.
 * ------------------------------------------------------------------------ */

const GRAPH_VERSION = "v21.0";
const TIMEOUT_MS = 10_000;

function env() {
  return {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    token: process.env.WHATSAPP_ACCESS_TOKEN || "",
    templateName: process.env.WHATSAPP_TEMPLATE_NAME || "",
    templateLang: process.env.WHATSAPP_TEMPLATE_LANG || "en",
  };
}

/** Meta wants digits only, country code included, no leading "+". */
function toE164Digits(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

export const whatsappCloud: NotifyProvider = {
  id: "whatsapp_cloud",
  channel: "whatsapp",

  isConfigured() {
    const { phoneNumberId, token } = env();
    return Boolean(phoneNumberId && token);
  },

  async send(toPhone: string, body: string): Promise<SendResult> {
    const { phoneNumberId, token, templateName, templateLang } = env();
    if (!phoneNumberId || !token) {
      return { ok: false, error: "WhatsApp Cloud API is not configured" };
    }

    const to = toE164Digits(toPhone);
    if (!to) return { ok: false, error: "Invalid destination number" };

    const payload = templateName
      ? {
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: templateName,
            language: { code: templateLang },
            components: [{ type: "body", parameters: [{ type: "text", text: body }] }],
          },
        }
      : {
          messaging_product: "whatsapp",
          to,
          type: "text",
          // Link previews off: the preview fetch adds latency and the buyer
          // does not need a thumbnail of their own order page.
          text: { preview_url: false, body },
        };

    try {
      const res = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }
      );

      const text = await res.text();
      if (!res.ok) {
        // Meta's error body carries the reason a message was refused -- the
        // 24-hour window, an unapproved template, a number not on WhatsApp.
        // It is kept verbatim on the notification row, because "failed" with
        // no reason is a row nobody can act on.
        return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 500)}` };
      }

      let providerRef: string | undefined;
      try {
        const json = JSON.parse(text) as { messages?: Array<{ id?: string }> };
        providerRef = json.messages?.[0]?.id;
      } catch {
        // A 2xx we cannot parse still sent the message. Losing the id is a
        // smaller problem than reporting a successful send as a failure and
        // having the admin send it a second time.
      }
      return { ok: true, providerRef };
    } catch (err) {
      reportError(err, { scope: "whatsappCloud.send" });
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
