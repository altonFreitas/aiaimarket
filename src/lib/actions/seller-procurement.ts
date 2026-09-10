"use server";
import { requireSellerFeature } from "./guard";
import { sellerScope } from "@/lib/procurementScope";
import {
  saveSupplierIn, deleteSupplierIn,
  savePurchaseOrderIn, setPurchaseOrderStatusIn, deletePurchaseOrderIn,
  type SupplierInput, type PurchaseOrderInput,
} from "@/lib/purchasing";
import type { PoStatus } from "@/lib/types";

/* A seller's own buying.
 *
 * Every one of these is the owner's action with one word changed: the scope
 * comes from requireSellerFeature("procurement") instead of requireAdmin,
 * so it is this store's and cannot be anything else. The work itself is
 * shared (lib/purchasing.ts), which is what keeps the validation -- dates,
 * currencies, quantities, the refusal to edit an order whose goods have
 * already landed -- identical for both.
 *
 * requireSellerFeature does three things before any of this runs: the
 * seller is signed in, their store is approved, and "My purchases" has
 * actually been granted to them. A store that stops paying for it loses
 * these the moment the owner unticks the box.
 */

export async function saveSellerSupplier(input: SupplierInput): Promise<string> {
  const seller = await requireSellerFeature("procurement");
  return saveSupplierIn(sellerScope(seller.id), input);
}

export async function deleteSellerSupplier(id: string) {
  const seller = await requireSellerFeature("procurement");
  return deleteSupplierIn(sellerScope(seller.id), id);
}

export async function saveSellerPurchaseOrder(input: PurchaseOrderInput): Promise<string> {
  const seller = await requireSellerFeature("procurement");
  return savePurchaseOrderIn(sellerScope(seller.id), input);
}

/** Moving an order along, including to "received" -- which is what puts the
 * goods on this store's shelf and creates the store's own listing for
 * anything it had never sold before. */
export async function setSellerPurchaseOrderStatus(id: string, status: PoStatus) {
  const seller = await requireSellerFeature("procurement");
  return setPurchaseOrderStatusIn(sellerScope(seller.id), id, status);
}

export async function deleteSellerPurchaseOrder(id: string) {
  const seller = await requireSellerFeature("procurement");
  return deletePurchaseOrderIn(sellerScope(seller.id), id);
}
