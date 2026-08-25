import "server-only";
import { whatsappCloud } from "./providers/whatsappCloud";
import type { NotifyProvider } from "./types";

const PROVIDERS: NotifyProvider[] = [whatsappCloud];

/** The configured provider, or null when none is set up.
 *
 * null is a supported, expected state -- not a misconfiguration. With no
 * provider the store still queues every notification and shows the admin a
 * one-tap WhatsApp link per message, which costs nothing and needs no Meta
 * business account. Adding credentials later turns the same queue automatic
 * without touching a single call site. */
export function activeProvider(): NotifyProvider | null {
  return PROVIDERS.find((p) => p.isConfigured()) || null;
}

export function notificationsAutomatic(): boolean {
  return activeProvider() !== null;
}
