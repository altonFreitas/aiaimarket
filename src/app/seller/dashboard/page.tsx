import Link from "next/link";
import { getCurrentSellerOrRedirect, getSellerProducts, getSellerOrders, computeSellerEarnings } from "@/lib/data/seller";
import { getSettings } from "@/lib/data/public";
import { getLang } from "@/lib/lang";
import { money } from "@/lib/utils";
import { t } from "@/lib/i18n";
import SellerStatusGate from "@/components/seller/SellerStatusGate";

/** Phase 2: real product AND earnings stats — orders are now connected
 * to sellers (see getSellerOrders), so gross sales / commission / net
 * earnings below are computed from actual completed orders, not a
 * placeholder. */
export default async function SellerDashboardPage() {
  const lang = await getLang();
  const seller = await getCurrentSellerOrRedirect();
  const isApproved = seller.status === "approved";

  const [products, orders, settings] = await Promise.all([
    isApproved ? getSellerProducts(seller.id) : Promise.resolve([]),
    isApproved ? getSellerOrders(seller.id) : Promise.resolve([]),
    getSettings(),
  ]);
  const live = products.filter((p) => !p.archived);
  const pendingReview = live.filter((p) => p.status === "pending").length;
  const outOfStock = live.filter((p) => p.stock_status === "out").length;
  const pendingOrders = orders.filter((o) => !["completed", "cancelled"].includes(o.status)).length;
  const earnings = computeSellerEarnings(orders, seller, settings.commission_rate);

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
            {t("commissionRate", lang)}: {earnings.commissionRatePercent}%
          </p>
          <div className="kv"><span>{t("grossSales", lang)}</span><b>{money(earnings.grossSales)}</b></div>
          <div className="kv"><span>{t("marketplaceCommission", lang)}</span><b>-{money(earnings.commission)}</b></div>
          <div className="kv total"><span>{t("sellerEarnings", lang)}</span><b>{money(earnings.earnings)}</b></div>
        </div>
      </SellerStatusGate>
    </div>
  );
}
