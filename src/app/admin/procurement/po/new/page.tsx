import { notFound } from "next/navigation";
import PurchaseOrderForm from "@/components/admin/procurement/PurchaseOrderForm";
import { adminSuppliers, procurementReady } from "@/lib/data/procurement";
import { adminProducts, adminCategories } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";

export default async function NewPurchaseOrderPage() {
  const [lang, ready] = await Promise.all([getLang(), procurementReady()]);
  if (!ready) notFound();
  const [suppliers, products, categories] = await Promise.all([
    adminSuppliers(), adminProducts(), adminCategories(),
  ]);
  // Archived products are excluded: buying more of something you have
  // retired should create a fresh listing rather than quietly revive it.
  return (
    <PurchaseOrderForm
      lang={lang} suppliers={suppliers} po={null}
      products={products.filter((p) => !p.archived)} categories={categories}
    />
  );
}
