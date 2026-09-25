import Link from "next/link";
import { adminPendingAlerts, adminPendingNotifications } from "@/lib/data/admin";
import { announceHealth } from "@/lib/notify/announce";
import { notificationsAutomatic } from "@/lib/notify/registry";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import PendingNotifications from "@/components/admin/PendingNotifications";
import PendingAlerts from "@/components/admin/PendingAlerts";
import AnnounceState from "@/components/admin/AnnounceState";
import { requireSection } from "@/lib/actions/guard";

/** Every message the store still owes a buyer, across all orders.
 *
 * With no messaging API configured this is a work queue, not a diagnostic:
 * each row is a buyer who has not yet been told what happened to their
 * order. That is why it lives in the nav rather than buried on an order
 * page -- an empty queue here is the thing worth being able to check. */
export default async function AdminNotificationsPage() {
  await requireSection("sales.notifications");
  const [lang, pending, alerts, announce] = await Promise.all([
    getLang(), adminPendingNotifications(), adminPendingAlerts(), announceHealth(),
  ]);
  const automatic = notificationsAutomatic();
  return (
    <>
      <h1>{t("pendingMessages", lang)}</h1>
      {/* AN EMPTY QUEUE IS NOT THE SAME AS A KEPT PROMISE.
          This screen used to say "every message has been sent" whenever both
          queues were empty -- including when announcements were switched off
          and had therefore never been queued at all, which is what a shop
          reported. The order queue is what that sentence is about, so it now
          says it about the order queue, and the announcements state is
          stated separately and always. */}
      {!pending.length ? (
        <div className="empty">
          <p>{t("allMessagesSent", lang)}</p>
          <Link className="btn btn-ghost" href="/admin/orders">{t("orders", lang)}</Link>
        </div>
      ) : (
        <PendingNotifications lang={lang} pending={pending} automatic={automatic} />
      )}
      {/* The announcements queue sits under the order messages on the same
          screen: both are "somebody the shop owes a message", and a second
          page for the second kind is a page nobody opens. */}
      <PendingAlerts lang={lang} pending={alerts} automatic={automatic} />
      <AnnounceState health={announce} lang={lang} />
    </>
  );
}
