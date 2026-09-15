import { notFound } from "next/navigation";
import ProductForm from "@/components/admin/ProductForm";
import { adminCategories, adminProduct, adminSellers, adminSettings } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

export default async function ProductFormPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSection("catalog.products");
  const { id } = await params;
  const [lang, cats, settings, sellers] = await Promise.all([
    getLang(), adminCategories(), adminSettings(), adminSellers(),
  ]);
  const product = id === "new" ? null : await adminProduct(id);
  if (id !== "new" && !product) notFound();

  return (
    <ProductForm
      lang={lang} cats={cats} product={product} settings={settings}
      // Approved only, and only the two fields the select needs. A pending
      // or suspended store is not somewhere a product can be filed: the
      // storefront resolves "Sold by" from the approved set, so the
      // product would sell with the line missing and the sale counted
      // against a store the shop does not show.
      sellers={sellers
        .filter((s) => s.status === "approved")
        .map((s) => ({ id: s.id, store_name: s.store_name }))}
    />
  );
}
