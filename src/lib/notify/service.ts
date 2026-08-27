import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability";
import { trackingUrl } from "@/lib/trackToken";
import { money } from "@/lib/utils";
import { activeProvider } from "./registry";
import { renderNotification, type NotifyEvent } from "./templates";
import type { Lang } from "@/lib/types";

/* ---------------------------------------------------------------------------
 * Queue-then-send, in that order, always.
 *
 * The row is written before any network call. If the send fails -- no
 * provider configured, Meta's 24-hour window closed, the network down -- the
 * row survives as `queued` or `failed` and the admin can act on it. The
 * alternative, sending first and recording afterwards, loses exactly the
 * messages you most need to know about.
 *
 * Nothing in this file is allowed to throw at its caller. A notification is
 * never the reason an order fails to be confirmed.
 * ------------------------------------------------------------------------ */

interface NotifiableOrder {
  id: string;
  ref: string;
  buyer_name: string;
  buyer_phone: string;
  total: number | string;
  lang?: string | null;
}

function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
}

function asLang(v: string | null | undefined): Lang {
  return v === "pt" || v === "en" ? v : "tet";
}

/** Queues one notification and immediately tries to send it.
 *
 * Idempotent on (order_id, event) via the unique constraint in
 * supabase/notifications.sql: calling this twice for the same moment inserts
 * once and sends once, however many times a status is re-applied or a retry
 * runs. That guarantee lives in the database rather than in a check here,
 * because two concurrent requests would both pass a check.
 */
export async function notifyOrderEvent(
  order: NotifiableOrder,
  event: NotifyEvent,
  storeName: string
): Promise<void> {
  try {
    const origin = siteOrigin();
    if (!origin) {
      // Without an absolute origin the message would carry a relative path,
      // which is unclickable in a chat. Better to send nothing and say why.
      console.warn(
        "NEXT_PUBLIC_SITE_URL is not set — skipping the order notification, " +
        "because the tracking link would not be tappable."
      );
      return;
    }

    const lang = asLang(order.lang);
    const url = trackingUrl(order.ref, order.buyer_phone, origin);
    const body = renderNotification(event, lang, {
      ref: order.ref,
      storeName,
      total: money(order.total),
      url,
    });

    const provider = activeProvider();
    const sb = supabaseAdmin();

    const { data: row, error } = await sb
      .from("notifications")
      .insert({
        order_id: order.id,
        order_ref: order.ref,
        event,
        to_phone: order.buyer_phone,
        lang,
        body,
        tracking_url: url,
        channel: provider ? provider.channel : "manual",
        provider: provider?.id || "",
        status: "queued",
      })
      .select("id")
      .single();

    if (error) {
      // 23505 = unique violation: this exact message was already queued, which
      // is the constraint doing its job, not a failure.
      if ((error as { code?: string }).code === "23505") return;
      // Anything else is most likely that supabase/notifications.sql has not
      // been run. Warn once; do not break the order.
      console.warn("Could not queue an order notification:", error.message);
      return;
    }

    if (!provider) return; // manual mode: the admin sends it from the order page

    await dispatchNotification(row.id as string, order.buyer_phone, body);
  } catch (err) {
    reportError(err, { scope: "notifyOrderEvent", event, ref: order.ref });
  }
}

/** Attempts one queued row and records the outcome. Exported so the admin's
 * retry button and any future cron can reuse the exact same path. */
export async function dispatchNotification(
  notificationId: string, toPhone: string, body: string
): Promise<boolean> {
  const provider = activeProvider();
  const sb = supabaseAdmin();

  if (!provider) {
    await sb.from("notifications")
      .update({ status: "queued", channel: "manual", error: "No messaging provider configured" })
      .eq("id", notificationId);
    return false;
  }

  const result = await provider.send(toPhone, body);

  await sb.from("notifications").update({
    status: result.ok ? "sent" : "failed",
    provider: provider.id,
    provider_ref: result.providerRef ?? null,
    error: result.ok ? null : (result.error || "").slice(0, 1000),
    sent_at: result.ok ? new Date().toISOString() : null,
    // Read-modify-write on a counter is a race, but the only cost of losing
    // a count is a slightly wrong "attempts" number in the admin UI. Not
    // worth an RPC.
    attempts: 1,
  }).eq("id", notificationId);

  return result.ok;
}

/** Fire-and-forget wrapper for the server actions.
 *
 * The buyer's message must never be on the critical path of the admin's
 * click. If it were, a slow Meta API would make "mark as confirmed" feel
 * broken, and an admin who taps twice is how you get duplicate work.
 */
export function notifyOrderEventInBackground(
  order: NotifiableOrder, event: NotifyEvent, storeName: string
): void {
  void notifyOrderEvent(order, event, storeName).catch((err) =>
    reportError(err, { scope: "notifyOrderEventInBackground", event })
  );
}
