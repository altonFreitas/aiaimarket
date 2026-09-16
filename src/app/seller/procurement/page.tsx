import { requireSellerFeature } from "@/lib/actions/guard";
import {
  sellerProcurementReady, getSellerSuppliers, getSellerPurchaseOrders,
} from "@/lib/data/seller-procurement";
import SellerProcurement from "@/components/seller/SellerProcurement";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";

/** What this store buys to restock itself.
 *
 * Granted per store on Sellers -> a store -> Access, like My sales and My
 * stock. requireSellerFeature refuses anyone who is not signed in, whose
 * store is not approved, or who has not been given it. */
export default async function SellerProcurementPage() {
  const seller = await requireSellerFeature("purchasing.purchases");
  const [lang, ready] = await Promise.all([getLang(), sellerProcurementReady()]);

  // The column is not there yet. Said rather than swallowed: an empty list
  // would tell a seller they have no purchase orders, when the truth is
  // that the marketplace has not finished installing the feature.
  if (!ready) {
    return (
      <>
        <h1>{t("sellerProcurement", lang)}</h1>
        <div className="empty"><p>{t("sellerProcurementSoon", lang)}</p></div>
      </>
    );
  }

  const [suppliers, orders] = await Promise.all([
    getSellerSuppliers(seller.id), getSellerPurchaseOrders(seller.id),
  ]);

  return <SellerProcurement lang={lang} suppliers={suppliers} orders={orders} />;
}
