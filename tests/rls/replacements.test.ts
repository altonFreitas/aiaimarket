import { describe, it, expect, beforeAll } from "vitest";
import { DATABASE_URL, sql, scalar, sqlAsync } from "./db";
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

/* NO `audience` OPTION, and that is not a tidy-up. It used to take one,
   and supabase/drop-audience.sql removed products.audience -- so the
   insert naming that column failed, silently, for every product the
   search block seeded. Two of its three products never existed, and its
   three tests failed against a function that was working correctly. A
   fixture that cannot be inserted is worse than a missing test: it fails
   loudly and points at the wrong thing. */
function product(ref: string, opts: { qty?: number; status?: string } = {}): string {
  sql(`delete from stock_movements where product_id in (select id from products where ref = '${ref}')`);
  sql(`delete from products where ref = '${ref}'`);
  sql(`insert into products (ref, name, slug, price, description, status, archived, qty, stock_status)
       values ('${ref}', '${ref} item', '${ref.toLowerCase()}', 10, 'x',
               '${opts.status ?? "approved"}', false, 0, 'out')`);
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
    /* ITS OWN ARC, start to finish. This used to cancel the order the
       test above had confirmed, and depended on that order still being
       there -- which made it hostage to any other file in this folder
       doing a blanket `delete from orders`. tests/rls/salesRollup.test.ts
       does exactly that, because a rollup of every order cannot be
       checked against a table somebody else is adding to.
     *
     * The failure that produced was worth nothing to anybody: this test
       reporting 4 units where it wanted 6, on a run where nothing about
       stock had changed. Six statements are cheaper than a test that
       cries wolf. */
    const p = product(`${REF}-C`, { qty: 6 });
    const o = order(`${PREFIX}DEC-C`, p, 2);
    sql(`select reserve_order_stock('${o}'::uuid)`);
    sql(`update orders set status = 'confirmed' where id = '${o}'`);
    expect(qtyOf(`${REF}-C`), "confirmed").toBe(4);

    sql(`update orders set status = 'cancelled', cancel_reason = 'test' where id = '${o}'`);
    expect(qtyOf(`${REF}-C`), "cancelled").toBe(6);
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
  /* FIVE FILES DEFINE THIS ONE FUNCTION and supabase/search-sorts.sql is
     the last word, so its body is what the database runs. Two of those
     five have already been overtaken: audience-restock.sql added an
     audience filter and drop-audience.sql removed it again, column and
     all.
   *
   * THAT IS WHY THIS BLOCK IS REWRITTEN RATHER THAN REPAIRED. It tested
   * the audience argument, so it had been failing ever since the column
   * went -- not because the search was broken, but because its own
   * fixture could not be inserted. A test that has been red long enough
   * to be scenery is a test nobody reads the failure of.
   *
   * WHAT IS WORTH PROVING INSTEAD is what the LAST definition adds:
   * 'popular' and 'deal'. They are the first thing to disappear if the
   * order of the files ever slips, and they disappear QUIETLY -- an
   * unknown sort name is not an error in this function, it is newest
   * first. So each one is checked against the answer newest-first would
   * have given, which is the only way the assertion can tell them apart.
   *
   * SCOPED WITH id_filter, not with a text query, wherever order matters.
   * vitest runs these files in parallel against one database, so a sort
   * assertion over "everything" reads whatever another file is halfway
   * through inserting. id_filter is also the argument
   * attribute-filters.sql added, so scoping this way exercises it. */

  const M = `${PREFIX}SRCH-M`, P = `${PREFIX}SRCH-P`;
  /* Most looked at, in the opposite order to newest. A and C are the pair
     that tells 'popular' from the fallback; B and C tie on views and are
     split by wa_clicks, which is the tiebreaker the file describes. */
  const A = `${PREFIX}SRCH-A`, B = `${PREFIX}SRCH-B`, C = `${PREFIX}SRCH-C`;
  /* Reduced most, as a FRACTION. D is half off five dollars; E is a fifth
     off a hundred. By amount E wins and by fraction D does, so the two
     readings cannot both pass. F is not on offer at all. */
  const D = `${PREFIX}SRCH-D`, E = `${PREFIX}SRCH-E`, F = `${PREFIX}SRCH-F`;

  const ids: Record<string, string> = {};
  const only = (...refs: string[]) =>
    `array[${refs.map((r) => `'${ids[r]}'::uuid`).join(",")}]`;
  /** The refs a search returns, in the order it returned them. */
  const search = (q: string, sort: string, filter: string) =>
    sql(`select (product).ref from search_products(
      ${q}, null, null, null, null, false, '${sort}', 50, 0, ${filter})`).rows;

  beforeAll(() => {
    for (const ref of [M, A, B, C, D, E, F]) ids[ref] = product(ref);
    ids[P] = product(P, { status: "pending" });

    // created_at ASCENDS through A, B, C while views DESCEND, so "newest
    // first" gives exactly the reverse of "most looked at" and neither
    // can be mistaken for the other.
    sql(`update products set views = 30, wa_clicks = 0,
           created_at = '2026-01-01T00:00:00Z' where ref = '${A}'`);
    sql(`update products set views = 10, wa_clicks = 9,
           created_at = '2026-01-02T00:00:00Z' where ref = '${B}'`);
    sql(`update products set views = 10, wa_clicks = 1,
           created_at = '2026-01-03T00:00:00Z' where ref = '${C}'`);

    sql(`update products set price = 10, discount_price = 5,
           created_at = '2026-01-01T00:00:00Z' where ref = '${D}'`);
    sql(`update products set price = 500, discount_price = 400,
           created_at = '2026-01-02T00:00:00Z' where ref = '${E}'`);
    sql(`update products set price = 20, discount_price = null,
           created_at = '2026-01-03T00:00:00Z' where ref = '${F}'`);
  });

  it("returns an approved product and hides an unapproved one", () => {
    // The moderation queue is only a queue if what is in it is not live.
    const rows = search(`'${PREFIX}SRCH'`, "new", "null");
    expect(rows).toContain(M);
    expect(rows).not.toContain(P);
  });

  it("orders by what people looked at, which is what the last file added", () => {
    /* search-sorts.sql is the last of the five definitions. If any other
       one were, 'popular' would be an unknown sort -- and an unknown sort
       here is not an error, it is newest first. Hence the second
       assertion: it is the answer this would give if the sort had
       silently gone, and it is the reverse. */
    expect(search("''", "popular", only(A, B, C))).toEqual([A, B, C]);
    expect(search("''", "new", only(A, B, C))).toEqual([C, B, A]);
  });

  it("breaks a tie on views with the people who pressed Order", () => {
    // B and C have been looked at equally often. Somebody who pressed
    // Order via WhatsApp wanted it more than somebody who looked.
    expect(search("''", "popular", only(B, C))).toEqual([B, C]);
  });

  it("ranks a deal by how far off it is, not by how much off", () => {
    /* $5 off $10 beats $100 off $500, and the shopper reading "-50%"
       against "-20%" agrees. By amount the order would be [E, D]. */
    expect(search("''", "deal", only(D, E, F))).toEqual([D, E, F]);
  });

  it("puts what is not on offer last, rather than at a discount of zero", () => {
    // F is not a bad deal; it is not a deal. Sorted as zero it would come
    // between the two real ones on any shop whose worst offer is negative
    // -- and above nothing, which is where it belongs.
    expect(search("''", "deal", only(F, D)).at(-1)).toBe(F);
    expect(search("''", "deal", only(F, E)).at(-1)).toBe(F);
  });

  it("tells no attribute filter from a filter that matched nothing", () => {
    /* The argument attribute-filters.sql added. Null means the shopper
       ticked nothing; an EMPTY array means they ticked something and it
       matched nothing, and the honest answer to that is no products
       rather than every product in the shop. */
    expect(search(`'${PREFIX}SRCH'`, "new", "array[]::uuid[]")).toEqual([]);
    expect(search(`'${PREFIX}SRCH'`, "new", "null").length).toBeGreaterThan(3);
    expect(search("''", "new", only(M))).toEqual([M]);
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

/* ===========================================================================
 * ONE FUNCTION PER NAME
 *
 * `create or replace function` cannot change a signature. Add a parameter
 * and you get an OVERLOAD beside the old definition, not a replacement --
 * and from that moment every call that does not name the new argument
 * matches both and fails with "is not unique".
 *
 * That is not a loud failure. lib/data/search.ts catches any error from
 * the RPC and falls back to the in-memory path, so the storefront keeps
 * working and quietly stops using its index. A shop with a few hundred
 * products would notice nothing; a shop with ten thousand would just be
 * slow, and nobody would connect it to a migration.
 *
 * Found exactly that way: supabase/attribute-filters.sql added id_filter
 * and left the ten-argument version in place. audience-restock.sql had
 * already got this right -- it drops both earlier arities first -- which
 * is what the new file should have copied.
 * ======================================================================== */

describeDb("no function is left with two definitions", () => {
  /* Every name a migration redefines. Reading it from INTENDED_REPLACEMENTS
     would be neater, but that list is about WHICH FILE runs last, and this
     is about what the database ended up holding -- two different questions,
     and the whole bug was that the first one passed while the second did
     not. */
  const REDEFINED = [
    "search_products", "reserve_order_stock", "sync_order_stock_state",
    "apply_stock_movement", "sync_order_items", "sync_order_refund_status",
    "decrement_stock_on_confirm", "sync_order_stock",
  ];

  it("leaves exactly one of each", () => {
    const doubled: string[] = [];
    for (const name of REDEFINED) {
      const n = Number(scalar(
        `select count(*) from pg_proc where proname = '${name}'`));
      if (n > 1) doubled.push(`${name} (${n})`);
    }
    // Named rather than counted, so the failure says which one.
    expect(doubled).toEqual([]);
  });

  it("lets the catalogue search be called the way the app calls it", () => {
    /* The call lib/data/search.ts makes when no audience and no attribute
       filter are set -- which is most of them. Ambiguity here is the
       silent fallback described above. */
    const r = sqlAsync(
      `select count(*) from search_products(q => '', sort => 'new', lim => 5, off => 0)`);
    return r.then((res) => {
      expect(res.ok, res.error).toBe(true);
      expect(res.error ?? "").not.toMatch(/not unique/);
    });
  });

  it("still accepts the filter argument that was added last", () => {
    const r = sqlAsync(
      `select count(*) from search_products(q => '', sort => 'new', lim => 5,
                                            off => 0, id_filter => null)`);
    return r.then((res) => expect(res.ok, res.error).toBe(true));
  });
});
