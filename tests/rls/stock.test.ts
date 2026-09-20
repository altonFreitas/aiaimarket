import { describe, it, expect, beforeAll } from "vitest";
import { DATABASE_URL, sql, scalar, sqlAsync, pause } from "./db";

/* OVERSELLING, TESTED BY ACTUALLY DOING IT.
 *
 * tests/stockReservation.test.ts is 271 lines that READ the SQL file and
 * match its text. That is worth having -- it catches somebody deleting the
 * FOR UPDATE -- but it cannot tell you whether two shoppers can both take
 * the last shirt, because that question is not answerable by reading. It is
 * a question about what Postgres does when two sessions are inside the same
 * function at the same time.
 *
 * It turned out they could. reserve_order_stock() checked availability and
 * never wrote the hold: size-stock.sql replaced stock-reservation.sql's
 * version to add a per-size check and dropped the one line that held the
 * units. The check passed, nothing was written, the lock went at commit, and
 * the next shopper passed the same check against the same unit. Two orders
 * for one shirt were both accepted and both confirmed and the shelf went to
 * -1. No text-matching test could have found that, because the text it would
 * have matched was all still there.
 *
 * These run against a real Postgres and are SKIPPED, loudly, without
 * TEST_DATABASE_URL -- same contract as the RLS suite beside them.
 */

const RUN = Boolean(DATABASE_URL);
const describeDb = RUN ? describe : describe.skip;

if (!RUN) {
  console.warn(
    "\n  Stock integration tests SKIPPED: set TEST_DATABASE_URL to a database\n" +
    "  with supabase/ci-bootstrap.sql + supabase/run-all.sql applied.\n");
}

/** A product with `units` on the shelf, put there through the ledger --
 * which is the only way stock is ever supposed to arrive. */
function stock(ref: string, units: number, size = "M"): string {
  sql(`delete from stock_movements where product_id in (select id from products where ref = '${ref}')`);
  sql(`delete from products where ref = '${ref}'`);
  sql(`insert into products (ref, name, slug, price, description, status, archived, qty, stock_status, sizes)
       values ('${ref}', '${ref} shirt', '${ref.toLowerCase()}', 10, 'x', 'approved', false, 0, 'out', array['S','M','L'])`);
  sql(`insert into stock_movements (product_id, size, delta, reason)
       select id, '${size}', ${units}, 'purchase_receipt' from products where ref = '${ref}'`);
  return scalar(`select id from products where ref = '${ref}'`)!;
}

/** A basket: one order for `qty` of `productId` in `size`. */
function order(ref: string, productId: string, qty: number, size = "M"): string {
  sql(`delete from orders where ref = '${ref}'`);
  sql(`insert into orders (ref, buyer_name, buyer_phone, items, mode, subtotal, total, pay_method, status)
       values ('${ref}', 'Buyer', '+67077712345',
               jsonb_build_array(jsonb_build_object(
                 'product_id', '${productId}', 'name', 'shirt',
                 'size', '${size}', 'price', 10, 'qty', ${qty})),
               'pickup', ${qty * 10}, ${qty * 10}, 'cod', 'new')`);
  return scalar(`select id from orders where ref = '${ref}'`)!;
}

const onHand = (ref: string) => Number(scalar(`select qty from products where ref = '${ref}'`));

/** THIS FILE'S OWN ROWS, AND ONLY THOSE.
 *
 * vitest runs test files in parallel, and tests/rls/rls.test.ts is pointed
 * at the same database. A whole-table assertion here would be reading rows
 * that another file is in the middle of writing, which is a test that fails
 * for reasons that have nothing to do with what it is testing -- and a flaky
 * test in a suite this one is teaching people to trust is worse than no test
 * at all.
 * PARENTHESISED, because `and` binds tighter than `or` in SQL: without the
 * brackets, `where drift <> 0 and <this>` parses as `(drift <> 0 and first
 * pattern) or second pattern or ...` and quietly returns every row this file
 * made, drift or no drift. It did exactly that, and reported four rows of
 * zero drift as a failure. */
const MINE = "(ref like 'CONC-%' or ref like 'HOLD-%' " +
             "or ref like 'SIZE-%' or ref like 'STALE-%' or ref like 'VAR-%')";

describeDb("two shoppers, one unit", () => {
  it("lets exactly one of them have it", async () => {
    /* THE TEST THE WHOLE FILE IS FOR, and it has to be genuinely
       concurrent: session A opens a transaction, reserves, and SITS THERE
       holding its row lock while B tries the same unit. Run one after the
       other, this would pass with no lock at all. */
    const p = stock("CONC-1", 1);
    const a = order("CONC-A", p, 1);
    const b = order("CONC-B", p, 1);

    const first = sqlAsync(
      `begin; select reserve_order_stock('${a}'::uuid); select pg_sleep(1.5); commit;`);
    await pause(400);                        // let A get inside and take the lock
    const second = sqlAsync(
      `begin; select reserve_order_stock('${b}'::uuid); commit;`);

    const [ra, rb] = await Promise.all([first, second]);

    // One succeeds and one is refused. Which one does not matter; that both
    // could succeed is the bug.
    expect([ra.ok, rb.ok]).toEqual([true, false]);
    expect(rb.error).toMatch(/Only 0 left/);
    // And the shelf is empty rather than negative.
    expect(onHand("CONC-1")).toBe(0);
  });

  it("leaves the balance non-negative, which is the damage that was done", () => {
    // -1 on hand is what this looked like from the outside: a shop that had
    // promised a unit it did not have, to somebody who was told yes.
    expect(Number(scalar(`select min(qty) from products where ${MINE}`)))
      .toBeGreaterThanOrEqual(0);
  });
});

describeDb("holding the units, not just checking them", () => {
  beforeAll(() => { stock("HOLD-1", 5); });

  it("writes a reservation the moment an order is placed", () => {
    /* The regression that let the oversell in: the function checked and
       returned without writing anything, so nothing was held between
       placement and confirmation. A reservation that records nothing is
       not a reservation. */
    const o = order("HOLD-A", scalar("select id from products where ref = 'HOLD-1'")!, 2);
    sql(`select reserve_order_stock('${o}'::uuid)`);

    expect(onHand("HOLD-1")).toBe(3);
    expect(scalar(`select sum(delta) from stock_movements
                    where order_id = '${o}' and reason = 'reservation'`)).toBe("-2");
  });

  it("refuses the next order against what is left, not against the shelf", () => {
    // 5 on the shelf, 2 held, so 4 must be refused at 3. Without the hold
    // it would be compared against 5 and allowed.
    const o = order("HOLD-B", scalar("select id from products where ref = 'HOLD-1'")!, 4);
    const r = sql(`select reserve_order_stock('${o}'::uuid)`);
    expect([r.ok, /Only 3 left/.test(r.error)]).toEqual([false, true]);
  });

  it("gives the units back when the order is cancelled", () => {
    sql("update orders set status = 'cancelled', cancel_reason = 'test' where ref = 'HOLD-A'");
    expect(onHand("HOLD-1")).toBe(5);
    // Returned by a second movement, not by deleting the first: the ledger
    // records what happened rather than pretending it did not.
    expect(scalar(`select count(*) from stock_movements m
                     join orders o on o.id = m.order_id
                    where o.ref = 'HOLD-A' and m.reason = 'reservation'`)).toBe("2");
  });

  it("turns the hold into a sale on confirmation, without moving the balance twice", () => {
    /* The double-decrement this replaced: confirm used to subtract again on
       top of the hold. The balance must not move -- the units were already
       taken off the shelf when they were held. */
    const o = order("HOLD-C", scalar("select id from products where ref = 'HOLD-1'")!, 2);
    sql(`select reserve_order_stock('${o}'::uuid)`);
    expect(onHand("HOLD-1")).toBe(3);

    sql("update orders set status = 'confirmed' where ref = 'HOLD-C'");
    expect(onHand("HOLD-1")).toBe(3);
    expect(scalar(`select sum(delta) from stock_movements m
                     join orders o on o.id = m.order_id
                    where o.ref = 'HOLD-C' and m.reason = 'sale'`)).toBe("-2");
  });
});

describeDb("the same unit, asked for by size", () => {
  it("refuses a size that is empty while the product is not", () => {
    /* The reason a total is not enough: thirty shirts is a healthy number
       and no comfort at all to the shopper who wants Medium, of which there
       are none. */
    const p = stock("SIZE-1", 10, "L");
    const o = order("SIZE-A", p, 1, "M");
    const r = sql(`select reserve_order_stock('${o}'::uuid)`);
    expect([r.ok, /in size M/.test(r.error)]).toEqual([false, true]);
    // And the product itself is untouched: a refusal must not consume stock.
    expect(onHand("SIZE-1")).toBe(10);
  });

  it("allows a different size of the same product", () => {
    const o = order("SIZE-B", scalar("select id from products where ref = 'SIZE-1'")!, 3, "L");
    expect(sql(`select reserve_order_stock('${o}'::uuid)`).ok).toBe(true);
    expect(onHand("SIZE-1")).toBe(7);
  });
});

describeDb("abandoned baskets", () => {
  it("are swept back onto the shelf after the threshold", () => {
    // A hold that is never confirmed is stock nobody can buy. The sweeper
    // is what stops a shop quietly bleeding availability to dead orders.
    const p = stock("STALE-1", 4);
    const o = order("STALE-A", p, 3);
    sql(`select reserve_order_stock('${o}'::uuid)`);
    expect(onHand("STALE-1")).toBe(1);

    sql(`update orders set created_at = now() - interval '72 hours' where id = '${o}'`);
    sql("select release_stale_reservations(48)");
    expect(onHand("STALE-1")).toBe(4);
  });

  it("leaves a hold that is still young alone", () => {
    // The other half, and the one that would make the sweeper dangerous if
    // it were wrong: releasing a basket somebody is still filling.
    const p = stock("STALE-2", 4);
    const o = order("STALE-B", p, 3);
    sql(`select reserve_order_stock('${o}'::uuid)`);
    sql("select release_stale_reservations(48)");
    expect(onHand("STALE-2")).toBe(1);
  });
});

describeDb("the ledger and the balance", () => {
  it("still agree after all of that", () => {
    /* THE INVARIANT EVERY TEST ABOVE IS REALLY PROTECTING. products.qty is
       the running sum of stock_movements and has exactly one writer. Any
       drift means something wrote the balance directly -- which is the bug
       class that has now bitten this schema three times. */
    const drift = sql(
      `select ref, drift from stock_reconciliation where drift <> 0 and ${MINE}`);
    expect(drift.rows).toEqual([]);
  });
});

/* ===========================================================================
 * VARIANTS
 *
 * supabase/variants.sql adds a third check to reserve_order_stock, beside
 * the product total and the size. The risk in adding it was never that it
 * would fail to work -- it is that touching this function at all would
 * break the two checks already in it, which is exactly what happened the
 * last time somebody extended it and dropped the line that held the stock.
 *
 * So these test the new behaviour AND that the old behaviour is untouched.
 * ======================================================================== */

/** A product with two variants and `each` units of each, through the ledger. */
function variantStock(ref: string, each: number): { product: string; a: string; b: string } {
  sql(`delete from stock_movements where product_id in (select id from products where ref = '${ref}')`);
  sql(`delete from product_variants where product_id in (select id from products where ref = '${ref}')`);
  sql(`delete from products where ref = '${ref}'`);
  sql(`insert into products (ref, name, slug, price, description, status, archived, qty, stock_status)
       values ('${ref}', '${ref} shirt', '${ref.toLowerCase()}', 10, 'x', 'approved', false, 0, 'out')`);
  const product = scalar(`select id from products where ref = '${ref}'`)!;
  for (const label of ["Black / M", "White / L"]) {
    sql(`insert into product_variants (product_id, label) values ('${product}', '${label}')`);
  }
  sql(`insert into stock_movements (product_id, variant_id, delta, reason)
       select '${product}', id, ${each}, 'purchase_receipt'
         from product_variants where product_id = '${product}'`);
  return {
    product,
    a: scalar(`select id from product_variants where product_id = '${product}' and label = 'Black / M'`)!,
    b: scalar(`select id from product_variants where product_id = '${product}' and label = 'White / L'`)!,
  };
}

/** A basket naming a variant. */
function variantOrder(ref: string, productId: string, variantId: string, qty: number): string {
  sql(`delete from orders where ref = '${ref}'`);
  sql(`insert into orders (ref, buyer_name, buyer_phone, items, mode, subtotal, total, pay_method, status)
       values ('${ref}', 'Buyer', '+67077712345',
               jsonb_build_array(jsonb_build_object(
                 'product_id', '${productId}', 'variant_id', '${variantId}',
                 'name', 'shirt', 'price', 10, 'qty', ${qty})),
               'pickup', ${qty * 10}, ${qty * 10}, 'cod', 'new')`);
  return scalar(`select id from orders where ref = '${ref}'`)!;
}

describeDb("two shoppers, one unit of one variant", () => {
  it("lets exactly one of them have it", async () => {
    /* The same test as the one at the top of this file, one level down.
       Genuinely concurrent: A holds its row lock while B tries the same
       unit. Run in sequence this would pass with no lock at all. */
    const { product, a: black } = variantStock("VAR-1", 1);
    const oa = variantOrder("VAR-A", product, black, 1);
    const ob = variantOrder("VAR-B", product, black, 1);

    const first = sqlAsync(
      `begin; select reserve_order_stock('${oa}'::uuid); select pg_sleep(1.5); commit;`);
    await pause(400);
    const second = sqlAsync(
      `begin; select reserve_order_stock('${ob}'::uuid); commit;`);

    const [ra, rb] = await Promise.all([first, second]);
    expect([ra.ok, rb.ok]).toEqual([true, false]);
    expect(onHand("VAR-1")).toBeGreaterThanOrEqual(0);
  });
});

describeDb("the variant check does work the total check cannot", () => {
  it("refuses a variant that is out while the product is not", () => {
    /* THE POINT OF THE WHOLE PHASE. Two units on the shelf, one of each
       variant. Ordering two of ONE variant passes the product total (2 of
       2) and must still be refused, because only one of them is that
       variant. Before variants this order was accepted and the shop found
       out when it went to pack it. */
    const { product, a: black } = variantStock("VAR-2", 1);
    expect(onHand("VAR-2")).toBe(2);              // two in total...

    const o = variantOrder("VAR-C", product, black, 2);
    const r = sqlAsync(`select reserve_order_stock('${o}'::uuid)`);
    return r.then((res) => {
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/Only 1 left/);
      // ...and it names the variant, not just the product, so the shopper
      // is told which choice ran out rather than being told the product
      // has none when it plainly has some.
      expect(res.error).toMatch(/Black \/ M/);
    });
  });

  it("still allows what genuinely fits", () => {
    const { product, a: black } = variantStock("VAR-3", 3);
    const o = variantOrder("VAR-D", product, black, 3);
    sql(`select reserve_order_stock('${o}'::uuid)`);
    // Three of the three Black/M held; the three White/L untouched.
    expect(onHand("VAR-3")).toBe(3);
  });
});

describeDb("a basket with no variant behaves exactly as before", () => {
  it("is not affected by the new loop at all", () => {
    /* The compatibility guarantee. Every order placed before variants
       existed, and every order for a product that has none, carries no
       variant_id -- the new loop skips them entirely and the two original
       checks decide, unchanged. */
    const p = stock("VAR-4", 2);
    const o = order("VAR-E", p, 2);
    sql(`select reserve_order_stock('${o}'::uuid)`);
    expect(onHand("VAR-4")).toBe(0);
  });

  it("is still refused by the product total when it asks for too much", () => {
    const p = stock("VAR-5", 1);
    const o = order("VAR-F", p, 2);
    return sqlAsync(`select reserve_order_stock('${o}'::uuid)`).then((r) => {
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/Only 1 left/);
    });
  });

  it("is still refused by the size check", () => {
    /* The check size-stock.sql added. It has to survive this change: a
       rewrite that quietly dropped it would pass every variant test in
       this file and leave the shop overselling by size again. */
    const p = stock("VAR-6", 2, "M");
    const o = order("VAR-G", p, 2, "L");          // none in L
    return sqlAsync(`select reserve_order_stock('${o}'::uuid)`).then((r) => {
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/in size L/);
    });
  });
});

/* ===========================================================================
 * RECEIVING, PER VARIANT
 *
 * Receiving is idempotent because a unique index refuses the second
 * receipt of a line -- Postgres rejecting it, not a check-then-insert two
 * concurrent clicks could both pass. That index has now been widened
 * twice: once for sizes, once for variants. Each widening is a chance to
 * break the guarantee for the shapes that came before.
 * ======================================================================== */

/** A purchase-order line pointing at a product, ready to receive. */
function poLine(ref: string, productId: string, qty: number): string {
  sql(`delete from stock_movements where note = '${ref}'`);
  sql(`delete from purchase_order_items where product_name = '${ref}'`);
  sql(`delete from purchase_orders where po_number = '${ref}'`);
  sql(`delete from suppliers where name = '${ref} supplier'`);
  sql(`insert into suppliers (name) values ('${ref} supplier')`);
  sql(`insert into purchase_orders (supplier_id, po_number, order_date, status)
       select id, '${ref}', current_date, 'draft' from suppliers where name = '${ref} supplier'`);
  sql(`insert into purchase_order_items (po_id, product_id, product_name, category, qty, unit_price)
       select po.id, '${productId}', '${ref}', 'other', ${qty}, 1
         from purchase_orders po where po.po_number = '${ref}'`);
  return scalar(`select id from purchase_order_items where product_name = '${ref}'`)!;
}

const receipt = (item: string, productId: string, variantId: string | null,
                 size: string, qty: number, note: string) =>
  sqlAsync(`insert into stock_movements
              (product_id, variant_id, size, delta, reason, po_item_id, note)
            values ('${productId}', ${variantId ? `'${variantId}'` : "null"},
                    '${size}', ${qty}, 'purchase_receipt', '${item}', '${note}')`);

describeDb("receiving a line that buys several variants", () => {
  it("writes one movement per variant, not one per line", async () => {
    /* THE BUG THE WIDENED INDEX EXISTS TO PREVENT. On the old index --
       unique on (po_item_id, size) -- three variants share one size, so
       the first receipt would be accepted and the other two rejected. The
       shop would receive ten shirts and believe it had thirty. */
    const { product, a, b } = variantStock("VAR-7", 0);
    const item = poLine("VAR-7", product, 20);

    expect((await receipt(item, product, a, "", 10, "VAR-7")).ok).toBe(true);
    expect((await receipt(item, product, b, "", 10, "VAR-7")).ok).toBe(true);
    expect(Number(scalar(
      `select count(*) from stock_movements where note = 'VAR-7'`))).toBe(2);
  });

  it("still refuses the same line and the same variant twice", async () => {
    const { product, a } = variantStock("VAR-8", 0);
    const item = poLine("VAR-8", product, 10);

    expect((await receipt(item, product, a, "", 10, "VAR-8")).ok).toBe(true);
    const second = await receipt(item, product, a, "", 10, "VAR-8");
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/stock_movements_receipt_once/);
  });

  it("still refuses a line with no variant twice", async () => {
    /* THE NULL TRAP. A unique index treats NULLs as distinct, so
       (item, '', null) twice would be two different keys and the second
       receipt of every unvarianted line the shop has ever had would be
       accepted -- the idempotency silently gone for the common case. The
       COALESCE sentinel in the index is what stops that. */
    const p = stock("VAR-9", 0);
    const item = poLine("VAR-9", p, 5);

    expect((await receipt(item, p, null, "", 5, "VAR-9")).ok).toBe(true);
    const second = await receipt(item, p, null, "", 5, "VAR-9");
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/stock_movements_receipt_once/);
  });

  it("still refuses the same line and the same SIZE twice", () => {
    // The guarantee size-stock.sql added, which this widening must keep.
    const p = stock("VAR-10", 0);
    const item = poLine("VAR-10", p, 5);
    return receipt(item, p, null, "M", 5, "VAR-10").then(async (first) => {
      expect(first.ok).toBe(true);
      const second = await receipt(item, p, null, "M", 5, "VAR-10");
      expect(second.ok).toBe(false);
    });
  });

  it("lets the same line receive two different sizes", () => {
    const p = stock("VAR-11", 0);
    const item = poLine("VAR-11", p, 10);
    return receipt(item, p, null, "M", 5, "VAR-11").then(async (first) => {
      expect(first.ok).toBe(true);
      expect((await receipt(item, p, null, "L", 5, "VAR-11")).ok).toBe(true);
    });
  });
});
