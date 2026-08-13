import StatisticsAdmin from "@/components/admin/StatisticsAdmin";
import { adminStats, adminSellers, adminProducts, adminSettings, adminOrders } from "@/lib/data/admin";
import { computeMarketplaceStats } from "@/lib/stats";
import { getLang } from "@/lib/lang";

export default async function StatisticsPage() {
  const [lang, stats, sellers, products, settings, orders] = await Promise.all([
    getLang(), adminStats(), adminSellers(), adminProducts(), adminSettings(), adminOrders(),
  ]);
  const marketplace = computeMarketplaceStats(sellers, orders, products, settings?.commission_rate ?? 10);
  return <StatisticsAdmin lang={lang} stats={stats} marketplace={marketplace} />;
}
