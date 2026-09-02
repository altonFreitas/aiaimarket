import { notFound } from "next/navigation";
import ReorderPlan from "@/components/admin/procurement/ReorderPlan";
import { adminReplenishment } from "@/lib/data/admin";
import { procurementReady } from "@/lib/data/procurement";
import { getLang } from "@/lib/lang";

/** What to buy, how much, and by when -- the question the stock screen
 * cannot answer, because "low" depends entirely on how fast a thing sells. */
export default async function ReorderPage() {
  const [lang, ready] = await Promise.all([getLang(), procurementReady()]);
  if (!ready) notFound();
  const rows = await adminReplenishment();
  return <ReorderPlan lang={lang} rows={rows} />;
}
