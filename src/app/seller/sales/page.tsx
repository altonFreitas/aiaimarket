import { requireSellerFeature } from "@/lib/actions/guard";
import { getSellerOrders } from "@/lib/data/seller";
import { adminSettings } from "@/lib/data/admin";
import { sellerSalesReport } from "@/lib/sellerSales";
import SellerSales from "@/components/seller/SellerSales";
import { getLang } from "@/lib/lang";

/** The first of the owner's tools a store can be given.
 *
 * Everything here is the store's own money: what they sold, what the
 * marketplace took, what is left. Nothing is derived from the platform's
 * purchase costs -- those never reach a seller (see stripCost in
 * lib/data/seller.ts), which is why this is a revenue view rather than the
 * margin view the owner has on /admin/sales. */
export default async function SellerSalesPage() {
  const seller = await requireSellerFeature("sales");
  const [lang, orders, settings] = await Promise.all([
    getLang(), getSellerOrders(seller.id), adminSettings(),
  ]);

  // Their own negotiated rate if they have one, otherwise the platform
  // default -- the same precedence computeSellerEarnings() uses, so this
  // screen and the dashboard's "still owed" cannot disagree.
  const rate = seller.commission_rate ?? settings.commission_rate ?? 0;
  const report = sellerSalesReport(orders, rate);

  return <SellerSales lang={lang} report={report} rate={rate} />;
}
