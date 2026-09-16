import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  SELLER_AREAS, ALL_SELLER_SUBSECTIONS, ALL_GRANT_KEYS, GRANTABLE_AREAS,
  INCLUDED_SUBSECTIONS, ALWAYS_GRANTED,
  sellerAreaOf, sellerSubsectionForPath, sellerCanOpen, sellerCanOpenPath,
  visibleSellerSubsections, visibleSellerAreas,
  grantableSubsection, normalizeFeatures, featureSummary,
} from "@/lib/sellerFeatures";

const label = (k: string) => k;

describe("sellerSubsectionForPath", () => {
  it("puts every seller page in the tab it belongs to", () => {
    const at = (p: string) => sellerSubsectionForPath(p)?.key;
    expect(at("/seller/dashboard")).toBe("home.dashboard");
    expect(at("/seller/orders")).toBe("selling.orders");
    expect(at("/seller/today")).toBe("selling.today");
    expect(at("/seller/sales")).toBe("selling.report");
    expect(at("/seller/products")).toBe("catalog.products");
    expect(at("/seller/stock")).toBe("catalog.stock");
    expect(at("/seller/procurement")).toBe("purchasing.purchases");
    expect(at("/seller/settings")).toBe("settings.store");
  });

  it("covers the detail routes the navigation never lists", () => {
    expect(sellerSubsectionForPath("/seller/products/new")?.key).toBe("catalog.products");
    expect(sellerSubsectionForPath("/seller/products/abc-123")?.key).toBe("catalog.products");
  });

  it("puts the refusal screen in the area everybody holds", () => {
    // Otherwise being refused could refuse you, which is a loop.
    expect(sellerSubsectionForPath("/seller/no-access")?.key).toBe("home.dashboard");
    expect(sellerCanOpen([], "home.dashboard")).toBe(true);
  });

  it("matches on segments, not on string prefixes", () => {
    // /seller/salesman must not resolve to My sales.
    expect(sellerSubsectionForPath("/seller/salesman")).toBeNull();
    expect(sellerSubsectionForPath("/admin/sales")).toBeNull();
  });
});

/* ---------------------------------------------------------------------------
 * The two grants, and the difference between them
 * ------------------------------------------------------------------------ */

describe("an area grant and a tab grant are not the same grant", () => {
  it("opens every tab of an area when the AREA is held", () => {
    for (const sub of SELLER_AREAS.find((a) => a.key === "selling")!.subsections) {
      expect([sub.key, sellerCanOpen(["selling"], sub.key)]).toEqual([sub.key, true]);
    }
  });

  it("opens exactly one tab when only that TAB is held", () => {
    expect(sellerCanOpen(["selling.today"], "selling.today")).toBe(true);
    expect(sellerCanOpen(["selling.today"], "selling.report")).toBe(false);
  });

  it("carries a tab added later to the area grant, and not to the tab grant", () => {
    /* THE WHOLE REASON BOTH EXIST. Simulate next release's tab by asking
       about a key that is not in the catalogue yet. A store holding the
       area gets it; a store holding a list of today's tabs does not, which
       is what the owner was selling in each case. */
    expect(sellerCanOpen(["selling"], "selling.somethingNew")).toBe(true);
    expect(sellerCanOpen(["selling.today", "selling.report"], "selling.somethingNew")).toBe(false);
  });

  it("never lets one area's grant open another's tab", () => {
    expect(sellerCanOpen(["selling"], "catalog.stock")).toBe(false);
    expect(sellerCanOpen(["catalog"], "selling.today")).toBe(false);
  });
});

describe("what comes with the shop", () => {
  it("gives every store the included tabs, granted nothing at all", () => {
    for (const key of INCLUDED_SUBSECTIONS) {
      expect([key, sellerCanOpen([], key)]).toEqual([key, true]);
    }
  });

  it("holds the always-granted areas open for everyone", () => {
    for (const area of ALWAYS_GRANTED) {
      const tabs = visibleSellerSubsections([], area);
      expect([area, tabs.length > 0]).toEqual([area, true]);
    }
  });

  it("never offers an included tab as something to sell", () => {
    // A box that grants what the store already has teaches the owner the
    // checklist is decorative.
    for (const key of INCLUDED_SUBSECTIONS) {
      expect([key, ALL_GRANT_KEYS.includes(key)]).toEqual([key, false]);
    }
  });

  it("does not offer an area whose every tab is free", () => {
    // Settings holds one tab and it comes free, so the area is not a
    // checkbox -- ticking it would change no permission.
    expect(GRANTABLE_AREAS).not.toContain("settings");
    expect(GRANTABLE_AREAS).not.toContain("home");
    expect([...GRANTABLE_AREAS]).toEqual(["selling", "catalog", "purchasing"]);
  });
});

/* ---------------------------------------------------------------------------
 * The keys that were already in the database
 * ------------------------------------------------------------------------ */

describe("the four old flat keys", () => {
  it("becomes the TAB it named, never the area of the same name", () => {
    /* THE ONE THAT WOULD HAVE WIDENED EVERYTHING. Old "sales" named the My
       sales PAGE; the Sales AREA did not exist. Reading it as the area
       would hand every store that had bought one report the whole of Sales
       -- and every tab added to Sales afterwards -- with nothing on any
       screen saying it had happened. */
    expect(normalizeFeatures(["sales"])).toEqual(["selling.report"]);
    expect(normalizeFeatures(["sales"])).not.toContain("selling");
  });

  it("translates the other three to their tabs", () => {
    expect(normalizeFeatures(["today"])).toEqual(["selling.today"]);
    expect(normalizeFeatures(["stock"])).toEqual(["catalog.stock"]);
    expect(normalizeFeatures(["procurement"])).toEqual(["purchasing.purchases"]);
  });

  it("leaves a migrated store able to open exactly what it could before", () => {
    const before = ["stock", "today"];
    const after = normalizeFeatures(before);
    expect(sellerCanOpen(after, "catalog.stock")).toBe(true);
    expect(sellerCanOpen(after, "selling.today")).toBe(true);
    // And nothing it could not open before.
    expect(sellerCanOpen(after, "selling.report")).toBe(false);
    expect(sellerCanOpen(after, "purchasing.purchases")).toBe(false);
  });
});

describe("normalizeFeatures", () => {
  it("reads a missing column as nothing granted", () => {
    // A shop with this code and not yet the SQL. Every sellable tab is a
    // screen that store never had, so fail closed.
    expect(normalizeFeatures(undefined)).toEqual([]);
    expect(normalizeFeatures(null)).toEqual([]);
    expect(normalizeFeatures("sales")).toEqual([]);
  });

  it("drops a key from a feature the app no longer has", () => {
    expect(normalizeFeatures(["selling.today", "wishlists"])).toEqual(["selling.today"]);
  });

  it("drops an included key, which is not a permission", () => {
    expect(normalizeFeatures(["selling.orders", "settings.store"])).toEqual([]);
  });

  it("drops a tab sitting beside its own area", () => {
    /* Keeping both would make the two grants indistinguishable the moment
       a new tab appeared: ["selling","selling.today"] would have to mean
       either "everything in Sales" or "just Today". The area wins. */
    expect(normalizeFeatures(["selling", "selling.today"])).toEqual(["selling"]);
    expect(sellerCanOpen(normalizeFeatures(["selling", "selling.today"]), "selling.report")).toBe(true);
  });

  it("de-duplicates and orders by the catalogue, not by click order", () => {
    // Two stores with the same access read identically, on screen and in
    // the database.
    expect(normalizeFeatures(["catalog.stock", "selling.today", "catalog.stock"]))
      .toEqual(normalizeFeatures(["selling.today", "catalog.stock"]));
  });
});

/* ---------------------------------------------------------------------------
 * What the nav and the row show
 * ------------------------------------------------------------------------ */

describe("the navigation", () => {
  it("shows a store with nothing granted only what comes free", () => {
    expect(visibleSellerAreas([]).map((a) => a.key)).toEqual(["home", "selling", "catalog", "settings"]);
    expect(visibleSellerSubsections([], "selling").map((s) => s.key)).toEqual(["selling.orders"]);
    expect(visibleSellerSubsections([], "purchasing")).toEqual([]);
  });

  it("adds the area once it is granted", () => {
    expect(visibleSellerAreas(["purchasing"]).map((a) => a.key))
      .toContain("purchasing");
    expect(visibleSellerSubsections(["selling.today"], "selling").map((s) => s.key))
      .toEqual(["selling.orders", "selling.today"]);
  });

  it("shows the tabs of the area the store is standing in", () => {
    /* WHAT SellerNav COMPUTES, without rendering it. The component groups
       the areas, finds the one owning the current path, and draws its tabs
       underneath -- and only when there is more than one, since a strip of
       one repeats the heading directly above it.

       Worth pinning here because the preview could not show it: on a page
       that is not a seller route the active area falls back to Home, which
       has a single tab, so the strip is correctly absent and a screenshot
       proves nothing either way. */
    const stripFor = (features: string[], pathname: string) => {
      const sub = sellerSubsectionForPath(pathname);
      const area = sub ? sellerAreaOf(sub.key) : null;
      const tabs = area ? visibleSellerSubsections(features, area) : [];
      return tabs.length > 1 ? tabs.map((x) => x.key) : [];
    };

    // Standing in Sales with the whole area: all three tabs.
    expect(stripFor(["selling"], "/seller/today"))
      .toEqual(["selling.orders", "selling.today", "selling.report"]);
    // With only Today bought: the free tab and that one.
    expect(stripFor(["selling.today"], "/seller/today"))
      .toEqual(["selling.orders", "selling.today"]);
    // With nothing bought, Sales holds one tab, so no strip at all.
    expect(stripFor([], "/seller/orders")).toEqual([]);
    // Purchasing has a single tab however it was granted.
    expect(stripFor(["purchasing"], "/seller/procurement")).toEqual([]);
    // A detail route keeps its area's strip.
    expect(stripFor(["catalog"], "/seller/products/new"))
      .toEqual(["catalog.products", "catalog.stock"]);
  });

  it("refuses a URL typed straight in", () => {
    // The nav hiding a tab is a courtesy; this is the same rule the page
    // guard applies.
    expect(sellerCanOpenPath([], "/seller/stock")).toBe(false);
    expect(sellerCanOpenPath(["catalog.stock"], "/seller/stock")).toBe(true);
    expect(sellerCanOpenPath([], "/seller/orders")).toBe(true);
    // Not a seller page at all.
    expect(sellerCanOpenPath(["selling"], "/admin/sales")).toBe(false);
  });
});

describe("featureSummary", () => {
  it("says nothing extra when nothing is granted", () => {
    expect(featureSummary([], label, "none", "all")).toBe("none");
  });

  it("names a whole area plainly and a part area with a count", () => {
    // Those are different permissions, and a row showing them the same way
    // would be the screen misreporting what a store is paying for.
    expect(featureSummary(["selling"], label, "none", "all")).toBe("navSales");
    expect(featureSummary(["selling.today"], label, "none", "all")).toBe("navSales (1/2)");
  });

  it("says all only when every grantable area is held whole", () => {
    expect(featureSummary([...GRANTABLE_AREAS], label, "none", "all")).toBe("all");
    // Every TAB is not every AREA -- see the grant tests above.
    const everyTab = ALL_SELLER_SUBSECTIONS.filter(grantableSubsection).map((s) => s.key);
    expect(featureSummary(everyTab, label, "none", "all")).not.toBe("all");
  });
});

/* ---------------------------------------------------------------------------
 * The catalogue itself, and the database that has to agree with it
 * ------------------------------------------------------------------------ */

describe("the area list", () => {
  it("has no duplicate keys", () => {
    const keys = ALL_SELLER_SUBSECTIONS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("namespaces every tab on an area that exists", () => {
    for (const sub of ALL_SELLER_SUBSECTIONS) {
      expect([sub.key, sellerAreaOf(sub.key)]).toEqual([sub.key, sub.key.split(".")[0]]);
    }
  });

  it("names a translation key that actually exists", () => {
    /* t() falls back to the key itself when it is missing, so a typo does
       not throw -- it renders "sales" in lowercase where "Sales" belongs,
       on a screen the owner uses to sell things. That is how this was
       found, and only in a screenshot. */
    const i18n = fs.readFileSync(
      path.join(process.cwd(), "src", "lib", "i18n.ts"), "utf8");
    const has = (key: string) => new RegExp("^\\s+" + key + ":", "m").test(i18n);
    for (const area of SELLER_AREAS) {
      expect([area.key, has(area.labelKey)]).toEqual([area.key, true]);
    }
    for (const sub of ALL_SELLER_SUBSECTIONS) {
      expect([sub.key, has(sub.labelKey), has(sub.blurbKey)])
        .toEqual([sub.key, true, true]);
    }
  });

  it("gives every tab a label, a blurb and at least one path", () => {
    // The owner is selling these; a blank line under a checkbox is a
    // feature nobody can describe to a seller.
    for (const sub of ALL_SELLER_SUBSECTIONS) {
      expect([sub.key, !!sub.labelKey, !!sub.blurbKey, sub.paths.length > 0])
        .toEqual([sub.key, true, true, true]);
    }
  });

  it("gives every seller page in the app a tab", () => {
    /* A page nobody's tab claims is a page the nav cannot show and the
       guard cannot name. Read from the filesystem so adding a route
       without adding it here fails rather than going unnoticed. */
    const dir = path.join(process.cwd(), "src", "app", "seller");
    const routes: string[] = [];
    const walk = (d: string, url: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const next = path.join(d, e.name);
        // [id] and the like are detail routes, covered by their parent.
        const seg = e.name.startsWith("[") ? "" : "/" + e.name;
        if (fs.existsSync(path.join(next, "page.tsx")) && seg) routes.push(url + seg);
        walk(next, url + seg);
      }
    };
    walk(dir, "/seller");
    // The ways in and out are not features; nothing guards them.
    const exempt = new Set(["/seller/login", "/seller/register"]);
    const orphans = routes.filter(
      (r) => !exempt.has(r) && !sellerSubsectionForPath(r));
    expect(orphans).toEqual([]);
  });
});

describe("the database agrees with the app about what may be sold", () => {
  /* The check constraint on sellers.features is the last word on what may
   * be stored. If the app offers a key the database refuses, saving fails
   * in the owner's face while they are trying to sell something. If the
   * database allows one the app does not recognise, the row reads as a paid
   * feature and opens nothing.
   *
   * Neither is caught by any other test, because the SQL is text to the
   * TypeScript and the TypeScript is invisible to the SQL. This reads both. */
  const SQL = fs.readFileSync(
    path.join(process.cwd(), "supabase/seller-areas.sql"), "utf8");

  function keysInConstraint(): string[] {
    const body = SQL.slice(SQL.indexOf("features <@ array["), SQL.indexOf("]::text[]"));
    return [...body.matchAll(/'([a-z.]+)'/g)].map((m) => m[1]);
  }

  it("names the same keys, in both directions", () => {
    expect([...keysInConstraint()].sort()).toEqual([...ALL_GRANT_KEYS].sort());
  });

  it("stores no key for what comes free", () => {
    for (const key of INCLUDED_SUBSECTIONS) {
      expect(keysInConstraint()).not.toContain(key);
    }
    expect(keysInConstraint()).not.toContain("settings");
  });

  it("migrates each old key to a tab, never to an area", () => {
    /* Read from the migration itself. Mapping 'sales' to the area rather
       than to sales.report is the one edit here that would widen every
       store's access silently, and it would look like a tidy-up. */
    const mapping = SQL.slice(SQL.indexOf("set features"), SQL.indexOf("where exists"));
    expect(mapping).toMatch(/when 'sales'\s+then 'selling\.report'/);
    expect(mapping).toMatch(/when 'today'\s+then 'selling\.today'/);
    expect(mapping).toMatch(/when 'stock'\s+then 'catalog\.stock'/);
    expect(mapping).toMatch(/when 'procurement'\s+then 'purchasing\.purchases'/);
  });

  it("drops the constraint it replaces, so the two cannot both apply", () => {
    // A check constraint is enforced whenever it is present: leave the old
    // narrow one and every new key would be rejected while the new one
    // allowed it.
    expect(SQL).toMatch(/drop constraint if exists sellers_features_check/);
    expect(SQL).toMatch(/add constraint sellers_area_keys_check/);
  });
});

describe("every page's guard names its own tab", () => {
  it("never guards on an area, which would be wider than the page", () => {
    /* A page naming its area would open for anybody holding any tab in
       that area -- My sales reachable by a store that only bought Today.
       Read from the pages themselves so a new one cannot quietly do it. */
    const dir = path.join(process.cwd(), "src", "app", "seller");
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (e.name !== "page.tsx") continue;
        const body = fs.readFileSync(full, "utf8");
        const m = /requireSellerFeature\(\s*"([a-z.]+)"/.exec(body);
        if (m && !m[1].includes(".")) {
          offenders.push(`${path.relative(process.cwd(), full)}: ${m[1]}`);
        }
      }
    };
    walk(dir);
    expect(offenders).toEqual([]);
  });

  it("guards each page with the tab that owns its own path", () => {
    const cases: [string, string][] = [
      ["src/app/seller/today/page.tsx", "selling.today"],
      ["src/app/seller/sales/page.tsx", "selling.report"],
      ["src/app/seller/stock/page.tsx", "catalog.stock"],
      ["src/app/seller/procurement/page.tsx", "purchasing.purchases"],
    ];
    for (const [file, key] of cases) {
      const body = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      const m = /requireSellerFeature\(\s*"([a-z.]+)"/.exec(body);
      expect([file, m?.[1]]).toEqual([file, key]);
    }
  });
});
