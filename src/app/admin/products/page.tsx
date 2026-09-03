import ProductList from "@/components/admin/ProductList";
import { adminCategories, adminProducts } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

export default async function AdminProductsPage() {
  await requireSection("catalog");
  const [lang, products, cats] = await Promise.all([
    getLang(), adminProducts(), adminCategories(),
  ]);
  return <ProductList lang={lang} products={products} cats={cats} />;
}
