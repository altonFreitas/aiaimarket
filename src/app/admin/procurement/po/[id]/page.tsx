import { notFound } from "next/navigation";
import PurchaseOrderForm from "@/components/admin/procurement/PurchaseOrderForm";
import { adminPurchaseOrder, adminSuppliers } from "@/lib/data/procurement";
import { purchaseOrderSpecs } from "@/lib/data/poSpecs";
import { adminProducts, adminCategories } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSection("procurement.orders");
  const { id } = await params;
  const [lang, po, suppliers, products, categories] = await Promise.all([
    getLang(), adminPurchaseOrder(id), adminSuppliers(), adminProducts(), adminCategories(),
  ]);
  if (!po) notFound();
  /* After the order, because it reads its lines. What each line's product
     type and answers are CALLED -- the PDF is built in the browser and has
     no way to resolve a uuid. */
  const lineSpecs = await purchaseOrderSpecs(po);
  return (
    <PurchaseOrderForm
      lang={lang} suppliers={suppliers} po={po}
      products={products.filter((p) => !p.archived)} categories={categories}
      lineSpecs={lineSpecs}
    />
  );
}
