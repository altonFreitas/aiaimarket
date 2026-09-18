import OrdersAdmin from "@/components/admin/OrdersAdmin";
import { adminOrdersView } from "@/lib/data/admin";
import { todayIso } from "@/lib/sales";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";
import { getSettings } from "@/lib/data/public";

export default async function OrdersPage() {
  await requireSection("sales.orders");
  const [lang, view, settings] = await Promise.all([
    getLang(), adminOrdersView(), getSettings(),
  ]);
  return (
    <OrdersAdmin
      lang={lang}
      orders={view.orders}
      /* For the delivery note each row can now print: its header is the
         shop's name, address and registration. */
      settings={settings}
      ordersToday={view.ordersToday}
      // Today comes from the SERVER, for the same reason the count beside
      // it does: an admin with a skewed device clock must not get a
      // different "today" than the data does.
      today={todayIso()}
    />
  );
}
