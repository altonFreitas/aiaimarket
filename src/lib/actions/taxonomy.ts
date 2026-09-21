"use server";
import { requireAnySection } from "./guard";
import { productTypesOf, attributesForType } from "@/lib/data/taxonomy";
import type { ProductType, FormAttribute } from "@/lib/taxonomy/types";

/* WHAT THE FORM ASKS FOR AS SOMEBODY FILLS IT IN.
 *
 * Section 24: the form never loads the whole taxonomy. The page arrives
 * holding 25 categories and nothing else; each of these is called when a
 * choice is made, and returns only what the next control needs. Picking
 * "Home, Furniture & Living" fetches one subcategory, not the other 266
 * product types in the catalogue.
 *
 * THE CATEGORY IS NOT ONE OF THEM. Loading subcategories used to be an
 * action too, called by the picker's own Category dropdown. Both the
 * product form and the purchase order line already hold every category the
 * page loaded with -- there are twenty-five of them -- so asking the
 * server for the children of one was a round trip to re-read rows that
 * were already in the browser.
 *
 * GUARDED, THOUGH THEY ONLY READ. The taxonomy is public on the
 * storefront, so none of this is secret -- but these are called from a
 * form, and an action reachable without a session is one more thing to
 * remember about later.
 *
 * BY EITHER SECTION, because two screens draw the same lists: the product
 * form under Catalog and a purchase order line under Procurement. A buyer
 * who may place orders but not edit the catalogue still has to be able to
 * say what kind of thing they are buying.
 */

/** The product types filed under one category or subcategory. */
export async function loadProductTypes(nodeId: string): Promise<ProductType[]> {
  await requireAnySection("catalog.products", "procurement");
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
  await requireAnySection("catalog.products", "procurement");
  return attributesForType(productTypeId, { includeAdminOnly: true });
}
