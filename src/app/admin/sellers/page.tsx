import SellersAdmin from "@/components/admin/SellersAdmin";
import { adminSellers, adminOrders, adminProducts, adminSettings } from "@/lib/data/admin";
import { computeMarketplaceStats } from "@/lib/stats";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

export default async function AdminSellersPage() {
  await requireSection("sellers");
  const [lang, sellers, orders, products, settings] = await Promise.all([
    getLang(), adminSellers(), adminOrders(), adminProducts(), adminSettings(),
  ]);
  const marketplace = computeMarketplaceStats(
    sellers, orders, products, settings?.commission_rate ?? 10
  );
  return <SellersAdmin lang={lang} sellers={sellers} marketplace={marketplace} />;
}
