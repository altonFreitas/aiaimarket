/* Whose buying a screen is looking at.
 *
 * suppliers and purchase_orders each carry a nullable seller_id (see
 * supabase/seller-procurement.sql): null is the marketplace's own, a uuid
 * is one store's. Every read filters on it and every write stamps it, and
 * getting that wrong in either direction is the whole risk of the feature
 * -- a seller reading the owner's supplier prices, or one store editing
 * another's orders.
 *
 * So the rule lives here, once, as three small functions with no I/O, and
 * both the admin actions and the seller actions ask it rather than each
 * writing `.eq("seller_id", …)` in their own way.
 */

export type ProcurementScope =
  | { kind: "platform" }
  | { kind: "seller"; sellerId: string };

/** The marketplace's own buying -- what every existing row belongs to. */
export const PLATFORM: ProcurementScope = { kind: "platform" };

export function sellerScope(sellerId: string): ProcurementScope {
  return { kind: "seller", sellerId };
}

/** What to write into seller_id for a row created in this scope. */
export function scopeSellerId(scope: ProcurementScope): string | null {
  return scope.kind === "seller" ? scope.sellerId : null;
}

/** May this scope open a row that carries `rowSellerId`?
 *
 * NOT SYMMETRICAL, on purpose. A seller sees only their own. The owner
 * sees everything, including a seller's -- they run the marketplace, they
 * approve the stores, and a purchase order they cannot open is one they
 * cannot help with. What the owner must never do is the reverse of what
 * this guards: their own rows staying out of a seller's reach.
 *
 * An undefined rowSellerId -- a database that has this code and has not
 * run supabase/seller-procurement.sql, so there is no column -- reads as
 * the platform's, which is what every row on such a database is. */
export function scopeCanSee(
  scope: ProcurementScope, rowSellerId: string | null | undefined
): boolean {
  if (scope.kind === "platform") return true;
  return (rowSellerId ?? null) === scope.sellerId;
}

/** The same question asked of a write, which is stricter: the owner may
 * READ a store's purchase order and must not silently edit one, because
 * the store would have no way to know its own order had changed. Nothing
 * in the app calls this on the owner's behalf today; it exists so that
 * "can the owner see it" and "may the owner change it" cannot be
 * confused for one another by whoever adds the screen that does. */
export function scopeCanWrite(
  scope: ProcurementScope, rowSellerId: string | null | undefined
): boolean {
  return (rowSellerId ?? null) === scopeSellerId(scope);
}
