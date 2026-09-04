import { requireSellerFeature } from "@/lib/actions/guard";
import { getSellerProducts } from "@/lib/data/seller";
import { adminSettings } from "@/lib/data/admin";
import { restockAlerts, normalizeRestockPct } from "@/lib/restock";
import SellerStock from "@/components/seller/SellerStock";
import { getLang } from "@/lib/lang";

/** The owner's restock alert, scoped to one store.
 *
 * Same threshold the owner uses, from the same setting, so a seller and
 * the marketplace are looking at the same definition of "running low"
 * rather than each having their own. */
export default async function SellerStockPage() {
  const seller = await requireSellerFeature("stock");
  const [lang, products, settings] = await Promise.all([
    getLang(), getSellerProducts(seller.id), adminSettings(),
  ]);

  const pct = normalizeRestockPct(settings?.restock_alert_pct);
  const live = products.filter((p) => !p.archived);
  const low = restockAlerts(live, pct);
  const out = live.filter((p) => p.stock_status === "out");

  return (
    <SellerStock
      lang={lang} pct={pct} low={low}
      out={out.map((p) => ({ id: p.id, name: p.name, qty: p.qty }))}
      total={live.length}
    />
  );
}
