import "server-only";
import { reportError } from "@/lib/observability";
import type { NotifyProvider, SendResult } from "../types";

/* ---------------------------------------------------------------------------
 * A generic HTTP SMS gateway, configured entirely by environment variable.
 *
 * This exists because of where the store is. Almost every Timorese mobile
 * operator and regional bulk-SMS reseller offers a plain HTTP endpoint --
 * "GET this URL with the number and the text" -- and for +670 those routes
 * are usually cheaper and better delivered than an international carrier.
 * They also differ from each other in every detail, and none of them is
 * worth its own adapter.
 *
 * So the shape of the request is data, not code:
 *
 *   SMS_HTTP_URL       https://gateway.example.tl/send?user=me&pass=x
 *                      &to={to}&text={text}
 *   SMS_HTTP_METHOD    GET (default) or POST
 *   SMS_HTTP_BODY      for POST: the body template, e.g.
 *                      {"to":"{to}","message":"{text}"}
 *   SMS_HTTP_CONTENT_TYPE   for POST, default application/json
 *   SMS_HTTP_AUTH_HEADER    optional, e.g. "Bearer abc123"
 *   SMS_HTTP_SUCCESS_TEXT   optional: a string the response must contain for
 *                           the send to count as successful
 *
 * {to} and {text} are substituted, URL-encoded in the URL and JSON-escaped in
 * a JSON body. {to_digits} is the number without its leading "+", which some
 * gateways insist on.
 *
 * The credentials live in the URL because that is how these gateways
 * authenticate. That makes SMS_HTTP_URL a secret: it belongs in the
 * environment, never in the repository, and it is never written to a
 * notification row or a log line.
 * ------------------------------------------------------------------------ */

const TIMEOUT_MS = 15_000;

function env() {
  return {
    url: process.env.SMS_HTTP_URL || "",
    method: (process.env.SMS_HTTP_METHOD || "GET").toUpperCase(),
    bodyTemplate: process.env.SMS_HTTP_BODY || "",
    contentType: process.env.SMS_HTTP_CONTENT_TYPE || "application/json",
    authHeader: process.env.SMS_HTTP_AUTH_HEADER || "",
    successText: process.env.SMS_HTTP_SUCCESS_TEXT || "",
  };
}

/** JSON string escaping without the surrounding quotes -- the template
 * already supplies those, and a raw quote or newline in a message would
 * otherwise produce a malformed body the gateway rejects with a parse error
 * nobody can trace back to an apostrophe in "ita-nia". */
function jsonEscape(s: string): string {
  return JSON.stringify(s).slice(1, -1);
}

function fill(template: string, to: string, text: string, escape: (s: string) => string): string {
  return template
    .replace(/\{to_digits\}/g, escape(to.replace(/[^\d]/g, "")))
    .replace(/\{to\}/g, escape(to))
    .replace(/\{text\}/g, escape(text));
}

export const httpSms: NotifyProvider = {
  id: "http_sms",
  channel: "sms",

  isConfigured() {
    return Boolean(env().url);
  },

  async send(toPhone: string, body: string): Promise<SendResult> {
    const { url, method, bodyTemplate, contentType, authHeader, successText } = env();
    if (!url) return { ok: false, error: "SMS_HTTP_URL is not set" };

    const isPost = method === "POST";
    const requestUrl = fill(url, toPhone, body, encodeURIComponent);

    const headers: Record<string, string> = {};
    if (authHeader) headers.Authorization = authHeader;
    if (isPost) headers["Content-Type"] = contentType;

    const requestBody = isPost
      ? fill(
          bodyTemplate || '{"to":"{to}","text":"{text}"}',
          toPhone,
          body,
          contentType.includes("json") ? jsonEscape : encodeURIComponent
        )
      : undefined;

    try {
      const res = await fetch(requestUrl, {
        method: isPost ? "POST" : "GET",
        headers,
        body: requestBody,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const text = await res.text();

      if (!res.ok) {
        // The URL is not echoed into the error: it carries the gateway
        // password, and this string is stored on the notification row and
        // shown in the admin UI.
        return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 500)}` };
      }

      // Plenty of these gateways answer 200 with a body that says "ERROR:
      // insufficient balance". SMS_HTTP_SUCCESS_TEXT is how a store says
      // what its own gateway's success actually looks like.
      if (successText && !text.includes(successText)) {
        return { ok: false, error: `Gateway did not confirm delivery: ${text.slice(0, 500)}` };
      }

      return { ok: true, providerRef: text.trim().slice(0, 120) || undefined };
    } catch (err) {
      reportError(err, { scope: "httpSms.send" });
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
