import DemandAdmin from "@/components/admin/demand/DemandAdmin";
import { adminProducts, adminOrders, adminCategories } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";

export default async function DemandPage() {
  const [lang, products, orders, categories] = await Promise.all([
    getLang(), adminProducts(), adminOrders(), adminCategories(),
  ]);
  return <DemandAdmin lang={lang} products={products} orders={orders} categories={categories} />;
}
