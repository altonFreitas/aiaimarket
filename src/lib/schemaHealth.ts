/* Which of the nineteen SQL files in supabase/ have actually been run.
 *
 * WHY THIS PROBES THE DATABASE RATHER THAN KEEPING A LIST.
 *
 * The usual answer is a schema_migrations table that each file writes a row
 * into. It is the standard pattern and it has one flaw that matters here:
 * it records what somebody RAN, not what is actually there. A file run
 * against the wrong project, a row inserted by a half-failed script, a
 * table dropped by hand afterwards -- in every one of those the list says
 * yes and the database says no, and the list is believed.
 *
 * So this asks the database instead. Each entry names the tables and
 * columns its file creates; if they are present the feature is live, and if
 * they are not it is not, whatever any record claims. It cannot drift,
 * because there is nothing to drift from.
 *
 * The reason it exists at all: this shop has twice been broken by exactly
 * this gap. Staff could not log in because admin-roles.sql had not been
 * run, and no product could be saved because audience-restock.sql had not.
 * Both times the code was fine, the database was fine, and nothing on any
 * screen connected the two.
 */

export interface FeatureCheck {
  /** The SQL file to run, which is the only thing the owner has to act on. */
  file: string;
  /** i18n key naming what this file gives them. */
  labelKey: string;
  /** Tables that must exist. */
  tables?: readonly string[];
  /** Columns that must exist, as [table, column]. */
  columns?: readonly (readonly [string, string])[];
  /** True for the ones the shop cannot open without. */
  core?: boolean;
}

/* Ordered as they should be run: the base schema first, then the rest.
 * Only what each file UNIQUELY provides is listed -- enough to tell it
 * apart, not an inventory. */
export const SCHEMA_FEATURES: readonly FeatureCheck[] = [
  {
    file: "schema.sql", labelKey: "featCore", core: true,
    tables: ["products", "orders", "settings", "categories", "sellers", "customers"],
  },
  {
    file: "marketplace-v2.sql", labelKey: "featMarketplace",
    tables: ["product_reviews", "seller_payouts"],
    columns: [["products", "search_vector"], ["products", "rating_count"]],
  },
  {
    file: "notifications.sql", labelKey: "featNotifications",
    tables: ["notifications"], columns: [["orders", "lang"]],
  },
  {
    file: "payments.sql", labelKey: "featPayments",
    tables: ["payments", "payment_events"],
  },
  {
    file: "procurement.sql", labelKey: "featProcurement",
    tables: ["suppliers", "purchase_orders", "purchase_order_items"],
  },
  {
    file: "po-product-details.sql", labelKey: "featPoDetails",
    columns: [["purchase_order_items", "sizes"], ["purchase_order_items", "description"]],
  },
  {
    file: "stock-receipt.sql", labelKey: "featStockReceipt",
    tables: ["stock_movements"],
  },
  {
    file: "sales.sql", labelKey: "featSales",
    tables: ["product_costs", "sales_targets"],
  },
  {
    file: "returns.sql", labelKey: "featReturns",
    tables: ["order_returns", "order_return_items"],
  },
  {
    file: "promotions.sql", labelKey: "featPromotions",
    tables: ["promotions"],
  },
  {
    file: "preorders.sql", labelKey: "featPreorders",
    columns: [["products", "preorder_enabled"], ["orders", "is_preorder"]],
  },
  {
    file: "reorder-policy.sql", labelKey: "featReorderPolicy",
    columns: [["settings", "reorder_window_days"]],
  },
  {
    file: "admin-users.sql", labelKey: "featAdminUsers",
    tables: ["admin_users", "audit_log"],
  },
  {
    file: "admin-roles.sql", labelKey: "featAdminRoles",
    columns: [["admin_users", "role"], ["admin_users", "sections"]],
  },
  {
    file: "audience-restock.sql", labelKey: "featAudienceRestock",
    columns: [
      ["products", "audience"],
      ["products", "restock_level"],
      ["settings", "restock_alert_pct"],
    ],
  },
];

export interface FeatureStatus extends FeatureCheck {
  applied: boolean;
  /** What was looked for and not found, named the way the SQL names it. */
  missing: string[];
}

/** What the database actually has. Both sets are lower-cased names. */
export interface SchemaSnapshot {
  tables: ReadonlySet<string>;
  /** "table.column" */
  columns: ReadonlySet<string>;
}

/** Compares the features against a snapshot. Pure, so the interesting part
 * -- deciding what counts as applied -- is testable without a database. */
export function checkSchema(snapshot: SchemaSnapshot): FeatureStatus[] {
  return SCHEMA_FEATURES.map((f) => {
    const missing: string[] = [];
    for (const t of f.tables ?? []) {
      if (!snapshot.tables.has(t.toLowerCase())) missing.push(t);
    }
    for (const [t, c] of f.columns ?? []) {
      // A column in a table that is not there is reported as the table, not
      // as the column: "orders.lang is missing" is confusing when the real
      // answer is that orders does not exist yet.
      if (!snapshot.tables.has(t.toLowerCase())) {
        if (!missing.includes(t)) missing.push(t);
      } else if (!snapshot.columns.has(`${t}.${c}`.toLowerCase())) {
        missing.push(`${t}.${c}`);
      }
    }
    return { ...f, applied: missing.length === 0, missing };
  });
}

/** The files still to run, in the order they should be run. */
export function outstandingFiles(statuses: readonly FeatureStatus[]): string[] {
  return statuses.filter((s) => !s.applied).map((s) => s.file);
}
