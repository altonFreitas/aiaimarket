"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import {
  markNotificationSent, retryNotification, skipNotification, clearOrderNotifications,
} from "@/lib/actions/notifications";
import { canClearOrderNotifications, countClearableNotifications } from "@/lib/notify/clearability";
import { smsLink, nowIso } from "@/lib/utils";
import SmsCostBadge from "./SmsCostBadge";
import { t } from "@/lib/i18n";
import type { Lang, Order, OrderNotification } from "@/lib/types";

const STATUS_PILL: Record<OrderNotification["status"], "ok" | "warn" | "bad"> = {
  sent: "ok",
  queued: "warn",
  failed: "bad",
  skipped: "warn",
};

/** The messages this order has sent the buyer, and the ones still owed.
 *
 * In manual mode (no SMS gateway configured) the "Send SMS" button is the
 * feature, not a fallback: it opens the admin's own phone messaging app with
 * the buyer's number and the full text already filled in, so sending is one
 * tap and a press. "Mark as sent" afterwards is what keeps the outbox honest
 * -- without it two people working the same orders send the same update
 * twice, and each duplicate costs real money. */
export default function OrderNotifications({
  lang, orderId, orderStatus, notifications, automatic, migrated,
}: {
  lang: Lang;
  orderId: string;
  orderStatus: Order["status"];
  notifications: OrderNotification[];
  /** True when a provider is configured and messages send themselves. */
  automatic: boolean;
  /** False when supabase/notifications.sql has not been run yet. */
  migrated: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, msg?: string) {
    setBusy(true);
    try { await fn(); if (msg) toast(msg); router.refresh(); }
    catch (e) { toast(String((e as Error).message), true); }
    setBusy(false);
  }

  // The same rule the server enforces (lib/notify/clearability.ts), computed
  // here too so the button can say how many rows it will remove, and stay
  // hidden entirely when there is nothing to.
  const statuses = notifications.map((n) => n.status);
  const clearableCount = countClearableNotifications(statuses);
  const canClear = canClearOrderNotifications(orderStatus, statuses);

  function clearMessages() {
    if (!window.confirm(t("clearMessagesAsk", lang).replace("{n}", String(clearableCount)))) return;
    run(() => clearOrderNotifications(orderId), t("messagesCleared", lang));
  }

  return (
    <div className="panel">
      <h3>{t("orderMessages", lang)}</h3>

      {!migrated ? (
        <p className="hint" style={{ margin: 0 }}>{t("notificationsNeedMigration", lang)}</p>
      ) : !notifications.length ? (
        <p className="hint" style={{ margin: 0 }}>{t("noMessagesYet", lang)}</p>
      ) : (
        <div className="rows">
          {notifications.map((n) => (
            <div key={n.id} className="notif">
              <div className="notif-head">
                <span className={"pill " + STATUS_PILL[n.status]}>
                  {t("notif_" + n.status, lang)}
                </span>
                <b className="face-sans">{t("notifEvent_" + n.event, lang)}</b>
                <span className="hint" suppressHydrationWarning>
                  {n.sent_at ? nowIso(n.sent_at) : nowIso(n.created_at)}
                  {n.channel === "manual" ? ` · ${t("byHand", lang)}` : ` · ${n.provider}`}
                </span>
                <SmsCostBadge body={n.body} lang={lang} />
              </div>

              {/* The message verbatim. An admin about to send this by hand
                  needs to see exactly what the buyer will read. */}
              <pre className="notif-body">{n.body}</pre>

              {n.error && <p className="notif-error">{n.error}</p>}

              {(n.status === "queued" || n.status === "failed") && (
                <div className="acts" style={{ justifyContent: "flex-start", marginTop: 8 }}>
                  <a
                    className="btn btn-sm btn-amber"
                    target="_blank"
                    rel="noopener"
                    href={smsLink(n.to_phone, n.body)}
                  >
                    {t("sendSms", lang)}
                  </a>
                  <button className="btn btn-sm btn-ghost" type="button" disabled={busy}
                    onClick={() => run(() => markNotificationSent(n.id), t("markedSent", lang))}>
                    {t("markSent", lang)}
                  </button>
                  {automatic && (
                    <button className="btn btn-sm btn-ghost" type="button" disabled={busy}
                      onClick={() => run(() => retryNotification(n.id), t("retry", lang))}>
                      {t("retry", lang)}
                    </button>
                  )}
                  <button className="btn btn-sm btn-ghost" type="button" disabled={busy}
                    onClick={() => run(() => skipNotification(n.id))}>
                    {t("skipMessage", lang)}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {migrated && !automatic && (
        <p className="hint" style={{ marginTop: 10 }}>{t("manualModeHint", lang)}</p>
      )}

      {/* Only ever reachable once the order itself can no longer change
          status -- clearing history mid-flight is not offered at all, not
          even disabled-and-explained, so there is nothing to misclick. */}
      {canClear && (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <button className="btn btn-sm btn-ghost" type="button" disabled={busy} onClick={clearMessages}>
            {t("clearMessages", lang)} ({clearableCount})
          </button>
        </div>
      )}
    </div>
  );
}
