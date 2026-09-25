import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  SCHEMA_FEATURES, SCHEMA_ORDER, NOT_SCHEMA_FILES, INVENTORY_FILE,
  checkSchema, memberKey, outstandingFiles, uncheckedFiles, snapshotFromRows,
  INTENDED_REPLACEMENTS,
  type SchemaSnapshot,
} from "@/lib/schemaHealth";

/** Everything a fully migrated database has beyond its tables. */
const KINDS = {
  views: ["stock_reconciliation", "stock_reservations", "product_size_stock", "product_variant_stock"],
  routines: [
    "schema_inventory", "sync_order_stock", "increment_loves", "decrement_loves",
    "hit_rate_limit", "redact_old_order_pii",
    "reserve_order_stock", "release_stale_reservations",
    "seller_earnings", "sync_order_items", "is_expense_account",
    "apply_supplier_return_stock", "size_available",
    // taxonomy.sql -- the two guards that stop a form posting a real id
    // belonging to something else.
    "attribute_belongs_to_type", "type_belongs_to_category",
    // variants.sql
    "variant_available",
    // attribute-filters.sql
    "products_with_attribute",
  ],
  indexes: [
    ["public.products", "idx_products_live"],
    ["public.sellers", "idx_sellers_status"],
    ["public.order_returns", "order_returns_unsettled_idx"],
    ["public.customer_alerts", "customer_alerts_once"],
  ] as [string, string][],
  /* harden-rls.sql has been run, so the three open-door policies are gone.
   * One unrelated policy is left in place to prove the check looks for the
   * named ones rather than for an empty set. */
  policies: [["public.products", "products_public_read"]] as [string, string][],
  /* The wide one, so admin-subsections.sql reads as applied. An unrelated
   * constraint sits beside it for the same reason as the policy above. */
  constraints: [
    ["public.admin_users", "admin_users_section_keys_check"],
    ["public.sellers", "sellers_area_keys_check"],
    ["public.orders", "orders_status_check"],
    ["public.orders", "orders_discount_check"],
    ["public.settings", "settings_tax_rate_range_check"],
  ] as [string, string][],
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
    constraints: new Set((kinds.constraints ?? []).map(([t, c]) => memberKey(t, c))),
    seesKinds: true,
    // Matches snapshotFromRows: constraints reported at all is what says
    // the installed inventory function is new enough to report them.
    seesConstraints: (kinds.constraints ?? []).length > 0,
  };
}

const EVERYTHING = snap([
  "products", "orders", "settings", "categories", "sellers", "customers",
  "product_reviews", "seller_payouts", "products.search_vector", "products.rating_count",
  "notifications", "customer_alerts", "orders.lang",
  "payments", "payment_events",
  "suppliers", "purchase_orders", "purchase_order_items",
  "purchase_order_items.sizes", "purchase_order_items.description",
  "stock_movements", "order_items",
  "product_costs", "sales_targets",
  "order_returns", "order_return_items",
  "return_requests", "return_request_items",
  "supplier_returns", "supplier_return_items",
  "purchase_order_items.size_qty",
  "operating_expenses", "recurring_expenses",
  "promotions",
  "hero_slides.video_url",
  "products.loves",
  "seller_invites",
  "rate_limits",
  "orders.idempotency_key",
  "suppliers.seller_id", "purchase_orders.seller_id",
  "products.preorder_enabled", "orders.is_preorder",
  "settings.reorder_window_days",
  "admin_users", "audit_log", "admin_users.role", "admin_users.sections",
  "sellers.features",
  "sellers.address_public",
  /* NOT products.audience. This is the end state of running every file in
     order, and the last one to touch that column DROPS it -- see
     supabase/drop-audience.sql. A fixture that still carried it would be
     describing a database that cannot exist. */
  "products.restock_level", "settings.restock_alert_pct",
  "products.updated_at",
  "settings.totp_last_counter",
  "orders.proof_path",
  // legal-currency-tax.sql
  "settings.legal_address", "settings.display_currency", "settings.tax_rate",
  "orders.tax", "orders.currency", "order_items.tax",
  // order-discount.sql
  "orders.discount",
  // taxonomy.sql -- the dynamic attribute model.
  "product_types", "attributes", "attribute_options", "product_type_attributes",
  "products.product_type_id",
  // product-attributes.sql -- what each product answers.
  "product_attribute_values",
  // variants.sql -- a product that varies more than one way.
  "product_variants", "variant_attribute_values",
  "stock_movements.variant_id", "order_items.variant_id",
  // variant-purchasing.sql -- buying and receiving by variant.
  "purchase_order_items.variant_qty",
  "purchase_order_items.product_type_id", "purchase_order_items.attribute_values",
  "settings.stale_days",
  // product-highlights.sql -- the ticked selling points.
  "products.highlights",
  // site-chrome.sql -- the face and the strip the shop can choose.
  "settings.heading_font", "settings.incentives_off",
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
    /* drop-audience.sql joins them, and for exactly the same reason: it
       only REMOVES, and on an empty database the columns it takes away are
       not there to take. */
    const done = new Set(["harden-rls.sql", "drop-audience.sql", INVENTORY_FILE]);
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
      .filter((n) => !n.startsWith("products.restock_level")
                  && !n.startsWith("settings.restock_alert_pct"));
    const out = checkSchema(snap(names));
    const f = out.find((x) => x.file === "audience-restock.sql")!;
    expect(f.applied).toBe(false);
    expect(f.missing).toEqual([
      "products.restock_level", "settings.restock_alert_pct",
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
    // The view alone. sync_order_stock() used to be probed here too and no
    // longer is: stock-reservation.sql keeps a wrapper of that name, so its
    // presence stopped saying anything about this file.
    expect(f.missing).toEqual(["stock_reconciliation"]);
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
      "loves.sql", "refund-settlement.sql", "rate-limits.sql",
      // Checked by a constraint alone, which the old function cannot report.
      "admin-subsections.sql",
      "seller-areas.sql",
      // A column AND a constraint, neither of which an old inventory
      // function reports.
      "order-discount.sql",
      // A table AND an index; the old function reports neither kind.
      "customer-alerts.sql",
      "pii-retention.sql",
      "operating-costs.sql", "supplier-returns.sql", "size-stock.sql",
      "order-items.sql", "stock-reservation.sql",
      "stock-ledger.sql",
      // Tables AND two guard functions; the old function reports the
      // tables but not the functions, so it cannot say this one is done.
      "taxonomy.sql",
      // Tables, a view and a function; the old inventory reports only the
      // tables, so it cannot say this one is done either.
      "variants.sql",
      // A function alone, which an old inventory cannot report at all.
      "attribute-filters.sql",
      // A renamed check constraint alone -- the file widens two columns
      // and an inventory reports neither a precision nor a constraint.
      "tax-precision.sql",
      "harden-rls.sql", "patch-audit-hardening.sql",
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

  /* THE KIND ADDED LAST, AND WHY IT NEEDED ADDING.
   *
   * admin-subsections.sql creates no table, no column and no function. Its
   * whole effect is to widen one check constraint, which made it the fourth
   * file this panel could not see -- the exact failure schema-health.sql was
   * written to stop, one kind later. */
  describe("a file checked by a check constraint alone", () => {
    const entry = SCHEMA_FEATURES.find((f) => f.file === "admin-subsections.sql")!;

    it("is checked by the name the file adds, not the one it drops", () => {
      // Both live on admin_users. Probing for the dropped name would report
      // the file applied on every shop that had NOT run it, which is the
      // panel lying in the most convincing direction.
      expect(entry.constraints).toEqual([
        ["public.admin_users", "admin_users_section_keys_check"],
      ]);
    });

    it("reads as applied when the wide constraint is there", () => {
      const out = checkSchema(EVERYTHING);
      const f = out.find((x) => x.file === "admin-subsections.sql")!;
      expect([f.applied, f.unknown]).toEqual([true, false]);
    });

    it("reads as outstanding when only the narrow one is", () => {
      // A shop on the previous release: admin-roles.sql run, this one not.
      const out = checkSchema(snap([...EVERYTHING.tables, ...EVERYTHING.columns], {
        ...KINDS,
        constraints: [["public.admin_users", "admin_users_sections_check"]],
      }));
      const f = out.find((x) => x.file === "admin-subsections.sql")!;
      expect([f.applied, f.unknown]).toEqual([false, false]);
      expect(f.missing).toEqual(["admin_users_section_keys_check"]);
      expect(outstandingFiles(out)).toContain("admin-subsections.sql");
    });

    it("says NOT CHECKED when the inventory cannot report constraints", () => {
      // Kind-aware, but installed before constraints were added to it. The
      // table is there, so the file may well have been run -- and "run this
      // again" would be a claim this module did not check.
      const out = checkSchema(snap([...EVERYTHING.tables, ...EVERYTHING.columns], {
        ...KINDS, constraints: [],
      }));
      const f = out.find((x) => x.file === "admin-subsections.sql")!;
      expect([f.applied, f.unknown]).toEqual([false, true]);
      expect(uncheckedFiles(out)).toContain("admin-subsections.sql");
    });

    it("still says NOT RUN when admin_users does not exist", () => {
      // The one case where no constraints is an honest answer rather than a
      // question never asked. A database without the table has not run the
      // file, and no inventory version is needed to know that.
      const out = checkSchema(snap([], { ...KINDS, constraints: [] }));
      const f = out.find((x) => x.file === "admin-subsections.sql")!;
      expect([f.applied, f.unknown]).toEqual([false, false]);
      expect(f.missing).toEqual(["admin_users"]);
    });
  });

  it("checks something for every entry", () => {
    for (const f of SCHEMA_FEATURES) {
      const n = (f.tables?.length ?? 0) + (f.columns?.length ?? 0)
        + (f.views?.length ?? 0) + (f.routines?.length ?? 0)
        + (f.indexes?.length ?? 0) + (f.droppedPolicies?.length ?? 0)
        + (f.droppedColumns?.length ?? 0)
        + (f.constraints?.length ?? 0);
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
      // run-all.sql is every other file pasted together, so it "creates"
      // all of them and would be named as a second creator of everything.
      fs.readdirSync(dir).filter((f) => f.endsWith(".sql") && f !== "run-all.sql")
        .map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8").toLowerCase()])
    );
    for (const f of SCHEMA_FEATURES) {
      for (const name of [...(f.views ?? []), ...(f.routines ?? [])]) {
        const creators = creatorsOf(sql, name);
        // The probing file must be among them, and must be the LAST of them
        // to run -- otherwise a later file's version is what the database
        // actually ends up with and the probe is describing something else.
        expect([f.file, name, creators.includes(f.file)])
          .toEqual([f.file, name, true]);
        expect([f.file, name, lastToRun(creators)])
          .toEqual([f.file, name, f.file]);
      }
    }
  });
});

/** Which files create this view or function. */
function creatorsOf(sql: Map<string, string>, name: string): string[] {
  return [...sql.entries()]
    .filter(([, body]) => new RegExp(
      `create\\s+(or\\s+replace\\s+)?(view|function|procedure)\\s+${name}\\b`
    ).test(body))
    .map(([file]) => file);
}

/** Of these files, the one SCHEMA_ORDER runs last -- which is the one whose
 * definition the database is left holding. */
function lastToRun(files: string[]): string | undefined {
  return [...files].sort(
    (a, b) => SCHEMA_ORDER.indexOf(a) - SCHEMA_ORDER.indexOf(b)
  ).pop();
}

/* ---------------------------------------------------------------------------
 * The check that would have caught it
 * ------------------------------------------------------------------------ */

/** Functions two files both define, where the later one MEANS to replace the
 * earlier -- listed here so that doing it by accident cannot pass.
 *
 * Every entry is a deliberate upgrade: a later file teaching an existing
 * function something the earlier one could not know about.
 *
 * THIS LIST EXISTS BECAUSE ONE WAS MISSING FROM IT. patch-audit-hardening
 * .sql -- the last file to run -- re-created decrement_stock_on_confirm()
 * with the pre-ledger version that writes products.qty directly. So on every
 * database built from run-all.sql: confirming an order moved stock with no
 * movement behind it, stock_reconciliation drifted by the size of the order,
 * no reservation was ever written, and the whole of stock-reservation.sql
 * was inert. Nothing failed. Nothing said anything. */

describe("no file quietly overwrites another's function", () => {
  it("has every double definition declared, and running last where it should", () => {
    const dir = path.join(process.cwd(), "supabase");
    const sql = new Map(
      fs.readdirSync(dir).filter((f) => f.endsWith(".sql") && f !== "run-all.sql")
        .map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8").toLowerCase()])
    );

    // Every function or view defined anywhere in the folder.
    const names = new Set<string>();
    for (const body of sql.values()) {
      for (const m of body.matchAll(
        /create\s+(?:or\s+replace\s+)?(?:view|function|procedure)\s+([a-z0-9_]+)/g
      )) names.add(m[1]);
    }

    for (const name of [...names].sort()) {
      const creators = creatorsOf(sql, name);
      if (creators.length < 2) continue;

      const declared = INTENDED_REPLACEMENTS[name];
      // An undeclared double definition is the bug this test is named for.
      expect([name, declared ? "declared" : "UNDECLARED"])
        .toEqual([name, "declared"]);

      // And the declaration has to match what is actually in the folder,
      // or it stops describing anything.
      expect([name, [...creators].sort()]).toEqual([name, [...declared!].sort()]);

      // The LAST file to run must be the last one named -- that is the
      // definition the database keeps, and the one the author intended.
      expect([name, lastToRun(creators)])
        .toEqual([name, declared![declared!.length - 1]]);
    }
  });

  it("keeps every column an earlier definition wrote", () => {
    /* DECLARING A REPLACEMENT IS NOT THE SAME AS CHECKING IT.
     *
     * The test above asks whether a second definition was INTENDED. It said
     * yes for apply_stock_movement, which was true -- audience-restock.sql
     * genuinely means to replace stock-ledger.sql's copy, to add the
     * restock_level high-water mark. Its own comment says it is "the same
     * function with one added line".
     *
     * It was not. It had also dropped the stock_status assignment, which
     * nothing else in the schema writes. That file runs last, so on every
     * database built from run-all.sql the column froze: a shop received
     * twenty-one shirts and its catalog, product page and stock screen all
     * went on saying OUT OF STOCK. Nothing failed. The paperwork was in
     * order and the function had quietly stopped doing half its job.
     *
     * So the declaration no longer exempts it. A replacement may add
     * columns, and may not lose one: an UPDATE that set a column before and
     * does not now has to be deliberate enough to come and edit this test.
     *
     * Crude -- it reads `set` clauses out of the text -- and it is exactly
     * the crudeness that catches a line going missing from a copy. */
    const dir = path.join(process.cwd(), "supabase");
    const read = (f: string) =>
      fs.readFileSync(path.join(dir, f), "utf8").toLowerCase();

    /** The columns a function's body assigns, from `set x = ...` and the
     * `, y = ...` continuations that follow it.
     *
     * Comments are stripped FIRST. An explanatory line sitting between the
     * comma and the column it introduces -- which is how this codebase
     * writes a multi-column UPDATE -- otherwise hides that column from the
     * scan, and a column this cannot see is a column it cannot miss. */
    const columnsWritten = (body: string): Set<string> => {
      const bare = body.replace(/--[^\n]*/g, " ");
      const out = new Set<string>();
      for (const m of bare.matchAll(/(?:^|\s|,)set\s+([a-z0-9_]+)\s*=/g)) out.add(m[1]);
      for (const m of bare.matchAll(/,\s*([a-z0-9_]+)\s*=\s*(?:case|coalesce|greatest|least|[a-z0-9_.']|\()/g)) {
        out.add(m[1]);
      }
      return out;
    };

    /** One function's body within a file: the text between the $$ that opens
     * it and the $$ that closes it.
     *
     * Delimited on the dollar quotes rather than on "end $$", which is how
     * this was written first and which silently ran past the end of any
     * function closing with `end loop; end; $$` -- swallowing whatever came
     * next in the file and reporting its columns as this one's. */
    const bodyOf = (sql: string, name: string): string | null => {
      const at = sql.search(
        new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${name}\\b`));
      if (at < 0) return null;
      const open = sql.indexOf("$$", at);
      if (open < 0) return null;
      const close = sql.indexOf("$$", open + 2);
      return sql.slice(open + 2, close === -1 ? undefined : close);
    };

    /* Columns a replacement deliberately stops writing, and why.
     *
     * The escape hatch has to exist -- a replacement CAN legitimately hand a
     * column to somebody else -- and it has to cost a sentence, or it is not
     * a guard, it is a switch. Anything not listed here is a line that went
     * missing. */
    const DELIBERATELY_DROPPED: Record<string, readonly string[]> = {
      // THE POINT OF THE LEDGER. schema.sql's version wrote products.qty
      // straight onto the row; stock-reservation.sql's records a movement
      // and lets apply_stock_movement() move the balance, so that qty has
      // exactly one writer and stock_reconciliation can prove it.
      decrement_stock_on_confirm: ["qty", "stock_status"],
    };

    for (const [name, chain] of Object.entries(INTENDED_REPLACEMENTS)) {
      const bodies = chain
        .map((file) => [file, bodyOf(read(file), name)] as const)
        .filter((pair): pair is readonly [string, string] => pair[1] !== null);
      if (bodies.length < 2) continue;

      const last = bodies[bodies.length - 1];
      const kept = columnsWritten(last[1]);

      const allowed = DELIBERATELY_DROPPED[name] ?? [];
      for (const [file, body] of bodies.slice(0, -1)) {
        for (const col of columnsWritten(body)) {
          if (allowed.includes(col)) continue;
          // Named in the failure rather than counted, so the message says
          // which column stopped being written and by which file.
          expect([`${name}: ${file} -> ${last[0]}`, col, kept.has(col)])
            .toEqual([`${name}: ${file} -> ${last[0]}`, col, true]);
        }
      }
    }
  });

  it("keeps every call an earlier definition made", () => {
    /* THE SAME BUG AGAIN, THROUGH THE OTHER DOOR, AND IT WAS ALREADY HERE.
     *
     * The test above watches the columns a replacement writes. It cannot see
     * work a function delegates -- and reserve_order_stock delegates the
     * only thing it is for. stock-reservation.sql's version ends
     *
     *     perform sync_order_stock_state(p_order_id, 'reserved');
     *
     * which is the line that actually HOLDS the units. size-stock.sql
     * replaced that function to add a per-size availability check and
     * dropped it. What was left checks and does not hold: the check passes,
     * nothing is written, the row lock goes at commit, and the next shopper
     * passes the same check against the same unit. Two orders for the last
     * shirt were both accepted, both confirmed, and the shelf went to -1 --
     * proved against a real Postgres, not reasoned about.
     *
     * A replacement may add calls. Losing one has to be deliberate enough to
     * come and say so here. */
    const dir = path.join(process.cwd(), "supabase");
    const read = (f: string) =>
      fs.readFileSync(path.join(dir, f), "utf8").toLowerCase();

    /** Calls to the schema's own functions: `perform f(...)`, `select f(...)`
     * and `f(...)` in a statement. Restricted to names the folder actually
     * defines, so Postgres's own built-ins are not treated as the schema's
     * work. */
    const callsMade = (body: string, known: ReadonlySet<string>): Set<string> => {
      const bare = body.replace(/--[^\n]*/g, " ");
      const out = new Set<string>();
      for (const m of bare.matchAll(/([a-z0-9_]+)\s*\(/g)) {
        if (known.has(m[1])) out.add(m[1]);
      }
      return out;
    };

    const bodyOf = (sql: string, name: string): string | null => {
      const at = sql.search(
        new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${name}\\b`));
      if (at < 0) return null;
      const open = sql.indexOf("$$", at);
      if (open < 0) return null;
      const close = sql.indexOf("$$", open + 2);
      return sql.slice(open + 2, close === -1 ? undefined : close);
    };

    // Every function the folder defines, so a call to one of them is the
    // schema calling itself rather than calling Postgres.
    const known = new Set<string>();
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql") && x !== "run-all.sql")) {
      for (const m of read(f).matchAll(
        /create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_]+)/g
      )) known.add(m[1]);
    }

    /* Calls a replacement deliberately stops making, and why. Same rule as
       the column list: the hatch exists, and it costs a sentence. */
    const DELIBERATELY_DROPPED_CALLS: Record<string, readonly string[]> = {
      // schema.sql's version did the arithmetic inline; the ledger versions
      // delegate to sync_order_stock_state, so the inline helpers it used
      // are gone on purpose.
      decrement_stock_on_confirm: ["sync_order_stock"],
    };

    for (const [name, chain] of Object.entries(INTENDED_REPLACEMENTS)) {
      const bodies = chain
        .map((file) => [file, bodyOf(read(file), name)] as const)
        .filter((pair): pair is readonly [string, string] => pair[1] !== null);
      if (bodies.length < 2) continue;

      const last = bodies[bodies.length - 1];
      const kept = callsMade(last[1], known);
      const allowed = DELIBERATELY_DROPPED_CALLS[name] ?? [];

      for (const [file, body] of bodies.slice(0, -1)) {
        for (const call of callsMade(body, known)) {
          if (call === name) continue;          // recursion, not delegation
          if (allowed.includes(call)) continue;
          expect([`${name}: ${file} -> ${last[0]}`, call, kept.has(call)])
            .toEqual([`${name}: ${file} -> ${last[0]}`, call, true]);
        }
      }
    }
  });
});
