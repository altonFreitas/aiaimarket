import StatisticsAdmin from "@/components/admin/StatisticsAdmin";
import { adminStats } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";

export default async function StatisticsPage() {
  const [lang, stats] = await Promise.all([getLang(), adminStats()]);
  return <StatisticsAdmin lang={lang} stats={stats} />;
}
