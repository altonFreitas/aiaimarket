"use server";
import { requireSection } from "./guard";
import {
  subcategoriesOf, productTypesOf, attributesForType,
} from "@/lib/data/taxonomy";
import type { TaxonomyNode, ProductType, FormAttribute } from "@/lib/taxonomy/types";

/* WHAT THE FORM ASKS FOR AS SOMEBODY FILLS IT IN.
 *
 * Section 24: the form never loads the whole taxonomy. The page arrives
 * holding 25 categories and nothing else; each of these is called when a
 * choice is made, and returns only what the next control needs. Picking
 * "Home, Furniture & Living" fetches one subcategory, not the other 266
 * product types in the catalogue.
 *
 * GUARDED, THOUGH THEY ONLY READ. The taxonomy is public on the
 * storefront, so none of this is secret -- but these are called from the
 * product form, and an action reachable without a session is one more
 * thing to remember about later. requireSection is what every other
 * catalogue action uses.
 */

/** The subcategories under one category. */
export async function loadSubcategories(categoryId: string): Promise<TaxonomyNode[]> {
  await requireSection("catalog.products");
  return subcategoriesOf(categoryId);
}

/** The product types filed under one category or subcategory. */
export async function loadProductTypes(nodeId: string): Promise<ProductType[]> {
  await requireSection("catalog.products");
  return productTypesOf(nodeId);
}

/** THE ONE THAT DRAWS THE FORM: every attribute this product type asks
 * for, with its options, in order.
 *
 * Admin-only attributes ARE included here -- this is the owner's own
 * product form, which is the one place they are meant to be visible. The
 * storefront reads the same taxonomy through lib/data/taxonomy.ts without
 * that flag, and the row-level policy refuses them there as well, so the
 * decision is not left to a caller remembering. */
export async function loadAttributes(productTypeId: string): Promise<FormAttribute[]> {
  await requireSection("catalog.products");
  return attributesForType(productTypeId, { includeAdminOnly: true });
}
