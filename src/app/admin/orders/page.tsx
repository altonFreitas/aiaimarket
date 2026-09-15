import OrdersAdmin from "@/components/admin/OrdersAdmin";
import { adminOrdersView } from "@/lib/data/admin";
import { todayIso } from "@/lib/sales";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

export default async function OrdersPage() {
  await requireSection("sales.orders");
  const [lang, view] = await Promise.all([getLang(), adminOrdersView()]);
  return (
    <OrdersAdmin
      lang={lang}
      orders={view.orders}
      ordersToday={view.ordersToday}
      // Today comes from the SERVER, for the same reason the count beside
      // it does: an admin with a skewed device clock must not get a
      // different "today" than the data does.
      today={todayIso()}
    />
  );
}
