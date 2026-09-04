import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ADMIN_SECTIONS, ALL_SECTIONS, GRANTABLE_SECTIONS,
  sectionForPath, canSee, canWrite, normalizeRole, normalizeSections,
  type Access, type SectionKey,
} from "@/lib/adminSections";

const staff = (role: "admin" | "reader", sections: string[]): Access =>
  ({ kind: "staff", role, sections });
const owner: Access = { kind: "owner", role: "admin", sections: [] };

describe("sectionForPath", () => {
  it("puts every nav page in the section its tab lives under", () => {
    expect(sectionForPath("/admin")).toBe("home");
    expect(sectionForPath("/admin/sales")).toBe("sales");
    expect(sectionForPath("/admin/orders")).toBe("sales");
    expect(sectionForPath("/admin/notifications")).toBe("sales");
    expect(sectionForPath("/admin/products")).toBe("catalog");
    expect(sectionForPath("/admin/stock")).toBe("catalog");
    expect(sectionForPath("/admin/cats")).toBe("catalog");
    expect(sectionForPath("/admin/demand")).toBe("catalog");
    expect(sectionForPath("/admin/procurement")).toBe("procurement");
    expect(sectionForPath("/admin/sellers")).toBe("sellers");
    expect(sectionForPath("/admin/payouts")).toBe("sellers");
    expect(sectionForPath("/admin/hero")).toBe("storefront");
    expect(sectionForPath("/admin/promotions")).toBe("storefront");
    expect(sectionForPath("/admin/settings")).toBe("settings");
    expect(sectionForPath("/admin/users")).toBe("settings");
    expect(sectionForPath("/admin/activity")).toBe("settings");
  });

  it("resolves the two pages that sit under a different section's URL", () => {
    // Both live beneath /admin/sales, and neither belongs to Sales.
    expect(sectionForPath("/admin/sales/costs")).toBe("catalog");
    expect(sectionForPath("/admin/sales/targets")).toBe("settings");
  });

  it("covers the detail pages the navigation never lists", () => {
    expect(sectionForPath("/admin/o/2f8c1b90-0000-4000-8000-000000000000")).toBe("sales");
    expect(sectionForPath("/admin/p/2f8c1b90-0000-4000-8000-000000000000")).toBe("catalog");
    expect(sectionForPath("/admin/procurement/po/new")).toBe("procurement");
    expect(sectionForPath("/admin/procurement/po/abc")).toBe("procurement");
    expect(sectionForPath("/admin/procurement/suppliers")).toBe("procurement");
    expect(sectionForPath("/admin/procurement/reorder")).toBe("procurement");
  });

  it("does not let /admin/p swallow the pages that merely start with p", () => {
    // The bug this guards: a plain startsWith would file payouts and
    // procurement under the product-detail route, handing the Sellers
    // section to anyone holding Catalog.
    expect(sectionForPath("/admin/payouts")).toBe("sellers");
    expect(sectionForPath("/admin/products")).toBe("catalog");
    expect(sectionForPath("/admin/procurement")).toBe("procurement");
  });

  it("treats /admin as an exact match, never as a prefix", () => {
    // Otherwise Home would contain the entire admin and every reader
    // would hold every section.
    expect(sectionForPath("/admin")).toBe("home");
    expect(sectionForPath("/admin/")).toBe("home");
    expect(sectionForPath("/admin/settings")).not.toBe("home");
  });

  it("ignores a query string or fragment", () => {
    expect(sectionForPath("/admin/sales?range=week")).toBe("sales");
    expect(sectionForPath("/admin/activity#top")).toBe("settings");
  });

  it("returns null for anything that is not an admin page", () => {
    expect(sectionForPath("/")).toBeNull();
    expect(sectionForPath("/shop")).toBeNull();
    expect(sectionForPath("/seller/dashboard")).toBeNull();
    // Not an admin page, and importantly not Home either.
    expect(sectionForPath("/administrators")).toBeNull();
  });
});

describe("canSee", () => {
  it("gives the owner everything, with no sections stored at all", () => {
    for (const key of ALL_SECTIONS) expect(canSee(owner, key)).toBe(true);
  });

  it("gives staff only what is ticked", () => {
    const a = staff("admin", ["procurement"]);
    expect(canSee(a, "procurement")).toBe(true);
    expect(canSee(a, "sales")).toBe(false);
    expect(canSee(a, "settings")).toBe(false);
  });

  it("always lets staff reach home, so an account can never land nowhere", () => {
    expect(canSee(staff("reader", []), "home")).toBe(true);
  });

  it("grants nothing else to an account with no sections", () => {
    const none = staff("admin", []);
    for (const key of GRANTABLE_SECTIONS) expect(canSee(none, key)).toBe(false);
  });
});

describe("canWrite", () => {
  it("is true for the owner and for an admin", () => {
    expect(canWrite(owner)).toBe(true);
    expect(canWrite(staff("admin", []))).toBe(true);
  });

  it("is false for a reader, however many sections they hold", () => {
    expect(canWrite(staff("reader", [...ALL_SECTIONS]))).toBe(false);
  });
});

describe("normalizeRole", () => {
  it("keeps admin", () => {
    expect(normalizeRole("admin")).toBe("admin");
  });

  it("reads anything else as a reader", () => {
    // Fail closed: a null column, a typo, or a role from a later version
    // of the app must be the least privilege, never the most.
    for (const v of [null, undefined, "", "Admin", "ADMIN", "owner", "superuser", 1, {}]) {
      expect(normalizeRole(v)).toBe("reader");
    }
  });
});

describe("normalizeSections", () => {
  it("keeps the keys it recognises, in order, without duplicates", () => {
    expect(normalizeSections(["sales", "catalog", "sales"])).toEqual(["sales", "catalog"]);
  });

  it("drops anything it does not recognise", () => {
    expect(normalizeSections(["sales", "warehouse", "", null, 7])).toEqual(["sales"]);
  });

  it("returns nothing for a value that is not a list", () => {
    // A null column must not become "every section".
    expect(normalizeSections(null)).toEqual([]);
    expect(normalizeSections("sales")).toEqual([]);
    expect(normalizeSections(undefined)).toEqual([]);
  });
});

/* ---------------------------------------------------------------------
 * Structural checks. These are the ones that keep working after we stop
 * looking at this file.
 * ------------------------------------------------------------------- */

const ADMIN_DIR = path.join(__dirname, "..", "src", "app", "admin");

function adminPages(dir = ADMIN_DIR, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) adminPages(full, out);
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

/** The route a page.tsx file serves, e.g. .../admin/o/[id]/page.tsx -> /admin/o/[id] */
function routeOf(file: string): string {
  const rel = path.relative(path.join(ADMIN_DIR, ".."), path.dirname(file));
  return "/" + rel.split(path.sep).join("/");
}

describe("every admin page is accounted for", () => {
  const pages = adminPages();

  it("finds the admin pages at all (guards against this test silently passing)", () => {
    expect(pages.length).toBeGreaterThan(20);
  });

  it("maps every page in the app to a section", () => {
    const unmapped: string[] = [];
    for (const file of pages) {
      const route = routeOf(file);
      if (route === "/admin/login") continue;
      // A dynamic segment stands in for a real id; either resolves the
      // same way, since matching is on segments.
      const probe = route.replace(/\[[^\]]+\]/g, "x");
      if (sectionForPath(probe) === null) unmapped.push(route);
    }
    // A page nobody assigned to a section would be reachable by anyone
    // who can sign in, because the guard has nothing to check it against.
    expect(unmapped).toEqual([]);
  });

  it("guards each page with the section that page's route belongs to", () => {
    // A guard with the WRONG section is worse than none: it looks locked
    // and hands the page to the wrong people. This reads the argument out
    // of each file and checks it against the map.
    const wrong: string[] = [];
    for (const file of pages) {
      const route = routeOf(file);
      if (route === "/admin/login") continue;
      const src = fs.readFileSync(file, "utf8");
      const m = /requireSection\s*\(\s*["']([a-z]+)["']/.exec(src);
      if (!m) continue; // reported by the test below
      const expected = sectionForPath(route.replace(/\[[^\]]+\]/g, "x"));
      if (m[1] !== expected) wrong.push(`${route}: guards "${m[1]}", belongs to "${expected}"`);
    }
    expect(wrong).toEqual([]);
  });

  it("guards every page with requireSection, or names it as deliberately open", () => {
    // The lock is one line at the top of each page, which is exactly the
    // kind of line that gets left out of the next new page. This is what
    // notices.
    const OPEN = new Set(["/admin/login"]);
    const missing: string[] = [];
    for (const file of pages) {
      const route = routeOf(file);
      if (OPEN.has(route)) continue;
      const src = fs.readFileSync(file, "utf8");
      if (!/requireSection\s*\(/.test(src)) missing.push(route);
    }
    expect(missing).toEqual([]);
  });
});

describe("the sign-in page gets no navigation", () => {
  /* A layout is not re-rendered when the router moves between two pages
   * that share it. /admin/login shares the admin layout with every other
   * admin page, so when a session expired and the middleware sent the tab
   * to the login screen, the nav the layout had already produced stayed
   * mounted above the sign-in form until somebody reloaded by hand.
   *
   * The layout's own check is correct and is not sufficient; the component
   * has to refuse as well. */
  it("returns null on the login route", () => {
    const NAV = fs.readFileSync(
      path.join(__dirname, "..", "src", "components", "admin", "AdminNav.tsx"), "utf8");
    expect(NAV).toMatch(/pathname === "\/admin\/login"\)\s*return null/);
  });

  it("does the same for the seller's ways in", () => {
    const NAV = fs.readFileSync(
      path.join(__dirname, "..", "src", "components", "seller", "SellerNav.tsx"), "utf8");
    expect(NAV).toMatch(/pathname === "\/seller\/login"/);
    expect(NAV).toMatch(/return null/);
  });
});

describe("the navigation offers no door that refuses", () => {
  const NAV = fs.readFileSync(
    path.join(__dirname, "..", "src", "components", "admin", "AdminNav.tsx"), "utf8");

  it("keeps /admin/users out of a non-owner's tabs", () => {
    // The page is the owner's alone. A tab everyone can see and nobody but
    // the owner can open is a broken link with a label on it -- and that is
    // exactly what it was: staff holding Settings were shown the tab and
    // then bounced.
    expect(NAV).toMatch(/isOwner \|\| href !== "\/admin\/users"/);
  });

  it("still lists the tab, so the owner has not lost it", () => {
    expect(NAV).toContain('["/admin/users", "adminUsers"]');
  });
});

describe("the section list itself", () => {
  it("has no duplicate keys", () => {
    expect(new Set(ALL_SECTIONS).size).toBe(ALL_SECTIONS.length);
  });

  it("has no path claimed by two sections", () => {
    const seen = new Map<string, SectionKey>();
    for (const section of ADMIN_SECTIONS) {
      for (const p of section.paths) {
        expect(seen.get(p)).toBeUndefined();
        seen.set(p, section.key);
      }
    }
  });

  it("resolves each of its own paths back to itself", () => {
    // Catches a path being shadowed by a longer one in another section.
    for (const section of ADMIN_SECTIONS) {
      for (const p of section.paths) {
        expect([p, sectionForPath(p)]).toEqual([p, section.key]);
      }
    }
  });
});

/* ---------------------------------------------------------------------
 * The other half of the rule: a reader must not be SHOWN controls that
 * would only be refused. Hiding them is courtesy, not security -- the
 * server still refuses -- but a button that always fails is a bug.
 *
 * This cannot check that every individual button is wrapped. It checks the
 * thing that actually goes wrong: a component that can change something,
 * written without anyone thinking about who is looking at it.
 * ------------------------------------------------------------------- */

const COMPONENT_DIR = path.join(__dirname, "..", "src", "components", "admin");

function clientComponents(dir = COMPONENT_DIR, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) clientComponents(full, out);
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("admin components that can change things know who is looking", () => {
  /** Components that call a server action and deliberately do NOT gate it. */
  const EXEMPT = new Map<string, string>([
    // Signing out. A reader must be able to leave.
    ["AdminNav.tsx", "logout is for everyone"],
    // Signing in. There is no session yet to have a role.
    ["LoginForm.tsx", "runs before anyone is signed in"],
    // Owner-only page (src/app/admin/users/page.tsx refuses staff outright),
    // so no reader ever renders it.
    ["AdminUsers.tsx", "owner only, refused at the page"],
    // A download is a read; it calls requireAdminRead, not requireAdmin.
    ["ExportExcelButton.tsx", "exporting is reading"],
  ]);

  it("gates every other one on the viewer's role", () => {
    const ungated: string[] = [];
    for (const file of clientComponents()) {
      const src = fs.readFileSync(file, "utf8");
      if (!/^"use client"/m.test(src)) continue;
      // Does it reach for something that writes?
      if (!/from "@\/lib\/actions\//.test(src)) continue;
      const name = path.basename(file);
      if (EXEMPT.has(name)) continue;
      if (!/WriteOnly|useCanWrite/.test(src)) ungated.push(path.relative(COMPONENT_DIR, file));
    }
    expect(ungated).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    // An exemption for a component that no longer exists is a stale excuse,
    // and the next person reads it as a rule.
    const names = new Set(clientComponents().map((f) => path.basename(f)));
    for (const exempt of EXEMPT.keys()) expect([exempt, names.has(exempt)]).toEqual([exempt, true]);
  });
});

