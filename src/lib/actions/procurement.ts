"use server";
import { requireAdmin } from "./guard";
import { PLATFORM } from "@/lib/procurementScope";
import {
  saveSupplierIn, deleteSupplierIn,
  savePurchaseOrderIn, setPurchaseOrderStatusIn, deletePurchaseOrderIn,
  type SupplierInput, type PurchaseOrderInput, type PoLineInput,
} from "@/lib/purchasing";
import type { PoStatus } from "@/lib/types";

/* The owner's purchasing, which is the marketplace's own.
 *
 * Everything these do lives in lib/purchasing.ts, because a seller granted
 * "My purchases" does the same things to the same tables for their own
 * store (lib/actions/seller-procurement.ts). What each of these adds is the
 * only part that must not be shared: WHO is asking, and therefore whose
 * rows are in reach. The scope is decided here, by a guard, and is never
 * something a caller can name -- see the note at the top of purchasing.ts.
 */

export type { SupplierInput, PurchaseOrderInput, PoLineInput };

export async function saveSupplier(input: SupplierInput): Promise<string> {
  await requireAdmin();
  return saveSupplierIn(PLATFORM, input);
}

export async function deleteSupplier(id: string) {
  await requireAdmin();
  return deleteSupplierIn(PLATFORM, id);
}

export async function savePurchaseOrder(input: PurchaseOrderInput): Promise<string> {
  await requireAdmin();
  return savePurchaseOrderIn(PLATFORM, input);
}

export async function setPurchaseOrderStatus(id: string, status: PoStatus) {
  await requireAdmin();
  return setPurchaseOrderStatusIn(PLATFORM, id, status);
}

export async function deletePurchaseOrder(id: string) {
  await requireAdmin();
  return deletePurchaseOrderIn(PLATFORM, id);
}
