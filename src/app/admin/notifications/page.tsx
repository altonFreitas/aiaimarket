import Link from "next/link";
import { adminPendingNotifications } from "@/lib/data/admin";
import { notificationsAutomatic } from "@/lib/notify/registry";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import PendingNotifications from "@/components/admin/PendingNotifications";
import { requireSection } from "@/lib/actions/guard";

/** Every message the store still owes a buyer, across all orders.
 *
 * With no messaging API configured this is a work queue, not a diagnostic:
 * each row is a buyer who has not yet been told what happened to their
 * order. That is why it lives in the nav rather than buried on an order
 * page -- an empty queue here is the thing worth being able to check. */
export default async function AdminNotificationsPage() {
  await requireSection("sales");
  const [lang, pending] = await Promise.all([getLang(), adminPendingNotifications()]);
  return (
    <>
      <h1>{t("pendingMessages", lang)}</h1>
      {!pending.length ? (
        <div className="empty">
          <p>{t("allMessagesSent", lang)}</p>
          <Link className="btn btn-ghost" href="/admin/orders">{t("orders", lang)}</Link>
        </div>
      ) : (
        <PendingNotifications lang={lang} pending={pending} automatic={notificationsAutomatic()} />
      )}
    </>
  );
}
