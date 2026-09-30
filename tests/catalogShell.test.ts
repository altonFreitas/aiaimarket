import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { cardSizes, MAX_SIZES } from "@/lib/cardFacts";
import { countIn } from "@/lib/categoryTree";
import type { Category } from "@/lib/types";
import { isNewProduct, NEW_DAYS } from "@/lib/cardBadges";

/* THE CATALOGUE, REBUILT ON THE REFERENCE.
 *
 * What stood here: a 246px column of category names down the left of
 * every catalogue page, a filter panel under it, and a bar above the grid
 * carrying sort AND price AND an in-stock tick. Three separate places to
 * narrow one catalogue, and a sixth of the width given for the whole
 * session to a question -- "what else is there" -- a shopper asks once.
 *
 * Now: the aisles are cards across the top, everything that narrows is in
 * one rail, and the bar above the grid answers how many and in what order.
 *
 * The guards below are for the promises that are easy to break by
 * accident and impossible to see in a screenshot: that the filters still
 * work with JavaScript switched off, that a closed drawer is out of the
 * tab order, that a filter link carries the other filters with it, and
 * that nothing here invents a fact about a product.
 */

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const CSS = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");

const LAYOUT = code("src/components/CatalogLayout.tsx");
const RAIL = code("src/components/shop/FilterRail.tsx");
const BAR = code("src/components/shop/ShopBar.tsx");
const HEADER = code("src/components/shop/CatalogHeader.tsx");
const SHOP = code("src/app/shop/page.tsx");
const CATPAGE = code("src/app/c/[slug]/page.tsx");
const CRUMB = code("src/components/Crumb.tsx");
const PDP = code("src/app/p/[slug]/page.tsx");

function rule(sel: string): string {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(esc + "\\{([^}]*)\\}").exec(CSS);
  expect(m, `no rule for ${sel}`).not.toBeNull();
  return m![1];
}

describe("the permanent category sidebar is gone", () => {
  it("took its components with it", () => {
    for (const f of ["src/components/Sidebar.tsx", "src/components/CatRail.tsx",
                     "src/components/Toolbar.tsx", "src/components/AttributeFilters.tsx"]) {
      expect(fs.existsSync(path.join(process.cwd(), f)), `${f} still exists`).toBe(false);
    }
  });

  it("and its styles, so nothing is left styling nothing", () => {
    for (const sel of [".cat-side{", ".cat-rail{", ".side-mega{", ".side-list{"]) {
      expect(CSS, sel).not.toContain(sel);
    }
  });

  it("is replaced by aisle cards, a rail and a bar", () => {
    for (const c of ["CatalogHeader", "FilterRail", "ShopBar"]) {
      expect(LAYOUT, c).toContain(c);
    }
  });
});

describe("the trail back is the same one the product page draws", () => {
  /* It was not. The catalogue header had its own copy -- the word "Home",
     then slashes -- while /p/ used <Crumb>'s house icon and chevrons, so
     walking from a category into a product changed the shape of the trail
     underneath you. */
  it("draws it with Crumb rather than its own markup", () => {
    expect(HEADER).toContain("<Crumb");
    expect(HEADER, "a hand-rolled trail is the thing that drifted")
      .not.toMatch(/<nav className="crumbs"/);
  });

  it("shows a house rather than the word for it", () => {
    // The word had to be translated four ways to say what the picture
    // says once -- and in the uppercase mono the trail is set in, "HOME"
    // was also the widest thing on the line.
    expect(HEADER, 'the crumb must not print t("home")')
      .not.toMatch(/>\{t\("home", lang\)\}</);
    expect(CRUMB, "the house itself").toMatch(/<path d="M3 11l9-8 9 8"/);
  });

  it("still names the home link for a screen reader", () => {
    // An icon with no accessible name is a link that announces as "link".
    expect(HEADER).toMatch(/homeLabel=\{t\("home", lang\)\}/);
    expect(CRUMB).toMatch(/aria-label=\{homeLabel\}/);
  });

  it("gives the trail a name of its own, not the home link's", () => {
    // They were the same string, so the nav landmark announced whatever
    // the home link did -- on /p/ that was "Catalog".
    expect(CRUMB).toMatch(/aria-label=\{navLabel \|\| homeLabel\}/);
    for (const f of [HEADER, PDP]) expect(f).toContain('navLabel={t("breadcrumb", lang)}');
  });
});

describe("the filters work with JavaScript switched off", () => {
  /* The whole point of the rail being links. On a phone on a slow
     connection in Dili this is the difference between a filter that works
     and one that does not, and it is the reason the drawer is opened by
     :target rather than by a click handler. */
  it("opens the drawer with an anchor, not a button", () => {
    expect(BAR).toMatch(/<a[^>]*className="[^"]*shop-filter-btn[^"]*"[^>]*href="#shop-filters"/);
    expect(BAR, "a button would need script").not.toMatch(/<button[^>]*shop-filter-btn/);
  });

  it("gives the rail the id that anchor names", () => {
    expect(RAIL).toContain('id="shop-filters"');
  });

  it("and the stylesheet opens it on :target", () => {
    expect(CSS).toMatch(/\.frail:target\{[^}]*visibility:visible/);
    expect(CSS).toMatch(/\.frail:target\{[^}]*transform:none/);
  });

  it("offers no checkbox or select to narrow by", () => {
    // One exception, and it is deliberate: price is typed, so it is a
    // form with a submit. Everything else is a link.
    expect(RAIL).not.toMatch(/type="checkbox"/);
    expect(RAIL).not.toMatch(/<select/);
  });
});

describe("a closed drawer is not in the way", () => {
  it("is hidden, not merely pushed off-screen", () => {
    /* A panel moved off-screen by a transform is still in the tab order
       and still read out: a shopper on a phone would tab from the sort
       control straight into a drawer nobody had opened. */
    const r = rule(".frail");
    expect(r).toMatch(/visibility:hidden/);
    expect(r).toMatch(/transform:translateX\(-10\d%\)/);
  });

  it("and is simply there on a desktop, where there is room", () => {
    const desktop = CSS.slice(CSS.indexOf("@media(min-width:1024px){\n  .frail{"));
    expect(desktop).toMatch(/\.frail\{[^}]*visibility:visible/);
    expect(desktop).toMatch(/\.frail\{[^}]*position:sticky/);
  });

  it("hides the button that opens it where the rail is already open", () => {
    expect(CSS).toMatch(/@media\(min-width:1024px\)\{ \.shop-filter-btn\{display:none\} \}/);
  });
});

describe("a filter link carries the rest of the catalogue with it", () => {
  it("keeps the other parameters", () => {
    // Picking a colour must not silently reset the sort.
    expect(RAIL).toMatch(/for \(const \[k, v\] of Object\.entries\(params\)\)/);
  });

  it("drops the page number", () => {
    // Page four of the old result set is rarely page four of the new one,
    // and is often past its end.
    expect(RAIL).toMatch(/k !== "page"/);
  });

  it("replaces the attribute filters rather than stacking them", () => {
    // The old a_* params are dropped and the new set written, or ticking
    // Black then un-ticking it would leave Black in the URL twice.
    expect(RAIL).toMatch(/!k\.startsWith\("a_"\)/);
    expect(RAIL).toMatch(/attributeFilterParams\(next\)/);
  });
});

describe("the aisles and their counts", () => {
  it("count the whole subtree, not the first level of it", () => {
    /* The tree is three deep in places -- Fitness & Wellness -> Sports
       Nutrition -> Protein -- and a count that stopped at the first level
       said 3 over a page that listed 11. */
    const cat = (id: string, parent: string | null): Category =>
      ({ id, name: id, slug: id, parent_id: parent, sort_order: 0 }) as Category;
    const tree = [cat("fitness", null), cat("nutrition", "fitness"), cat("protein", "nutrition")];
    const goods = [{ category_id: "fitness" }, { category_id: "nutrition" },
                   { category_id: "protein" }, { category_id: "protein" },
                   { category_id: "elsewhere" }];
    expect(countIn(tree, goods, "fitness")).toBe(4);
    expect(countIn(tree, goods, "nutrition")).toBe(3);
    expect(countIn(tree, goods, "protein")).toBe(2);
  });

  it("is the one count, used by both the cards and the rail", () => {
    // It lived twice, which is how the two came to disagree.
    for (const f of [HEADER, RAIL]) expect(f).toContain("countIn(cats, products,");
    expect(HEADER).not.toMatch(/function count\(/);
    expect(RAIL).not.toMatch(/function count\(/);
  });

  it("draws no card for an aisle holding nothing", () => {
    // A card promising 0 products is a door onto an empty room.
    expect(HEADER).toMatch(/\.filter\(\(r\) => r\.n > 0\)/);
  });

  it("names no aisle this file made up", () => {
    /* The reference's mock-up lists Fashion, Shoes, Accessories, Fitness,
       Sports Nutrition, Supplements and Health Food. Typing those in
       would give this shop an aisle it does not stock. */
    for (const invented of ["Shoes & Footwear", "Sports Nutrition", "Health Food"]) {
      expect(HEADER, invented).not.toContain(invented);
    }
  });
});

describe("a category page searches the aisle it is showing", () => {
  it("takes the whole subtree", () => {
    /* This walked one level -- the category and its direct children -- so
       the top of a three-deep aisle showed its own products and its
       children's and none of the grandchildren's, while the aisle card
       beside it counted them in. */
    expect(CATPAGE).toContain("descendantIds(cats, cat.id)");
    expect(CATPAGE).not.toMatch(/\[cat\.id, \.\.\.cats\.filter/);
  });

  it("builds its filters from that aisle, not from the whole shop", () => {
    // Shoes offer Shoe Size and Terrain; protein offers Flavour and
    // Weight. Neither should offer the other's.
    expect(CATPAGE).toMatch(/categoryIds\.includes\(p\.category_id/);
    expect(CATPAGE).toMatch(/filtersFor\(inAisle\.map/);
  });

  it("resolves them before the search, so the pager is right", () => {
    expect(CATPAGE).toMatch(/idsMatching\(active\)/);
    expect(CATPAGE).toMatch(/attributeIds,/);
  });
});

describe("the bar over the grid", () => {
  it("prints a floor, not a number the shop does not have", () => {
    expect(BAR).toMatch(/\$\{count\}\$\{countCapped \? "\+" : ""\}/);
  });

  it("is actually given the flag", () => {
    expect(LAYOUT).toMatch(/countCapped=\{result\.totalCapped\}/);
  });

  it("counts what is on, including the ones that are not attributes", () => {
    // Price and the in-stock tick moved into the rail; a badge that
    // counted only the attribute filters would say "none" with both on.
    expect(LAYOUT).toMatch(/params\.in === "1" \? 1 : 0/);
    expect(LAYOUT).toMatch(/params\.min \? 1 : 0/);
  });
});

describe("the empty result offers both ways out", () => {
  it("clears the filters when there are filters to clear", () => {
    expect(LAYOUT).toMatch(/onCount > 0 && \([\s\S]*?clearFilters/);
  });

  it("and always offers the whole catalogue", () => {
    expect(LAYOUT).toMatch(/shopEverything/);
  });
});

describe("the grid widens with the window", () => {
  it("is two up on a phone and four on a desktop", () => {
    expect(CSS).toMatch(/\.grid\{display:grid;grid-template-columns:repeat\(2,1fr\)/);
    expect(CSS).toMatch(/\.grid\{grid-template-columns:repeat\(3,1fr\)/);
    expect(CSS).toMatch(/\.grid\{grid-template-columns:repeat\(4,1fr\)\}/);
  });
});

describe("the headline is the shop's own line", () => {
  it("comes from Settings, with the word Catalog as the fallback", () => {
    // A shop that has not written a tagline gets a heading, not a blank.
    expect(SHOP).toMatch(/taglineOf\(settings, lang\) \|\| t\("catalog", lang\)/);
  });
});

/* ---------------------------------------------------------------- *
 * The two facts a card is allowed to state about stock and age.
 * ---------------------------------------------------------------- */

describe("a size is struck through only on evidence", () => {
  it("says nothing at all when the ledger has no rows for the product", () => {
    /* THE BUG THIS EXISTS TO PREVENT. Most of this catalogue predates
       per-size stock, so most products have no rows. Reading "no rows" as
       "no stock" would draw every size of every one of them struck
       through: a full shelf shown as sold out. */
    expect(cardSizes(["S", "M"], undefined))
      .toEqual([{ size: "S", inStock: null }, { size: "M", inStock: null }]);
  });

  it("answers from the rows when there are rows", () => {
    expect(cardSizes(["S", "M"], [{ size: "S", qty: 3 }]))
      .toEqual([{ size: "S", inStock: true }, { size: "M", inStock: false }]);
  });

  it("matches the shelf's spelling to the listing's", () => {
    // The ledger is keyed on the size as the shelf spells it, the listing
    // on the size as the seller typed it.
    expect(cardSizes(["M"], [{ size: " m ", qty: 2 }])[0].inStock).toBe(true);
  });

  it("adds up the rows for one size rather than taking the last", () => {
    /* Two shelves can hold the same size. Ordered so that OVERWRITING
       would answer zero: taking the last row would call a product with
       four in the back room sold out. */
    expect(cardSizes(["M"], [{ size: "M", qty: 4 }, { size: "M", qty: 0 }])[0].inStock).toBe(true);
  });

  it("stops at what fits on a card", () => {
    const many = ["1", "2", "3", "4", "5", "6", "7", "8"];
    expect(cardSizes(many, undefined)).toHaveLength(MAX_SIZES);
  });

  it("survives a product with no sizes at all", () => {
    expect(cardSizes(null, undefined)).toEqual([]);
  });
});

describe("NEW means new", () => {
  const now = new Date("2026-06-30T12:00:00Z");

  it("flags a listing posted this month", () => {
    expect(isNewProduct("2026-06-20T00:00:00Z", now)).toBe(true);
  });

  it("does not flag one from last season", () => {
    expect(isNewProduct("2026-01-02T00:00:00Z", now)).toBe(false);
  });

  it("lets go exactly on the boundary", () => {
    const old = new Date(now.getTime() - NEW_DAYS * 86400000).toISOString();
    expect(isNewProduct(old, now)).toBe(false);
  });

  it("does not flag a listing dated in the future", () => {
    // A clock problem, not a new arrival.
    expect(isNewProduct("2027-01-01T00:00:00Z", now)).toBe(false);
  });

  it("does not flag one it cannot read", () => {
    // The one thing worse than missing the flag is printing it on
    // everything, which is what a permissive parse would do.
    expect(isNewProduct(undefined, now)).toBe(false);
    expect(isNewProduct("", now)).toBe(false);
    expect(isNewProduct("not a date", now)).toBe(false);
  });

  it("is worked out on the server, not in the card", () => {
    /* ProductCard is a client component. Asking the clock inside it asks
       it on both sides of the boundary, and a card rendered either side of
       midnight mismatches. */
    expect(LAYOUT).toMatch(/isNewProduct\(p\.created_at, now\)/);
    expect(code("src/components/ProductCard.tsx")).not.toMatch(/new Date\(/);
  });
});
