import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const DATA = read("src/lib/data/stale.ts");
const ADMIN = read("src/lib/data/admin.ts");
const LIST = read("src/components/admin/ProductList.tsx");
const PAGE = read("src/app/admin/products/page.tsx");
const SETTINGS = read("src/lib/actions/settings.ts");
const FORM = read("src/components/admin/SettingsAdmin.tsx");
const SQL = read("supabase/stale-stock.sql");

/* WHAT HAS NOT SOLD, AND WHERE THE SHOP ACTS ON IT.
 *
 * lib/stale.ts holds the rule and is tested on its own. These are the
 * joins: where the figures come from, what the notice points at, and
 * whether a shop can still save its settings before the SQL is pasted.
 */

describe("where the sales figures come from", () => {
  it("does NOT reuse the capped order list", () => {
    /* Every other figure on the to-do list is built from the most recent N
       orders. A busy shop's cap covers less than thirty days, so a product
       that sold last week would be missing from it and reported as not
       having sold in a month -- the alert firing hardest on the shop it is
       least true of. */
    expect(ADMIN).toContain("staleStock(staleDays)");
    expect(DATA).toContain('.from("order_items")');
    expect(DATA).toContain('.gte("created_at", since)');
  });

  it("does not count a cancelled order as a sale", () => {
    // And counts everything else: waiting to be confirmed, being packed
    // and out for delivery are all somebody buying the thing.
    expect(DATA).toContain('.neq("orders.status", "cancelled")');
  });

  it("only looks at stock a discount could actually move", () => {
    /* Discounting something the shop has run out of achieves nothing, and
       an unapproved or archived product is not on sale to begin with. */
    expect(DATA).toContain('.eq("archived", false)');
    expect(DATA).toContain('.eq("status", "approved")');
    expect(DATA).toContain('.neq("stock_status", "out")');
  });

  it("leaves out what the shop has already discounted", () => {
    // It has looked and acted; saying it again every morning is how a
    // notice stops being read.
    expect(DATA).toContain('.is("discount_price", null)');
  });

  it("degrades to nothing rather than to an error page", () => {
    expect(DATA).toContain("return empty;");
    expect(DATA).toMatch(/\} catch \{[\s\S]*?return empty;/);
  });
});

describe("where the notice points", () => {
  it("lands on the catalogue with the filter on", () => {
    expect(PAGE).toContain('initialStale={params?.stale === "1"}');
    expect(LIST).toContain("if (stale) a = a.filter((p) => staleSet.has(p.id));");
  });

  it("offers the filter only when something is behind it", () => {
    // A filter that can only ever return nothing teaches people the screen
    // is broken.
    expect(LIST).toContain("{staleIds.length > 0 && (");
  });

  it("reads the list where the shop acts, not only on the home page", () => {
    // A link that lands on an unfiltered catalogue has told them a number
    // and then hidden the rows.
    expect(PAGE).toContain("staleStock(days)");
  });
});

describe("the setting", () => {
  it("is clamped in the column and in the code", () => {
    expect(SQL).toContain("check (stale_days >= 1 and stale_days <= 365)");
    expect(read("src/lib/stale.ts")).toContain("if (rounded < 1 || rounded > 365)");
  });

  it("defaults so an unwritten row still reads as something", () => {
    expect(SQL).toContain("add column if not exists stale_days int not null default 30");
  });

  it("is offered on the settings screen", () => {
    expect(FORM).toContain('id="stale-days"');
    expect(FORM).toContain("min={1} max={365}");
    expect(FORM).toContain("stale_days: num(f.stale_days, 0)");
  });

  it("does not stop a shop saving settings before the SQL is pasted", () => {
    /* Postgres fails the WHOLE statement over one unknown column, so
       naming stale_days on a shop that has not run the migration would
       stop it saving ANY setting -- including the ones it had just typed.
       The legal and tax columns beside it had the same hazard, written
       down as a warning rather than handled. */
    expect(SETTINGS).toContain("writeTolerating(optional, (extra) =>");
    for (const col of ["stale_days", "tax_rate", "display_currency", "legal_address"]) {
      expect(SETTINGS, col).toMatch(new RegExp(`const optional = \\{[\\s\\S]*?${col}`));
    }
    // The columns every shop has stay outside it, so they are never the
    // ones dropped.
    expect(SETTINGS).toContain("...core,");
  });
});
