import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  SCHEMA_FEATURES, NOT_SCHEMA_FILES, INVENTORY_FILE,
  checkSchema, memberKey, outstandingFiles, uncheckedFiles, snapshotFromRows,
  type SchemaSnapshot,
} from "@/lib/schemaHealth";

/** Everything a fully migrated database has beyond its tables. */
const KINDS = {
  views: ["stock_reconciliation"],
  routines: ["schema_inventory", "sync_order_stock"],
  indexes: [
    ["public.products", "idx_products_live"],
    ["public.sellers", "idx_sellers_status"],
  ] as [string, string][],
  /* harden-rls.sql has been run, so the three open-door policies are gone.
   * One unrelated policy is left in place to prove the check looks for the
   * named ones rather than for an empty set. */
  policies: [["public.products", "products_public_read"]] as [string, string][],
};

/** A snapshot from a plain list of "table" and "table.column", plus
 * whichever of the other kinds the caller wants. */
function snap(names: string[], kinds: Partial<typeof KINDS> = KINDS): SchemaSnapshot {
  const tables = new Set<string>();
  const columns = new Set<string>();
  for (const n of names) {
    if (n.includes(".")) { columns.add(n); tables.add(n.split(".")[0]); }
    else tables.add(n);
  }
  return {
    tables, columns,
    views: new Set(kinds.views ?? []),
    routines: new Set(kinds.routines ?? []),
    indexes: new Set((kinds.indexes ?? []).map(([t, i]) => memberKey(t, i))),
    policies: new Set((kinds.policies ?? []).map(([t, x]) => memberKey(t, x))),
    seesKinds: true,
  };
}

const EVERYTHING = snap([
  "products", "orders", "settings", "categories", "sellers", "customers",
  "product_reviews", "seller_payouts", "products.search_vector", "products.rating_count",
  "notifications", "orders.lang",
  "payments", "payment_events",
  "suppliers", "purchase_orders", "purchase_order_items",
  "purchase_order_items.sizes", "purchase_order_items.description",
  "stock_movements",
  "product_costs", "sales_targets",
  "order_returns", "order_return_items",
  "promotions",
  "products.preorder_enabled", "orders.is_preorder",
  "settings.reorder_window_days",
  "admin_users", "audit_log", "admin_users.role", "admin_users.sections",
  "sellers.features",
  "products.audience", "products.restock_level", "settings.restock_alert_pct",
]);

describe("checkSchema", () => {
  it("reports everything applied on a fully migrated database", () => {
    const out = checkSchema(EVERYTHING);
    expect(out.filter((f) => !f.applied)).toEqual([]);
    expect(outstandingFiles(out)).toEqual([]);
  });

  it("reports everything outstanding on an empty one", () => {
    const out = checkSchema(snap([], {}));
    // Every file that CREATES something, that is. harden-rls.sql only
    // removes, and on an empty database there is nothing to remove -- the
    // doors it closes are not open, so it is satisfied and saying otherwise
    // would be a red row with nothing behind it.
    //
    // schema-health.sql is the other exception, and for the same kind of
    // reason: this snapshot is kind-aware, which is only possible because
    // that file has been run.
    const done = new Set(["harden-rls.sql", INVENTORY_FILE]);
    expect(out.filter((f) => !done.has(f.file)).every((f) => !f.applied)).toBe(true);
    expect(out.filter((f) => f.applied).map((f) => f.file).sort())
      .toEqual([...done].sort());
    expect(outstandingFiles(out)).toHaveLength(SCHEMA_FEATURES.length - done.size);
  });

  it("catches the exact gap that broke staff login", () => {
    // admin-users.sql run, admin-roles.sql not. Nobody could sign in and
    // nothing said why.
    const names = [...EVERYTHING.tables, ...EVERYTHING.columns]
      .filter((n) => n !== "admin_users.role" && n !== "admin_users.sections");
    const out = checkSchema(snap(names));
    const roles = out.find((f) => f.file === "admin-roles.sql")!;
    expect(roles.applied).toBe(false);
    expect(roles.missing).toEqual(["admin_users.role", "admin_users.sections"]);
    // And the file it depends on is still reported as done.
    expect(out.find((f) => f.file === "admin-users.sql")!.applied).toBe(true);
  });

  it("catches the exact gap that stopped products saving", () => {
    const names = [...EVERYTHING.tables, ...EVERYTHING.columns]
      .filter((n) => !n.startsWith("products.audience")
                  && !n.startsWith("products.restock_level")
                  && !n.startsWith("settings.restock_alert_pct"));
    const out = checkSchema(snap(names));
    const f = out.find((x) => x.file === "audience-restock.sql")!;
    expect(f.applied).toBe(false);
    expect(f.missing).toEqual([
      "products.audience", "products.restock_level", "settings.restock_alert_pct",
    ]);
  });

  it("names the missing TABLE rather than its columns", () => {
    // "orders.lang is missing" is a confusing way to say orders does not
    // exist yet.
    const out = checkSchema(snap(["products", "settings"]));
    const notif = out.find((f) => f.file === "notifications.sql")!;
    expect(notif.missing).toEqual(["notifications", "orders"]);
  });

  it("is not confused by capitalisation", () => {
    const out = checkSchema(
      snap(["products", "orders", "settings", "categories", "sellers", "customers"])
    );
    expect(out.find((f) => f.file === "schema.sql")!.applied).toBe(true);
  });

  it("keeps them in the order they should be run", () => {
    const files = SCHEMA_FEATURES.map((f) => f.file);
    // The inventory first: until it is installed nothing below it can be
    // checked, and the panel's own header says to run this one first.
    expect(files[0]).toBe(INVENTORY_FILE);
    expect(files[1]).toBe("schema.sql");
    expect(files.indexOf("admin-roles.sql")).toBeGreaterThan(files.indexOf("admin-users.sql"));
  });
});

describe("the objects that need looking past tables", () => {
  it("catches a stock-ledger.sql that was never run", () => {
    // The file creates no table and no column, so for a long time it was
    // not in the list at all -- and the panel, having no row for it, said
    // every SQL file had been run.
    const out = checkSchema(snap([...EVERYTHING.tables, ...EVERYTHING.columns], {
      ...KINDS, views: [], routines: ["schema_inventory"],
    }));
    const f = out.find((x) => x.file === "stock-ledger.sql")!;
    expect(f.applied).toBe(false);
    expect(f.missing).toEqual(["stock_reconciliation", "sync_order_stock()"]);
  });

  it("catches a harden-rls.sql that was never run", () => {
    // Inverted: the file is done when the policies are GONE. Here they are
    // still there, which is an anon key that can insert orders and upload
    // files straight past every check the app makes.
    const out = checkSchema(snap([...EVERYTHING.tables, ...EVERYTHING.columns], {
      ...KINDS,
      policies: [
        ["public.products", "products_public_read"],
        ["public.orders", "orders_public_insert"],
        ["storage.objects", "product images public upload"],
        ["storage.objects", "payment proofs public upload"],
      ],
    }));
    const f = out.find((x) => x.file === "harden-rls.sql")!;
    expect(f.applied).toBe(false);
    expect(f.missing).toEqual([]);
    expect(f.lingering).toEqual([
      "public.orders: orders_public_insert",
      "storage.objects: product images public upload",
      "storage.objects: payment proofs public upload",
    ]);
  });

  it("catches a patch-audit-hardening.sql that was never run", () => {
    const out = checkSchema(snap([...EVERYTHING.tables, ...EVERYTHING.columns], {
      ...KINDS, indexes: [],
    }));
    const f = out.find((x) => x.file === "patch-audit-hardening.sql")!;
    expect(f.applied).toBe(false);
    expect(f.missing).toEqual(["idx_products_live", "idx_sellers_status"]);
  });

  it("is not fooled by a policy of the same name on another table", () => {
    const out = checkSchema(snap([...EVERYTHING.tables, ...EVERYTHING.columns], {
      ...KINDS,
      policies: [["public.some_other_table", "orders_public_insert"]],
    }));
    expect(out.find((x) => x.file === "harden-rls.sql")!.applied).toBe(true);
  });
});

describe("an old schema_inventory() that can only see tables", () => {
  /** What the pre-kinds function returns: table and column names only. */
  const oldShape = snapshotFromRows(
    [...EVERYTHING.columns].map((n) => ({
      table_name: n.split(".")[0], column_name: n.split(".")[1],
    })).concat([...EVERYTHING.tables].map((t) => ({ table_name: t, column_name: "id" })))
  );

  it("reads that shape without inventing kinds", () => {
    expect(oldShape.seesKinds).toBe(false);
    expect(oldShape.tables.has("products")).toBe(true);
    expect(oldShape.views.size).toBe(0);
  });

  it("says NOT CHECKED, not NOT RUN, for the files it cannot see", () => {
    // The distinction is the whole point. An empty set of views means the
    // database was never asked, and reading that as an absence sends the
    // owner off to re-run files that are already in place -- while quietly
    // implying the panel checked them.
    const out = checkSchema(oldShape);
    const unchecked = uncheckedFiles(out);
    expect(unchecked).toEqual([
      "stock-ledger.sql", "harden-rls.sql", "patch-audit-hardening.sql",
    ]);
    for (const f of out.filter((x) => x.unknown)) {
      expect([f.file, f.applied]).toEqual([f.file, false]);
      expect([f.file, f.missing]).toEqual([f.file, []]);
    }
    // And they are NOT in the run-these list, because nothing checked them.
    expect(outstandingFiles(out)).toEqual([INVENTORY_FILE]);
  });

  it("names the file that fixes it, and only ever that one", () => {
    const out = checkSchema(oldShape);
    const inv = out.find((f) => f.file === INVENTORY_FILE)!;
    expect(inv.applied).toBe(false);
    expect(inv.unknown).toBe(false);
    expect(inv.missing).toEqual(["schema_inventory() reports tables only"]);
    // Everything the old function CAN see is still reported normally.
    expect(out.find((f) => f.file === "schema.sql")!.applied).toBe(true);
    expect(out.find((f) => f.file === "audience-restock.sql")!.applied).toBe(true);
  });

  it("never calls a file applied and unchecked at once", () => {
    for (const f of checkSchema(oldShape)) {
      expect([f.file, f.applied && f.unknown]).toEqual([f.file, false]);
    }
  });
});

describe("the feature list matches the folder", () => {
  const dir = path.join(__dirname, "..", "supabase");

  it("names only files that exist", () => {
    const missing = SCHEMA_FEATURES
      .map((f) => f.file)
      .filter((f) => !fs.existsSync(path.join(dir, f)));
    expect(missing).toEqual([]);
  });

  /* THE TEST THAT WAS NOT HERE.
   *
   * The one above asks whether every entry has a file. Nothing asked
   * whether every file has an entry, and that is the gap the bug lived in:
   * stock-ledger.sql, harden-rls.sql and patch-audit-hardening.sql were
   * simply not on the list. A file that is not on the list is not shown as
   * unchecked -- it is not shown at all -- so with every listed file present
   * the panel reported "Every SQL file has been run", never having looked at
   * the two that close the anon key's direct write access.
   *
   * Adding a file to supabase/ now fails this until it is either checked or
   * explicitly named as something other than schema. */
  it("names every file in the folder", () => {
    const onDisk = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const accounted = new Set([
      ...SCHEMA_FEATURES.map((f) => f.file),
      ...NOT_SCHEMA_FILES,
    ]);
    expect(onDisk.filter((f) => !accounted.has(f))).toEqual([]);
  });

  it("exempts only files that exist, so the exemption cannot rot", () => {
    for (const f of NOT_SCHEMA_FILES) {
      expect([f, fs.existsSync(path.join(dir, f))]).toEqual([f, true]);
    }
  });

  it("checks something for every entry", () => {
    for (const f of SCHEMA_FEATURES) {
      const n = (f.tables?.length ?? 0) + (f.columns?.length ?? 0)
        + (f.views?.length ?? 0) + (f.routines?.length ?? 0)
        + (f.indexes?.length ?? 0) + (f.droppedPolicies?.length ?? 0);
      expect([f.file, n > 0]).toEqual([f.file, true]);
    }
  });

  it("lists no file twice", () => {
    const files = SCHEMA_FEATURES.map((f) => f.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it("looks for objects the named file actually creates", () => {
    // Guards against the mistake made while writing this: stock-ledger.sql
    // was first identified by apply_stock_movement(), which stock-receipt.sql
    // and audience-restock.sql each create their own version of. A shop that
    // had never run stock-ledger.sql would have been told it had.
    const sql = new Map(
      fs.readdirSync(dir).filter((f) => f.endsWith(".sql"))
        .map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8").toLowerCase()])
    );
    for (const f of SCHEMA_FEATURES) {
      for (const name of [...(f.views ?? []), ...(f.routines ?? [])]) {
        const creators = [...sql.entries()]
          .filter(([, body]) => new RegExp(
            `create\\s+(or\\s+replace\\s+)?(view|function|procedure)\\s+${name}\\b`
          ).test(body))
          .map(([file]) => file);
        expect([f.file, name, creators]).toEqual([f.file, name, [f.file]]);
      }
    }
  });
});
