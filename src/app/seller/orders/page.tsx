import SellerOrdersList from "@/components/seller/SellerOrdersList";
import SellerStatusGate from "@/components/seller/SellerStatusGate";
import { getCurrentSellerOrRedirect, getSellerOrders } from "@/lib/data/seller";
import { adminSettings } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";

/** adminSettings() (service role, full row), not the public getSettings()
 * — commission_rate isn't in the public anon column grant, and this page
 * is already gated behind a real seller login (see SellerStatusGate /
 * getCurrentSellerOrRedirect). */
export default async function SellerOrdersPage() {
  const lang = await getLang();
  const seller = await getCurrentSellerOrRedirect();
  const [orders, settings] = await Promise.all([
    seller.status === "approved" ? getSellerOrders(seller.id) : Promise.resolve([]),
    adminSettings(),
  ]);
  const commissionRatePercent = seller.commission_rate ?? settings.commission_rate;

  return (
    <SellerStatusGate seller={seller} lang={lang}>
      <SellerOrdersList lang={lang} orders={orders} commissionRatePercent={commissionRatePercent} />
    </SellerStatusGate>
  );
}
