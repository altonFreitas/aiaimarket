import CostsAdmin from "@/components/admin/sales/CostsAdmin";
import { adminProducts, adminCategories } from "@/lib/data/admin";
import { adminProductCosts, salesReady } from "@/lib/data/sales";
import { allVariantCosts } from "@/lib/data/variantCosts";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

export default async function CostsPage() {
  await requireSection("catalog.costs");
  const [lang, products, categories, costs, ready, variants] = await Promise.all([
    getLang(), adminProducts(), adminCategories(), adminProductCosts(), salesReady(),
    /* The SKUs behind each product's one cost row -- what the purchase
       order paid and charged for each size and colour. Empty on a
       database without the variant tables, and the screen then reads
       exactly as it did before. */
    allVariantCosts(),
  ]);

  return (
    <CostsAdmin
      lang={lang} products={products} categories={categories}
      costs={costs} ready={ready}
      /* A plain object, not the Map: this crosses into a client
         component, and a Map does not survive that. */
      variants={Object.fromEntries(variants)}
    />
  );
}
