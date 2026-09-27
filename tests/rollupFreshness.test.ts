import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { rollupIsCurrent } from "@/lib/data/salesRollup";

/* THE NET PROFIT THAT CHANGED WHEN YOU CHANGED THE RANGE.
 *
 * Reported from the shop: the admin home said $102.20 on every range
 * except "1D", where it said $259.43 -- and $259.43 is what the Finance
 * screen says.
 *
 * Not an arithmetic bug. "1D" is the only range bucketed by HOUR, so it is
 * the only one a rollup grouped by DAY cannot answer, and therefore the
 * only one that fell back to the live order book -- which is what Finance
 * reads too. Every other range read sales_daily, a materialized view that
 * is exactly as current as its last refresh. Nothing recorded when that
 * was, so `ready: true` only ever meant "the view can be read".
 */

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const PAGE = code("src/app/admin/page.tsx");
const SQL = read("supabase/analytics-freshness.sql")
  .replace(/^\s*--.*$/gm, "");
/* The stamping lives in the file that OWNS refresh_sales_daily(). Putting
   a second definition in analytics-freshness.sql would have made that file
   the last to create the function -- and the health panel checks that
   function to decide whether the ROLLUP is installed, so it would have
   reported a rollup that was never built. */
const ROLLUP_SQL = read("supabase/sales-rollup.sql")
  .replace(/^\s*--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const t = (iso: string) => iso;

describe("whether the rollup may be trusted with money", () => {
  it("is current when it refreshed after the last order change", () => {
    expect(rollupIsCurrent({
      refreshedAt: t("2026-09-26T12:00:00Z"),
      ordersChangedAt: t("2026-09-26T11:59:59Z"),
    })).toBe(true);
  });

  it("is not current when an order changed after it refreshed", () => {
    expect(rollupIsCurrent({
      refreshedAt: t("2026-09-26T12:00:00Z"),
      ordersChangedAt: t("2026-09-26T12:00:01Z"),
    })).toBe(false);
  });

  it("counts an exact tie as current", () => {
    // The refresh read that change; it did not miss it by zero seconds.
    const same = t("2026-09-26T12:00:00Z");
    expect(rollupIsCurrent({ refreshedAt: same, ordersChangedAt: same })).toBe(true);
  });

  it("refuses a rollup that has never refreshed", () => {
    /* Also the shape of a shop that has not applied
       analytics-freshness.sql: the honest reading of "I cannot tell
       whether these are current" is not to put them on a card labelled
       net profit. */
    expect(rollupIsCurrent({ refreshedAt: null, ordersChangedAt: t("2026-09-26T12:00:00Z") }))
      .toBe(false);
    expect(rollupIsCurrent({ refreshedAt: null, ordersChangedAt: null })).toBe(false);
  });

  it("trusts it on a shop with no orders at all", () => {
    // Nothing for it to be behind on, and an empty dashboard is the same
    // either way.
    expect(rollupIsCurrent({ refreshedAt: t("2026-09-26T12:00:00Z"), ordersChangedAt: null }))
      .toBe(true);
  });

  it("refuses a timestamp it cannot read rather than guessing", () => {
    for (const bad of ["", "not a date", "yesterday"]) {
      expect([bad, rollupIsCurrent({
        refreshedAt: t("2026-09-26T12:00:00Z"), ordersChangedAt: bad,
      })]).toEqual([bad, false]);
    }
  });
});

describe("the dashboard's use of it", () => {
  it("asks before reading the rollup, not after", () => {
    // Reading it and then deciding would already have paid for the read.
    expect(PAGE).toMatch(/const rollupCurrent = freshness \? rollupIsCurrent\(freshness\) : false/);
    expect(PAGE.indexOf("rollupIsCurrent(freshness)"))
      .toBeLessThan(PAGE.indexOf("await salesRollup("));
  });

  it("falls back to the order book when the rollup is behind", () => {
    expect(PAGE).toMatch(/const fromRollup = daily && rollupCurrent && rollup\.ready/);
    // `ready` alone is what the bug was.
    expect(PAGE).not.toMatch(/const fromRollup = daily && rollup\.ready;/);
  });

  it("says so, rather than being quietly slow", () => {
    expect(PAGE).toMatch(/rollupStale = daily && !rollupCurrent && Boolean\(freshness\?\.ordersChangedAt\)/);
    expect(code("src/components/admin/AdminHome.tsx")).toMatch(/\{rollupStale && \(/);
  });
});

describe("what the database records", () => {
  it("stamps the refresh only after the rebuild", () => {
    /* A refresh that throws must not leave a record saying it worked. */
    const at = ROLLUP_SQL.indexOf("create or replace function refresh_sales_daily");
    expect(at, "refresh_sales_daily").toBeGreaterThan(-1);
    const body = ROLLUP_SQL.slice(at);
    const rebuild = body.indexOf("refresh materialized view");
    const stamp = body.indexOf("insert into analytics_refresh");
    expect(rebuild, "the rebuild").toBeGreaterThan(-1);
    expect(stamp, "the stamp").toBeGreaterThan(-1);
    expect(rebuild).toBeLessThan(stamp);
  });

  it("compares against when an order CHANGED, not when it was placed", () => {
    /* Cancelling a month-old order changes the takings and moves no
       created_at. Proved against a real Postgres: the rollup went on
       reporting the cancelled sale as revenue. */
    expect(SQL).toMatch(/max\(o\.updated_at\) from orders/);
    expect(SQL).not.toMatch(/max\(o\.created_at\) from orders/);
    expect(SQL).toMatch(/add column if not exists updated_at/);
    /* The WHOLE statement: a prefix match passed with the trigger renamed
       to orders_touch_updated_at_DISABLED, which installs nothing on
       orders and leaves updated_at frozen at insert time. */
    expect(SQL).toMatch(
      /create trigger orders_touch_updated_at\s+before update on orders\s+for each row execute function touch_order_updated_at\(\)/);
  });

  it("backfills from the order's own creation, not from now()", () => {
    // now() would claim every historic order changed the moment the
    // migration ran, and the dashboard would refuse the rollup for ever.
    expect(SQL).toMatch(/update orders set updated_at = created_at/);
  });

  it("keeps the storefront out of the shop's takings", () => {
    expect(SQL).toMatch(/revoke all on analytics_refresh from anon, authenticated/);
    expect(SQL).toMatch(/revoke all on function analytics_freshness\(\) from public, anon, authenticated/);
  });

  it("re-runs safely", () => {
    expect(SQL).toMatch(/create table if not exists analytics_refresh/);
    expect(SQL).toMatch(/drop trigger if exists orders_touch_updated_at/);
    expect(SQL).toMatch(/create or replace function analytics_freshness/);
  });

  it("creates the table before the refresh that writes to it", () => {
    const health = read("src/lib/schemaHealth.ts");
    const order = health.slice(health.indexOf("export const SCHEMA_ORDER"));
    const list = order.slice(0, order.indexOf("];"));
    expect(list).toContain('"analytics-freshness.sql"');
    expect(list.indexOf('"analytics-freshness.sql"'))
      .toBeLessThan(list.indexOf('"sales-rollup.sql"'));
    expect(read("supabase/run-all.sql")).toContain("analytics-freshness.sql");
  });

  it("does not fail the refresh on a shop without the table yet", () => {
    /* sales-rollup.sql is applied to shops that have not got the newer
       file. A missing analytics_refresh must leave the rebuild working
       and simply record nothing. */
    expect(ROLLUP_SQL).toMatch(/exception when undefined_table then/);
  });

  it("defines refresh_sales_daily exactly once across the folder", () => {
    /* The health panel checks that function to decide whether the rollup
       is installed. A second definition elsewhere would make that file the
       last creator, and the panel would report a rollup nobody built. */
    const dir = path.join(process.cwd(), "supabase");
    const hits = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".sql") && f !== "run-all.sql")
      .filter((f) => /create\s+(or\s+replace\s+)?function\s+refresh_sales_daily/
        .test(fs.readFileSync(path.join(dir, f), "utf8")));
    expect(hits).toEqual(["sales-rollup.sql"]);
  });
});
