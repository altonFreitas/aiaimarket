import { notFound } from "next/navigation";
import SuppliersAdmin from "@/components/admin/procurement/SuppliersAdmin";
import { adminProcurementData } from "@/lib/data/procurement";
import { supplierPerformance, todayIso } from "@/lib/procurement";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

export default async function SuppliersPage() {
  await requireSection("procurement");
  const [lang, data] = await Promise.all([getLang(), adminProcurementData()]);
  if (!data.ready) notFound();
  // Performance is computed here, on the server, so the page ships numbers
  // rather than the whole purchasing book for the browser to reduce.
  const perf = supplierPerformance(data.purchaseOrders, data.suppliers, todayIso());
  return <SuppliersAdmin lang={lang} performance={perf} />;
}
