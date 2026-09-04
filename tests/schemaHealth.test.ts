import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  SCHEMA_FEATURES, checkSchema, outstandingFiles, type SchemaSnapshot,
} from "@/lib/schemaHealth";

/** A snapshot from a plain list of "table" and "table.column". */
function snap(names: string[]): SchemaSnapshot {
  const tables = new Set<string>();
  const columns = new Set<string>();
  for (const n of names) {
    if (n.includes(".")) { columns.add(n); tables.add(n.split(".")[0]); }
    else tables.add(n);
  }
  return { tables, columns };
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
    const out = checkSchema(snap([]));
    expect(out.every((f) => !f.applied)).toBe(true);
    expect(outstandingFiles(out)).toHaveLength(SCHEMA_FEATURES.length);
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
    const out = checkSchema({
      tables: new Set(["products", "orders", "settings", "categories", "sellers", "customers"]),
      columns: new Set<string>(),
    });
    expect(out.find((f) => f.file === "schema.sql")!.applied).toBe(true);
  });

  it("keeps them in the order they should be run", () => {
    const files = SCHEMA_FEATURES.map((f) => f.file);
    expect(files[0]).toBe("schema.sql");
    expect(files.indexOf("admin-roles.sql")).toBeGreaterThan(files.indexOf("admin-users.sql"));
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

  it("checks something for every entry", () => {
    for (const f of SCHEMA_FEATURES) {
      const n = (f.tables?.length ?? 0) + (f.columns?.length ?? 0);
      expect([f.file, n > 0]).toEqual([f.file, true]);
    }
  });

  it("lists no file twice", () => {
    const files = SCHEMA_FEATURES.map((f) => f.file);
    expect(new Set(files).size).toBe(files.length);
  });
});
