"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { approveSeller, rejectSeller, suspendSeller, reactivateSeller } from "@/lib/actions/sellers-admin";
import { nowIso } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Lang, Seller, SellerStatus } from "@/lib/types";

const STATUS_PILL: Record<SellerStatus, "ok" | "warn" | "bad"> = {
  pending: "warn",
  approved: "ok",
  rejected: "bad",
  suspended: "bad",
};

export default function SellersAdmin({ lang, sellers }: { lang: Lang; sellers: Seller[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"" | SellerStatus>("");

  const list = filter ? sellers.filter((s) => s.status === filter) : sellers;
  const pendingCount = sellers.filter((s) => s.status === "pending").length;
  const approvedCount = sellers.filter((s) => s.status === "approved").length;

  async function run(fn: () => Promise<unknown>, msg?: string) {
    setBusy(true);
    try {
      await fn();
      if (msg) toast(msg);
      router.refresh();
    } catch (e) {
      toast(String((e as Error).message), true);
    }
    setBusy(false);
  }

  return (
    <>
      <h1>{t("sellers", lang)}</h1>
      <div className="stat">
        <div><b>{sellers.length}</b><span>{t("sellers", lang)}</span></div>
        <div><b>{pendingCount}</b><span>{t("sellerStatus_pending", lang)}</span></div>
        <div><b>{approvedCount}</b><span>{t("sellerStatus_approved", lang)}</span></div>
      </div>

      <div className="bar">
        <select value={filter} onChange={(e) => setFilter(e.target.value as "" | SellerStatus)}>
          <option value="">{t("all", lang)}</option>
          {(["pending", "approved", "rejected", "suspended"] as const).map((s) => (
            <option key={s} value={s}>{t("sellerStatus_" + s, lang)}</option>
          ))}
        </select>
        <span className="count">{list.length}</span>
      </div>

      {list.length ? (
        <div className="list">
          {list.map((s) => (
            <div className="item" key={s.id}>
              <div className="g">
                <b>{s.store_name}</b>
                <span>
                  {s.full_name} · {s.email}{s.phone ? " · " + s.phone : ""}
                  {" · "}{t(s.seller_type === "individual" ? "sellerTypeIndividual" : "sellerTypeBusiness", lang)}
                  {" · "}{nowIso(s.created_at)}
                </span>
              </div>
              <div className="acts">
                <span className={"pill " + STATUS_PILL[s.status]}>{t("sellerStatus_" + s.status, lang)}</span>
                {s.status === "pending" && (
                  <>
                    <button className="btn btn-sm" disabled={busy}
                      onClick={() => run(() => approveSeller(s.id), t("approve", lang) + ": " + s.store_name)}>
                      {t("approve", lang)}
                    </button>
                    <button className="btn btn-sm btn-danger" disabled={busy}
                      onClick={() => run(() => rejectSeller(s.id))}>
                      {t("reject", lang)}
                    </button>
                  </>
                )}
                {s.status === "approved" && (
                  <button className="btn btn-sm btn-danger" disabled={busy}
                    onClick={() => run(() => suspendSeller(s.id))}>
                    {t("suspend", lang)}
                  </button>
                )}
                {(s.status === "suspended" || s.status === "rejected") && (
                  <button className="btn btn-sm" disabled={busy}
                    onClick={() => run(() => reactivateSeller(s.id))}>
                    {t("reactivate", lang)}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty"><p>{t("noSellersYet", lang)}</p></div>
      )}
    </>
  );
}
