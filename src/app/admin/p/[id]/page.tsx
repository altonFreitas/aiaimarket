import { notFound } from "next/navigation";
import ProductForm from "@/components/admin/ProductForm";
import { adminCategories, adminProduct, adminSettings } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";

export default async function ProductFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lang, cats, settings] = await Promise.all([
    getLang(), adminCategories(), adminSettings(),
  ]);
  const product = id === "new" ? null : await adminProduct(id);
  if (id !== "new" && !product) notFound();

  return <ProductForm lang={lang} cats={cats} product={product} settings={settings} />;
}
