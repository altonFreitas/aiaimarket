"use server";
import { requireSection } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import {
  buildMatrix, newVariantsOnly, orphanedLabels,
  TooManyVariants, type VariantAxis,
} from "@/lib/taxonomy/variantMatrix";

/* CREATING AND MAINTAINING A PRODUCT'S VARIANTS.
 *
 * GENERATING IS ADDITIVE, ALWAYS. A shop adding a fourth size to a shirt
 * already selling three wants one more variant, not twelve replacements:
 * the existing rows carry SKUs, prices, barcodes and -- the one that
 * cannot be recreated -- stock, which is ledger history pointing at that
 * variant id. So generate() only inserts what is genuinely new, and
 * reports what the axes no longer cover instead of deleting it.
 *
 * DELETING ONE IS REFUSED WHILE IT HOLDS STOCK, for the same reason the
 * attribute builder refuses an attribute in use. The ledger reference is
 * ON DELETE SET NULL, so the history would survive -- but it would survive
 * as movements belonging to no variant, silently folded back into the
 * "never recorded" pool that backs every OTHER variant. Six White/XL in
 * the stockroom would become six units of everything.
 */

export interface GenerateInput {
  productId: string;
  axes: VariantAxis[];
}

export interface GenerateResult {
  created: number;
  /** Labels the product still has that the axes no longer produce. Named,
   * never removed -- they may be units on a shelf. */
  orphaned: string[];
  error?: string;
}

export async function generateVariants(input: GenerateInput): Promise<GenerateResult> {
  await requireSection("catalog.products");
  const { productId, axes } = input;
  if (!productId) return { created: 0, orphaned: [], error: "No product." };

  const sb = supabaseAdmin();

  /* ONLY ATTRIBUTES THE CATALOGUE CALLS VARIANT AXES.
     Read from the database rather than trusted from the form: a variant
     per Brand would multiply the catalogue by something that never varies,
     and nothing in the browser should be able to decide that. */
  const ids = axes.map((a) => a.attributeId).filter(Boolean);
  if (!ids.length) return { created: 0, orphaned: [] };

  const { data: allowed } = await sb
    .from("attributes").select("id").in("id", ids).eq("is_variant", true);
  const ok = new Set(((allowed ?? []) as { id: string }[]).map((a) => a.id));
  const clean = axes.filter((a) => ok.has(a.attributeId));
  if (!clean.length) {
    return { created: 0, orphaned: [], error: "None of those fields can vary." };
  }

  let matrix;
  try {
    matrix = buildMatrix(clean);
  } catch (e) {
    if (e instanceof TooManyVariants) return { created: 0, orphaned: [], error: e.message };
    throw e;
  }

  const { data: existing } = await sb
    .from("product_variants").select("label").eq("product_id", productId);
  const labels = ((existing ?? []) as { label: string }[]).map((v) => v.label);

  const fresh = newVariantsOnly(matrix, labels);
  const orphaned = orphanedLabels(matrix, labels);

  if (fresh.length) {
    const { data: made, error } = await sb.from("product_variants")
      .insert(fresh.map((v, i) => ({
        product_id: productId, label: v.label, display_order: labels.length + i,
      })))
      .select("id,label");
    if (error) throw error;

    /* What each new variant IS, so a filter can find every Black one
       across every size without parsing the label back apart. */
    const byLabel = new Map(
      ((made ?? []) as { id: string; label: string }[]).map((v) => [v.label, v.id]));
    const rows = fresh.flatMap((v) => {
      const id = byLabel.get(v.label);
      return id ? v.values.map((x) => ({
        variant_id: id, attribute_id: x.attributeId, value: x.value,
      })) : [];
    });
    if (rows.length) {
      const { error: vErr } = await sb.from("variant_attribute_values").insert(rows);
      if (vErr) throw vErr;
    }
  }

  revalidatePath("/admin/products");
  return { created: fresh.length, orphaned };
}

export interface VariantPatch {
  sku?: string | null;
  barcode?: string | null;
  price?: number | null;
  discount_price?: number | null;
  cost_price?: number | null;
  weight?: number | null;
  status?: "active" | "hidden";
}

export async function updateVariant(id: string, patch: VariantPatch) {
  await requireSection("catalog.products");
  const sb = supabaseAdmin();

  /* Empty means "as the product", and that is a real answer rather than a
     missing one -- a t-shirt whose sizes all cost the same carries null in
     every one of them, and changing the product's price still moves all of
     them at once. So a blank box clears the override rather than being
     ignored. */
  const body: Record<string, unknown> = {};
  if ("sku" in patch) body.sku = patch.sku?.trim() || null;
  if ("barcode" in patch) body.barcode = patch.barcode?.trim() || null;
  if ("price" in patch) body.price = num(patch.price);
  if ("discount_price" in patch) body.discount_price = num(patch.discount_price);
  if ("cost_price" in patch) body.cost_price = num(patch.cost_price);
  if ("weight" in patch) body.weight = num(patch.weight);
  if (patch.status) body.status = patch.status;

  const { error } = await sb.from("product_variants").update(body).eq("id", id);
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new Error("That SKU is already used by another variant.");
    }
    throw error;
  }
  revalidatePath("/admin/products");
}

export async function deleteVariant(id: string) {
  await requireSection("catalog.products");
  const sb = supabaseAdmin();

  /* REFUSED WHILE IT HOLDS STOCK. The ledger reference is ON DELETE SET
     NULL, so the movements would survive -- as movements belonging to no
     variant, which the availability rule folds back into the pool that
     backs EVERY variant. Six White/XL in the stockroom would silently
     become six units of everything. Hiding takes it off sale and keeps
     the shelf honest. */
  const { count } = await sb.from("stock_movements")
    .select("id", { count: "exact", head: true }).eq("variant_id", id);
  if ((count ?? 0) > 0) {
    throw new Error(
      `This option has stock movements recorded against it. Hide it instead.`);
  }

  const { error } = await sb.from("product_variants").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/products");
}

function num(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
