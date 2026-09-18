"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { markAlertSent, skipAlert } from "@/lib/actions/notifications";
import { smsLink, nowIso } from "@/lib/utils";
import { t } from "@/lib/i18n";
import WriteOnly from "./Access";
import type { CustomerAlert, Lang } from "@/lib/types";

/* The announcements the shop still owes the customers who asked for them.
 *
 * The same work queue as the order messages above it, and deliberately on
 * the same screen: an announcement queued where nobody looks is an
 * announcement nobody sends, and these rows exist only because somebody
 * ticked a box asking to be told.
 *
 * With no gateway configured each row is a tap that opens the admin's own
 * SMS app with the number and the text already filled in -- the same
 * fallback the order queue has always used, which needs no account
 * anywhere. */
export default function PendingAlerts({
  lang, pending, automatic,
}: { lang: Lang; pending: CustomerAlert[]; automatic: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, msg?: string) {
    setBusy(true);
    try { await fn(); if (msg) toast(msg); router.refresh(); }
    catch (e) { toast(String((e as Error).message), true); }
    setBusy(false);
  }

  if (!pending.length) return null;

  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <h3>{t("pendingAlerts", lang)}</h3>
      {!automatic && <p className="hint">{t("manualModeHint", lang)}</p>}
      <div className="rows">
        {pending.map((a) => (
          <div className="kv" key={a.id} style={{ alignItems: "flex-start", gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>{a.products?.name || t("product", lang)}</b>
              {" · "}
              <span className="pill">{t(a.kind === "discount" ? "alertDiscount" : "alertNew", lang)}</span>
              <br />
              <span className="hint">{a.to_phone} · {nowIso(a.created_at)}</span>
              <br />
              <span className="hint">{a.body}</span>
              {a.error && <><br /><span className="hint" style={{ color: "var(--red)" }}>{a.error}</span></>}
            </span>
            <WriteOnly>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {/* Opens the phone's own SMS app with everything filled in.
                    Marking it sent is a separate tap, because the shop is
                    the only one who knows whether it actually went. */}
                <a className="btn btn-sm btn-amber" target="_blank" rel="noopener"
                  href={smsLink(a.to_phone, a.body)}>
                  {t("sendSms", lang)}
                </a>
                <button className="btn btn-sm btn-ghost" disabled={busy}
                  onClick={() => run(() => markAlertSent(a.id), t("saved", lang))}>
                  {t("markSent", lang)}
                </button>
                <button className="btn btn-sm btn-ghost" disabled={busy}
                  onClick={() => run(() => skipAlert(a.id), t("saved", lang))}>
                  {t("skipMessage", lang)}
                </button>
              </span>
            </WriteOnly>
          </div>
        ))}
      </div>
    </div>
  );
}
