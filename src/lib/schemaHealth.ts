/* Which of the SQL files in supabase/ have actually been run.
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
 *
 * AND WHY IT LOOKS PAST TABLES.
 *
 * It used to check tables and columns only, because that is all the
 * inventory function could see. Three files in supabase/ create neither, so
 * they were not in this list at all -- and a file that is not in the list is
 * not reported as unchecked, it is simply absent. With every listed file
 * present the screen said "Every SQL file has been run", having never looked
 * at stock-ledger.sql (the rule that products.qty only moves through
 * stock_movements), harden-rls.sql (which closes the anon key's direct write
 * access to orders and storage) or patch-audit-hardening.sql.
 *
 * A panel that overstates what it checked is worse than no panel: the owner
 * acts on it. So the inventory now reports views, functions, policies and
 * indexes too, every file in the folder is listed, and the one thing this
 * cannot answer -- an old inventory function that still only sees tables --
 * is reported as NOT CHECKED rather than guessed at either way.
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
  /** Views that must exist. */
  views?: readonly string[];
  /** Functions and procedures that must exist, by name. */
  routines?: readonly string[];
  /** Indexes that must exist, as [schema-qualified table, index]. */
  indexes?: readonly (readonly [string, string])[];
  /** Policies the file REMOVES, as [schema-qualified table, policy]. The
   * file has been run when these are gone -- the only check here that is
   * satisfied by an absence, and the reason harden-rls.sql could not be
   * expressed at all before. */
  droppedPolicies?: readonly (readonly [string, string])[];
  /** True for the ones the shop cannot open without. */
  core?: boolean;
}

/** How a policy or index is keyed in a snapshot: the schema-qualified table,
 * "::", then the name. Policy names contain spaces ("product images public
 * upload") but never "::". */
export function memberKey(object: string, member: string): string {
  return `${object}::${member}`.toLowerCase();
}

/** The file that installs the inventory function this whole module reads.
 *
 * It is checked differently from the rest: every other entry asks the
 * snapshot what exists, and this one asks whether the snapshot can answer
 * that question at all. */
export const INVENTORY_FILE = "schema-health.sql";

/* Ordered as they should be run: the base schema first, then the rest.
 * Only what each file UNIQUELY provides is listed -- enough to tell it
 * apart, not an inventory. */
export const SCHEMA_FEATURES: readonly FeatureCheck[] = [
  {
    // First, because until it is run nothing below can be checked.
    file: INVENTORY_FILE, labelKey: "featSchemaHealth", core: true,
    routines: ["schema_inventory"],
  },
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
    file: "seller-features.sql", labelKey: "featSellerFeatures",
    columns: [["sellers", "features"]],
  },
  {
    file: "audience-restock.sql", labelKey: "featAudienceRestock",
    columns: [
      ["products", "audience"],
      ["products", "restock_level"],
      ["settings", "restock_alert_pct"],
    ],
  },
  {
    // Creates no table and no column, which is how it stayed off this list.
    // It is the half of the stock rule the database enforces: nothing but a
    // movement adds to the balance, and stock_reconciliation reports it when
    // something else does. Without it the ledger is a convention.
    file: "stock-ledger.sql", labelKey: "featStockLedger",
    //
    // NOT apply_stock_movement(): stock-receipt.sql and audience-restock.sql
    // each create their own version of it, so its presence says nothing
    // about this file. Only what a file UNIQUELY provides can identify it.
    views: ["stock_reconciliation"],
    routines: ["sync_order_stock"],
  },
  {
    // Also creates nothing -- it DROPS. Until it is run, anyone with the
    // public anon key (it is in every browser's network tab) can insert
    // orders and upload files straight past the app's checks.
    file: "harden-rls.sql", labelKey: "featHardenRls",
    droppedPolicies: [
      ["public.orders", "orders_public_insert"],
      ["storage.objects", "product images public upload"],
      ["storage.objects", "payment proofs public upload"],
    ],
  },
  {
    // Indexes. Named by two that no other file creates -- the partial index
    // behind the catalog query, and the seller status lookup.
    file: "patch-audit-hardening.sql", labelKey: "featAuditHardening",
    indexes: [
      ["public.products", "idx_products_live"],
      ["public.sellers", "idx_sellers_status"],
    ],
  },
];

/** In supabase/ and deliberately not above: demo content, not schema. Named
 * here so the test that compares this list against the folder has something
 * to check the exemption against, rather than the list simply being short. */
export const NOT_SCHEMA_FILES: readonly string[] = ["seed.sql"];

export interface FeatureStatus extends FeatureCheck {
  applied: boolean;
  /** True when the answer is not known -- see `checkSchema`. Never true at
   * the same time as `applied`: "I cannot tell" and "all good" are the two
   * answers that must never look alike here. */
  unknown: boolean;
  /** What was looked for and not found, named the way the SQL names it. */
  missing: string[];
  /** What should have been REMOVED and is still there. Only harden-rls.sql
   * ever fills this. */
  lingering: string[];
}

/** What the database actually has. Every set holds lower-cased names. */
export interface SchemaSnapshot {
  tables: ReadonlySet<string>;
  /** "table.column" */
  columns: ReadonlySet<string>;
  views: ReadonlySet<string>;
  /** Function and procedure names. */
  routines: ReadonlySet<string>;
  /** memberKey(qualified table, policy name) */
  policies: ReadonlySet<string>;
  /** memberKey(qualified table, index name) */
  indexes: ReadonlySet<string>;
  /** False when the database still has the older schema_inventory(), which
   * reported tables and columns and nothing else. Then the four sets above
   * are empty because the database was never asked, NOT because the objects
   * are absent -- and reading an empty set as an absence is how a panel ends
   * up telling an owner to re-run files that are already in place. */
  seesKinds: boolean;
}

/** Compares the features against a snapshot. Pure, so the interesting part
 * -- deciding what counts as applied -- is testable without a database. */
export function checkSchema(snapshot: SchemaSnapshot): FeatureStatus[] {
  return SCHEMA_FEATURES.map((f): FeatureStatus => {
    // The inventory file is the one entry that cannot be checked by asking
    // the inventory what exists, because it IS the inventory. What decides
    // it is whether the installed function can report kinds at all.
    if (f.file === INVENTORY_FILE) {
      return snapshot.seesKinds
        ? { ...f, applied: true, unknown: false, missing: [], lingering: [] }
        : { ...f, applied: false, unknown: false, lingering: [],
            missing: ["schema_inventory() reports tables only"] };
    }

    // Everything an old inventory function cannot see. Reported as not
    // checked -- not as missing, which would send the owner off to re-run
    // files that may well be fine.
    const looksPastTables = !!(f.views || f.routines || f.indexes || f.droppedPolicies);
    if (looksPastTables && !snapshot.seesKinds) {
      return { ...f, applied: false, unknown: true, missing: [], lingering: [] };
    }

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
    for (const v of f.views ?? []) {
      if (!snapshot.views.has(v.toLowerCase())) missing.push(v);
    }
    for (const r of f.routines ?? []) {
      if (!snapshot.routines.has(r.toLowerCase())) missing.push(`${r}()`);
    }
    for (const [tbl, ix] of f.indexes ?? []) {
      if (!snapshot.indexes.has(memberKey(tbl, ix))) missing.push(ix);
    }

    // The inverted one: still there means still to do.
    const lingering: string[] = [];
    for (const [tbl, pol] of f.droppedPolicies ?? []) {
      if (snapshot.policies.has(memberKey(tbl, pol))) lingering.push(`${tbl}: ${pol}`);
    }

    return {
      ...f,
      applied: missing.length === 0 && lingering.length === 0,
      unknown: false,
      missing,
      lingering,
    };
  });
}

/** The files still to run, in the order they should be run. Files whose
 * state could not be determined are not in it -- "run this" is a claim, and
 * this module does not make claims it did not check. */
export function outstandingFiles(statuses: readonly FeatureStatus[]): string[] {
  return statuses.filter((s) => !s.applied && !s.unknown).map((s) => s.file);
}

/** Files the panel could not check. Non-empty only while an old
 * schema_inventory() is installed. */
export function uncheckedFiles(statuses: readonly FeatureStatus[]): string[] {
  return statuses.filter((s) => s.unknown).map((s) => s.file);
}

/* Folding the inventory's rows into a snapshot.
 *
 * TWO SHAPES. schema_inventory() used to return (table_name, column_name)
 * and could therefore see nothing but tables. It now returns (kind,
 * object_name, member_name) and covers views, functions, policies and
 * indexes as well.
 *
 * A shop upgraded from the older one keeps the older function until its
 * owner re-runs the file, so both shapes are read here. */
/** One row from schema_inventory(), in either of its two shapes. */
export type SchemaRow = Record<string, string | null>;

/** Rows from either version of the function, folded into one snapshot. */
export function snapshotFromRows(rows: readonly SchemaRow[]): SchemaSnapshot {
  const tables = new Set<string>();
  const columns = new Set<string>();
  const views = new Set<string>();
  const routines = new Set<string>();
  const policies = new Set<string>();
  const indexes = new Set<string>();

  // The presence of the column, not of a particular value: a database with
  // the new function but (impossibly) no policies at all must still count as
  // kind-aware, or it would be told to re-run a file it has already run.
  const seesKinds = rows.length > 0 && "kind" in rows[0];

  for (const r of rows) {
    if (!seesKinds) {
      const t = String(r.table_name ?? "").toLowerCase();
      const c = String(r.column_name ?? "").toLowerCase();
      if (!t) continue;
      tables.add(t);
      if (c) columns.add(`${t}.${c}`);
      continue;
    }
    const name = String(r.object_name ?? "").toLowerCase();
    const member = String(r.member_name ?? "").toLowerCase();
    if (!name) continue;
    switch (r.kind) {
      case "table":
        tables.add(name);
        if (member) columns.add(`${name}.${member}`);
        break;
      case "view": views.add(name); break;
      case "routine": routines.add(name); break;
      case "policy": policies.add(memberKey(name, member)); break;
      case "index": indexes.add(memberKey(name, member)); break;
    }
  }

  return { tables, columns, views, routines, policies, indexes, seesKinds };
}
