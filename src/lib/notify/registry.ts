import "server-only";
import { httpSms } from "./providers/httpSms";
import { twilioSms } from "./providers/twilio";
import type { NotifyProvider } from "./types";

/** Order matters: a store that has configured a local gateway wants it used,
 * even if Twilio credentials are also lying around from an earlier trial. A
 * local +670 route is normally both cheaper and better delivered. */
const PROVIDERS: NotifyProvider[] = [httpSms, twilioSms];

/** The configured provider, or null when none is set up.
 *
 * null is a supported, expected state -- not a misconfiguration. With no
 * provider the store still queues every message and shows the admin a one-tap
 * link that opens their own phone's SMS app with the number and text already
 * filled in. That needs no account anywhere and costs whatever their own SIM
 * charges. Adding gateway credentials later turns the same queue automatic
 * without touching a single call site. */
export function activeProvider(): NotifyProvider | null {
  return PROVIDERS.find((p) => p.isConfigured()) || null;
}

export function notificationsAutomatic(): boolean {
  return activeProvider() !== null;
}
