import OrdersAdmin from "@/components/admin/OrdersAdmin";
import { adminOrdersView } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

export default async function OrdersPage() {
  await requireSection("sales");
  const [lang, view] = await Promise.all([getLang(), adminOrdersView()]);
  return <OrdersAdmin lang={lang} orders={view.orders} ordersToday={view.ordersToday} />;
}
