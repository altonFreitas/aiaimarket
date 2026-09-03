import CostsAdmin from "@/components/admin/sales/CostsAdmin";
import { adminProducts, adminCategories } from "@/lib/data/admin";
import { adminProductCosts, salesReady } from "@/lib/data/sales";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

export default async function CostsPage() {
  await requireSection("catalog");
  const [lang, products, categories, costs, ready] = await Promise.all([
    getLang(), adminProducts(), adminCategories(), adminProductCosts(), salesReady(),
  ]);

  return (
    <CostsAdmin
      lang={lang} products={products} categories={categories}
      costs={costs} ready={ready}
    />
  );
}
