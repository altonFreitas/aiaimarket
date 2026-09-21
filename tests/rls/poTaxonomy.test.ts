import { describe, it, expect, beforeAll } from "vitest";
import { DATABASE_URL, sql, scalar } from "./db";

/* THE TWO COLUMNS A PURCHASE ORDER LINE GREW, against a real Postgres.
 *
 * What is worth testing here is not that a column exists -- the schema
 * health panel says that -- but the two decisions encoded in it:
 *
 *   ON DELETE SET NULL, so retiring a product type next year does not
 *   delete the purchase orders that bought under it. An order is the
 *   record of what was bought and paid for.
 *
 *   NOT NULL DEFAULT '{}', so every line written before this file existed
 *   reads as "no answers" rather than as null -- which is what lets
 *   receiving treat old and new lines with one code path.
 */

const RUN = Boolean(DATABASE_URL);
const describeDb = RUN ? describe : describe.skip;

if (!RUN) {
  console.warn(
    "\n  Purchase order taxonomy tests SKIPPED: set TEST_DATABASE_URL to a\n" +
    "  database with ci-bootstrap.sql + run-all.sql applied.\n");
}

/** A supplier, a category, a product type and an order, torn down first. */
function fixture(): { poId: string; typeId: string; itemId: string } {
  sql(`delete from purchase_orders where po_number = 'PO-TAXO-1'`);
  sql(`delete from product_types where slug = 'taxo_test_type'`);
  sql(`delete from categories where slug = 'taxo-test-cat'`);
  sql(`delete from suppliers where name = 'Taxo Test Supplier'`);

  sql(`insert into categories (name, slug, sort_order) values ('Taxo Test', 'taxo-test-cat', 99)`);
  const catId = scalar(`select id from categories where slug = 'taxo-test-cat'`)!;
  sql(`insert into product_types (category_id, name, slug, display_order)
       values ('${catId}', 'Taxo Test Type', 'taxo_test_type', 0)`);
  const typeId = scalar(`select id from product_types where slug = 'taxo_test_type'`)!;

  sql(`insert into suppliers (name) values ('Taxo Test Supplier')`);
  const supId = scalar(`select id from suppliers where name = 'Taxo Test Supplier'`)!;
  sql(`insert into purchase_orders (po_number, supplier_id, order_date, status, payment_status, currency)
       values ('PO-TAXO-1', '${supId}', current_date, 'draft', 'unpaid', 'USD')`);
  const poId = scalar(`select id from purchase_orders where po_number = 'PO-TAXO-1'`)!;

  sql(`insert into purchase_order_items
         (po_id, product_name, category, qty, unit_price, product_type_id, attribute_values)
       values ('${poId}', 'Test Shoe', 'goods_for_resale', 10, 5,
               '${typeId}', '{"a1": ["41,5"]}'::jsonb)`);
  const itemId = scalar(
    `select id from purchase_order_items where po_id = '${poId}'`)!;
  return { poId, typeId, itemId };
}

describeDb("a line that names a product type", () => {
  let f: ReturnType<typeof fixture>;
  beforeAll(() => { f = fixture(); });

  it("stores the type and the answers", () => {
    expect(scalar(`select product_type_id from purchase_order_items where id = '${f.itemId}'`))
      .toBe(f.typeId);
    expect(scalar(`select attribute_values->'a1'->>0 from purchase_order_items where id = '${f.itemId}'`))
      .toBe("41,5");
  });

  it("keeps the order when the product type is retired", () => {
    /* ON DELETE SET NULL, not CASCADE. A shop tidying its taxonomy next
       year must not lose the purchase orders that bought under it -- those
       are what it paid for, and what its accountant will ask about. */
    sql(`delete from product_types where id = '${f.typeId}'`);
    expect(scalar(`select count(*) from purchase_order_items where id = '${f.itemId}'`)).toBe("1");
    /* A NULL column comes back from psql as an empty line, which sql()
       filters out -- so scalar() reports it as null rather than as "". */
    expect(scalar(`select product_type_id from purchase_order_items where id = '${f.itemId}'`))
      .toBeNull();
    // And the answers stay, so the line still says what was ordered.
    expect(scalar(`select attribute_values->'a1'->>0 from purchase_order_items where id = '${f.itemId}'`))
      .toBe("41,5");
  });

  it("refuses a product type that does not exist", () => {
    // The foreign key, not the application, is what makes this impossible.
    const r = sql(`update purchase_order_items
                      set product_type_id = '00000000-0000-0000-0000-000000000001'
                    where id = '${f.itemId}'`);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/foreign key|violates/i);
  });
});

describeDb("a line written before any of this existed", () => {
  it("reads as no answers rather than as null", () => {
    /* NOT NULL DEFAULT '{}' is what lets receiving.ts treat an old line
       and a new one with one code path instead of a null check at every
       use. */
    const nullable = scalar(
      `select is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'purchase_order_items'
          and column_name = 'attribute_values'`);
    expect(nullable).toBe("NO");

    sql(`delete from purchase_orders where po_number = 'PO-TAXO-2'`);
    const supId = scalar(`select id from suppliers where name = 'Taxo Test Supplier'`)!;
    sql(`insert into purchase_orders (po_number, supplier_id, order_date, status, payment_status, currency)
         values ('PO-TAXO-2', '${supId}', current_date, 'draft', 'unpaid', 'USD')`);
    const poId = scalar(`select id from purchase_orders where po_number = 'PO-TAXO-2'`)!;
    // Exactly the insert the application made before po-taxonomy.sql.
    sql(`insert into purchase_order_items (po_id, product_name, category, qty, unit_price)
         values ('${poId}', 'Old Line', 'goods_for_resale', 1, 1)`);
    expect(scalar(`select attribute_values::text from purchase_order_items
                    where po_id = '${poId}'`)).toBe("{}");
    expect(scalar(`select coalesce(product_type_id::text, 'null')
                     from purchase_order_items where po_id = '${poId}'`)).toBe("null");
    sql(`delete from purchase_orders where po_number = 'PO-TAXO-2'`);
  });
});
