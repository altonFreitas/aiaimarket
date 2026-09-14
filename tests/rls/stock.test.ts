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
             "or ref like 'SIZE-%' or ref like 'STALE-%')";

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
