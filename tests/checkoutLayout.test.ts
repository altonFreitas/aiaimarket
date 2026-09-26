import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { enabledPayments, acceptedPayments } from "@/lib/payMethods";

/* THE TWO-COLUMN CHECKOUT, AND THE METHODS IT MAY OFFER.
 *
 * The reference is a form on the left with the order summary beside it on
 * the right, editable, and following you down a form that runs several
 * screens.
 *
 * The bug underneath the redesign was worse than the layout: the payment
 * list was a hardcoded array filtered only by delivery mode, so a shop
 * that had never entered a bank account still offered "Bank transfer" --
 * and choosing it printed a "Bank details" heading with nothing under it.
 * The footer and the cart had always been gated on the settings. This
 * screen, the only one where the choice does anything, was not.
 */

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const FORM = code("src/components/CheckoutForm.tsx");
const CSS = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");

/** The @media block whose body contains `needle`, with its query text. */
function mediaBlock(needle: string): { query: string; body: string } | null {
  for (const m of CSS.matchAll(/@media ?([^{]+)\{/g)) {
    const open = m.index! + m[0].length;
    let depth = 1, i = open;
    while (i < CSS.length && depth > 0) {
      if (CSS[i] === "{") depth++;
      else if (CSS[i] === "}") depth--;
      i++;
    }
    const body = CSS.slice(open, i - 1);
    if (body.includes(needle)) return { query: m[1], body };
  }
  return null;
}

const shop = (over: Partial<{ pickup: boolean; banks: unknown[]; wallets: unknown[] }> = {}) =>
  ({ pickup: false, banks: [], wallets: [], ...over }) as Parameters<typeof enabledPayments>[0];

describe("which payment methods a shop may offer", () => {
  it("offers cash on delivery on a shop that has set nothing up", () => {
    expect(enabledPayments(shop(), false)).toEqual(["cod"]);
  });

  it("does not offer bank transfer with no bank account to transfer to", () => {
    // The whole bug: the buyer commits to a method that names nowhere to
    // send the money.
    expect(enabledPayments(shop(), false)).not.toContain("bank");
    expect(enabledPayments(shop({ banks: [{ label: "BNU" }] }), false)).toContain("bank");
  });

  it("does not offer a mobile wallet with no wallet number", () => {
    expect(enabledPayments(shop(), false)).not.toContain("wallet");
    expect(enabledPayments(shop({ wallets: [{ label: "Mosan" }] }), false)).toContain("wallet");
  });

  it("offers cash on pickup only where pickup is switched on", () => {
    expect(enabledPayments(shop(), false)).not.toContain("cop");
    expect(enabledPayments(shop({ pickup: true }), false)).toContain("cop");
  });

  it("offers card only where a gateway is configured", () => {
    expect(enabledPayments(shop(), false)).not.toContain("card");
    expect(enabledPayments(shop(), true)).toContain("card");
  });

  it("is the one list the footer and the cart print from", () => {
    // Derived, not restated: acceptedPayments must be enabledPayments with
    // the i18n prefix on it, or two screens promise different things.
    const s = shop({ pickup: true, banks: [{}], wallets: [{}] });
    for (const card of [true, false]) {
      expect(acceptedPayments(s, card)).toEqual(enabledPayments(s, card).map((m) => "pm_" + m));
    }
  });
});

describe("the checkout's payment picker", () => {
  it("asks the settings rather than a list of its own", () => {
    expect(FORM).toMatch(/enabledPayments\(settings, cardAvailable\)/);
    // The hardcoded array is the thing that must not come back.
    expect(FORM).not.toMatch(/ALL_PAY/);
    expect(FORM).not.toMatch(/\[\s*"cod",\s*"cop",\s*"bank"/);
  });

  it("drops the method that does not suit how the order is coming", () => {
    expect(FORM).toMatch(/mode === "pickup" \? m !== "cod" : m !== "cop"/);
  });

  it("does not keep a selection the shop has since switched off", () => {
    /* The owner removing their last bank account mid-checkout must not
       leave an order going out named for a method the shop cannot take. */
    expect(FORM).toMatch(/const payOk = availablePay\.includes\(pay\)/);
    expect(FORM).toMatch(/effectivePay[^=]*= payOk \? pay : availablePay\[0\]/);
    // ...and the order must be placed with the corrected one.
    expect(FORM).toMatch(/payMethod: effectivePay/);
    expect(FORM).not.toMatch(/payMethod: pay\b/);
  });

  it("shows each method's details against the corrected choice too", () => {
    // A details box keyed off the stale `pay` would show bank details for
    // a method no longer on offer.
    for (const m of ["bank", "wallet", "card"]) {
      expect([m, FORM.includes(`effectivePay === "${m}"`)]).toEqual([m, true]);
      expect([m, FORM.includes(`{pay === "${m}"`)]).toEqual([m, false]);
    }
  });
});

describe("the pickup option", () => {
  it("does not send anybody to collect their order from a comma", () => {
    /* {suku}, {municipality} · {hours} on a shop that has filled none of
       them in rendered ", ·" as the collection address. */
    expect(FORM).not.toMatch(/\{settings\.suku\}, \{settings\.municipality\}/);
    expect(FORM).toMatch(/pickupWhere && <small>/);
    expect(FORM).toMatch(/\.filter\(Boolean\)\.join\(" · "\)/);
  });
});

describe("the two columns", () => {
  it("gives the wide track to the form, not to the summary", () => {
    const block = mediaBlock(".co-cols{grid-template-columns");
    expect(block, "a width rule giving .co-cols its tracks").not.toBeNull();
    expect(block!.query).toMatch(/min-width:\s*\d+px/);
    const rule = /\.co-cols\{grid-template-columns:([^;}]*)/.exec(block!.body)!;
    // 1fr FIRST, with the summary ordered into the narrow track after it.
    expect(rule[1].trim()).toMatch(/^minmax\(0,1fr\) minmax\(\d+px,\d+px\)$/);
    expect(block!.body).toMatch(/\.co-cols>form\{order:1/);
    expect(block!.body).toMatch(/\.co-summary\{order:2/);
  });

  it("keeps the summary in view down a form several screens long", () => {
    expect(mediaBlock(".co-summary{order:2")!.body).toMatch(/\.co-summary\{[^}]*position:sticky/);
  });

  it("stops capping the form now that it has the wide track", () => {
    // max-width:820px in a track with ~874 left a strip of dead page.
    // The whole rule body, not just its first declaration: written as
    // {order:1;min-width:0;max-width:820px} an anchored match sails past.
    for (const m of CSS.matchAll(/\.co-cols>form\{([^}]*)\}/g)) {
      expect(m[1], ".co-cols>form").not.toContain("max-width");
    }
  });

  it("stacks with the order on top, which is what a phone reads first", () => {
    expect(FORM.indexOf('className="co-summary"')).toBeLessThan(FORM.indexOf("<form onSubmit"));
    // Base width is ONE column, exactly -- a prefix match here passed
    // with a second track appended, which is two columns on a phone.
    const base = /\.co-cols\{display:grid;grid-template-columns:([^;}]*)/.exec(CSS)!;
    expect(base[1].trim()).toBe("minmax(0,1fr)");
  });
});
