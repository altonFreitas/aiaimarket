import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { callingCodeOf, phoneDisplay, phoneNorm } from "@/lib/utils";
import { COUNTRIES } from "@/lib/countries";

/* THE NUMBER, AS A PERSON READS IT.
 *
 * An order stores its phone as one unbroken run of digits, because that
 * is what the lookups match on -- lookupOrder compares against phoneNorm()
 * and getOrdersByPhone filters the column by equality. Change the stored
 * shape and every buyer loses their own order history.
 *
 * So the split is a DISPLAY rule: "+351932766074" is what the database
 * holds, "+351 932766074" is what the shop reads out over the phone.
 */

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("splitting the calling code from the number", () => {
  it("splits the shop's own country", () => {
    expect(phoneDisplay("+67077123456")).toBe("+670 77123456");
  });

  it("splits the diaspora codes the checkout offers", () => {
    // The reported example, verbatim.
    expect(phoneDisplay("+351932766074")).toBe("+351 932766074");
    expect(phoneDisplay("+6281234567")).toBe("+62 81234567");
  });

  it("prefers the longer code where one is a prefix of another", () => {
    /* PROVED ON A LIST THAT HAS THE COLLISION, because the shop's own nine
       codes share no prefixes today -- so against the real list a
       shortest-first search gives identical answers and nothing here would
       catch it being wrong. +1 and +1242 are both real; read shortest
       first, a Bahamas number becomes an American one with three of its
       digits swallowed by the country code. */
    expect(COUNTRIES.map((c) => c.code).some((a, _i, all) =>
      all.some((b) => b !== a && b.startsWith(a)))).toBe(false);

    const codes = ["1", "1242", "670", "67"];
    expect(callingCodeOf("12425551234", codes)).toBe("1242");
    expect(callingCodeOf("12025551234", codes)).toBe("1");
    expect(callingCodeOf("67077123456", codes)).toBe("670");
  });

  it("finds no code in a string that is only a code", () => {
    // There is no local number to put after the space.
    expect(callingCodeOf("670", ["670"])).toBeNull();
    expect(callingCodeOf("", ["670"])).toBeNull();
    expect(callingCodeOf("99999", ["670"])).toBeNull();
  });

  it("leaves a number alone when its code is not one the shop offers", () => {
    // A wrong split is worse than none: it puts the digits in the wrong
    // places and reads as a different number entirely.
    expect(phoneDisplay("+9995551234")).toBe("+9995551234");
  });

  it("leaves anything that is not a bare +digits string alone", () => {
    for (const v of ["", "  ", "not a phone", "+351 932766074", "07712 3456"]) {
      expect([v, phoneDisplay(v)]).toEqual([v, v.trim()]);
    }
    expect(phoneDisplay(null)).toBe("");
    expect(phoneDisplay(undefined)).toBe("");
  });

  it("never splits a number that is only a country code", () => {
    // "+670" alone would otherwise become "+670 " with nothing after it.
    expect(phoneDisplay("+670")).toBe("+670");
  });

  it("survives a round trip back to the stored form", () => {
    /* The whole safety argument: whatever this prints, phoneNorm turns it
       back into exactly what the database holds. */
    for (const stored of ["+67077123456", "+351932766074", "+6281234567"]) {
      expect([stored, phoneNorm(phoneDisplay(stored))]).toEqual([stored, stored]);
    }
  });
});

describe("where the split is and is not applied", () => {
  it("is not applied on the way into the database", () => {
    const orders = read("src/lib/actions/orders.ts");
    expect(orders).toMatch(/buyer_phone: normalizedPhone/);
    expect(orders).not.toMatch(/buyer_phone: phoneDisplay/);
    // Lookups keep comparing canonical forms.
    expect(orders).toMatch(/phoneNorm\(phone\)/);
  });

  it("is applied wherever a person reads a number", () => {
    for (const f of [
      "src/components/admin/OrdersAdmin.tsx",
      "src/components/admin/OrderAdmin.tsx",
      "src/components/seller/SellerOrdersList.tsx",
      "src/components/OrderHistory.tsx",
      "src/components/TrackForm.tsx",
      // The shop copies this one out of a spreadsheet to ring somebody.
      "src/lib/actions/export.ts",
    ]) {
      expect([f, /phoneDisplay\(/.test(read(f))]).toEqual([f, true]);
    }
  });

  it("leaves the machine-readable links canonical", () => {
    /* A tel: href and a WhatsApp link are dialled, not read. The wa link
       strips to digits anyway; tel: keeps the stored form. */
    const admin = read("src/components/admin/OrderAdmin.tsx");
    expect(admin).toMatch(/href=\{`tel:\$\{o\.buyer_phone\}`\}/);
    expect(admin).not.toMatch(/tel:\$\{phoneDisplay/);
  });

  it("filters the customer column on the stored value, not the pretty one", () => {
    // The phone doubles as the customer's identity on the orders screen.
    const list = read("src/components/admin/OrdersAdmin.tsx");
    expect(list).toMatch(/set\(\{ customer: o\.buyer_phone \}\)/);
  });
});
