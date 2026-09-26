import BasketView from "@/components/BasketView";
import { getLang } from "@/lib/lang";
import { getBestSellingProducts, getSettings } from "@/lib/data/public";
import { cardPaymentAvailable } from "@/lib/payments/registry";
import { acceptedPayments } from "@/lib/payMethods";

/** The cart.
 *
 * The suggestions are read HERE rather than in the component, because the
 * basket lives in the browser's localStorage and the server cannot see it
 * -- so nothing here can be personalised to what is already in the cart.
 * What it can be is real: the shop's own best sellers, which is the honest
 * version of "Suggested" for a shop with no recommendation engine. The
 * component drops any that are already in the basket.
 */
export default async function ListPage() {
  const [lang, settings, best] = await Promise.all([
    getLang(), getSettings(), getBestSellingProducts(8).catch(() => ({ products: [] })),
  ]);
  return (
    <BasketView
      lang={lang}
      settings={settings}
      suggestions={best.products}
      pays={acceptedPayments(settings, cardPaymentAvailable())}
    />
  );
}
