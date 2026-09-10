import SellersAdmin from "@/components/admin/SellersAdmin";
import SellerInvites from "@/components/admin/SellerInvites";
import { adminSellers, adminSellerInvites, adminOrders, adminProducts, adminSettings } from "@/lib/data/admin";
import { computeMarketplaceStats } from "@/lib/stats";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

export default async function AdminSellersPage() {
  await requireSection("sellers");
  const [lang, sellers, invites, orders, products, settings] = await Promise.all([
    getLang(), adminSellers(), adminSellerInvites(), adminOrders(), adminProducts(), adminSettings(),
  ]);
  const marketplace = computeMarketplaceStats(
    sellers, orders, products, settings?.commission_rate ?? 10
  );
  return (
    <>
      <SellersAdmin lang={lang} sellers={sellers} marketplace={marketplace} />
      {/* Below the list, not above it: approving the store that has just
          applied is the work waiting today; inviting the next one is not. */}
      <SellerInvites lang={lang} invites={invites} />
    </>
  );
}
