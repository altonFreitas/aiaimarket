import { notFound } from "next/navigation";
import ProductForm from "@/components/admin/ProductForm";
import { adminCategories, adminProduct, adminSellers, adminSettings } from "@/lib/data/admin";
import { attributeValuesOf } from "@/lib/data/taxonomy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";
import type { TaxonomySelection } from "@/components/admin/TaxonomyPicker";
import type { VariantRow } from "@/components/admin/VariantEditor";

export default async function ProductFormPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSection("catalog.products");
  const { id } = await params;
  const [lang, cats, settings, sellers] = await Promise.all([
    getLang(), adminCategories(), adminSettings(), adminSellers(),
  ]);
  const product = id === "new" ? null : await adminProduct(id);
  if (id !== "new" && !product) notFound();

  // What this product already answers, and which type asked.
  const saved = product ? await selectionFor(product.id) : undefined;
  const variants = product ? await variantsFor(product.id) : [];

  return (
    <ProductForm
      lang={lang} cats={cats} product={product} settings={settings}
      initialTaxonomy={saved?.selection}
      currentType={saved?.type ?? null}
      variants={variants}
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

/* REBUILDING THE FORM'S STATE FROM WHAT WAS STORED.
 *
 * Section 14: opening an existing product has to put the picker back where
 * it was and then fill in every answer.
 *
 * IT NO LONGER WALKS UP THE TREE, and that is the point of the change it
 * belongs to. There used to be two Category dropdowns on this form, and
 * this function answered the second one by climbing from the product type
 * to its node and up through categories.parent_id. There is one pair now,
 * and it is answered by products.category_id -- where the product is
 * actually filed, which is what the shop menu and /c/[slug] read. So all
 * that is wanted here is the type and its answers.
 *
 * THE TYPE'S NAME COMES WITH IT. A product type need not hang off the node
 * its product is filed under, and in this shop it usually does not:
 * /admin/migrate files the Tetum category "Sapatu" under the English type
 * "Shoes", which lives under "Footwear". The picker offers the type it was
 * given even when the node's own list does not contain it, and it needs
 * the name to print.
 *
 * Returns undefined for a product with no type, which is every product
 * created before this existed. They open with the picker empty and
 * everything else exactly as before -- see section 23. */
async function selectionFor(productId: string): Promise<{
  selection: TaxonomySelection; type: { id: string; name: string } | null;
} | undefined> {
  try {
    const sb = supabaseAdmin();
    const { data: p } = await sb
      .from("products").select("product_type_id").eq("id", productId).maybeSingle();
    const typeId = (p as { product_type_id?: string } | null)?.product_type_id;
    if (!typeId) return undefined;

    const { data: pt } = await sb
      .from("product_types").select("id,name").eq("id", typeId).maybeSingle();
    const type = (pt as { id: string; name: string } | null) ?? null;

    const values: Record<string, string[]> = {};
    for (const v of await attributeValuesOf(productId)) {
      (values[v.attribute_id] ??= []).push(v.value);
    }

    return { selection: { productTypeId: typeId, values }, type };
  } catch {
    // The migration window: no taxonomy tables yet. The product still
    // opens and still saves -- it simply has no type to show.
    return undefined;
  }
}

/* THE COMBINATIONS, WITH WHAT THE LEDGER SAYS IS ON THE SHELF.
 *
 * The balance comes from product_variant_stock, a GROUP BY over the ledger
 * -- not from a column on the variant. There is exactly one account of how
 * stock got where it is, and a second number stored beside it would be a
 * second answer to the same question, wrong the first time anything failed
 * midway. */
async function variantsFor(productId: string): Promise<VariantRow[]> {
  try {
    const sb = supabaseAdmin();
    const [{ data: rows }, { data: bal }] = await Promise.all([
      sb.from("product_variants")
        .select("id,label,sku,price,cost_price,status")
        .eq("product_id", productId).order("display_order"),
      sb.from("product_variant_stock").select("variant_id,qty")
        .eq("product_id", productId),
    ]);
    if (!rows) return [];

    const onHand = new Map(
      ((bal ?? []) as { variant_id: string; qty: number }[])
        .map((b) => [b.variant_id, b.qty]));

    return (rows as Omit<VariantRow, "onHand">[]).map((v) => ({
      ...v, onHand: onHand.get(v.id) ?? 0,
    }));
  } catch {
    // The migration window again: no variant tables yet.
    return [];
  }
}
