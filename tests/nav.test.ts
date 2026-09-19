import { describe, it, expect } from "vitest";
import { buildNav, audienceHighlights, isNavFree } from "@/lib/nav";
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

/* A shop that sells clothes (labelled) and appliances (not). */
const CATS: Category[] = [
  cat("shoes", "Sapatu", null, 1),
  cat("sneakers", "Sneakers", "shoes", 1),
  cat("sandals", "Sandals", "shoes", 2),
  cat("jeans", "Kalsa Jeans", null, 2),
  cat("appliances", "Eletrodomestiku", null, 3),
  cat("fridges", "Fridges", "appliances", 1),
];

const PRODUCTS: Product[] = [
  product({ id: "1", category_id: "sneakers", audience: "women" }),
  product({ id: "2", category_id: "sandals", audience: "men" }),
  product({ id: "3", category_id: "jeans", audience: "unisex" }),
  product({ id: "4", category_id: "fridges" }),            // nobody's clothing
  product({ id: "5", category_id: "appliances" }),         // filed on the parent
];

describe("buildNav", () => {
  it("puts Women and Men in the bar when products say who they are for", () => {
    const nav = buildNav(CATS, PRODUCTS, "en");
    expect(nav.map((r) => r.id)).toEqual(["women", "men", "appliances"]);
    expect(nav[0].label).toBe("Women");
    expect(nav[0].href).toBe("/shop?for=women");
  });

  it("counts unisex under both audiences and neither audience under the other", () => {
    const [women, men] = buildNav(CATS, PRODUCTS, "en");
    // Women: the women's sneaker + the unisex jeans. Men: the men's sandal
    // + the same jeans. The fridge and the loose appliance are in neither:
    // nobody said they were anybody's, and unset is not unisex.
    expect(women.count).toBe(2);
    expect(men.count).toBe(2);
  });

  it("shows a category inside an audience only when that audience has stock in it", () => {
    const [women] = buildNav(CATS, PRODUCTS, "en");
    expect(women.groups.map((g) => g.id)).toEqual(["shoes", "jeans"]);
    // Sandals are the men's product, so they are not one of the women's
    // subcategories -- an empty shelf is never a link.
    expect(women.groups[0].children.map((c) => c.label)).toEqual(["Sneakers"]);
  });

  it("carries the audience through every link in the panel", () => {
    const [, men] = buildNav(CATS, PRODUCTS, "en");
    expect(men.groups[0].href).toBe("/c/shoes?for=men");
    expect(men.groups[0].children[0].href).toBe("/c/sandals?for=men");
  });

  it("gives the goods nobody labelled a top-level entry of their own", () => {
    const nav = buildNav(CATS, PRODUCTS, "en");
    const appliances = nav[2];
    expect(appliances.href).toBe("/c/appliances");
    // Unfiltered: the entry IS the category, so its numbers are the
    // category's own -- the product filed on the parent counts too.
    expect(appliances.count).toBe(2);
    expect(appliances.groups[0].children[0].href).toBe("/c/fridges");
  });

  it("counts a category together with its subcategories", () => {
    const [women] = buildNav(CATS, PRODUCTS, "en");
    // Browsing "Sapatu" must not look empty because everything inside it is
    // filed under "Sneakers".
    expect(women.groups[0].count).toBe(1);
  });

  it("falls back to the plain category list when nothing is labelled", () => {
    // The state every shop is in on the day this ships. It must degrade to
    // exactly what was there before -- the shop's own categories -- rather
    // than to an empty bar.
    const flat = PRODUCTS.map((p) => product({ ...p, audience: null }));
    const nav = buildNav(CATS, flat, "en");
    expect(nav.map((r) => r.id)).toEqual(["shoes", "jeans", "appliances"]);
  });

  it("offers nothing at all for an empty catalogue", () => {
    expect(buildNav(CATS, [], "en")).toEqual([]);
  });

  it("leaves out a category with no live products", () => {
    const nav = buildNav([...CATS, cat("empty", "Empty", null, 9)], PRODUCTS, "en");
    expect(nav.map((r) => r.id)).not.toContain("empty");
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
    const [appliances] = buildNav(CATS, PRODUCTS, "en");
    expect(appliances.feature[0].image).toBe("");
  });

  it("keeps the bar to a readable number of entries", () => {
    const wide: Category[] = [];
    const stock: Product[] = [];
    for (let i = 0; i < 12; i++) {
      wide.push(cat("c" + i, "Category " + i, null, i));
      stock.push(product({ id: "p" + i, category_id: "c" + i }));
    }
    expect(buildNav(wide, stock, "en")).toHaveLength(6);
  });

  it("names the entries in the shopper's language", () => {
    expect(buildNav(CATS, PRODUCTS, "pt")[0].label).toBe("Mulher");
    expect(buildNav(CATS, PRODUCTS, "tet")[0].label).toBe("Feto");
  });
});

describe("audienceHighlights", () => {
  it("returns only the audiences the shop actually stocks", () => {
    const menOnly = [product({ id: "1", category_id: "jeans", audience: "men" })];
    expect(audienceHighlights(CATS, menOnly, "en").map((r) => r.id)).toEqual(["men"]);
  });

  it("returns nothing when no product says who it is for", () => {
    // Which is what keeps the homepage's "Shop by" tiles from appearing as
    // two doors onto empty rooms.
    expect(audienceHighlights(CATS, [product({ id: "1", category_id: "jeans" })], "en")).toEqual([]);
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
