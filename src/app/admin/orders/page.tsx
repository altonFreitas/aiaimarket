import OrdersAdmin from "@/components/admin/OrdersAdmin";
import { adminOrders } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";

export default async function OrdersPage() {
  const [lang, orders] = await Promise.all([getLang(), adminOrders()]);
  return <OrdersAdmin lang={lang} orders={orders} />;
}
