import Link from "next/link";
import { getCurrentSellerOrRedirect, getSellerProducts } from "@/lib/data/seller";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import SellerStatusGate from "@/components/seller/SellerStatusGate";

/** Phase 1: a real overview now that products exist. Products/orders/
 * earnings stats are still ahead (orders aren't connected to sellers
 * yet), but "how many products, how many need restocking" is real data
 * today. */
export default async function SellerDashboardPage() {
  const lang = await getLang();
  const seller = await getCurrentSellerOrRedirect();
  const products = seller.status === "approved" ? await getSellerProducts(seller.id) : [];
  const live = products.filter((p) => !p.archived);
  const pendingReview = live.filter((p) => p.status === "pending").length;
  const outOfStock = live.filter((p) => p.stock_status === "out").length;

  return (
    <div className="panel">
      <h1>{seller.store_name}</h1>

      <SellerStatusGate seller={seller} lang={lang}>
        <p className="sub">{t("sellerApprovedWelcome", lang)}</p>

        <div className="stat">
          <div><b>{live.length}</b><span>{t("sellerProducts", lang)}</span></div>
          <div><b>{pendingReview}</b><span>{t("sellerStatus_pending", lang)}</span></div>
          <div><b>{outOfStock}</b><span>{t("stockOut", lang)}</span></div>
        </div>

        <div className="btn-row" style={{ marginTop: 12 }}>
          <Link className="btn btn-amber" href="/seller/products/new">+ {t("newProduct", lang)}</Link>
          <Link className="btn btn-ghost" href="/seller/products">{t("sellerProducts", lang)}</Link>
        </div>
      </SellerStatusGate>
    </div>
  );
}
