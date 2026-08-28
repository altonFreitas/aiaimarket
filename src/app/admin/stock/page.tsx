import StockAdmin from "@/components/admin/StockAdmin";
import { adminStockReport } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";

/** Stock control: every listing, what the database thinks is on the shelf,
 * and what the orders table has already promised away. */
export default async function AdminStockPage() {
  const [lang, report] = await Promise.all([getLang(), adminStockReport()]);
  return <StockAdmin lang={lang} report={report} />;
}
