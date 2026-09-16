import { requireSellerFeature } from "@/lib/actions/guard";
import { sellerSalesData } from "@/lib/data/sellerSales";
import { getSellerOrders } from "@/lib/data/seller";
import { adminSettings } from "@/lib/data/admin";
import { buildSellerAttention } from "@/lib/sellerAttention";
import { totals, growth, todayIso, shiftIso } from "@/lib/sales";
import SellerToday from "@/components/seller/SellerToday";
import { getLang } from "@/lib/lang";

/** How long a window the figures cover, and what they are compared with.
 * Thirty days against the thirty before them -- the same shape the owner's
 * overview uses, so a seller and the marketplace are reading the same
 * period when they talk about "this month". */
const WINDOW_DAYS = 30;

/** A store's own "what needs doing today", sold per store.
 *
 * The figures are the SAME LINES the seller's sales screen is built from
 * (lib/data/sellerSales.ts), which have had the platform's purchase cost
 * removed before they leave the database -- so there is nothing here to
 * re-check and nothing that could leak what the marketplace paid.
 *
 * Deliberately not a second sales dashboard. That exists, it is behind its
 * own feature, and it is where the breakdowns live. This is four numbers
 * and a to-do list, which is what a home page is for. */
export default async function SellerTodayPage() {
  const seller = await requireSellerFeature("selling.today");
  const [lang, data, orders, settings] = await Promise.all([
    getLang(), sellerSalesData(seller), getSellerOrders(seller.id), adminSettings(),
  ]);

  const today = todayIso();
  const from = shiftIso(today, -(WINDOW_DAYS - 1));
  const prevTo = shiftIso(from, -1);
  const prevFrom = shiftIso(prevTo, -(WINDOW_DAYS - 1));

  const inWindow = (a: string, b: string) =>
    data.lines.filter((l) => l.date >= a && l.date <= b);
  const now = totals(inWindow(from, today));
  const before = totals(inWindow(prevFrom, prevTo));

  return (
    <SellerToday
      lang={lang}
      storeName={seller.store_name}
      items={buildSellerAttention({
        orders,
        products: data.products,
        // The marketplace's own threshold, so "running low" means the same
        // thing on this screen as it does on the owner's.
        restockPct: (settings as { restock_alert_pct?: number } | null)?.restock_alert_pct,
      })}
      figures={{
        revenue: now.revenue, orders: now.orders, qty: now.qty,
        avgOrderValue: now.orders ? now.revenue / now.orders : 0,
        revenueChange: growth(now.revenue, before.revenue),
        ordersChange: growth(now.orders, before.orders),
        qtyChange: growth(now.qty, before.qty),
      }}
      days={WINDOW_DAYS}
    />
  );
}
