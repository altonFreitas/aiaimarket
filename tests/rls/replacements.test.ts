import { describe, it, expect, beforeAll } from "vitest";
import { DATABASE_URL, sql, scalar } from "./db";
import { INTENDED_REPLACEMENTS } from "@/lib/schemaHealth";

/* WHAT THE REPLACED FUNCTIONS ACTUALLY DO.
 *
 * Eight functions in this schema are defined by more than one file, and the
 * last file to run silently decides the behaviour. That pattern has lost a
 * line three times this year:
 *
 *   apply_stock_movement   audience-restock.sql re-created it "with one
 *                          added line" and dropped the stock_status write.
 *                          Nothing else writes that column, so a shop that
 *                          received twenty-one shirts had twenty-one shirts
 *                          and a catalog, product page and stock screen all
 *                          saying OUT OF STOCK.
 *   reserve_order_stock    size-stock.sql re-created it to add a per-size
 *                          check and dropped the line that HOLDS the units.
 *                          Two orders for the last shirt were both accepted
 *                          and the shelf went to -1.
 *   sync_order_items       replaced again here, to carry the line's tax.
 *
 * tests/schemaHealth.test.ts guards the text: a declared replacement must
 * keep writing every column and keep making every call the definition it
 * replaces did. That catches the two shapes above and CANNOT catch a
 * changed threshold, a dropped `where`, or a reversed condition.
 *
 * So this file runs them. Every key in INTENDED_REPLACEMENTS has a case
 * here, and the last test in the file fails if one does not -- which is
 * what stops the map growing a tenth entry with nothing behind it.
 *
 * SKIPPED, loudly, without TEST_DATABASE_URL -- same contract as the RLS
 * suite beside it. CI runs the whole tests/rls/ folder against Postgres 16.
 */

const RUN = Boolean(DATABASE_URL);
const describeDb = RUN ? describe : describe.skip;

if (!RUN) {
  console.warn(
    "\n  Replacement behaviour tests SKIPPED: set TEST_DATABASE_URL to a\n" +
    "  database with ci-bootstrap.sql + run-all.sql applied.\n");
}

/** Rows this file made, and only those: vitest runs test files in parallel
 * against the one database, so a whole-table assertion would read rows
 * another file is mid-way through writing. */
const PREFIX = "RPL-";

function product(ref: string, opts: { qty?: number; status?: string; audience?: string | null } = {}): string {
  sql(`delete from stock_movements where product_id in (select id from products where ref = '${ref}')`);
  sql(`delete from products where ref = '${ref}'`);
  sql(`insert into products (ref, name, slug, price, description, status, archived, qty, stock_status${opts.audience ? ", audience" : ""})
       values ('${ref}', '${ref} item', '${ref.toLowerCase()}', 10, 'x',
               '${opts.status ?? "approved"}', false, 0, 'out'${opts.audience ? `, '${opts.audience}'` : ""})`);
  if (opts.qty) {
    sql(`insert into stock_movements (product_id, delta, reason)
         select id, ${opts.qty}, 'purchase_receipt' from products where ref = '${ref}'`);
  }
  return scalar(`select id from products where ref = '${ref}'`)!;
}

function order(ref: string, productId: string, qty: number, size = ""): string {
  sql(`delete from orders where ref = '${ref}'`);
  sql(`insert into orders (ref, buyer_name, buyer_phone, items, mode, subtotal, total, pay_method, status)
       values ('${ref}', 'Buyer', '+67077712345',
               jsonb_build_array(jsonb_build_object(
                 'product_id', '${productId}', 'name', 'item',
                 'size', '${size}', 'price', 10, 'qty', ${qty})),
               'pickup', ${qty * 10}, ${qty * 10}, 'cod', 'new')`);
  return scalar(`select id from orders where ref = '${ref}'`)!;
}

const qtyOf = (ref: string) => Number(scalar(`select qty from products where ref = '${ref}'`));
const statusOf = (ref: string) => scalar(`select stock_status from products where ref = '${ref}'`);

describeDb("apply_stock_movement", () => {
  /* THE ONE THAT BIT. Three files define it; audience-restock.sql wins and
     had dropped the stock_status case. Every screen in the shop reads that
     column and nothing else writes it. */
  const REF = PREFIX + "ASM";

  it("moves the balance", () => {
    product(REF, { qty: 21 });
    expect(qtyOf(REF)).toBe(21);
  });

  it("sets the status the whole shop reads, at the right thresholds", () => {
    // 'out' at zero and below, 'low' at one and two, 'in' above. A changed
    // threshold here is invisible in a diff of two near-identical copies.
    expect(statusOf(REF)).toBe("in");

    sql(`insert into stock_movements (product_id, delta, reason)
         select id, -19, 'sale' from products where ref = '${REF}'`);
    expect([qtyOf(REF), statusOf(REF)]).toEqual([2, "low"]);

    sql(`insert into stock_movements (product_id, delta, reason)
         select id, -2, 'sale' from products where ref = '${REF}'`);
    expect([qtyOf(REF), statusOf(REF)]).toEqual([0, "out"]);
  });

  it("records the restock reference, which is what the later file added", () => {
    // The whole reason audience-restock.sql replaced it. Losing THIS would
    // silence the reorder alert instead of the stock badge.
    expect(Number(scalar(`select restock_level from products where ref = '${REF}'`))).toBe(21);
  });

  it("does not re-baseline the reference on a sale", () => {
    /* Only a delivery moves it. If a sale moved it too, the alert would
       re-baseline downward on every purchase and never fire at all -- a
       feature that is present, passes a text guard, and does nothing. */
    product(REF + "2", { qty: 10 });
    sql(`insert into stock_movements (product_id, delta, reason)
         select id, -6, 'sale' from products where ref = '${REF}2'`);
    expect(Number(scalar(`select restock_level from products where ref = '${REF}2'`))).toBe(10);
  });
});

describeDb("reserve_order_stock", () => {
  /* size-stock.sql replaced stock-reservation.sql's and dropped the hold.
     What was left checked and did not hold, so the check passed, nothing
     was written, and the next shopper passed the same check. */
  const REF = PREFIX + "RES";

  it("holds the units, not just checks them", () => {
    const p = product(REF, { qty: 5 });
    const o = order(PREFIX + "RES-A", p, 2);
    sql(`select reserve_order_stock('${o}'::uuid)`);

    expect(qtyOf(REF)).toBe(3);
    expect(scalar(`select sum(delta) from stock_movements
                    where order_id = '${o}' and reason = 'reservation'`)).toBe("-2");
  });

  it("refuses more than is left after the hold", () => {
    const o = order(PREFIX + "RES-B", scalar(`select id from products where ref = '${REF}'`)!, 4);
    const r = sql(`select reserve_order_stock('${o}'::uuid)`);
    expect([r.ok, /Only 3 left/.test(r.error)]).toEqual([false, true]);
  });

  it("checks the size as well as the total", () => {
    // What size-stock.sql was replacing it to add. Ten in Large is no
    // comfort at all to the shopper who wants Medium.
    const p = product(PREFIX + "SZ", {});
    sql(`update products set sizes = array['S','M','L'] where ref = '${PREFIX}SZ'`);
    sql(`insert into stock_movements (product_id, size, delta, reason)
         values ('${p}', 'L', 10, 'purchase_receipt')`);
    const o = order(PREFIX + "SZ-A", p, 1, "M");
    const r = sql(`select reserve_order_stock('${o}'::uuid)`);
    expect([r.ok, /in size M/.test(r.error)]).toEqual([false, true]);
  });
});

describeDb("sync_order_stock_state", () => {
  const REF = PREFIX + "SOS";

  it("writes only the difference, so calling it twice changes nothing", () => {
    /* THE PROPERTY THE WHOLE RESERVATION SYSTEM RESTS ON. It is called on
       every status change, and a version that wrote the full amount each
       time would decrement the shelf again on every touch. */
    const p = product(REF, { qty: 10 });
    const o = order(PREFIX + "SOS-A", p, 3);
    sql(`select sync_order_stock_state('${o}'::uuid, 'reserved')`);
    expect(qtyOf(REF)).toBe(7);
    sql(`select sync_order_stock_state('${o}'::uuid, 'reserved')`);
    sql(`select sync_order_stock_state('${o}'::uuid, 'reserved')`);
    expect(qtyOf(REF)).toBe(7);
  });

  it("converts a hold into a sale without moving the balance again", () => {
    const o = scalar(`select id from orders where ref = '${PREFIX}SOS-A'`)!;
    sql(`select sync_order_stock_state('${o}'::uuid, 'sold')`);
    expect(qtyOf(REF)).toBe(7);
    expect(scalar(`select sum(delta) from stock_movements
                    where order_id = '${o}' and reason = 'sale'`)).toBe("-3");
  });

  it("gives the units back when released", () => {
    const o = scalar(`select id from orders where ref = '${PREFIX}SOS-A'`)!;
    sql(`select sync_order_stock_state('${o}'::uuid, 'released')`);
    expect(qtyOf(REF)).toBe(10);
  });

  it("refuses a state it does not know", () => {
    const o = scalar(`select id from orders where ref = '${PREFIX}SOS-A'`)!;
    expect(sql(`select sync_order_stock_state('${o}'::uuid, 'banana')`).ok).toBe(false);
  });
});

describeDb("sync_order_stock", () => {
  it("still works as the two-argument wrapper older callers use", () => {
    /* Kept for callers predating the three-state form. A wrapper nothing in
       the app calls today is exactly the kind of thing a replacement quietly
       drops -- and the failure would appear only on whatever still calls it. */
    const REF = PREFIX + "W";
    const p = product(REF, { qty: 8 });
    const o = order(PREFIX + "W-A", p, 3);
    sql(`select sync_order_stock('${o}'::uuid, true)`);
    expect(qtyOf(REF)).toBe(5);
    sql(`select sync_order_stock('${o}'::uuid, false)`);
    expect(qtyOf(REF)).toBe(8);
  });
});

describeDb("decrement_stock_on_confirm", () => {
  /* Four definitions -- the most-replaced function in the schema, and the
     one patch-audit-hardening.sql was quietly reverting to a pre-ledger
     version on every database built from run-all.sql. */
  const REF = PREFIX + "DEC";

  it("takes the stock through the ledger, not by writing the balance", () => {
    const p = product(REF, { qty: 6 });
    const o = order(PREFIX + "DEC-A", p, 2);
    sql(`select reserve_order_stock('${o}'::uuid)`);
    sql(`update orders set status = 'confirmed' where ref = '${PREFIX}DEC-A'`);

    expect(qtyOf(REF)).toBe(4);
    // The proof it went through the ledger: the balance and the movements
    // agree. A direct write would show as drift.
    expect(scalar(`select drift from stock_reconciliation where ref = '${REF}'`)).toBe("0");
  });

  it("gives the units back when a confirmed order is cancelled", () => {
    sql(`update orders set status = 'cancelled', cancel_reason = 'test' where ref = '${PREFIX}DEC-A'`);
    expect(qtyOf(REF)).toBe(6);
  });

  it("leaves a pre-order alone", () => {
    // preorders.sql's contribution to the chain: a pre-order is sold before
    // it exists, so confirming one must not move a shelf that has nothing on it.
    const p = product(PREFIX + "PRE", { qty: 1 });
    const o = order(PREFIX + "PRE-A", p, 1);
    sql(`update orders set is_preorder = true where id = '${o}'`);
    sql(`update orders set status = 'confirmed' where id = '${o}'`);
    expect(qtyOf(PREFIX + "PRE")).toBe(1);
  });
});

describeDb("sync_order_items", () => {
  const REF = PREFIX + "ITM";

  it("builds a row per line from the order's items", () => {
    const p = product(REF, { qty: 20 });
    sql(`delete from orders where ref = '${PREFIX}ITM-A'`);
    sql(`insert into orders (ref, buyer_name, buyer_phone, items, mode, subtotal, total, pay_method, status, tax, tax_rate)
         values ('${PREFIX}ITM-A', 'Buyer', '+67077712345',
                 jsonb_build_array(
                   jsonb_build_object('product_id','${p}','name','item','size','S','price',10,'qty',1,'tax',0.33),
                   jsonb_build_object('product_id','${p}','name','item','size','M','price',10,'qty',1,'tax',0.33),
                   jsonb_build_object('product_id','${p}','name','item','size','L','price',10,'qty',1,'tax',0.34)),
                 'pickup', 30, 31, 'cod', 'new', 1.00, 0.0333)`);
    expect(scalar(`select count(*) from order_items
                    where order_id = (select id from orders where ref = '${PREFIX}ITM-A')`)).toBe("3");
  });

  it("carries each line's share of the tax, which is what the later file added", () => {
    /* A return of a line has to give this back. Refunding the net price
       alone quietly keeps the tax on goods the shop no longer sold, and the
       shares must add back to the order's figure exactly. */
    const o = scalar(`select id from orders where ref = '${PREFIX}ITM-A'`)!;
    expect(scalar(`select sum(tax) from order_items where order_id = '${o}'`)).toBe("1.00");
    expect(scalar(`select tax from orders where id = '${o}'`)).toBe("1.00");
  });

  it("defaults an untaxed line to zero rather than to null", () => {
    // Every order placed before tax existed. Null would propagate through
    // any sum that touches it.
    const p = scalar(`select id from products where ref = '${REF}'`)!;
    sql(`delete from orders where ref = '${PREFIX}ITM-B'`);
    sql(`insert into orders (ref, buyer_name, buyer_phone, items, mode, subtotal, total, pay_method, status)
         values ('${PREFIX}ITM-B', 'Buyer', '+67077712345',
                 jsonb_build_array(jsonb_build_object(
                   'product_id','${p}','name','item','size','S','price',10,'qty',1)),
                 'pickup', 10, 10, 'cod', 'new')`);
    expect(scalar(`select tax from order_items
                    where order_id = (select id from orders where ref = '${PREFIX}ITM-B')`)).toBe("0.00");
  });

  it("keeps a line whose seller no longer exists", () => {
    // The line is worth more than the attribution: a foreign key failure
    // here would take the whole order insert down with it.
    const p = scalar(`select id from products where ref = '${REF}'`)!;
    sql(`delete from orders where ref = '${PREFIX}ITM-C'`);
    sql(`insert into orders (ref, buyer_name, buyer_phone, items, mode, subtotal, total, pay_method, status)
         values ('${PREFIX}ITM-C', 'Buyer', '+67077712345',
                 jsonb_build_array(jsonb_build_object(
                   'product_id','${p}','seller_id','00000000-0000-0000-0000-000000000000',
                   'name','item','size','S','price',10,'qty',1)),
                 'pickup', 10, 10, 'cod', 'new')`);
    expect(scalar(`select count(*) from order_items
                    where order_id = (select id from orders where ref = '${PREFIX}ITM-C')`)).toBe("1");
  });
});

describeDb("search_products", () => {
  beforeAll(() => {
    product(PREFIX + "SRCH-M", { qty: 5, audience: "men" });
    product(PREFIX + "SRCH-W", { qty: 5, audience: "women" });
    product(PREFIX + "SRCH-P", { qty: 5, status: "pending" });
  });

  it("returns an approved product and hides an unapproved one", () => {
    const rows = sql(`select (product).ref from search_products(
      '${PREFIX}SRCH', null, null, null, null, false, 'new', 50, 0, null)`).rows;
    expect(rows).toContain(`${PREFIX}SRCH-M`);
    expect(rows).not.toContain(`${PREFIX}SRCH-P`);
  });

  it("filters by audience, which is what the later file added", () => {
    /* audience-restock.sql replaced marketplace-v2.sql's version for this
       one argument. It has to filter INSIDE the query -- filtering the page
       after it comes back would leave the count and the page numbers
       describing a different set than the one on screen. */
    const men = sql(`select (product).ref from search_products(
      '${PREFIX}SRCH', null, null, null, null, false, 'new', 50, 0, 'men')`).rows;
    expect(men).toContain(`${PREFIX}SRCH-M`);
    expect(men).not.toContain(`${PREFIX}SRCH-W`);
  });

  it("still searches by text with no audience given", () => {
    // The original behaviour the replacement had to preserve.
    const rows = sql(`select (product).ref from search_products(
      '${PREFIX}SRCH-W', null, null, null, null, false, 'new', 50, 0, null)`).rows;
    expect(rows).toContain(`${PREFIX}SRCH-W`);
  });
});

describeDb("sync_order_refund_status", () => {
  it("counts a refund when it has SETTLED, not when it was agreed", () => {
    /* refund-settlement.sql replaced returns.sql's version for exactly this.
       A return with refunded_at null is a decision recorded, not money
       moved -- and marking the order refunded before the money left is the
       shop telling itself it has paid somebody it has not. */
    const p = product(PREFIX + "RFD", { qty: 5 });
    const o = order(PREFIX + "RFD-A", p, 1);
    sql(`update orders set pay_status = 'paid' where id = '${o}'`);

    const ins = sql(`insert into order_returns (order_id, ref, reason, refund_total)
                     values ('${o}', '${PREFIX}R1', 'damaged', 10)`);
    // Asserted, because an insert that silently failed would leave the
    // order at 'paid' and make the next line pass for the wrong reason --
    // which is exactly what the first draft of this test did.
    expect([ins.ok, ins.error]).toEqual([true, ""]);
    expect(scalar(`select pay_status from orders where id = '${o}'`)).toBe("paid");

    sql(`update order_returns set refunded_at = now() where order_id = '${o}'`);
    expect(scalar(`select pay_status from orders where id = '${o}'`)).toBe("refunded");
  });

  it("calls a part-refund something other than refunded", () => {
    // Some money stayed with the shop. Calling that "refunded" would lose
    // the difference on every reconciliation.
    const p = product(PREFIX + "RFD2", { qty: 5 });
    const o = order(PREFIX + "RFD2-A", p, 2);   // total 20
    sql(`update orders set pay_status = 'paid' where id = '${o}'`);
    const ins = sql(`insert into order_returns (order_id, ref, reason, refund_total, refunded_at)
                     values ('${o}', '${PREFIX}R2', 'damaged', 5, now())`);
    expect([ins.ok, ins.error]).toEqual([true, ""]);
    // Positively asserted, not merely "not refunded": a failed insert would
    // leave it at 'paid', which also is not 'refunded'.
    expect(scalar(`select pay_status from orders where id = '${o}'`)).toBe("deposit");
  });
});

describeDb("the map and the proofs", () => {
  it("has a behavioural test for every declared replacement", () => {
    /* THE TEST THAT KEEPS THIS HONEST. A ninth chain added to
       INTENDED_REPLACEMENTS without a case in this file fails here -- which
       is the difference between declaring a replacement intentional and
       knowing what it does.

       Listed by hand rather than scraped from the describe() names: the
       point is that somebody looked at each one. */
    const PROVEN = [
      "apply_stock_movement",
      "decrement_stock_on_confirm",
      "reserve_order_stock",
      "search_products",
      "sync_order_items",
      "sync_order_refund_status",
      "sync_order_stock",
      "sync_order_stock_state",
    ];
    expect(Object.keys(INTENDED_REPLACEMENTS).sort()).toEqual(PROVEN.sort());
  });
});
