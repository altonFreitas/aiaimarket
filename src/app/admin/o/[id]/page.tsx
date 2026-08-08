import { notFound } from "next/navigation";
import OrderAdmin from "@/components/admin/OrderAdmin";
import { adminOrder, adminSettings } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";

export default async function OrderAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lang, order, settings] = await Promise.all([
    getLang(), adminOrder(id), adminSettings(),
  ]);
  if (!order) notFound();
  return <OrderAdmin lang={lang} order={order} settings={settings} />;
}
