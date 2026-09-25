import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spendByProduct, spendByShopCategory, spendByCategory } from "@/lib/procurement";
import type { PurchaseOrder, Supplier } from "@/lib/types";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const CSS = read("src/app/globals.css");
const ATTRS = read("src/components/admin/AttributesAdmin.tsx");
const TYPES = read("src/components/admin/ProductTypesAdmin.tsx");
const CATS = read("src/components/admin/CategoriesAdmin.tsx");
const REVIEWS = read("src/components/admin/ReviewsAdmin.tsx");
const DEMAND = read("src/components/admin/demand/DemandAdmin.tsx");
const PROC = read("src/components/admin/procurement/ProcurementDashboard.tsx");
const PO = read("src/components/admin/procurement/PurchaseOrderForm.tsx");
const MENU = read("src/components/admin/DownloadMenu.tsx");

describe("a long list is bounded, and only when it is long", () => {
  /* Eight rows for a table, two for a moderation list -- the counts the
     shop asked for. The point of each is the same: a screen whose own
     content runs to several pages pushes the form that adds to it out of
     reach, and the list below it out of existence. */
  it.each([
    ["the attribute table", ATTRS, "8"],
    ["the product type list", TYPES, "8"],
  ])("caps %s past eight", (_n, src, n) => {
    expect(src).toContain(`.length > ${n} ? "rows-cap`);
    // And not at all below it: a border and a scrollbar around four rows
    // is chrome around nothing.
    expect(src).toContain(`: undefined`);
  });

  it("caps both moderation lists past two", () => {
    expect(REVIEWS.split('reviews.length > 2 ? "rows-cap rows-cap-review"').length - 1).toBe(1);
    expect(REVIEWS.split('ratings.length > 2 ? "rows-cap rows-cap-review"').length - 1).toBe(1);
  });

  it("lets a keyboard into every box that scrolls", () => {
    /* A div that scrolls and holds nothing focusable cannot be scrolled
       from a keyboard at all, so everything past the fold is unreachable
       without a mouse. */
    for (const src of [ATTRS, TYPES, REVIEWS]) {
      const caps = src.split("rows-cap").length - 1;
      const tabs = src.split("tabIndex={").length - 1;
      expect(tabs).toBeGreaterThanOrEqual(caps > 0 ? 1 : 0);
    }
    expect(ATTRS).toContain("tabIndex={shown.length > 8 ? 0 : undefined}");
  });

  it("keeps a scrolled table's heading in view", () => {
    // Otherwise the rows below the fold are a grid of unlabelled numbers.
    expect(CSS).toContain(".rows-cap .table thead th{position:sticky");
    // A sticky cell is transparent by default and the rows would be read
    // through it.
    expect(CSS).toMatch(/\.rows-cap \.table thead th\{[^}]*background:/);
  });

  it("states how many rows in the markup, not as a pixel height", () => {
    expect(CSS).toContain("max-height:calc(var(--rows) * var(--row-h))");
  });
});

describe("the find box and its button sit on one baseline", () => {
  it("is a flex row, not a grid with a flex property on a block", () => {
    /* THE BUG: the button's wrapper carried `justifyContent:flex-end`
       inline, inside a .two grid. .field is a block, justify-content does
       nothing to one, and the button hung from the top of its cell while
       the input sat below a label -- 21px apart, measured. */
    expect(ATTRS).toContain('className="admin-find"');
    expect(ATTRS).not.toContain('justifyContent: "flex-end"');
    expect(CSS).toMatch(/\.admin-find\{[^}]*align-items:flex-end/);
  });
});

describe("the categories screen can be searched", () => {
  it("has a box above the list", () => {
    expect(CATS).toContain('type="search"');
    expect(CATS).toContain("searchCategories");
  });

  it("matches the slug as well as the name", () => {
    // The slug is on screen and is what a URL complaint will quote.
    expect(CATS).toContain("c.slug.toLowerCase().includes(needle)");
  });

  it("keeps a matching child's parent, and a matching parent's children", () => {
    /* A flat list of hits would strip the one thing this screen is for --
       showing what sits inside what. */
    expect(CATS).toContain("hit(c) ? kids : kids.filter(hit)");
    expect(CATS).toContain("hit(c) || kids.length > 0");
  });

  it("says so when nothing matches", () => {
    // An empty list under a box you have just typed in reads as a broken
    // screen rather than as an answer.
    expect(CATS).toContain('needle !== "" && shown.length === 0');
  });
});

describe("the demand cards sit with the table they filter", () => {
  it("comes after catalog health and before the table", () => {
    const health = DEMAND.indexOf('t("catalogHealth"');
    const tiles = DEMAND.indexOf('className="status-tiles"');
    const table = DEMAND.indexOf('t("productDemand"');
    expect(health).toBeGreaterThan(-1);
    expect(tiles).toBeGreaterThan(health);
    expect(table).toBeGreaterThan(tiles);
  });

  it("reports its own state to a screen reader, not just to the eye", () => {
    expect(DEMAND).toContain("aria-pressed={signalFilter === s}");
  });
});

describe("one download button, two formats", () => {
  it("replaced the two ghost buttons on the purchase order", () => {
    expect(PO).toContain("<DownloadMenu");
    expect(PO).not.toContain('onClick={downloadPdf}>');
    expect(PO).not.toContain('onClick={downloadExcel}>');
    // Both jobs are still reachable, as menu rows.
    expect(PO).toContain("run: downloadPdf");
    expect(PO).toContain("run: downloadExcel");
  });

  it("closes on Escape and on a press anywhere else", () => {
    expect(MENU).toContain('e.key === "Escape"');
    // Pointerdown, so the menu is gone before whatever was tapped behind
    // it reacts.
    expect(MENU).toContain('window.addEventListener("pointerdown", onDown)');
  });

  it("takes its listeners back off", () => {
    expect(MENU).toContain('window.removeEventListener("pointerdown", onDown)');
    expect(MENU).toContain('window.removeEventListener("keydown", onKey)');
  });

  it("opens inwards from a button at the right edge", () => {
    expect(CSS).toMatch(/\.dlmenu-list\{[^}]*right:0/);
  });
});

/* ------------------------------------------------------------------ */

function po(items: Array<Partial<PurchaseOrder["items"] extends (infer I)[] | null | undefined ? I : never>>): PurchaseOrder {
  return {
    id: "po1", po_number: "PO-1", supplier_id: "s1", order_date: "2026-01-01",
    status: "sent", payment_status: "unpaid", fx_rate: 1,
    items: items.map((i, n) => ({
      id: "i" + n, product_name: "Thing", category: "goods_for_resale",
      qty: 1, unit_price: 1, ...i,
    })),
  } as PurchaseOrder;
}
const SUPPLIERS = [{ id: "s1", name: "Supplier One" }] as Supplier[];
const NAMES = new Map([["c1", "Clothing"], ["c2", "Eletrodomestiku"]]);

describe("shop category is not spend category", () => {
  /* They answer different questions and the dashboard was showing one
     chart called "Quantity by category", which was whichever of the two
     you assumed it meant. "How much went on goods for resale rather than
     freight" is the spend category; "how much of it was clothing" is the
     shop one. */

  it("groups the same lines two different ways", () => {
    const orders = [po([
      { product_name: "Tee", category: "goods_for_resale", qty: 10, unit_price: 2, catalog_category_id: "c1" },
      { product_name: "Fridge", category: "goods_for_resale", qty: 1, unit_price: 400, catalog_category_id: "c2" },
      { product_name: "Boxes", category: "packaging", qty: 1, unit_price: 50 },
    ])];
    const spend = spendByCategory(orders);
    const shop = spendByShopCategory(orders, NAMES);
    // Spend: two buckets, one of them packaging.
    expect(spend.map((r) => r.category).sort()).toEqual(["goods_for_resale", "packaging"]);
    // Shop: two aisles, and the packaging is in neither.
    expect(shop.map((r) => r.category).sort()).toEqual(["Clothing", "Eletrodomestiku"]);
  });

  it("leaves lines with no shop category out rather than bundling them", () => {
    /* Packaging and bank charges are not an aisle, and an "(none)" bar
       for them would usually be the tallest one on the chart. */
    const orders = [po([
      { product_name: "Boxes", category: "packaging", qty: 1, unit_price: 50 },
    ])];
    expect(spendByShopCategory(orders, NAMES)).toEqual([]);
  });

  it("carries the shop category onto each product row", () => {
    const orders = [po([
      { product_name: "Tee", qty: 10, unit_price: 2, catalog_category_id: "c1" },
    ])];
    const rows = spendByProduct(orders, SUPPLIERS, NAMES);
    expect(rows[0]).toMatchObject({ name: "Tee", shopCategory: "Clothing", category: "goods_for_resale" });
  });

  it("prints nothing rather than a uuid when the names are not loaded", () => {
    const orders = [po([
      { product_name: "Tee", qty: 1, unit_price: 2, catalog_category_id: "c1" },
    ])];
    expect(spendByProduct(orders, SUPPLIERS)[0].shopCategory).toBe("");
  });

  it("keeps one answer for a product bought twice", () => {
    /* The same product refiled between two orders would otherwise flicker
       between categories depending on which line was read last. */
    const orders = [po([
      { product_name: "Tee", qty: 1, unit_price: 2, catalog_category_id: "c1" },
      { product_name: "tee", qty: 1, unit_price: 2, catalog_category_id: "c2" },
    ])];
    const rows = spendByProduct(orders, SUPPLIERS, NAMES);
    expect(rows).toHaveLength(1);
    expect(rows[0].shopCategory).toBe("Clothing");
  });

  it("names both columns on the screen", () => {
    expect(PROC).toContain('t("shopCategory", lang)');
    expect(PROC).toContain('t("spendCategory", lang)');
    expect(PROC).toContain('t("quantityBySpendCategory", lang)');
    expect(PROC).toContain('t("quantityByShopCategory", lang)');
    // The ambiguous old title is gone entirely.
    expect(PROC).not.toContain('t("quantityByCategory"');
  });

  it("widens the empty row to the columns it now spans", () => {
    // A colSpan short of the header leaves a ragged last column on an
    // empty table.
    expect(PROC).toContain("colSpan={9}");
  });
});
