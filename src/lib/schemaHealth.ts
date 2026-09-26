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
  /** CHECK constraints that must exist, as [schema-qualified table, name].
   *
   * For the files whose whole effect is to tighten or widen one. Such a
   * file RENAMES what it replaces -- see admin-subsections.sql -- because
   * the inventory reports names, and a constraint swapped under its own
   * name looks the same before and after. */
  constraints?: readonly (readonly [string, string])[];
  /** Policies the file REMOVES, as [schema-qualified table, policy]. The
   * file has been run when these are gone -- the only check here that is
   * satisfied by an absence, and the reason harden-rls.sql could not be
   * expressed at all before. */
  droppedPolicies?: readonly (readonly [string, string])[];
  /** Columns the file REMOVES, as [table, column]. Satisfied by an
   * absence, like droppedPolicies: the file has been run when these are
   * gone.
   *
   * A table that is not there at all counts as gone. It has to: a shop
   * that has never run procurement.sql has no purchase_order_items, and
   * asking it to run a file that drops a column from a table it does not
   * have is sending it after work that does not exist. */
  droppedColumns?: readonly (readonly [string, string])[];
  /** True for the ones the shop cannot open without. */
  core?: boolean;
}

/** "public.admin_users" -> "admin_users".
 *
 * Constraints are keyed schema-qualified, like policies and indexes, but
 * `tables` holds bare names for the public schema. */
function bareTable(qualified: string): string {
  return qualified.replace(/^public\./i, "").toLowerCase();
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
    file: "hero-video.sql", labelKey: "featHeroVideo",
    columns: [["hero_slides", "video_url"]],
  },
  {
    file: "hero-product.sql", labelKey: "featHeroProduct",
    columns: [["hero_slides", "product_id"]],
  },
  {
    file: "sales-rollup.sql", labelKey: "featSalesRollup",
    /* A materialized view and the function that rebuilds it. Checked by
       the function, because an inventory that reports relations may or may
       not report a matview as a table -- and the function is the half the
       cron actually calls. */
    routines: ["refresh_sales_daily"],
  },
  {
    file: "message-queue.sql", labelKey: "featMessageQueue",
    columns: [["notifications", "claimed_at"], ["customer_alerts", "attempts"]],
  },
  {
    file: "site-chrome.sql", labelKey: "featSiteChrome",
    columns: [["settings", "heading_font"], ["settings", "incentives_off"]],
  },
  {
    file: "product-highlights.sql", labelKey: "featHighlights",
    columns: [["products", "highlights"]],
  },
  {
    file: "loves.sql", labelKey: "featLoves",
    columns: [["products", "loves"]],
    routines: ["increment_loves", "decrement_loves"],
  },
  {
    file: "refund-settlement.sql", labelKey: "featRefundSettlement",
    // NOT the trigger function it replaces: supabase/returns.sql creates one
    // of the same name, so probing for it would tell an owner who had run
    // only that file that this one was applied too. The index is this file's
    // own, and it is the index the admin's "refunds not yet paid" list runs
    // on -- so its absence means both the honest trigger and the list are
    // missing, which is exactly what the panel should report.
    indexes: [["public.order_returns", "order_returns_unsettled_idx"]],
  },
  {
    file: "order-idempotency.sql", labelKey: "featOrderIdempotency",
    columns: [["orders", "idempotency_key"]],
  },
  {
    file: "rate-limits.sql", labelKey: "featRateLimits",
    tables: ["rate_limits"],
    routines: ["hit_rate_limit"],
  },
  {
    file: "seller-invites.sql", labelKey: "featSellerInvites",
    tables: ["seller_invites"],
  },
  {
    file: "seller-procurement.sql", labelKey: "featSellerProcurement",
    columns: [["suppliers", "seller_id"], ["purchase_orders", "seller_id"]],
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
    // No table, no column, no function: this file widens one check
    // constraint and that is all it does. It is here because the panel
    // saying "every file has been run" while this one has not is a shop
    // whose Admin users screen offers tab checkboxes the database refuses.
    file: "admin-subsections.sql", labelKey: "featAdminSubsections",
    constraints: [["public.admin_users", "admin_users_section_keys_check"]],
  },
  {
    file: "seller-features.sql", labelKey: "featSellerFeatures",
    columns: [["sellers", "features"]],
  },
  {
    file: "seller-address-public.sql", labelKey: "featSellerAddressPublic",
    columns: [["sellers", "address_public"]],
  },
  {
    // No table, no column: this file rewrites the keys in sellers.features
    // and replaces the constraint that bounds them. Checked by the new
    // constraint's NAME, because the panel saying "all run" while this one
    // has not is a Sellers screen offering tabs the database refuses.
    file: "seller-areas.sql", labelKey: "featSellerAreas",
    constraints: [["public.sellers", "sellers_area_keys_check"]],
  },
  {
    file: "audience-restock.sql", labelKey: "featRestockLevel",
    /* NOT products.audience, which this file adds and drop-audience.sql
       later removes. Probing a column a later file deletes would leave
       this row reading "not applied" on a database where every file HAS
       run -- and a health panel that cries wolf is one nobody reads. The
       restock half of this file is what survives, so that is what it is
       probed by. */
    columns: [
      ["products", "restock_level"],
      ["settings", "restock_alert_pct"],
    ],
  },
  {
    /* Probed by the ABSENCE of what it removes. Every other row here asks
       "is the thing there yet"; this file's whole job is to take two
       columns away, so the only honest question is the opposite one. */
    file: "drop-audience.sql", labelKey: "featDropAudience",
    droppedColumns: [
      ["products", "audience"],
      ["purchase_order_items", "audience"],
    ],
  },
  {
    file: "legal-currency-tax.sql", labelKey: "featLegalCurrencyTax",
    columns: [
      ["settings", "legal_address"],
      ["settings", "display_currency"],
      ["settings", "tax_rate"],
      ["orders", "tax"],
      ["orders", "currency"],
      ["order_items", "tax"],
    ],
  },
  {
    /* What the buyer saved, so the invoice can say it. The checkout showed
       a Discount line and the invoice could not, because nothing on the
       order recorded one. */
    file: "order-discount.sql", labelKey: "featOrderDiscount",
    columns: [["orders", "discount"]],
    constraints: [["public.orders", "orders_discount_check"]],
  },
  {
    /* Telling customers about a new product or a new discount.
       customers.notify_new_products had existed since the account page did,
       and nothing read it: a customer ticking the box was told nothing,
       ever. */
    file: "customer-alerts.sql", labelKey: "featCustomerAlerts",
    tables: ["customer_alerts"],
    indexes: [["public.customer_alerts", "customer_alerts_once"]],
  },
  {
    // The retention sweep. Nothing in the application calls it -- it is a
    // tool an operator runs deliberately -- so the panel is the only place
    // that can say whether the shop has it at all.
    file: "pii-retention.sql", labelKey: "featPiiRetention",
    routines: ["redact_old_order_pii"],
  },
  {
    // A payment proof that stops being readable. Named by the column that
    // replaces a year-long signed URL with a path nobody can open.
    file: "proof-path.sql", labelKey: "featProofPath",
    columns: [["orders", "proof_path"]],
  },
  {
    // One-use TOTP codes. Named by the settings column, because that is
    // the one table the file touches that admin-users.sql does not.
    file: "totp-replay.sql", labelKey: "featTotpReplay",
    columns: [["settings", "totp_last_counter"]],
  },
  {
    // The sitemap's <lastmod>. Named by the column, which no other file
    // adds to products -- settings has an updated_at of its own, from
    // schema.sql, which is why the probe is a pair and not a name.
    file: "product-timestamps.sql", labelKey: "featProductTimestamps",
    columns: [["products", "updated_at"]],
  },
  {
    // What it costs to run the shop. Named by both tables and the account
    // guard: one alone would not distinguish this from a half-run file.
    file: "operating-costs.sql", labelKey: "featOperatingCosts",
    tables: ["operating_expenses", "recurring_expenses"],
    routines: ["is_expense_account"],
  },
  {
    // A buyer can start a return. Named by both tables: one alone would
    // not distinguish this from a file that got half way.
    file: "return-requests.sql", labelKey: "featReturnRequests",
    tables: ["return_requests", "return_request_items"],
  },
  {
    // Goods going the other way. Named by both tables and the ledger
    // trigger's function: without the last one the stock never leaves the
    // shelf, which is the half-run state worth catching.
    file: "supplier-returns.sql", labelKey: "featSupplierReturns",
    tables: ["supplier_returns", "supplier_return_items"],
    routines: ["apply_supplier_return_stock"],
  },
  {
    // Stock counted per size. Named by the view and the availability
    // function rather than by the column, because the column alone would
    // not distinguish this from a file that stopped after section 1.
    file: "size-stock.sql", labelKey: "featSizeStock",
    views: ["product_size_stock"],
    routines: ["size_available"],
    columns: [["purchase_order_items", "size_qty"]],
  },
  {
    /* Order lines as rows rather than as a document. Named by the table and
       the EARNINGS aggregate: the table alone would not distinguish this
       file from one that had only got half way.
     *
     * sync_order_items is deliberately NOT probed, though this file creates
     * it. legal-currency-tax.sql replaces it to add the line's tax and runs
     * later, so its presence says nothing about whether THIS file ran -- the
     * same trap that once had stock-ledger.sql identified by a function two
     * other files also create. seller_earnings is created only here. */
    file: "order-items.sql", labelKey: "featOrderItems",
    tables: ["order_items"],
    routines: ["seller_earnings"],
  },
  {
    // Stock held from the moment it is ordered. Named by the view and the
    // sweep -- the two things no LATER file redefines. reserve_order_stock
    // and sync_order_stock_state are created here too and then replaced by
    // size-stock.sql, so their presence says nothing about whether this
    // file ran; probing for them would report a database that has only run
    // the newer file as having run this one.
    file: "stock-reservation.sql", labelKey: "featStockReservation",
    views: ["stock_reservations"],
    routines: ["release_stale_reservations"],
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
    //
    // NOT sync_order_stock() either, as of stock-reservation.sql -- that
    // file keeps a wrapper of the same name so nothing still calling the
    // two-argument form breaks, which means the name no longer identifies
    // anybody. The view is what this file alone makes.
    views: ["stock_reconciliation"],
  },
  {
    // The dynamic attribute model: an attribute is a row, so a new category
    // is INSERTs rather than a migration. Named by the join table, which
    // nothing else creates.
    file: "taxonomy.sql", labelKey: "featTaxonomy",
    tables: ["product_types", "attributes", "attribute_options",
             "product_type_attributes"],
    routines: ["attribute_belongs_to_type", "type_belongs_to_category"],
  },
  {
    // What each product answers. Named by the table, which nothing else
    // creates.
    file: "product-attributes.sql", labelKey: "featProductAttributes",
    tables: ["product_attribute_values"],
  },
  {
    // Variants: a product that varies more than one way. Named by the two
    // tables and the availability function, none of which anything else
    // creates.
    file: "variants.sql", labelKey: "featVariants",
    tables: ["product_variants", "variant_attribute_values"],
    views: ["product_variant_stock"],
    routines: ["variant_available"],
  },
  {
    // Buying and receiving by variant. Named by the column, which nothing
    // else adds.
    file: "variant-purchasing.sql", labelKey: "featVariantPurchasing",
    columns: [["purchase_order_items", "variant_qty"]],
  },
  {
    // How long a product may sit unsold before the shop is told.
    file: "stale-stock.sql", labelKey: "featStaleStock",
    columns: [["settings", "stale_days"]],
  },
  {
    // Buying a product type. Named by the column, which nothing else adds.
    file: "po-taxonomy.sql", labelKey: "featPoTaxonomy",
    columns: [["purchase_order_items", "product_type_id"],
              ["purchase_order_items", "attribute_values"]],
  },
  {
    // Filtering the catalogue by attribute. Named by the helper function,
    // which nothing else creates -- search_products is redefined here but
    // three other files also create it.
    file: "attribute-filters.sql", labelKey: "featAttributeFilters",
    routines: ["products_with_attribute"],
  },
  {
    // Creates nothing -- it WIDENS two columns legal-currency-tax.sql
    // already added. A column's precision is not in the inventory, so the
    // file renames the range check instead, which is: the same rule under
    // a name that can be seen. Same trick as admin-subsections.sql.
    file: "tax-precision.sql", labelKey: "featTaxPrecision",
    constraints: [["public.settings", "settings_tax_rate_range_check"]],
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
/* THE ORDER TO RUN THEM IN.
 *
 * SCHEMA_FEATURES above is a list of what each file CREATES, ordered for
 * reading. It is not a run order and never was -- returns.sql sits tenth in
 * it and its own header says "Run AFTER supabase/stock-ledger.sql", which is
 * twenty-fifth. An operator following that list produces a database that
 * refuses halfway through.
 *
 * Until this existed the run order lived in prose inside the files, and
 * DEPLOY.md named six of the twenty-seven. The nineteen it did not name
 * included the stock ledger, the payment tables, staff logins, and the two
 * files whose entire purpose is closing security holes -- so an operator
 * who followed the guide literally deployed a shop missing all of them.
 *
 * This is that order, as data rather than prose, so a test can check it:
 * every file present exactly once, and every "Run AFTER X" in any header
 * actually respected. scripts/build-run-all.mjs turns it into one pasteable
 * supabase/run-all.sql.
 *
 * seed.sql is deliberately last and deliberately optional -- it is sample
 * data, not schema.
 */
export const SCHEMA_ORDER: readonly string[] = [
  // The foundation: every table, index, policy, bucket and trigger.
  "schema.sql",
  // The inventory function the health panel reads. Early, so that a
  // half-finished install can still be diagnosed from the admin screen.
  "schema-health.sql",

  // Catalogue and the marketplace itself.
  "marketplace-v2.sql",
  "order-items.sql",         // after marketplace-v2.sql
  "notifications.sql",
  "customer-alerts.sql",     // after notifications.sql, whose shape it follows
  // AFTER both queues exist: it adds a claim column to each and the
  // function that drains them.
  "message-queue.sql",
  "payments.sql",

  // Buying, then the ledger that receiving writes into, then returns --
  // this run of four is where the stated dependencies live.
  "procurement.sql",
  "po-product-details.sql",
  "stock-receipt.sql",
  // BEFORE stock-ledger.sql, which reads orders.is_preorder in its
  // backfill and in the trigger it installs. The dependency is real and
  // was not stated in either file's header -- an integration run against a
  // real Postgres is what found it, which is the argument for having one.
  "preorders.sql",
  "stock-ledger.sql",        // after stock-receipt.sql and preorders.sql
  "stock-reservation.sql",   // after stock-ledger.sql
  "returns.sql",             // after stock-ledger.sql
  "return-requests.sql",     // after returns.sql
  // AFTER procurement.sql, whose suppliers and purchase_orders it
  // references, and after stock-reservation.sql, whose reason constraint
  // it rebuilds -- applied the other way round, the older file would drop
  // 'supplier_return' back out of the list again.
  "supplier-returns.sql",
  // AFTER stock-reservation.sql, whose sync_order_stock_state and
  // reserve_order_stock it replaces with size-aware versions, and after
  // procurement.sql, whose purchase_order_items it adds two columns to.
  // Applied the other way round, the older file would put the sizeless
  // functions back.
  "size-stock.sql",
  "zone-cleanup.sql",
  "operating-costs.sql",
  "refund-settlement.sql",   // after returns.sql

  // Reporting and storefront features. Independent of each other.
  "sales.sql",
  /* AFTER order-items.sql, returns.sql and sales.sql, all three of which
     it reads: the lines, the returns that net them down, and product_costs
     for the cost a line was sold without. Placed by running it -- the
     first attempt sat beside message-queue.sql and run-all.sql stopped at
     "relation order_return_items does not exist". */
  "sales-rollup.sql",
  "promotions.sql",
  "hero-video.sql",
  "hero-product.sql",     // after schema.sql (products) and hero-video.sql
  "legal-currency-tax.sql",  // columns only; safe anywhere after schema.sql
  "tax-precision.sql",       // widens the two tax_rate columns it added
  "stale-stock.sql",         // one column on settings; anywhere after schema.sql
  "order-discount.sql",      // one column on orders; anywhere after schema.sql
  "loves.sql",
  "reorder-policy.sql",
  "audience-restock.sql",
  "product-timestamps.sql",
  "proof-path.sql",
  "pii-retention.sql",

  // Hardening the request path.
  "order-idempotency.sql",
  "rate-limits.sql",

  // Staff accounts, then the roles that describe them.
  "admin-users.sql",
  "admin-roles.sql",
  "admin-subsections.sql",   // must follow admin-roles.sql: it replaces that
                             // file's check constraint, and the table it sits
                             // on does not exist before admin-users.sql
  "totp-replay.sql",         // after admin-users.sql

  // Sellers: what they may be given, then what one of those grants needs.
  "seller-invites.sql",
  "seller-features.sql",
  "seller-procurement.sql",
  // LAST of the three, so it is genuinely the last word on the constraint
  // it replaces. seller-features.sql and seller-procurement.sql both add the
  // narrow sellers_features_check; this file drops it, rewrites every row to
  // the two-level keys and adds the wider sellers_area_keys_check. Running it
  // between the other two left a file that re-narrows the column downstream
  // of it, which worked only because that file asks first.
  "seller-areas.sql",
  "seller-address-public.sql",  // a column on sellers; anywhere after schema.sql

  // LAST, both of them. These two REMOVE things -- open policies, and
  // grants on the audit log -- so anything that creates one has to have run
  // already or it is dropped and then recreated behind their backs.
  // The dynamic attribute model, then the taxonomy that fills it.
  // BEFORE the hardening files: this one creates read policies and
  // grants, and anything that creates one has to run before the pass
  // that reviews them.
  "taxonomy.sql",
  "taxonomy-seed.sql",
  "product-attributes.sql",
  "variants.sql",
  "variant-purchasing.sql",
  // AFTER taxonomy.sql, whose product_types it references, and after
  // procurement.sql, whose purchase_order_items it adds two columns to.
  "po-taxonomy.sql",
  "attribute-filters.sql",
  // AFTER attribute-filters.sql, because it redefines the same
  // search_products and has to be the last word on it, and after every
  // file that adds products.audience or purchase_order_items.audience --
  // it drops both columns, and a file that adds one again downstream of
  // this would undo it.
  "drop-audience.sql",
  // AFTER taxonomy-seed.sql, whose tree it reshapes. It only moves rows
  // that file put there, so on a shop that has never pasted the seed it
  // finds nothing and does nothing.
  "clothing-taxonomy.sql",
  // AFTER variants.sql, whose tables it reads, and after anything that
  // creates variants. It only ever ADDS to products.sizes, so running it
  // before a later receipt simply means that receipt has less to catch up.
  "backfill-sizes.sql",
  // AFTER taxonomy-seed.sql and clothing-taxonomy.sql, both of which build
  // the tree this one replaces. It reads what they left and moves it.
  "focus-taxonomy.sql",
  // Anywhere after schema.sql: it adds one column to products and reads
  // nothing. Kept beside the other product-column files.
  "product-highlights.sql",
  // AFTER legal-currency-tax.sql, whose column-by-column grant pattern on
  // settings it follows and extends.
  "site-chrome.sql",
  "harden-rls.sql",
  "patch-audit-hardening.sql",

  // Optional sample data.
  "seed.sql",
];

export const NOT_SCHEMA_FILES: readonly string[] = [
  // Sample data, not schema.
  "seed.sql",
  // The taxonomy's CONTENTS -- 25 categories, 267 product types, 546
  // attributes -- generated from the specification. taxonomy.sql creates
  // the tables and the panel probes those; this one only fills them, so
  // there is no object it could be probed by. An empty taxonomy is a shop
  // that has not pasted it yet, not a broken schema.
  "taxonomy-seed.sql",
  // A DATA fix, not a schema one: it fills products.sizes from the
  // variants, creating no table, column, view or function of its own.
  "backfill-sizes.sql",
  // The same: it rewrites the CONTENTS of `categories`, which schema.sql
  // created, so there is no object the health panel could probe for it.
  "focus-taxonomy.sql",
  // A DATA fix, not a schema one, exactly like zone-cleanup.sql below: it
  // moves rows between categories that taxonomy.sql already created, and
  // creates no table, column, view or function of its own. The only
  // probe-able object would be `categories`, which schema.sql creates and
  // which would therefore always read "applied".
  "clothing-taxonomy.sql",
  // A DATA fix, not a schema one: it rewrites settings.zones so a shop
  // stops offering "zone_z1" as a delivery option. It creates no table,
  // column, view or function, so the panel has nothing it could probe --
  // the only honest probe would be settings.zones, which schema.sql
  // already creates and which would therefore always read "applied".
  // It is in SCHEMA_ORDER and so in run-all.sql, which is what DEPLOY.md
  // tells an operator to run.
  "zone-cleanup.sql",
  // What Supabase provides before a project's first migration -- roles,
  // auth.users, storage.objects, extensions. Applied only to the bare
  // Postgres the integration tests run against, never to a real database,
  // which already has all of it. See supabase/ci-bootstrap.sql.
  "ci-bootstrap.sql",
  // Every other file concatenated in SCHEMA_ORDER, generated by
  // scripts/build-run-all.mjs. It creates nothing of its own, so probing
  // for it would mean probing for everything at once -- and it must never
  // appear on the panel as a migration in its own right.
  "run-all.sql",
];

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
  /** memberKey(qualified table, check constraint name) */
  constraints: ReadonlySet<string>;
  /** False when the database still has the older schema_inventory(), which
   * reported tables and columns and nothing else. Then the sets above
   * are empty because the database was never asked, NOT because the objects
   * are absent -- and reading an empty set as an absence is how a panel ends
   * up telling an owner to re-run files that are already in place. */
  seesKinds: boolean;
  /** False when the installed schema_inventory() is kind-aware but predates
   * check constraints. Same trap one version later, and it needs its own
   * flag: seesKinds would be true while `constraints` was empty for the
   * reason it was never asked.
   *
   * Unlike seesKinds this IS inferred from a value being present, which is
   * sound only because it cannot legitimately be absent: schema.sql onward
   * declares dozens of check constraints across most tables, so a database
   * holding this application's schema always has some. A function that
   * reports none is a function that does not report them. */
  seesConstraints: boolean;
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
    const looksPastTables = !!(f.views || f.routines || f.indexes || f.droppedPolicies || f.constraints);
    if (looksPastTables && !snapshot.seesKinds) {
      return { ...f, applied: false, unknown: true, missing: [], lingering: [] };
    }

    // And the same again for the kind added after the rest. A kind-aware
    // inventory installed before check constraints were reported cannot
    // answer for them, so a file checked only by one is NOT CHECKED rather
    // than outstanding.
    //
    // UNLESS THE TABLE IS NOT THERE EITHER, which is the one case where an
    // empty constraint set is an honest answer rather than a question never
    // asked: a database without admin_users has not run the file that adds
    // a constraint to admin_users, and no inventory version is needed to
    // know that. Saying "not checked" there would hide a real answer.
    if (f.constraints && !snapshot.seesConstraints
        && f.constraints.every(([tbl]) => snapshot.tables.has(bareTable(tbl)))) {
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
    for (const [tbl, con] of f.constraints ?? []) {
      // Reported as the table when the table is what is missing, for the
      // same reason as columns above: "admin_users_section_keys_check is
      // missing" is a puzzle when the answer is that admin_users is.
      const bare = bareTable(tbl);
      if (!snapshot.tables.has(bare)) {
        if (!missing.includes(bare)) missing.push(bare);
      } else if (!snapshot.constraints.has(memberKey(tbl, con))) {
        missing.push(con);
      }
    }

    // The inverted one: still there means still to do.
    const lingering: string[] = [];
    for (const [tbl, pol] of f.droppedPolicies ?? []) {
      if (snapshot.policies.has(memberKey(tbl, pol))) lingering.push(`${tbl}: ${pol}`);
    }
    for (const [tbl, col] of f.droppedColumns ?? []) {
      // No table, nothing to drop -- see droppedColumns' note.
      if (snapshot.tables.has(tbl.toLowerCase())
          && snapshot.columns.has(`${tbl}.${col}`.toLowerCase())) {
        lingering.push(`${tbl}.${col}`);
      }
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
 * object_name, member_name) and covers views, functions, policies, indexes
 * and check constraints as well.
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
  const constraints = new Set<string>();

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
      case "constraint": constraints.add(memberKey(name, member)); break;
    }
  }

  return {
    tables, columns, views, routines, policies, indexes, constraints,
    seesKinds, seesConstraints: constraints.size > 0,
  };
}

/** Functions this schema deliberately defines more than once, in run order,
 * with the LAST entry the definition the database is left holding.
 *
 * LIVES HERE, NOT IN A TEST, because it is a fact about the schema rather
 * than about one test file -- and because two tests now depend on it: the
 * text guards in tests/schemaHealth.test.ts, and the behavioural proofs in
 * tests/rls/replacements.test.ts. A chain added to one list and not the
 * other is exactly the gap this is meant to close.
 *
 * ADDING AN ENTRY IS NOT FREE. Every key here must also have a test that
 * runs the final definition against a real Postgres and asserts what it
 * does. Three of these chains silently lost a line this year; the text
 * guards caught two shapes of that and would not have caught a changed
 * threshold or a dropped clause. */
export const INTENDED_REPLACEMENTS: Record<string, readonly string[]> = {
  /* Each list is in SCHEMA_ORDER, and the LAST entry is the definition the
     database is left holding. */

  // Direct write -> pre-orders skipped -> through the ledger -> reservations.
  decrement_stock_on_confirm: [
    "schema.sql", "preorders.sql", "stock-ledger.sql", "stock-reservation.sql",
  ],
  // Reservations, then sizes.
  sync_order_stock_state: ["stock-reservation.sql", "size-stock.sql"],
  reserve_order_stock: ["stock-reservation.sql", "size-stock.sql", "variants.sql"],
  // The two-argument wrapper, kept for callers predating the three-state form.
  sync_order_stock: ["stock-ledger.sql", "stock-reservation.sql"],
  // The trigger that moves products.qty gains the restock high-water mark.
  apply_stock_movement: [
    "stock-receipt.sql", "stock-ledger.sql", "audience-restock.sql",
  ],
  // Catalogue search gains the audience filter.
  search_products: ["marketplace-v2.sql", "audience-restock.sql", "attribute-filters.sql",
                    "drop-audience.sql"],
  // A refund counts when it has SETTLED, not when it was agreed.
  sync_order_refund_status: ["returns.sql", "refund-settlement.sql"],
  // The line-building trigger gains the line's share of the order's tax.
  sync_order_items: ["order-items.sql", "legal-currency-tax.sql"],
};

