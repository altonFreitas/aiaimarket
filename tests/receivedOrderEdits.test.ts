import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sameStoredValue, sameLines } from "@/lib/purchasing";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const PURCHASING = read("src/lib/purchasing.ts");
const PAGE = read("src/app/p/[slug]/page.tsx");
const BACKFILL = read("supabase/backfill-sizes.sql");

/* PAYING FOR GOODS THAT HAVE ALREADY ARRIVED.
 *
 * Saving a received order was refused outright, and the message said the
 * LINES could not change -- but the refusal came before the header update,
 * so the payment status could not change either. Trade runs on the gap
 * between delivery and payment: a shop paying thirty days after the goods
 * land could not record having paid for them.
 *
 * The rule is now about what changed, not about when. */

describe("what a received order still accepts", () => {
  it("saves the payment without touching the lines", () => {
    /* Not deleted and rewritten identically either: stock_movements points
       at a line id, and replacing the rows nulls every one of those links
       -- taking the idempotency guard with it, so the next move to
       "received" would add the stock a second time. */
    const branch = PURCHASING.slice(
      PURCHASING.indexOf("if (receipts && receipts.length)"),
      PURCHASING.indexOf("const { error } = await sb.from(\"purchase_orders\").update(header)"));
    expect(branch).toContain("payment_status: header.payment_status");
    expect(branch).toContain("payment_date: header.payment_date");
    expect(branch).toContain("return poId;");
    // It returns before the line delete/insert can run.
    expect(branch).not.toContain("purchase_order_items\").delete()");
  });

  it("names the field in the way rather than refusing the whole order", () => {
    expect(PURCHASING).toContain("`This order has already been received, so ${moved.join(\", \")} can no `");
    expect(PURCHASING).toContain("Payment ");
  });

  it("still closes everything the receipt already consumed", () => {
    /* The lines, who supplied them and when, and every number that fed the
       landed cost already written onto the movements and into
       product_costs. */
    for (const f of ["Supplier", "Order date", "Currency", "Exchange rate",
                     "Tax", "Shipping", "Discount", "Line items"]) {
      expect(PURCHASING, f).toContain(`"${f}"`);
    }
  });
});

describe("telling a real edit from a round trip through the database", () => {
  /* Postgres hands numeric back as "2.0000" where the form sent 2, and a
     date column as a string where an empty box sent null. Reading either
     as a change would bring back the bug this replaced. */

  it("reads a numeric spelled differently as the same amount", () => {
    expect(sameStoredValue("2.0000", 2)).toBe(true);
    expect(sameStoredValue("12.50", 12.5)).toBe(true);
    expect(sameStoredValue(1, "1")).toBe(true);
  });

  it("still catches a real change of amount", () => {
    expect(sameStoredValue("2.0000", 3)).toBe(false);
    expect(sameStoredValue(12.5, 12.51)).toBe(false);
  });

  it("treats null, undefined and empty as one thing", () => {
    expect(sameStoredValue(null, "")).toBe(true);
    expect(sameStoredValue(undefined, null)).toBe(true);
    expect(sameStoredValue("", undefined)).toBe(true);
  });

  it("catches a field being filled in or emptied", () => {
    expect(sameStoredValue(null, "2026-01-01")).toBe(false);
    expect(sameStoredValue("2026-01-01", null)).toBe(false);
  });

  it("ignores whitespace the clip may have trimmed", () => {
    expect(sameStoredValue("Acme Ltd", " Acme Ltd ")).toBe(true);
  });

  it("does not read two different suppliers as one", () => {
    expect(sameStoredValue("Acme Ltd", "Acme Limited")).toBe(false);
  });
});

describe("whether the lines are the ones already stored", () => {
  const line = (over: Record<string, unknown> = {}) => ({
    product_id: null, product_name: "Tee", category: "goods_for_resale",
    qty: 10, unit_price: 2, catalog_category_id: null, sell_price: 12,
    sizes: "", description: "", ...over,
  });

  it("is true for the same lines round-tripped through Postgres", () => {
    const stored = [line({ qty: "10.000", unit_price: "2.0000", sell_price: "12.00" })];
    expect(sameLines(stored, [line()])).toBe(true);
  });

  it("catches a changed price", () => {
    expect(sameLines([line()], [line({ unit_price: 3 })])).toBe(false);
  });

  it("catches a line added or removed", () => {
    expect(sameLines([line()], [line(), line({ product_name: "Cap" })])).toBe(false);
    expect(sameLines([line(), line()], [line()])).toBe(false);
  });

  it("catches two lines swapped", () => {
    /* Order is not sorted away: a receipt points at a specific line id,
       and two lines exchanged is an edit even though the set is equal. */
    const a = line({ product_name: "Tee" });
    const b = line({ product_name: "Cap" });
    expect(sameLines([a, b], [b, a])).toBe(false);
  });

  it("does not compare the columns written separately", () => {
    /* product_type_id and attribute_values go through writeTolerating, so
       a shop mid-migration has no such columns to read back -- comparing
       them would report every line as changed and refuse every payment. */
    expect(PURCHASING).not.toMatch(/LINE_FIELDS[\s\S]{0,200}product_type_id/);
    expect(PURCHASING).not.toMatch(/LINE_FIELDS[\s\S]{0,200}attribute_values/);
  });
});

/* ------------------------------------------------------------------ */

describe("a product knows every size it is sold in", () => {
  /* products.sizes and the variants are two accounts of one fact, written
     by different code -- and BOTH writers swallow their errors on purpose,
     because a size list that could not be extended must not fail a receipt
     or a save. So they can drift, and when they do the shopper finds out:
     the card offers "Add to cart" where its neighbours offer "Choose size",
     and the product page shows no picker at all. */

  it("unions the stored list with the variants, stored order first", () => {
    expect(PAGE).toContain("const sizes = [...(p.sizes || [])];");
    expect(PAGE).toContain("for (const s of sizePrices.keys())");
    expect(PAGE).toContain("had.toLowerCase() === s.toLowerCase()");
  });

  it("gives the picker, the cap, the basket and WhatsApp one list", () => {
    expect(PAGE).toContain("<ProductInteractive p={{ ...p, sizes }}");
  });

  it("counts the stock for the unioned list, not the stored one", () => {
    /* Asking about the stored list leaves a size the product only has a
       variant for reading as zero -- which the picker draws as sold out on
       a full shelf, the one thing it exists to avoid. */
    expect(PAGE).toContain("const sizeStock = await oneSizeStock(p.id, sizes);");
    expect(PAGE).not.toContain("oneSizeStock(p.id, p.sizes || [])");
  });

  it("repairs the stored column too, because the card has only that", () => {
    // A card in a grid cannot read the variants of twenty-four products.
    expect(BACKFILL).toContain("update products p");
    expect(BACKFILL).toContain("a.slug = 'size'");
  });

  it("adds to the stored list and never replaces it", () => {
    // A size typed by hand with no variant is still a size they sell.
    expect(BACKFILL).toContain("set sizes = coalesce(p.sizes, '{}'::text[]) ||");
  });

  it("does not add a size the product already lists in another case", () => {
    expect(BACKFILL).toContain("where lower(had) = lower(vs.size)");
  });

  it("does nothing on a shop with no variant tables", () => {
    expect(BACKFILL).toContain("if to_regclass('public.product_variants') is null");
  });
});
