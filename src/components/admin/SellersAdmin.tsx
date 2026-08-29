"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { approveSeller, rejectSeller, suspendSeller, reactivateSeller, resetSellerTotpAction } from "@/lib/actions/sellers-admin";
import { nowIso } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { money } from "@/lib/utils";
import type { MarketplaceStats } from "@/lib/stats";
import type { Lang, Seller, SellerStatus } from "@/lib/types";

const STATUS_PILL: Record<SellerStatus, "ok" | "warn" | "bad"> = {
  pending: "warn",
  approved: "ok",
  rejected: "bad",
  suspended: "bad",
};

export default function SellersAdmin({
  lang, sellers, marketplace,
}: {
  lang: Lang; sellers: Seller[];
  /** Gross marketplace sales and the platform's commission on them.
   * Moved here from the old statistics page: this is money owed between
   * the platform and its sellers, so it belongs beside the sellers it
   * concerns rather than in a general analytics drawer. */
  marketplace?: MarketplaceStats;
}) {
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

  function resetTotp(s: Seller) {
    // A confirm() here on purpose — this is more consequential than
    // approve/reject/suspend above (it's the recovery path for a
    // locked-out seller, so it should only be used after actually
    // confirming who's asking, not clicked reflexively).
    if (!window.confirm(t("confirmResetSellerTotp", lang).replace("{store}", s.store_name))) return;
    run(() => resetSellerTotpAction(s.id), t("sellerTotpResetToast", lang) + ": " + s.store_name);
  }

  return (
    <>
      <h1>{t("sellers", lang)}</h1>
      <div className="stat">
        <div><b>{sellers.length}</b><span>{t("sellers", lang)}</span></div>
        <div><b>{pendingCount}</b><span>{t("sellerStatus_pending", lang)}</span></div>
        <div><b>{approvedCount}</b><span>{t("sellerStatus_approved", lang)}</span></div>
      </div>

      {/* Only shown once a first seller has actually joined -- a
          single-seller store has no commission to report against itself. */}
      {marketplace && marketplace.totalSellers > 0 && (
        <div className="stat stat-fit">
          <div><b>{money(marketplace.totalMarketplaceSales)}</b><span>{t("grossSales", lang)}</span></div>
          <div><b>{money(marketplace.totalMarketplaceCommission)}</b><span>{t("marketplaceCommission", lang)}</span></div>
          <div><b>{marketplace.pendingProducts}</b><span>{t("productStatus_pending", lang)}</span></div>
        </div>
      )}

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
                {s.totp_enabled && (
                  <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => resetTotp(s)}>
                    {t("resetSellerTotp", lang)}
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
