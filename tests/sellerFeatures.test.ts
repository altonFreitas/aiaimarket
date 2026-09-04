import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  SELLER_FEATURES, ALL_FEATURES, INCLUDED_FEATURES, SELLABLE_FEATURES,
  featureForPath, sellerCanUse, normalizeFeatures, featureSummary,
} from "@/lib/sellerFeatures";

describe("featureForPath", () => {
  it("puts every seller page in the feature its tab lives under", () => {
    expect(featureForPath("/seller/dashboard")).toBe("dashboard");
    expect(featureForPath("/seller/products")).toBe("products");
    expect(featureForPath("/seller/orders")).toBe("orders");
    expect(featureForPath("/seller/settings")).toBe("settings");
    expect(featureForPath("/seller/sales")).toBe("sales");
    expect(featureForPath("/seller/stock")).toBe("stock");
  });

  it("covers the detail routes the navigation never lists", () => {
    expect(featureForPath("/seller/products/new")).toBe("products");
    expect(featureForPath("/seller/products/abc-123")).toBe("products");
  });

  it("puts the refusal screen in the one feature everybody holds", () => {
    // Otherwise being refused could refuse you, which is a loop.
    expect(featureForPath("/seller/no-access")).toBe("dashboard");
    expect(sellerCanUse([], "dashboard")).toBe(true);
  });

  it("matches on segments, not on string prefixes", () => {
    // /seller/salesman is not inside /seller/sales. Nothing is called that
    // today; the point is that adding it later cannot silently inherit
    // another feature's permission.
    expect(featureForPath("/seller/salesman")).toBeNull();
    expect(featureForPath("/seller/stockroom")).toBeNull();
  });

  it("ignores a query string and a trailing slash", () => {
    expect(featureForPath("/seller/sales?from=2026-01")).toBe("sales");
    expect(featureForPath("/seller/sales/")).toBe("sales");
  });

  it("returns null for anything that is not a seller page", () => {
    expect(featureForPath("/admin/sales")).toBeNull();
    expect(featureForPath("/seller")).toBeNull();
    expect(featureForPath("/")).toBeNull();
  });
});

describe("sellerCanUse", () => {
  it("gives every store the four screens that make it a store", () => {
    for (const key of INCLUDED_FEATURES) {
      expect([key, sellerCanUse([], key)]).toEqual([key, true]);
    }
  });

  it("refuses everything else until it is granted", () => {
    for (const key of SELLABLE_FEATURES) {
      expect([key, sellerCanUse([], key)]).toEqual([key, false]);
    }
  });

  it("grants exactly what was ticked, and nothing next to it", () => {
    expect(sellerCanUse(["sales"], "sales")).toBe(true);
    expect(sellerCanUse(["sales"], "stock")).toBe(false);
    expect(sellerCanUse(["sales", "stock"], "stock")).toBe(true);
  });

  it("has no all-sellers switch", () => {
    // The whole point is that stores differ. If a "everyone gets it" flag
    // is ever added, this is where it has to be explained.
    const source = fs.readFileSync(
      path.join(__dirname, "..", "src", "lib", "sellerFeatures.ts"), "utf8");
    expect(/return features\.includes\(key\)/.test(source)).toBe(true);
  });
});

describe("normalizeFeatures", () => {
  it("reads a column that is not there yet as nothing extra", () => {
    // A shop with this code and not yet supabase/seller-features.sql. It
    // must fail CLOSED: failing open would hand every store on the
    // marketplace the thing the owner is selling.
    expect(normalizeFeatures(undefined)).toEqual([]);
    expect(normalizeFeatures(null)).toEqual([]);
  });

  it("drops a key the app does not recognise", () => {
    // A leftover from a removed feature, or a typo written straight into
    // the database. Either would otherwise read as a granted permission.
    expect(normalizeFeatures(["sales", "procurement", "nonsense"])).toEqual(["sales"]);
  });

  it("never lets an included screen be stored as a grant", () => {
    // "products" in the column would look like something the owner had
    // given, and taking it away would then read as a downgrade.
    expect(normalizeFeatures(["products", "orders", "sales"])).toEqual(["sales"]);
  });

  it("removes duplicates", () => {
    expect(normalizeFeatures(["sales", "sales"])).toEqual(["sales"]);
  });

  it("stores in catalogue order, not click order", () => {
    // So two stores with the same access read identically on screen and in
    // the database, and a diff of the column means something changed.
    expect(normalizeFeatures(["stock", "sales"])).toEqual(["sales", "stock"]);
    expect(normalizeFeatures(["sales", "stock"])).toEqual(["sales", "stock"]);
  });

  it("ignores anything that is not an array of strings", () => {
    expect(normalizeFeatures("sales")).toEqual([]);
    expect(normalizeFeatures(42)).toEqual([]);
    expect(normalizeFeatures([1, true, null])).toEqual([]);
  });
});

describe("featureSummary", () => {
  const label = (k: string) => ({ sellerSales: "My sales", sellerStock: "My stock" }[k] ?? k);
  const sum = (f: string[]) => featureSummary(f, label, "Nothing extra", "Everything");

  it("says so when a store has only the included screens", () => {
    expect(sum([])).toBe("Nothing extra");
  });

  it("names what was granted", () => {
    expect(sum(["sales"])).toBe("My sales");
    expect(sum(["sales", "stock"])).toBe("Everything");
  });

  it("never lists the included screens, which nobody chose", () => {
    expect(sum(["products", "sales"])).toBe("My sales");
  });
});

describe("the catalogue itself", () => {
  it("has no duplicate keys", () => {
    expect(new Set(ALL_FEATURES).size).toBe(ALL_FEATURES.length);
  });

  it("splits cleanly into included and sellable", () => {
    expect([...INCLUDED_FEATURES, ...SELLABLE_FEATURES].sort())
      .toEqual([...ALL_FEATURES].sort());
    for (const k of INCLUDED_FEATURES) expect(SELLABLE_FEATURES).not.toContain(k);
  });

  it("gives every feature at least one route", () => {
    for (const f of SELLER_FEATURES) {
      expect([f.key, f.paths.length > 0]).toEqual([f.key, true]);
      for (const p of f.paths) {
        expect([f.key, p.startsWith("/seller/")]).toEqual([f.key, true]);
      }
    }
  });

  it("has something to sell at all", () => {
    // A catalogue with nothing sellable makes every screen in this feature
    // decorative, and this test would otherwise pass forever.
    expect(SELLABLE_FEATURES.length).toBeGreaterThan(0);
  });

  it("keeps the SQL constraint in step with the catalogue", () => {
    // supabase/seller-features.sql restricts the column to the sellable
    // keys. If they drift, the owner ticks a box the database refuses --
    // and the failure lands at save time, on a screen, in front of them.
    const sql = fs.readFileSync(
      path.join(__dirname, "..", "supabase", "seller-features.sql"), "utf8");
    const m = /features <@ array\[([^\]]+)\]/.exec(sql);
    expect(m).not.toBeNull();
    const inSql = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(inSql).toEqual([...SELLABLE_FEATURES].sort());
  });
});

/* ---------------------------------------------------------------------
 * Structural checks: the ones that keep working after we stop looking.
 * ------------------------------------------------------------------- */

const ROOT = path.join(__dirname, "..");
const SELLER_DIR = path.join(ROOT, "src", "app", "seller");

function sellerPages(dir = SELLER_DIR, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sellerPages(full, out);
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

/** The file with its comments removed.
 *
 * Every scan below asks "does this file CALL something". Prose is not a
 * call: /seller/no-access explains in its own header comment where
 * requireSellerFeature() sends people, and the first version of these
 * tests read that sentence as the page guarding itself -- reporting the
 * one page that must never be guarded as over-guarded. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/([^:])\/\/.*$/gm, "$1");
}

/** .../seller/products/[id]/page.tsx -> /seller/products/[id] */
function routeOf(file: string): string {
  const rel = path.relative(path.join(SELLER_DIR, ".."), path.dirname(file));
  return "/" + rel.split(path.sep).join("/");
}

describe("every seller page is accounted for", () => {
  const pages = sellerPages();

  it("finds the seller pages at all", () => {
    // Guards against this whole block silently passing on an empty list.
    expect(pages.length).toBeGreaterThan(5);
  });

  /** Pages that are deliberately outside the feature map: the ways IN,
   * which somebody reaches before they are a seller at all. */
  const OPEN = new Set(["/seller/login", "/seller/register"]);

  it("maps every page to a feature", () => {
    const unmapped: string[] = [];
    for (const file of pages) {
      const route = routeOf(file);
      if (OPEN.has(route)) continue;
      const probe = route.replace(/\[[^\]]+\]/g, "x");
      if (featureForPath(probe) === null) unmapped.push(route);
    }
    // A page nobody assigned to a feature is reachable by every store,
    // because the guard has nothing to check it against.
    expect(unmapped).toEqual([]);
  });

  it("guards every page that belongs to a sellable feature", () => {
    // The lock is one line at the top of the page, which is exactly the
    // kind of line left out of the next new one.
    const missing: string[] = [];
    for (const file of pages) {
      const route = routeOf(file);
      if (OPEN.has(route)) continue;
      const feature = featureForPath(route.replace(/\[[^\]]+\]/g, "x"));
      if (!feature || INCLUDED_FEATURES.includes(feature)) continue;
      const src = code(fs.readFileSync(file, "utf8"));
      if (!/requireSellerFeature\s*\(/.test(src)) missing.push(route);
    }
    expect(missing).toEqual([]);
  });

  it("guards each page with the feature its own route belongs to", () => {
    // A guard naming the WRONG feature is worse than none: it looks locked
    // and opens for the wrong stores.
    const wrong: string[] = [];
    for (const file of pages) {
      const route = routeOf(file);
      const src = code(fs.readFileSync(file, "utf8"));
      const m = /requireSellerFeature\s*\(\s*["']([a-z]+)["']/.exec(src);
      if (!m) continue;
      const expected = featureForPath(route.replace(/\[[^\]]+\]/g, "x"));
      if (m[1] !== expected) {
        wrong.push(`${route}: guards "${m[1]}", belongs to "${expected}"`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("never guards an included page, which would lock out every store", () => {
    const overGuarded: string[] = [];
    for (const file of pages) {
      const route = routeOf(file);
      const feature = featureForPath(route.replace(/\[[^\]]+\]/g, "x"));
      if (!feature || !INCLUDED_FEATURES.includes(feature)) continue;
      const src = code(fs.readFileSync(file, "utf8"));
      if (/requireSellerFeature\s*\(/.test(src)) overGuarded.push(route);
    }
    expect(overGuarded).toEqual([]);
  });
});

describe("the seller navigation offers no door that refuses", () => {
  const NAV = code(fs.readFileSync(
    path.join(ROOT, "src", "components", "seller", "SellerNav.tsx"), "utf8"));

  it("builds its tabs from the catalogue rather than a list of its own", () => {
    // A hand-written tab list is how a store ends up shown a tab that the
    // page then bounces them off -- which reads as the shop being broken.
    expect(NAV).toMatch(/SELLER_FEATURES\.filter\(/);
    expect(NAV).toMatch(/sellerCanUse\(/);
  });

  it("takes what the store holds from the server, not from the browser", () => {
    expect(NAV).toMatch(/features: readonly string\[\]/);
    const LAYOUT = fs.readFileSync(
      path.join(ROOT, "src", "app", "seller", "layout.tsx"), "utf8");
    expect(LAYOUT).toMatch(/normalizeFeatures\(/);
  });
});

describe("granting is the platform's to do", () => {
  const ACTION = code(fs.readFileSync(
    path.join(ROOT, "src", "lib", "actions", "sellers-admin.ts"), "utf8"));

  it("requires an admin before writing the column", () => {
    const fn = ACTION.slice(ACTION.indexOf("export async function setSellerFeatures"));
    expect(/requireAdmin\s*\(/.test(fn)).toBe(true);
  });

  it("filters the list instead of trusting the request body", () => {
    // A server action is a public HTTP endpoint; the argument is whatever
    // the caller sent. Without this a crafted request writes any string
    // into the column, including a key from a future version of the app.
    const fn = ACTION.slice(ACTION.indexOf("export async function setSellerFeatures"));
    expect(/normalizeFeatures\s*\(\s*features\s*\)/.test(fn)).toBe(true);
    expect(/update\(\{\s*features:\s*clean\s*\}\)/.test(fn)).toBe(true);
  });
});
