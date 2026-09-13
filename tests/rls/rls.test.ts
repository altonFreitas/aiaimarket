import { describe, it, expect, beforeAll } from "vitest";
import { DATABASE_URL, sql, scalar, denied, blockedByPolicy } from "./db";

/* THE PUBLIC DATA-SECURITY MODEL, TESTED BY RUNNING IT.
 *
 * RLS plus column grants is the ENTIRE thing standing between the anon key
 * -- which is in every visitor's network tab, by design -- and this shop's
 * orders, customers and margins. Sixty-nine test files and, until this one,
 * not one that touched a database. The only way to test a policy is to run
 * it: a policy is a sentence Postgres evaluates, and reading it is not the
 * same as knowing what it does.
 *
 * These run against a real Postgres with the real schema applied. They are
 * SKIPPED, loudly, when TEST_DATABASE_URL is absent -- so `npm run verify`
 * on a laptop stays fast and does not silently pretend to have checked.
 *
 * WHAT "SAFE" MEANS HERE, in two flavours that are deliberately not
 * conflated:
 *
 *   permission denied   the table is not reachable at all (a REVOKE).
 *   0 rows              it is reachable and a policy decided you see none.
 *
 * Both are safe today. Only the first stays safe if somebody later adds a
 * permissive policy, so each test says which one it expects.
 */

const RUN = Boolean(DATABASE_URL);
const describeDb = RUN ? describe : describe.skip;

if (!RUN) {
  console.warn(
    "\n  RLS tests SKIPPED: set TEST_DATABASE_URL to a database with\n" +
    "  supabase/ci-bootstrap.sql + supabase/run-all.sql applied.\n");
}

describeDb("the schema itself", () => {
  it("applies to an empty database without an error", () => {
    // The whole suite depends on this, and it is worth its own assertion:
    // an ordering bug in run-all.sql leaves a half-built database, and
    // every failure below would then be a symptom rather than the cause.
    expect(scalar("select count(*) from information_schema.tables where table_schema = 'public'"))
      .not.toBeNull();
    expect(Number(scalar(
      "select count(*) from information_schema.tables where table_schema = 'public'")))
      .toBeGreaterThan(20);
  });

  it("has row-level security on every table that holds anything private", () => {
    const off = sql(`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      order by 1`).rows;
    // Named rather than counted, so a new table without RLS shows up as
    // its own name in the failure rather than as an off-by-one.
    expect(off).toEqual([]);
  });
});

describeDb("what the anon key can read", () => {
  beforeAll(() => {
    // Seeded so that "0 rows" cannot be mistaken for "nothing was there".
    // A security test that passes against an empty table proves nothing.
    sql(`insert into products (ref, name, slug, price, description, status, archived)
         values ('RLS-OK', 'Visible boot', 'rls-visible', 10, 'x', 'approved', false)
         on conflict do nothing`);
    sql(`insert into products (ref, name, slug, price, description, status, archived)
         values ('RLS-NO', 'Unapproved boot', 'rls-hidden', 10, 'x', 'pending', false)
         on conflict do nothing`);
    sql(`insert into orders (ref, buyer_name, buyer_phone, items, mode, subtotal, total, pay_method)
         values ('RLS-ORD', 'Maria', '+67077712345', '[]', 'pickup', 10, 10, 'cod')
         on conflict do nothing`);
    sql(`insert into admin_users (email, password_hash)
         values ('rls@example.com', 'hash') on conflict do nothing`);
  });

  it("shows an approved product and hides an unapproved one", () => {
    // The moderation queue is only a queue if what is in it is not live.
    const names = sql("select name from products order by name", "anon").rows;
    expect(names).toContain("Visible boot");
    expect(names).not.toContain("Unapproved boot");
  });

  it("cannot read a single order", () => {
    // orders holds every buyer's name, phone and delivery address.
    // Reachable, and a policy returns nothing -- which is what lets the
    // service role read it through the same table.
    expect(scalar("select count(*) from orders", "anon")).toBe("0");
    expect(Number(scalar("select count(*) from orders"))).toBeGreaterThan(0);
  });

  it("is refused outright by the tables that should not be reachable at all", () => {
    // Not "returns no rows" -- refused. These carry staff credentials, the
    // audit trail, live invitation tokens, unit costs and the platform's
    // margin on every line it has sold.
    for (const table of [
      "admin_users", "audit_log", "seller_invites", "stock_movements",
      "product_costs", "notifications", "order_items", "rate_limits",
      "return_requests", "return_request_items",
    ]) {
      expect([table, denied(`select count(*) from ${table}`, "anon")])
        .toEqual([table, true]);
    }
  });

  it("is refused the payments_needing_review view", () => {
    // The finding that started the audit: the one object in the schema
    // with no REVOKE, exposing order refs -- half the credential pair the
    // entire buyer-side trust model runs on.
    expect(denied("select count(*) from payments_needing_review", "anon")).toBe(true);
  });

  it("is refused the reconciliation and reservation views", () => {
    for (const view of ["stock_reconciliation", "stock_reservations"]) {
      expect([view, denied(`select count(*) from ${view}`, "anon")])
        .toEqual([view, true]);
    }
  });
});

describeDb("what the anon key can write", () => {
  it("cannot insert an order", () => {
    // harden-rls.sql exists to close exactly this. Before it, anyone with
    // the public key could write orders straight past every check the
    // application makes -- price, stock, rate limit, all of it.
    expect(blockedByPolicy(
      `insert into orders (ref, buyer_name, buyer_phone, items, mode, subtotal, total, pay_method)
       values ('RLS-HACK', 'x', '+67077700000', '[]', 'pickup', 0, 0, 'cod')`,
      "anon")).toBe(true);
  });

  it("cannot change a price", () => {
    const before = scalar("select price from products where ref = 'RLS-OK'");
    sql("update products set price = 0.01 where ref = 'RLS-OK'", "anon");
    expect(scalar("select price from products where ref = 'RLS-OK'")).toBe(before);
  });

  it("cannot approve its own product", () => {
    sql("update products set status = 'approved' where ref = 'RLS-NO'", "anon");
    expect(scalar("select status from products where ref = 'RLS-NO'")).toBe("pending");
  });

  it("cannot delete anything from the catalog", () => {
    sql("delete from products where ref = 'RLS-OK'", "anon");
    expect(scalar("select count(*) from products where ref = 'RLS-OK'")).toBe("1");
  });

  it("cannot move stock", () => {
    // products.qty has exactly one writer -- a stock movement -- and the
    // ledger is not reachable by the public key.
    expect(denied(
      "insert into stock_movements (product_id, delta, reason) " +
      "select id, 100, 'correction' from products where ref = 'RLS-OK'", "anon")).toBe(true);
  });

  it("cannot call the functions that move money, hold stock or erase customers", () => {
    for (const call of [
      "select reserve_order_stock('00000000-0000-0000-0000-000000000000'::uuid)",
      "select release_stale_reservations(48)",
      "select redact_old_order_pii(7)",
      "select hit_rate_limit('k', 1, 60)",
      "select seller_earnings('00000000-0000-0000-0000-000000000000'::uuid)",
    ]) {
      const r = sql(call, "anon");
      expect([call, r.ok]).toEqual([call, false]);
    }
  });

  it("holds EXECUTE on exactly the four counters and nothing else", () => {
    /* AN ALLOWLIST, not a denylist, and this is the test that found the
     * real bug. Every one of these had a `revoke` beside it that LOOKED
     * finished and closed nothing:
     *
     *   revoke ... from anon         leaves PUBLIC's grant, which anon
     *                                inherits.
     *   revoke ... from public       leaves the direct grant Supabase's
     *                                default privileges hand to anon at
     *                                creation time.
     *
     * Both are needed. Reading either one in a diff, it is finished.
     * redact_old_order_pii -- which irreversibly scrubs the name, phone
     * and address off every order older than N years and deletes their
     * log -- was callable by anyone holding the public key.
     *
     * Written as an allowlist so a new SECURITY DEFINER function has to be
     * added here deliberately rather than arriving open. */
    const PUBLIC_BY_DESIGN = [
      "decrement_loves", "increment_loves", "increment_views", "increment_wa_clicks",
    ];
    const callable = sql(`
      select p.proname from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and has_function_privilege('anon', p.oid, 'EXECUTE')
      order by 1`).rows;
    expect(callable).toEqual(PUBLIC_BY_DESIGN);
  });
});

describeDb("the settings row", () => {
  it("never hands out the TOTP secret", () => {
    // A column grant, not a policy: settings is public (the shop's name,
    // its hours, its delivery zones) and exactly one column on it is not.
    const r = sql("select totp_secret from settings where id = 1", "anon");
    expect(r.ok).toBe(false);
  });

  it("still lets a shopper read the shop's own details", () => {
    // The negative test above is only meaningful next to this one:
    // refusing everything would also pass it.
    expect(scalar("select count(*) from settings", "anon")).toBe("1");
  });
});
