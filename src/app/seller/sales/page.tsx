import { requireSellerFeature } from "@/lib/actions/guard";
import { sellerSalesData } from "@/lib/data/sellerSales";
import { adminSettings } from "@/lib/data/admin";
import { packSalesLines } from "@/lib/salesWire";
import { todayIso } from "@/lib/sales";
import SellerSales from "@/components/seller/SellerSales";
import { getLang } from "@/lib/lang";

/** A store's own sales, on the owner's own engine.
 *
 * The lines come from lib/data/sellerSales.ts, which filters them to this
 * store and removes the platform's purchase cost before anything is built.
 * Nothing below re-checks that, because there is nothing to re-check: what
 * arrives here has no cost in it. */
export default async function SellerSalesPage() {
  const seller = await requireSellerFeature("sales");
  const [lang, data, settings] = await Promise.all([
    getLang(), sellerSalesData(seller), adminSettings(),
  ]);

  // Their own negotiated rate if they have one, otherwise the platform
  // default -- the same precedence computeSellerEarnings() uses, so this
  // screen and the dashboard's "still owed" cannot disagree.
  const rate = seller.commission_rate ?? settings?.commission_rate ?? 0;

  return (
    <SellerSales
      lang={lang}
      lines={packSalesLines(data.lines)}
      categories={data.categories}
      rate={rate}
      unsold={data.unsold}
      today={todayIso()}
    />
  );
}
