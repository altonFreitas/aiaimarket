import { describe, it, expect, beforeAll } from "vitest";
import { DATABASE_URL, sql, scalar } from "./db";

/* THE COLUMN, NOT THE ARITHMETIC.
 *
 * tests/tax.cents.test.ts proves the arithmetic keeps its cents. This
 * proves the database does -- which is a different question, and the one
 * that was answered wrongly: a rate computed to four decimal places of a
 * percentage was stored in numeric(6,4), which holds two, and Postgres
 * rounded the rest away without an error, a warning or a failed save.
 *
 * Only a real Postgres can answer it. A mock would have stored whatever it
 * was handed.
 */

const RUN = Boolean(DATABASE_URL);
const describeDb = RUN ? describe : describe.skip;

if (!RUN) {
  console.warn(
    "\n  Tax column tests SKIPPED: set TEST_DATABASE_URL to a database\n" +
    "  with supabase/ci-bootstrap.sql + supabase/run-all.sql applied.\n");
}

describeDb("the rate the shop set is the rate the column holds", () => {
  beforeAll(() => {
    sql(`insert into settings (id) values (1) on conflict (id) do nothing`);
  });

  it("keeps four decimal places of a percentage", () => {
    // 7.125% -- the fraction lib/money.ts normalizeTaxRate() produces.
    sql(`update settings set tax_rate = 0.071250 where id = 1`);
    expect(Number(scalar(`select tax_rate from settings where id = 1`))).toBe(0.07125);
  });

  it("would have rounded it to 7.13% before the column was widened", () => {
    /* The bug, reproduced against the same server: cast the same value
       through the old type and watch it change. If this ever stops being
       true the file that widens the column has stopped being needed. */
    expect(Number(scalar(`select 0.071250::numeric(6,4)`))).toBe(0.0713);
    expect(Number(scalar(`select 0.071250::numeric(9,6)`))).toBe(0.07125);
  });

  it("still refuses a rate above 100%", () => {
    /* The widening must not have widened the RULE. sql() REPORTS a refusal
       rather than throwing it -- a security suite is mostly about what is
       denied -- so this reads .ok rather than wrapping the call in a try,
       which would have passed no matter what the database did. */
    const r = sql(`update settings set tax_rate = 1.5 where id = 1`);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/settings_tax_rate_range_check/);
    expect(Number(scalar(`select tax_rate from settings where id = 1`))).toBe(0.07125);
    sql(`update settings set tax_rate = 0 where id = 1`);
  });
});

describeDb("an order's tax is stored to the cent", () => {
  it("keeps 13.95 as 13.95", () => {
    sql(`delete from orders where ref = 'TAXCENT'`);
    sql(`insert into orders (ref, buyer_name, buyer_phone, items, mode,
                             subtotal, tax, tax_rate, total, pay_method, status)
         values ('TAXCENT', 'Buyer', '+67077712345', '[]'::jsonb, 'pickup',
                 279, 13.95, 0.05, 292.95, 'cod', 'new')`);
    expect(Number(scalar(`select tax from orders where ref = 'TAXCENT'`))).toBe(13.95);
    expect(Number(scalar(`select total from orders where ref = 'TAXCENT'`))).toBe(292.95);
    // And the rate it was charged at, to the same precision as the setting.
    sql(`update orders set tax_rate = 0.071250 where ref = 'TAXCENT'`);
    expect(Number(scalar(`select tax_rate from orders where ref = 'TAXCENT'`))).toBe(0.07125);
    sql(`delete from orders where ref = 'TAXCENT'`);
  });

  it("keeps a line's share to the cent too", () => {
    // order_items.tax is what a return of that line gives back.
    expect(Number(scalar(`select 12.68::numeric(10,2)`))).toBe(12.68);
    const scale = scalar(
      `select numeric_scale from information_schema.columns
        where table_schema = 'public' and table_name = 'order_items' and column_name = 'tax'`);
    expect(Number(scale)).toBe(2);
  });
});
