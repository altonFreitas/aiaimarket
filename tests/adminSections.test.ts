import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ADMIN_SECTIONS, ALL_SECTIONS, ALL_SUBSECTIONS, ALL_GRANT_KEYS, GRANTABLE_SECTIONS,
  sectionForPath, subsectionForPath,
  canSee, canOpenSubsection, canOpenPath, visibleSubsections,
  canWrite, normalizeRole, normalizeSections,
  type Access,
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

  it("guards each page with the SUBSECTION that page's route belongs to", () => {
    /* A guard with the wrong key is worse than none: it looks locked and
       hands the page to the wrong people. And now it must name the TAB, not
       the area -- a Finance page still guarding "settings" would open to
       anybody granted only Activity, which is the whole point of splitting
       them. This reads the argument out of each file and checks it. */
    const wrong: string[] = [];
    for (const file of pages) {
      const route = routeOf(file);
      if (route === "/admin/login") continue;
      const src = fs.readFileSync(file, "utf8");
      const m = /requireSection\s*\(\s*["']([a-z.]+)["']/.exec(src);
      if (!m) continue; // reported by the test below
      const expected = subsectionForPath(route.replace(/\[[^\]]+\]/g, "x"))?.key;
      if (m[1] !== expected) wrong.push(`${route}: guards "${m[1]}", belongs to "${expected}"`);
    }
    expect(wrong).toEqual([]);
  });

  it("names a subsection, never just an area", () => {
    // The area form still works -- requireSection accepts both, so a page
    // that has not been narrowed locks itself rather than opening. But no
    // page should be left that way, and this is what says so.
    const broad: string[] = [];
    for (const file of pages) {
      const route = routeOf(file);
      if (route === "/admin/login") continue;
      const m = /requireSection\s*\(\s*["']([a-z.]+)["']/.exec(fs.readFileSync(file, "utf8"));
      if (m && !m[1].includes(".")) broad.push(`${route}: guards the whole "${m[1]}" area`);
    }
    expect(broad).toEqual([]);
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
  it("keeps Admin users out of a non-owner's tabs", () => {
    /* The page is the owner's alone. A tab everyone can see and nobody but
       the owner can open is a broken link with a label on it -- and that is
       exactly what it was: staff holding Settings were shown the tab and
       then bounced.

       Asserted on the BEHAVIOUR now rather than on a line of the nav's
       source. It used to match a regex against AdminNav.tsx, which stopped
       meaning anything the moment the nav was rewritten -- the test would
       have kept passing while the tab came back. */
    const everything = staff("admin", [...GRANTABLE_SECTIONS]);
    expect(canOpenSubsection(everything, "settings.users")).toBe(false);
    expect(visibleSubsections(everything, "settings").map((x) => x.key))
      .not.toContain("settings.users");
  });

  it("still lists the tab for the owner, who has not lost it", () => {
    expect(canOpenSubsection(owner, "settings.users")).toBe(true);
    expect(visibleSubsections(owner, "settings").map((x) => x.key))
      .toContain("settings.users");
  });

  it("refuses to hand it out even if the row somehow names it", () => {
    // Belt and braces: normalizeSections drops an owner-only key on the way
    // in, and canOpenSubsection refuses it on the way out. Either alone
    // would do; both means a gap in one is not a breach.
    expect(normalizeSections(["settings.users"])).toEqual([]);
    expect(canOpenSubsection(staff("admin", ["settings.users"]), "settings.users"))
      .toBe(false);
  });
});

describe("the section list itself", () => {
  it("has no duplicate keys", () => {
    expect(new Set(ALL_SECTIONS).size).toBe(ALL_SECTIONS.length);
  });

  it("has no path claimed by two subsections", () => {
    const seen = new Map<string, string>();
    for (const sub of ALL_SUBSECTIONS) {
      for (const p of sub.paths) {
        expect([p, seen.get(p)]).toEqual([p, undefined]);
        seen.set(p, sub.key);
      }
    }
  });

  it("resolves each of its own paths back to itself", () => {
    // Catches a path being shadowed by a longer one somewhere else.
    for (const sub of ALL_SUBSECTIONS) {
      for (const p of sub.paths) {
        expect([p, subsectionForPath(p)?.key]).toEqual([p, sub.key]);
      }
    }
  });

  it("gives every subsection a key namespaced on its own area", () => {
    // sectionOfSubsection reads the area off the key, so a key that does
    // not start with its area would resolve to the wrong one -- or to none.
    for (const section of ADMIN_SECTIONS) {
      for (const sub of section.subsections) {
        expect([sub.key, sub.key.split(".")[0]]).toEqual([sub.key, section.key]);
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
    // Your own second factor is yours. Everything it calls acts on the
    // caller's own login and nothing else, so it takes requireAdminRead --
    // gating it on the write role would stop a read-only staff account
    // turning 2FA ON for itself, which is backwards.
    ["AdminTotpSettings.tsx", "a person's own login, not the shop's data"],
    // Every action it imports READS the taxonomy -- which categories exist,
    // which product types are under one, which fields a type asks for. It
    // writes nothing. Gating it on the write role would hide a product's
    // own fields from a read-only account looking at the catalogue, which
    // is backwards for the same reason as the 2FA entry above. The SAVE
    // lives in ProductForm, which is gated, and passes `disabled` down.
    ["TaxonomyPicker.tsx", "reads the taxonomy; the save is the parent's"],
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


describe("the database agrees with the app about what may be granted", () => {
  /* TWO LISTS, AND THEY MUST BE THE SAME LIST.
   *
   * admin_users.sections carries a check constraint naming every key that
   * may be stored. If the app offers a key the database refuses, saving
   * that account fails with a constraint error in the owner's face. If the
   * database allows one the app does not recognise, the row reads as a
   * granted permission on screen and opens nothing.
   *
   * Neither is caught by any other test, because the SQL is text to the
   * TypeScript and the TypeScript is invisible to the SQL. This reads both. */
  const SQL = fs.readFileSync(
    path.join(process.cwd(), "supabase/admin-subsections.sql"), "utf8");

  /** The keys named inside the constraint's array literal. */
  function keysInConstraint(): string[] {
    const body = SQL.slice(SQL.indexOf("sections <@ array["), SQL.indexOf("]::text[]"));
    return [...body.matchAll(/'([a-z.]+)'/g)].map((m) => m[1]);
  }

  it("names the same keys, in both directions", () => {
    expect([...keysInConstraint()].sort()).toEqual([...ALL_GRANT_KEYS].sort());
  });

  it("does not let the owner-only tab be stored at all", () => {
    // Refused in three independent places: here, normalizeSections, and
    // canOpenSubsection. A gap in one is then not a breach.
    expect(keysInConstraint()).not.toContain("settings.users");
    expect(ALL_GRANT_KEYS).not.toContain("settings.users");
  });

  it("does not offer Home, which is not a permission", () => {
    expect(keysInConstraint().some((k) => k.startsWith("home"))).toBe(false);
  });

  /* THE TWO CONSTRAINTS MUST NEVER COEXIST.
   *
   * admin-roles.sql creates the narrow admin_users_sections_check; this file
   * replaces it with the wide admin_users_section_keys_check under a new
   * name, so the Settings -> Database panel -- which compares names -- can
   * tell a shop that has run it from one that has not.
   *
   * A check constraint is enforced whenever it is present. Leave both and
   * the narrow one goes on rejecting every tab key while the wide one
   * allows it: every tab grant fails to save, on a shop whose panel reports
   * both files applied. These two tests read the SQL because that failure
   * cannot be reproduced from TypeScript at all. */
  const ROLES_SQL = fs.readFileSync(
    path.join(process.cwd(), "supabase/admin-roles.sql"), "utf8");

  it("drops the narrow constraint it replaces", () => {
    expect(SQL).toMatch(
      /drop constraint if exists admin_users_sections_check/);
    expect(SQL).toMatch(
      /add constraint admin_users_section_keys_check/);
  });

  it("is not undone by running admin-roles.sql afterwards", () => {
    // That file only adds the narrow constraint when NEITHER name is
    // present. Without the second name in its guard, running it on its own
    // after this file would silently re-narrow the column.
    //
    // COMMENTS ARE STRIPPED FIRST, and that is not a detail. The prose above
    // this guard names both constraints; a check that read the raw text
    // would pass on the strength of the explanation while the code below it
    // said something else entirely. Only the SQL counts.
    const add = ROLES_SQL.indexOf("add constraint admin_users_sections_check");
    const block = ROLES_SQL.slice(ROLES_SQL.lastIndexOf("do $$", add), add)
      .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(block).toContain("admin_users_sections_check");
    expect(block).toContain("admin_users_section_keys_check");
  });
});

describe("granting one tab of an area", () => {
  /* THE WHOLE POINT OF THIS FEATURE, and the thing that would quietly not
   * work: a grant of Activity must open Activity and must NOT open Finance,
   * which sits in the same area and holds what the shop pays its staff. */
  const activityOnly = staff("reader", ["settings.activity"]);

  it("opens the area, or there is no way to reach the tab", () => {
    expect(canSee(activityOnly, "settings")).toBe(true);
  });

  it("opens that tab", () => {
    expect(canOpenSubsection(activityOnly, "settings.activity")).toBe(true);
    expect(canOpenPath(activityOnly, "/admin/activity")).toBe(true);
  });

  it("does NOT open the others in the same area", () => {
    for (const other of ["settings.shop", "settings.finance", "settings.targets"]) {
      expect([other, canOpenSubsection(activityOnly, other)]).toEqual([other, false]);
    }
    // Said again as a URL, because that is how somebody would actually try.
    for (const url of ["/admin/settings", "/admin/finance", "/admin/sales/targets"]) {
      expect([url, canOpenPath(activityOnly, url)]).toEqual([url, false]);
    }
  });

  it("shows only that tab in the navigation", () => {
    expect(visibleSubsections(activityOnly, "settings").map((s) => s.key))
      .toEqual(["settings.activity"]);
  });

  it("does not leak into another area", () => {
    expect(canSee(activityOnly, "sales")).toBe(false);
    expect(canOpenPath(activityOnly, "/admin/orders")).toBe(false);
  });
});

describe("granting a whole area", () => {
  const settings = staff("reader", ["settings"]);

  it("opens every tab in it", () => {
    for (const sub of ADMIN_SECTIONS.find((s) => s.key === "settings")!.subsections) {
      // Except the owner-only one, which is nobody's to grant.
      const want = !sub.ownerOnly;
      expect([sub.key, canOpenSubsection(settings, sub.key)]).toEqual([sub.key, want]);
    }
  });

  it("is NOT the same stored grant as ticking every tab", () => {
    /* The distinction that decides what happens when a tab is added in a
       later version: the area grant picks it up, a list of tabs does not.
       If these normalised to the same thing the choice would be lost. */
    const everyTab = ADMIN_SECTIONS.find((s) => s.key === "settings")!
      .subsections.filter((s) => !s.ownerOnly).map((s) => s.key);
    expect(normalizeSections(["settings"])).not.toEqual(normalizeSections(everyTab));
  });

  it("swallows a tab key sitting beside it, so the row cannot say both", () => {
    // ["settings","settings.finance"] would have to mean either "everything"
    // or "just finance", and nothing on the row says which.
    expect(normalizeSections(["settings", "settings.finance"])).toEqual(["settings"]);
  });
});

describe("a stale key left on a row", () => {
  it("opens nothing", () => {
    // A tab removed in a later version leaves its key behind on accounts.
    // It must not resolve to its area and quietly grant all of it.
    const stale = staff("admin", ["settings.gone"]);
    expect(normalizeSections(["settings.gone"])).toEqual([]);
    expect(canOpenSubsection(stale, "settings.gone")).toBe(false);
    expect(canOpenSubsection(stale, "settings.finance")).toBe(false);
  });

  it("does not open the area either", () => {
    // canSee asks whether any key belongs to the area. A key that only
    // LOOKS like one must not be enough.
    expect(canSee(staff("admin", normalizeSections(["settings.gone"])), "settings")).toBe(false);
  });
});

describe("every page's guard, against a real grant", () => {
  it("refuses a Finance-only account everywhere except Finance", () => {
    /* End to end over the real path table rather than a handful of
       examples: exactly one subsection should open, and it should be the
       one granted. */
    const financeOnly = staff("reader", ["settings.finance"]);
    const opened = ALL_SUBSECTIONS.filter((sub) => canOpenSubsection(financeOnly, sub.key));
    expect(opened.map((s) => s.key)).toEqual(["home.overview", "settings.finance"]);
  });
});
