import { notFound } from "next/navigation";
import ProductForm from "@/components/admin/ProductForm";
import { adminCategories, adminProduct, adminSellers, adminSettings } from "@/lib/data/admin";
import { taxonomyRoots, attributeValuesOf } from "@/lib/data/taxonomy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";
import type { TaxonomySelection } from "@/components/admin/TaxonomyPicker";
import type { VariantRow } from "@/components/admin/VariantEditor";

export default async function ProductFormPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSection("catalog.products");
  const { id } = await params;
  const [lang, cats, settings, sellers, roots] = await Promise.all([
    getLang(), adminCategories(), adminSettings(), adminSellers(), taxonomyRoots(),
  ]);
  const product = id === "new" ? null : await adminProduct(id);
  if (id !== "new" && !product) notFound();

  // What this product already answers, and where it sits in the tree.
  const initialTaxonomy = product ? await selectionFor(product.id) : undefined;
  const variants = product ? await variantsFor(product.id) : [];

  return (
    <ProductForm
      lang={lang} cats={cats} product={product} settings={settings}
      taxonomyRoots={roots}
      initialTaxonomy={initialTaxonomy}
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
 * it was -- category, subcategory, product type -- and then fill in every
 * answer. Only the product type is stored on the product; the two levels
 * above it are walked back up through categories.parent_id, so the tree is
 * described in exactly one place and cannot drift.
 *
 * Returns undefined for a product with no type, which is every product
 * created before this existed. They open with the picker empty and
 * everything else exactly as before -- see section 23. */
async function selectionFor(productId: string): Promise<TaxonomySelection | undefined> {
  try {
    const sb = supabaseAdmin();
    const { data: p } = await sb
      .from("products").select("product_type_id").eq("id", productId).maybeSingle();
    const typeId = (p as { product_type_id?: string } | null)?.product_type_id;
    if (!typeId) return undefined;

    const { data: pt } = await sb
      .from("product_types").select("category_id").eq("id", typeId).maybeSingle();
    const nodeId = (pt as { category_id?: string } | null)?.category_id;
    if (!nodeId) return undefined;

    // The node the type hangs off is either a subcategory (it has a
    // parent) or a category in its own right.
    const { data: node } = await sb
      .from("categories").select("id,parent_id").eq("id", nodeId).maybeSingle();
    const n = node as { id: string; parent_id: string | null } | null;
    if (!n) return undefined;

    const values: Record<string, string[]> = {};
    for (const v of await attributeValuesOf(productId)) {
      (values[v.attribute_id] ??= []).push(v.value);
    }

    return {
      categoryId: n.parent_id ?? n.id,
      subcategoryId: n.parent_id ? n.id : "",
      productTypeId: typeId,
      values,
    };
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
