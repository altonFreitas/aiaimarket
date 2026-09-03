"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { markNotificationSent, retryNotification, skipNotification } from "@/lib/actions/notifications";
import { smsLink, nowIso } from "@/lib/utils";
import SmsCostBadge from "./SmsCostBadge";
import { t } from "@/lib/i18n";
import WriteOnly from "./Access";
import type { Lang, OrderNotification } from "@/lib/types";

export default function PendingNotifications({
  lang, pending, automatic,
}: { lang: Lang; pending: OrderNotification[]; automatic: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, msg?: string) {
    setBusy(true);
    try { await fn(); if (msg) toast(msg); router.refresh(); }
    catch (e) { toast(String((e as Error).message), true); }
    setBusy(false);
  }

  return (
    <>
      {!automatic && <p className="sub">{t("manualModeHint", lang)}</p>}
      <div className="rows">
        {pending.map((n) => (
          <div key={n.id} className="notif">
            <div className="notif-head">
              <span className={"pill " + (n.status === "failed" ? "bad" : "warn")}>
                {t("notif_" + n.status, lang)}
              </span>
              <b className="face-sans">{t("notifEvent_" + n.event, lang)}</b>
              {/* Straight to the order, because the next question after
                  "who has not been told" is almost always "what did they buy". */}
              <Link className="mono" style={{ fontSize: 12 }} href={`/admin/o/${n.order_id}`}>
                {n.order_ref}
              </Link>
              <span className="hint" suppressHydrationWarning>{nowIso(n.created_at)}</span>
              <SmsCostBadge body={n.body} lang={lang} />
            </div>

            <pre className="notif-body">{n.body}</pre>
            {n.error && <p className="notif-error">{n.error}</p>}

            <div className="acts" style={{ justifyContent: "flex-start", marginTop: 8 }}><WriteOnly>
              <a className="btn btn-sm btn-amber" target="_blank" rel="noopener"
                href={smsLink(n.to_phone, n.body)}>
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
            </WriteOnly></div>
          </div>
        ))}
      </div>
    </>
  );
}
