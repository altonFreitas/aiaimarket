import SellerOrdersList from "@/components/seller/SellerOrdersList";
import SellerStatusGate from "@/components/seller/SellerStatusGate";
import { getCurrentSellerOrRedirect, getSellerOrders } from "@/lib/data/seller";
import { getSettings } from "@/lib/data/public";
import { getLang } from "@/lib/lang";

export default async function SellerOrdersPage() {
  const lang = await getLang();
  const seller = await getCurrentSellerOrRedirect();
  const [orders, settings] = await Promise.all([
    seller.status === "approved" ? getSellerOrders(seller.id) : Promise.resolve([]),
    getSettings(),
  ]);
  const commissionRatePercent = seller.commission_rate ?? settings.commission_rate;

  return (
    <SellerStatusGate seller={seller} lang={lang}>
      <SellerOrdersList lang={lang} orders={orders} commissionRatePercent={commissionRatePercent} />
    </SellerStatusGate>
  );
}
