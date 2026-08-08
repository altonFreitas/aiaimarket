import CategoriesAdmin from "@/components/admin/CategoriesAdmin";
import { adminCategories, adminProducts } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";

export default async function CatsPage() {
  const [lang, cats, products] = await Promise.all([
    getLang(), adminCategories(), adminProducts(),
  ]);
  return <CategoriesAdmin lang={lang} cats={cats} products={products.filter((p) => !p.archived)} />;
}
