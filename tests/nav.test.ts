import { describe, it, expect } from "vitest";
import { buildNav, categoryFilterIds, isNavFree } from "@/lib/nav";
import type { Category, Product } from "@/lib/types";

/* Only the fields the navigation actually reads. The rest of a product row
 * is forty columns of things this module must not care about, and a test
 * that spelled them all out would be testing the fixture. */
function product(p: Partial<Product> & { id: string }): Product {
  return {
    seller_id: "s1", ref: "PRD-" + p.id, name: "Product " + p.id, slug: "p-" + p.id,
    category_id: null, price: 10, discount_price: null, sizes: [], tags: [],
    stock_status: "in", qty: 1, description: "", images: [],
    municipality: null, post: null, suku: null, landmark: null,
    pay_cod: true, pay_cop: false, pay_bank: false, pay_wallet: false, pay_fiar: false,
    archived: false, status: "approved", views: 0, wa_clicks: 0,
    created_at: "2026-01-01T00:00:00Z",
    ...p,
  } as Product;
}

function cat(id: string, name: string, parent: string | null = null, order = 1): Category {
  return { id, name, slug: id, parent_id: parent, sort_order: order };
}

/* A shop that sells clothing and appliances. Men's and Women's clothing
 * are SUBCATEGORIES now, which is the whole point: "who is it for" used to
 * be a column on the product and a pair of derived roots in the bar, and
 * it is a place in the tree instead. */
const CATS: Category[] = [
  cat("clothing", "Clothing", null, 1),
  cat("mens", "Men's clothing", "clothing", 1),
  cat("womens", "Women's clothing", "clothing", 2),
  cat("appliances", "Eletrodomestiku", null, 2),
  cat("fridges", "Fridges", "appliances", 1),
  cat("empty", "Empty", null, 3),
];

const PRODUCTS: Product[] = [
  product({ id: "1", category_id: "mens" }),
  product({ id: "2", category_id: "womens" }),
  product({ id: "3", category_id: "clothing" }),   // filed on the parent
  product({ id: "4", category_id: "fridges" }),
];

describe("buildNav", () => {
  it("is the shop's own categories, in the order the admin put them", () => {
    const nav = buildNav(CATS, PRODUCTS, "en");
    expect(nav.map((r) => r.id)).toEqual(["clothing", "appliances"]);
    expect(nav[0].label).toBe("Clothing");
    expect(nav[0].href).toBe("/c/clothing");
  });

  it("counts a category together with its subcategories", () => {
    // Browsing Clothing must not look empty because everything inside it
    // is filed under Men's clothing.
    const [clothing] = buildNav(CATS, PRODUCTS, "en");
    expect(clothing.count).toBe(3);
  });

  it("hangs the subcategories off their parent", () => {
    const [clothing] = buildNav(CATS, PRODUCTS, "en");
    expect(clothing.groups.map((g) => g.label)).toEqual(["Men's clothing", "Women's clothing"]);
    expect(clothing.groups[0].href).toBe("/c/mens");
    expect(clothing.groups[0].count).toBe(1);
  });

  it("leaves out a subcategory with nothing in it", () => {
    // An entry that opens onto "No products found" is worse than no entry.
    const onlyMens = [product({ id: "1", category_id: "mens" })];
    const [clothing] = buildNav(CATS, onlyMens, "en");
    expect(clothing.groups.map((g) => g.id)).toEqual(["mens"]);
  });

  it("leaves out a category with no live products", () => {
    expect(buildNav(CATS, PRODUCTS, "en").map((r) => r.id)).not.toContain("empty");
  });

  it("offers nothing at all for an empty catalogue", () => {
    expect(buildNav(CATS, [], "en")).toEqual([]);
  });

  it("previews real products, a row's worth plus something to scroll to", () => {
    /* Four FIT the panel's third column; eight are sent, because that row
       scrolls sideways. A panel that carried exactly what fit had nothing
       past its right edge, so the gesture had nothing to find.

       The cap still matters in the other direction: this is a menu, and
       every entry in it costs a thumbnail on a connection the shop was
       designed around. */
    const many = Array.from({ length: 20 }, (_, i) =>
      product({ id: "m" + i, category_id: "fridges", images: ["https://x/" + i + ".webp"] }));
    const [appliances] = buildNav(CATS, many, "en");
    expect(appliances.feature.length).toBeGreaterThan(4);
    expect(appliances.feature.length).toBeLessThanOrEqual(12);
    expect(appliances.feature[0].image).toBe("https://x/0.webp");
  });

  it("does not send the whole catalogue to fill a menu", () => {
    // The bound is what keeps a 400-product shop from putting 400
    // thumbnails in its navigation payload.
    const many = Array.from({ length: 400 }, (_, i) =>
      product({ id: "m" + i, category_id: "fridges", images: ["https://x/" + i + ".webp"] }));
    const [appliances] = buildNav(CATS, many, "en");
    expect(appliances.feature.length).toBeLessThanOrEqual(12);
  });

  it("ships no data URL for a product with no photo", () => {
    // The placeholder is drawn by the browser from the product's name --
    // putting the SVG in the payload would cost every page a few hundred
    // bytes per menu entry for a picture that is generated anyway.
    const [clothing] = buildNav(CATS, PRODUCTS, "en");
    expect(clothing.feature[0].image).toBe("");
  });

  it("sends no ?for= anywhere, because there is nothing to filter by", () => {
    const nav = buildNav(CATS, PRODUCTS, "en");
    const hrefs = nav.flatMap((r) => [r.href, ...r.groups.flatMap((g) => [g.href, ...g.children.map((c) => c.href)])]);
    for (const h of hrefs) expect([h, h.includes("?")]).toEqual([h, false]);
  });
});

describe("categoryFilterIds", () => {
  it("covers the category and its children", () => {
    expect(categoryFilterIds(CATS, "clothing")).toEqual(["clothing", "mens", "womens"]);
  });

  it("is just itself for a subcategory", () => {
    expect(categoryFilterIds(CATS, "mens")).toEqual(["mens"]);
  });

  it("is no filter at all for a slug the shop does not have", () => {
    /* Null, not []. An empty array would read as "a filter that matched
       nothing" downstream and show an empty shelf -- a stale bookmark
       should show the catalogue. */
    expect(categoryFilterIds(CATS, "gone")).toBeNull();
    expect(categoryFilterIds(CATS, undefined)).toBeNull();
  });
});

describe("isNavFree", () => {
  it("keeps the aisles off the back office and the checkout", () => {
    for (const p of ["/admin", "/admin/sales", "/seller", "/seller/products/1", "/checkout"]) {
      expect([p, isNavFree(p)]).toEqual([p, true]);
    }
  });

  it("leaves them everywhere a shopper is browsing", () => {
    for (const p of ["/", "/shop", "/c/sapatu", "/p/sneaker", "/list", "/track", "/account"]) {
      expect([p, isNavFree(p)]).toEqual([p, false]);
    }
  });

  it("matches whole segments, not prefixes", () => {
    // "/sellers" is a page about sellers, not the seller area, and
    // "/checkout-help" would be an article about checking out. A plain
    // startsWith would have swallowed both.
    for (const p of ["/sellers", "/checkout-help", "/administration"]) {
      expect([p, isNavFree(p)]).toEqual([p, false]);
    }
  });
});
