import OrdersAdmin from "@/components/admin/OrdersAdmin";
import { adminOrdersView } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";

export default async function OrdersPage() {
  const [lang, view] = await Promise.all([getLang(), adminOrdersView()]);
  return <OrdersAdmin lang={lang} orders={view.orders} ordersToday={view.ordersToday} />;
}
