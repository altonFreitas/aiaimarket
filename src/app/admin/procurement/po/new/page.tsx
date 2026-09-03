import { notFound } from "next/navigation";
import PurchaseOrderForm from "@/components/admin/procurement/PurchaseOrderForm";
import { adminSuppliers, procurementReady } from "@/lib/data/procurement";
import { adminProducts, adminCategories } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";
import { parsePrefillLines } from "@/lib/replenishment";
import { requireSection } from "@/lib/actions/guard";

export default async function NewPurchaseOrderPage({ searchParams }: {
  searchParams: Promise<{ supplier?: string; lines?: string }>;
}) {
  await requireSection("procurement");
  const params = await searchParams;
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
      prefill={{
        // Only a supplier that actually exists: a stale link must not leave
        // the form pointing at nothing.
        supplierId: suppliers.some((s) => s.id === params.supplier) ? params.supplier : undefined,
        lines: parsePrefillLines(params.lines),
      }}
    />
  );
}
