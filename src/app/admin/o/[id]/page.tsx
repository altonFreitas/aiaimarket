import { notFound } from "next/navigation";
import OrderAdmin from "@/components/admin/OrderAdmin";
import OrderNotifications from "@/components/admin/OrderNotifications";
import { adminOrder, adminOrderNotifications, adminSettings } from "@/lib/data/admin";
import { notificationsAutomatic } from "@/lib/notify/registry";
import { getLang } from "@/lib/lang";

export default async function OrderAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lang, order, settings, notifications] = await Promise.all([
    getLang(), adminOrder(id), adminSettings(), adminOrderNotifications(id),
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
      <OrderNotifications
        lang={lang}
        notifications={notifications}
        automatic={notificationsAutomatic()}
        migrated={migrated}
      />
    </>
  );
}
