import ProductList from "@/components/admin/ProductList";
import { adminCategories, adminProducts } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";

export default async function AdminProductsPage() {
  const [lang, products, cats] = await Promise.all([
    getLang(), adminProducts(), adminCategories(),
  ]);
  return <ProductList lang={lang} products={products} cats={cats} />;
}
