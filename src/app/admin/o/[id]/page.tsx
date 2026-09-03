import { notFound } from "next/navigation";
import OrderAdmin from "@/components/admin/OrderAdmin";
import OrderNotifications from "@/components/admin/OrderNotifications";
import OrderReturns from "@/components/admin/OrderReturns";
import { adminOrder, adminOrderNotifications, adminOrderReturns, adminSettings } from "@/lib/data/admin";
import { notificationsAutomatic } from "@/lib/notify/registry";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

export default async function OrderAdminPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSection("sales");
  const { id } = await params;
  const [lang, order, settings, notifications, returns] = await Promise.all([
    getLang(), adminOrder(id), adminSettings(), adminOrderNotifications(id),
    adminOrderReturns(id),
  ]);
  if (!order) notFound();

  // `lang` on the order row is only present once notifications.sql has run,
  // which makes it a reliable stand-in for "is this store migrated yet" --
  // and lets the panel say so plainly instead of rendering an empty list
  // that looks like a bug.
  const migrated = order.lang !== undefined;

  return (
    <>
      <OrderAdmin lang={lang} order={order} settings={settings} />
      <OrderReturns lang={lang} order={order} returns={returns} />
      <OrderNotifications
        lang={lang}
        orderId={order.id}
        orderStatus={order.status}
        notifications={notifications}
        automatic={notificationsAutomatic()}
        migrated={migrated}
      />
    </>
  );
}
