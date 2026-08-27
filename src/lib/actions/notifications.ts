"use server";
import { requireAdmin } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dispatchNotification } from "@/lib/notify/service";
import { notificationsAutomatic } from "@/lib/notify/registry";
import { revalidatePath } from "next/cache";

/** Marks a queued message as sent by hand.
 *
 * The manual path is not a degraded mode -- for a store with no SMS gateway
 * contract it is the whole feature. The admin taps the link, their phone's
 * messaging app opens with the buyer's number and the text already filled
 * in, they press send, then they press this. The outbox stays an accurate
 * record of what the buyer has actually been told, which is what stops the
 * same update being sent twice by two different people -- and with SMS, each
 * duplicate is a real charge. */
export async function markNotificationSent(id: string) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("notifications")
    .update({ status: "sent", channel: "manual", provider: "manual", sent_at: new Date().toISOString(), error: null })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/o", "layout");
  revalidatePath("/admin/notifications");
}

/** Retries a failed send through the configured provider. Refuses in manual
 * mode rather than silently doing nothing, so "Retry" never looks broken. */
export async function retryNotification(id: string) {
  await requireAdmin();
  if (!notificationsAutomatic()) {
    throw new Error("No SMS gateway is configured — send this one by hand instead");
  }
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("notifications")
    .select("id, to_phone, body")
    .eq("id", id)
    .maybeSingle();
  if (!data) throw new Error("Notification not found");

  const ok = await dispatchNotification(data.id as string, data.to_phone as string, data.body as string);
  revalidatePath("/admin/o", "layout");
  revalidatePath("/admin/notifications");
  if (!ok) throw new Error("The provider refused the message again — see the error on the row");
}

/** Takes a message off the queue without sending it. For the case where the
 * admin has already told the buyer another way (a phone call, in person) and
 * the row would otherwise sit there looking like outstanding work. */
export async function skipNotification(id: string) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("notifications").update({ status: "skipped" }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/o", "layout");
  revalidatePath("/admin/notifications");
}
