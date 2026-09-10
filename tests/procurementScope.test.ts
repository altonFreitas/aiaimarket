import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  PLATFORM, sellerScope, scopeSellerId, scopeCanSee, scopeCanWrite,
} from "@/lib/procurementScope";

const ana = sellerScope("sel-ana");
const bee = sellerScope("sel-bee");

describe("scopeSellerId", () => {
  it("stamps a seller's rows with the seller and the owner's with null", () => {
    expect(scopeSellerId(ana)).toBe("sel-ana");
    expect(scopeSellerId(PLATFORM)).toBeNull();
  });
});

describe("scopeCanSee", () => {
  it("keeps one store out of another's buying", () => {
    // The failure the column exists to prevent, in both directions.
    expect(scopeCanSee(ana, "sel-bee")).toBe(false);
    expect(scopeCanSee(bee, "sel-ana")).toBe(false);
  });

  it("keeps the owner's supplier prices off a seller's screen", () => {
    expect(scopeCanSee(ana, null)).toBe(false);
    expect(scopeCanSee(ana, undefined)).toBe(false);
  });

  it("lets a store see its own", () => {
    expect(scopeCanSee(ana, "sel-ana")).toBe(true);
  });

  it("lets the owner see everything, including a store's", () => {
    // They run the marketplace. An order they cannot open is one they
    // cannot help with.
    expect(scopeCanSee(PLATFORM, null)).toBe(true);
    expect(scopeCanSee(PLATFORM, "sel-ana")).toBe(true);
    expect(scopeCanSee(PLATFORM, undefined)).toBe(true);
  });
});

describe("scopeCanWrite", () => {
  it("is stricter than seeing: the owner may read a store's order, not rewrite it", () => {
    // A store whose purchase order changed under it has no way to know.
    expect(scopeCanSee(PLATFORM, "sel-ana")).toBe(true);
    expect(scopeCanWrite(PLATFORM, "sel-ana")).toBe(false);
  });

  it("lets each side write its own", () => {
    expect(scopeCanWrite(PLATFORM, null)).toBe(true);
    expect(scopeCanWrite(PLATFORM, undefined)).toBe(true);
    expect(scopeCanWrite(ana, "sel-ana")).toBe(true);
  });

  it("still refuses another store's", () => {
    expect(scopeCanWrite(ana, "sel-bee")).toBe(false);
  });
});

/* ---------------------------------------------------------------------
 * The structural half: the scope must not be nameable from a client.
 * ------------------------------------------------------------------- */
describe("nobody can name the scope they want", () => {
  /* Every export of a "use server" module is a callable endpoint. The
   * scoped implementations take a ProcurementScope as their first
   * argument, so exporting one from an action file would be a way for
   * anyone to write into anyone's purchasing book by naming them. They
   * live in lib/purchasing.ts and lib/receiving.ts, which are server-only
   * and NOT server-action modules. This is the kind of mistake that is
   * invisible in review and total in effect. */
  const ROOT = path.join(__dirname, "..");

  it("keeps the scoped writers out of any 'use server' file", () => {
    for (const rel of ["src/lib/purchasing.ts", "src/lib/receiving.ts"]) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect([rel, /^\s*"use server"/m.test(src)]).toEqual([rel, false]);
      // server-only is the other half: it fails the build if a client
      // component ever imports one of these.
      expect([rel, /^import "server-only"/m.test(src)]).toEqual([rel, true]);
    }
  });

  it("gives every seller action a feature guard", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "src/lib/actions/seller-procurement.ts"), "utf8");
    const exported = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThan(0);
    // Each one resolves the scope from the guard rather than taking it.
    const guards = src.match(/await requireSellerFeature\("procurement"\)/g) || [];
    expect(guards.length).toBe(exported.length);
    expect(/sellerScope\(seller\.id\)/.test(src)).toBe(true);
  });

  it("gives every admin action the platform scope and an admin guard", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "src/lib/actions/procurement.ts"), "utf8");
    const exported = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThan(0);
    expect((src.match(/await requireAdmin\(\)/g) || []).length).toBe(exported.length);
    expect(/PLATFORM/.test(src)).toBe(true);
  });
});
