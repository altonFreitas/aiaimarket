import { notFound } from "next/navigation";
import PurchaseOrderForm from "@/components/admin/procurement/PurchaseOrderForm";
import { adminPurchaseOrder, adminSuppliers } from "@/lib/data/procurement";
import { adminProducts, adminCategories } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lang, po, suppliers, products, categories] = await Promise.all([
    getLang(), adminPurchaseOrder(id), adminSuppliers(), adminProducts(), adminCategories(),
  ]);
  if (!po) notFound();
  return (
    <PurchaseOrderForm
      lang={lang} suppliers={suppliers} po={po}
      products={products.filter((p) => !p.archived)} categories={categories}
    />
  );
}
