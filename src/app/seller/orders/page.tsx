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
  const settings = await adminSettings();
  // Their current rate: shown as the heading, and used as the fallback for
  // lines placed before rates were recorded on them.
  const commissionRatePercent = seller.commission_rate ?? settings.commission_rate;
  const orders = seller.status === "approved"
    ? await getSellerOrders(seller.id, commissionRatePercent)
    : [];

  return (
    <SellerStatusGate seller={seller} lang={lang}>
      <SellerOrdersList lang={lang} orders={orders} commissionRatePercent={commissionRatePercent} />
    </SellerStatusGate>
  );
}
