import SellersAdmin from "@/components/admin/SellersAdmin";
import { adminSellers, adminOrders, adminProducts, adminSettings } from "@/lib/data/admin";
import { computeMarketplaceStats } from "@/lib/stats";
import { getLang } from "@/lib/lang";

export default async function AdminSellersPage() {
  const [lang, sellers, orders, products, settings] = await Promise.all([
    getLang(), adminSellers(), adminOrders(), adminProducts(), adminSettings(),
  ]);
  const marketplace = computeMarketplaceStats(
    sellers, orders, products, settings?.commission_rate ?? 10
  );
  return <SellersAdmin lang={lang} sellers={sellers} marketplace={marketplace} />;
}
