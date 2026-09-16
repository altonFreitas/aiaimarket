import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* THE RESERVATION, READ OUT OF THE SQL ITSELF.
 *
 * None of this can be executed here -- there is no Postgres in this suite,
 * which is finding D in the plan and a separate piece of work. What CAN be
 * checked without a database is that the file still says the things the
 * whole design rests on, because every one of them is a line somebody could
 * remove in a refactor without any test noticing:
 *
 *   - the row lock. Without FOR UPDATE this is the same read-then-write
 *     race it was written to close, and it would still pass every
 *     functional test that did not run two orders at once.
 *   - the deterministic lock order. Without it two baskets holding the same
 *     two products in opposite order deadlock -- rarely, in production,
 *     under load.
 *   - the three-state target. Netting the two kinds of holding together
 *     makes 'reserved' and 'sold' indistinguishable, which silently breaks
 *     the sweep.
 *   - the pre-order exemption, in both directions.
 *
 * These are structural assertions, and they are worth exactly what they
 * claim: that the mechanism is still present, not that it works.
 */

const SQL = readFileSync(
  resolve(__dirname, "../supabase/stock-reservation.sql"), "utf8");
const ORDERS = readFileSync(
  resolve(__dirname, "../src/lib/actions/orders.ts"), "utf8");
const CRON = readFileSync(
  resolve(__dirname, "../src/app/api/cron/release-reservations/route.ts"), "utf8");
const VERCEL = JSON.parse(readFileSync(
  resolve(__dirname, "../vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] };

/** The body of one `create or replace function <name>` block. */
function fn(name: string): string {
  const start = SQL.indexOf(`create or replace function ${name}`);
  if (start < 0) throw new Error(`no such function in the migration: ${name}`);
  const end = SQL.indexOf("\n$$;", start);
  const alt = SQL.indexOf("\nend $$;", start);
  const stop = [end, alt].filter((i) => i > start).sort((a, b) => a - b)[0];
  return SQL.slice(start, stop > 0 ? stop : undefined);
}

describe("reserve_order_stock", () => {
  const body = fn("reserve_order_stock");

  it("locks each product row it is about to commit against", () => {
    // The entire finding. Everything else in this function was already
    // being done in TypeScript; holding the row still between deciding
    // there is enough and taking it is what could not be.
    expect(body).toMatch(/for\s+update/i);
  });

  it("takes those locks in a deterministic order", () => {
    // Two baskets with the same two products in opposite order would
    // otherwise take the two locks in opposite orders and deadlock.
    expect(body).toMatch(/order by 1/);
  });

  it("checks every line before holding any of them", () => {
    // The loop verifies, and the write happens once afterwards. A basket
    // that fails on its third line must not leave holds behind from the
    // first two -- and since the raise aborts the function, it cannot.
    const check = body.indexOf("raise exception 'Only %");
    const write = body.indexOf("sync_order_stock_state");
    expect(check).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(check);
  });

  it("names the product and what is left, for a sentence a shopper reads", () => {
    expect(body).toMatch(/Only %.*left of "%"/);
    expect(body).toMatch(/greatest\(v_qty, 0\)/);
  });

  it("holds nothing for a pre-order", () => {
    // A pre-order is the shop saying it does not have this. Holding units
    // it has already said it does not have is incoherent.
    expect(body).toMatch(/is_preorder/);
    expect(body).toMatch(/if v_pre then return; end if/);
  });

  it("is not callable by anyone holding the anon key", () => {
    // BOTH `public` and the two roles by name. Revoking from one leaves
    // the other's grant and reads as finished -- see tests/rls/rls.test.ts,
    // which caught exactly that on five functions.
    expect(SQL).toMatch(
      /revoke all on function reserve_order_stock\(uuid\) from public, anon, authenticated/);
  });
});

describe("sync_order_stock_state", () => {
  const body = fn("sync_order_stock_state");

  it("has three targets, and refuses a fourth", () => {
    expect(body).toMatch(/'reserved', 'sold', 'released'/);
    expect(body).toMatch(/raise exception 'sync_order_stock_state: unknown state/);
  });

  it("counts held and sold separately", () => {
    // Netting them together makes 'reserved' and 'sold' indistinguishable,
    // which is exactly the distinction release_stale_reservations depends
    // on -- it would then either release live sales or nothing at all.
    expect(body).toMatch(/filter \(where m\.reason = 'reservation'\)/);
    expect(body).toMatch(/filter \(where m\.reason in \('sale','return'\)\)/);
  });

  it("targets a hold when reserved and a sale when sold, never both", () => {
    expect(body).toMatch(/case when p_state = 'reserved' then -w\.want else 0 end/);
    expect(body).toMatch(/case when p_state = 'sold' then -w\.want else 0 end/);
  });

  it("writes only the difference, so calling it twice is not two movements", () => {
    expect(body).toMatch(/need_hold <> 0/);
    expect(body).toMatch(/need_sale <> 0/);
  });

  it("keeps the old two-argument form working", () => {
    // A function signature is an interface. Dropping it would break any
    // caller this file has not been shown.
    expect(SQL).toMatch(/create or replace function sync_order_stock\(p_order_id uuid, p_take boolean\)/);
    expect(SQL).toMatch(/case when p_take then 'sold' else 'released' end/);
  });
});

describe("the status trigger", () => {
  const body = fn("decrement_stock_on_confirm");

  it("holds on new, sells on anything live, releases on cancelled", () => {
    expect(body).toMatch(/status = 'cancelled'[\s\S]*'released'/);
    expect(body).toMatch(/status = 'new'[\s\S]*'reserved'/);
    expect(body).toMatch(/else[\s\S]*'sold'/);
  });

  it("still exempts a pre-order in both directions", () => {
    // Excluded from the taking AND from the giving back. A pre-order that
    // was never taken from stock must not be handed back to it either.
    expect(body).toMatch(/if coalesce\(new\.is_preorder, false\) then return new; end if/);
  });
});

describe("release_stale_reservations", () => {
  const body = fn("release_stale_reservations");

  it("refuses a window under an hour", () => {
    // A sweep with a tiny window cancels live orders. There is no undo.
    expect(body).toMatch(/p_hours < 1/);
    expect(body).toMatch(/raise exception 'release_stale_reservations/);
  });

  it("only touches orders that are still unconfirmed", () => {
    expect(body).toMatch(/o\.status = 'new'/);
  });

  it("only touches orders actually holding something", () => {
    // A pre-order, or one placed before the migration, holds nothing and is
    // not stale stock.
    expect(body).toMatch(/m\.reason = 'reservation'/);
    expect(body).toMatch(/< 0/);
  });

  it("releases through the status, not by writing movements directly", () => {
    // One path ends a reservation, so an order cannot survive as a live
    // order with no stock behind it.
    expect(body).toMatch(/update orders[\s\S]*set status = 'cancelled'/);
    expect(body).not.toMatch(/insert into stock_movements/);
  });

  it("says why, on the order itself", () => {
    expect(body).toMatch(/cancel_reason/);
    expect(body).toMatch(/insert into order_log/);
  });

  it("is not callable by anyone holding the anon key", () => {
    expect(SQL).toMatch(
      /revoke all on function release_stale_reservations\(int\) from public, anon, authenticated/);
  });
});

describe("the ledger vocabulary", () => {
  it("adds the reason constraint only when there is not one already", () => {
    /* IT USED TO DROP AND RE-ADD, and that is the bug this now pins shut.
       supabase/supplier-returns.sql runs after this file and widens the same
       constraint with 'supplier_return'. Dropping it here and putting the
       shorter list back broke run-all.sql on any shop that had actually sent
       goods back to a supplier -- the rows held a reason this list has never
       heard of. A clean database never showed it, because empty tables
       violate nothing.

       So: no drop, and the add asks twice -- is there a constraint, and do
       the rows already fit. The second question matters because a run that
       failed here once has already committed the old drop, leaving no
       constraint at all beside rows this list would reject. */
    expect(SQL).not.toMatch(/drop constraint if exists stock_movements_reason_check/);
    expect(SQL).toMatch(/if not exists \([\s\S]{0,200}pg_constraint/);
    expect(SQL).toMatch(/reason not in \(/);
    expect(SQL).toMatch(/check \(reason in[\s\S]*'reservation'\)\)/);
  });

  it("keeps every reason the ledger already used", () => {
    for (const reason of
      ["purchase_receipt", "sale", "adjustment", "return", "correction"]) {
      expect([reason, SQL.includes(`'${reason}'`)]).toEqual([reason, true]);
    }
  });

  it("backfills orders already sitting unconfirmed", () => {
    // Without this every order already at 'new' keeps its units on the
    // shelf forever -- the old behaviour, silently preserved for exactly
    // the orders most affected by it.
    expect(SQL).toMatch(/reservation backfill/);
    expect(SQL).toMatch(/where status = 'new'/);
  });
});

describe("placeOrder", () => {
  it("reserves through the RPC, not by reading and writing itself", () => {
    expect(ORDERS).toMatch(/rpc\("reserve_order_stock"/);
  });

  it("unwinds the order when the hold cannot be taken", () => {
    // The order row has to exist before stock can be held against it, so
    // there is a window. It is closed by deleting the order rather than
    // leaving one behind that the shop believes in and cannot fill.
    expect(ORDERS).toMatch(/if \(!reserved\.ok\)[\s\S]{0,200}\.delete\(\)\.eq\("id", data\.id\)/);
    expect(ORDERS).toMatch(/throw new Error\(reserved\.message\)/);
  });

  it("reserves before the buyer is told anything", () => {
    // A notification for an order that is about to be deleted is a message
    // that cannot be taken back.
    const reserve = ORDERS.indexOf("const reserved = await reserveStock");
    // The CALL, not the import at the top of the file.
    const notify = ORDERS.indexOf("notifyOrderEventInBackground(data");
    expect(reserve).toBeGreaterThan(-1);
    expect(notify).toBeGreaterThan(reserve);
  });

  it("treats a missing migration as 'this database does not reserve yet'", () => {
    // 42883 undefined_function, PGRST202 no such RPC. A shop that has not
    // run the migration must keep selling.
    expect(ORDERS).toMatch(/"42883"/);
    expect(ORDERS).toMatch(/"PGRST202"/);
  });

  it("refuses every other failure rather than assuming it is fine", () => {
    // This call is the one thing between two buyers and the same last
    // unit. Treating an unrecognised error as success hands back the bug.
    expect(ORDERS).toMatch(/reportError\(error, \{ scope: "reserve_order_stock"/);
    expect(ORDERS).toMatch(/ok: false, message: "We could not hold the stock/);
  });
});

describe("the sweep is actually scheduled", () => {
  it("has a cron entry", () => {
    // The function existing and nothing calling it is the same as it not
    // existing, only harder to notice.
    const paths = VERCEL.crons.map((c) => c.path);
    expect(paths).toContain("/api/cron/release-reservations");
  });

  it("does not run in the same minute as the payment reconciliation", () => {
    const mine = VERCEL.crons.find((c) => c.path === "/api/cron/release-reservations")!;
    const other = VERCEL.crons.find((c) => c.path === "/api/cron/reconcile-payments")!;
    expect(mine.schedule.split(" ")[0]).not.toBe(other.schedule.split(" ")[0]);
  });

  it("fails closed without a secret", () => {
    // Without this, anyone could cancel every unconfirmed order in the shop.
    expect(CRON).toMatch(/if \(!secret\) return false/);
    expect(CRON).toMatch(/timingSafeEqual/);
  });

  it("defaults to a window set by the slowest real payment, not the fastest", () => {
    // This shop takes bank transfers and sells on credit. A window tuned
    // for a card checkout cancels real orders from real customers.
    expect(CRON).toMatch(/DEFAULT_HOURS = 48/);
  });

  it("is quiet when nothing happened and speaks when something did", () => {
    expect(CRON).toMatch(/if \(rows\.length && alertsConfigured\(\)\)/);
  });
});
