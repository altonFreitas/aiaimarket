import Link from "next/link";
import { getCurrentSellerOrRedirect, getSellerProducts, getSellerOrdersCapped, getSellerPayouts, computeSellerEarnings, computeSellerLedger } from "@/lib/data/seller";
import { adminSettings } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";
import { money, nowIso } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Capped } from "@/lib/data/capped";
import type { SellerOrderView } from "@/lib/data/seller";
import SellerStatusGate from "@/components/seller/SellerStatusGate";

/** Phase 2: real product AND earnings stats — orders are now connected
 * to sellers (see getSellerOrders), so gross sales / commission / net
 * earnings below are computed from actual completed orders, not a
 * placeholder.
 *
 * Uses adminSettings() (service role, full row), not the public
 * getSettings() — commission_rate is deliberately excluded from the
 * public anon column grant (customers never need to see it), and this
 * page is already gated behind a real seller login, so reading the full
 * settings row here is safe and correct. */
export default async function SellerDashboardPage() {
  const lang = await getLang();
  const seller = await getCurrentSellerOrRedirect();
  const isApproved = seller.status === "approved";

  // The rate a new order would be placed at. Passed in as the fallback for
  // lines placed before rates were recorded on them; every line since
  // carries its own (see OrderItem.commission_rate).
  const settings = await adminSettings();
  const rate = seller.commission_rate ?? settings.commission_rate;

  const empty: Capped<SellerOrderView> =
    { rows: [], truncated: false, cap: 0, oldestKept: null };
  const [products, ordersCapped, payouts] = await Promise.all([
    isApproved ? getSellerProducts(seller.id) : Promise.resolve([]),
    isApproved ? getSellerOrdersCapped(seller.id, rate) : Promise.resolve(empty),
    isApproved ? getSellerPayouts(seller.id) : Promise.resolve([]),
  ]);
  const orders = ordersCapped.rows;
  const live = products.filter((p) => !p.archived);
  const pendingReview = live.filter((p) => p.status === "pending").length;
  const outOfStock = live.filter((p) => p.stock_status === "out").length;
  const pendingOrders = orders.filter((o) => !["completed", "cancelled"].includes(o.status)).length;
  const ledger = computeSellerLedger(
    computeSellerEarnings(orders, seller, settings.commission_rate),
    payouts
  );

  return (
    <div className="panel">
      <h1>{seller.store_name}</h1>

      <SellerStatusGate seller={seller} lang={lang}>
        <p className="sub">{t("sellerApprovedWelcome", lang)}</p>

        <div className="stat">
          <div><b>{live.length}</b><span>{t("sellerProducts", lang)}</span></div>
          <div><b>{pendingReview}</b><span>{t("sellerStatus_pending", lang)}</span></div>
          <div><b>{outOfStock}</b><span>{t("stockOut", lang)}</span></div>
          <div><b>{pendingOrders}</b><span>{t("sellerOrders", lang)}</span></div>
        </div>

        <div className="btn-row" style={{ marginTop: 12 }}>
          <Link className="btn btn-amber" href="/seller/products/new">+ {t("newProduct", lang)}</Link>
          <Link className="btn btn-ghost" href="/seller/products">{t("sellerProducts", lang)}</Link>
          <Link className="btn btn-ghost" href="/seller/orders">{t("sellerOrders", lang)}</Link>
        </div>

        <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <h3>{t("sellerEarnings", lang)}</h3>
          <p className="hint" style={{ marginTop: -4 }}>
            {t("commissionRate", lang)}: {ledger.commissionRatePercent}%
          </p>

          {/* THE FIGURES ARE REFUSED WHEN THE SCAN DID NOT SEE EVERYTHING.
              A seller's orders are found by scanning the most recent slice
              of the whole marketplace and filtering in memory -- there is
              no index to query them directly. Payouts, meanwhile, are read
              unbounded. Once the marketplace passes the cap, this store's
              older completed orders silently stop counting towards gross
              sales while every dollar paid to them still counts, and
              "still owed" drifts negative for no reason anyone can see.
              A number that might be wrong about money is worse than no
              number, so this says so instead. */}
          {ordersCapped.truncated ? (
            <p className="note bad" role="status">
              <b>{t("earningsIncomplete", lang)}</b>{" "}
              {t("earningsIncompleteHint", lang).replace("{n}", String(ordersCapped.cap))}
            </p>
          ) : (
          <>
          <div className="kv"><span>{t("grossSales", lang)}</span><b>{money(ledger.grossSales)}</b></div>
          <div className="kv"><span>{t("marketplaceCommission", lang)}</span><b>-{money(ledger.commission)}</b></div>
          <div className="kv"><span>{t("sellerEarnings", lang)}</span><b>{money(ledger.earnings)}</b></div>
          <div className="kv"><span>{t("paidOut", lang)}</span><b>-{money(ledger.paidOut)}</b></div>
          {/* The one number a seller actually came here for. Shown in red
              when negative, which means the platform has paid out more than
              completed orders justify -- surfaced rather than clamped, so
              the mistake is visible to both sides. */}
          <div className="kv total">
            <span>{ledger.outstanding < 0 ? t("overpaid", lang) : t("outstanding", lang)}</span>
            <b style={{ color: ledger.outstanding < 0 ? "var(--red)" : undefined }}>
              {money(ledger.outstanding)}
            </b>
          </div>
          </>
          )}
        </div>

        {payouts.length > 0 && (
          <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
            <h3>{t("payoutHistory", lang)}</h3>
            {payouts.map((p) => (
              <div key={p.id} className="kv">
                <span>{nowIso(p.paid_at)}{p.reference ? ` · ${p.reference}` : ""}</span>
                <b>{money(p.amount)}</b>
              </div>
            ))}
          </div>
        )}
      </SellerStatusGate>
    </div>
  );
}
