import { notFound } from "next/navigation";
import PurchaseOrderForm from "@/components/admin/procurement/PurchaseOrderForm";
import { adminSuppliers, procurementReady } from "@/lib/data/procurement";
import { getLang } from "@/lib/lang";

export default async function NewPurchaseOrderPage() {
  const [lang, ready] = await Promise.all([getLang(), procurementReady()]);
  if (!ready) notFound();
  const suppliers = await adminSuppliers();
  return <PurchaseOrderForm lang={lang} suppliers={suppliers} po={null} />;
}
