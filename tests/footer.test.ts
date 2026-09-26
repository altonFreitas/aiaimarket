import { describe, it, expect } from "vitest";
import { acceptedPayments } from "@/lib/payMethods";
import fs from "node:fs";
import path from "node:path";

/* THE FOOTER, ON THE REFERENCE'S SHAPE AND THIS SHOP'S FACTS.
 *
 * The reference design is a large ecommerce footer: four boutiques across
 * the top, social icons, an "app on the go" panel with two store badges,
 * and a strip of six card-network logos.
 *
 * This shop has one address, no app, no social accounts in its settings,
 * and takes cards only if somebody has configured a gateway. A footer is
 * exactly where a shopper goes to check whether a shop is real, so every
 * one of those would be a lie in the place least able to afford one.
 *
 * These guard the adaptation, not the layout.
 */

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const FOOTER = code("src/components/Footer.tsx");
const CSS = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const I18N = read("src/lib/i18n.ts");

describe("what the reference has and this shop does not", () => {
  it("ships no app badges", () => {
    /* There is no app. Two store badges in the footer of a site with no
       app is a promise a shopper can act on and find nothing. */
    expect(FOOTER).not.toMatch(/App Store|Google Play|app-store|play-badge/i);
  });

  it("ships no social icons", () => {
    // settings has no social accounts. An icon linking to a Facebook page
    // that does not exist is worse than no icon.
    expect(FOOTER).not.toMatch(/facebook|instagram|twitter|tiktok/i);
  });

  it("names no card network it cannot promise", () => {
    // The reference prints six logos. This shop's payment options are
    // settings, so the footer names methods rather than brands.
    expect(FOOTER).not.toMatch(/\bvisa\b|mastercard|amex|discover|paypal/i);
  });
});

describe("the places row is this shop's places", () => {
  it("is the shop's own address plus the zones it delivers to", () => {
    /* The reference's four boutiques become the one address this shop
       has, and the delivery zones it actually reaches. */
    expect(FOOTER).toMatch(/settings\.zones \?\? \[\]/);
    expect(FOOTER).toMatch(/<MapLink/);
  });

  it("never prints a fee for a zone that is quoted case by case", () => {
    /* Saying "$0.00" of a delivery somebody will be charged for is the one
       thing this line must never do -- and zone.fee is 0 on a quoted zone,
       so it would. */
    expect(FOOTER).toMatch(
      /z\.quote \? t\("quoteOnRequest", lang\)\s*\n?\s*: t\("deliveryFee", lang\)/);
  });

  it("uses the words the checkout already uses for the same thing", () => {
    // A shopper meets one phrase for one thing.
    const CHECKOUT = read("src/components/CheckoutForm.tsx");
    expect(CHECKOUT).toContain("quoteOnRequest");
    expect(FOOTER).toContain("quoteOnRequest");
  });
});

describe("what the shop takes, read off the settings", () => {
  /* Driven rather than grepped. The list is shared with the cart, which
     makes the same promise beside its checkout button, so what matters is
     what the function returns -- not what any one caller's source says. */
  const shop = (over: Partial<Parameters<typeof acceptedPayments>[0]> = {}) =>
    ({ pickup: false, banks: [], wallets: [], ...over }) as Parameters<typeof acceptedPayments>[0];

  it("always offers cash on delivery", () => {
    // What this shop is for, and what the checkout assumes as its
    // fallback.
    expect(acceptedPayments(shop(), false)).toEqual(["pm_cod"]);
  });

  it("offers bank transfer only when a bank has been entered", () => {
    expect(acceptedPayments(shop(), false)).not.toContain("pm_bank");
    expect(acceptedPayments(
      shop({ banks: [{ label: "BNCTL", account: "1", holder: "A" }] }), false))
      .toContain("pm_bank");
  });

  it("offers a wallet only when one has been entered", () => {
    expect(acceptedPayments(shop(), false)).not.toContain("pm_wallet");
    expect(acceptedPayments(shop({ wallets: [{ label: "M", number: "1" }] }), false))
      .toContain("pm_wallet");
  });

  it("offers a card only when a gateway is configured", () => {
    /* A payment method that throws the moment it is chosen is worse than
       one that is not offered. */
    expect(acceptedPayments(shop(), false)).not.toContain("pm_card");
    expect(acceptedPayments(shop(), true)).toContain("pm_card");
  });

  it("offers cash on pickup only when the shop does pickup", () => {
    expect(acceptedPayments(shop(), false)).not.toContain("pm_cop");
    expect(acceptedPayments(shop({ pickup: true }), false)).toContain("pm_cop");
  });

  it("is the list the footer prints, not a second one", () => {
    expect(FOOTER).toMatch(/acceptedPayments\(settings, cardPaymentAvailable\(\)\)/);
  });
});

describe("a section with nothing behind it does not appear", () => {
  it("draws no category column on a shop with no categories", () => {
    // A heading over nothing is worse than no heading.
    expect(FOOTER).toMatch(/\{top\.length > 0 && \(/);
  });

  it("draws no WhatsApp panel without a number", () => {
    expect(FOOTER).toMatch(/\{wa && \(/);
  });

  it("prints no tagline when the shop has not written one", () => {
    expect(FOOTER).toMatch(/\{tagline && </);
  });

  it("does not let one shop's catalogue fill the column", () => {
    // The reference's column is four links long. A shop with forty
    // categories would otherwise print forty.
    expect(FOOTER).toMatch(/\.filter\(\(c\) => !c\.parent_id\)\.slice\(0, \d+\)/);
  });
});

describe("the footer fills the window", () => {
  it("is a flex item with a width", () => {
    /* <body> is display:flex, so a footer with auto margins and no width
       shrinks to fit its contents -- which is why a footer of three
       centred lines never looked wrong and one of five columns came out
       784px wide in a 1280px window. Measured in a browser before and
       after. */
    const rule = /(?:^|\})\s*\.ft\{([^}]*)\}/m.exec(CSS);
    expect(rule, "the .ft rule").not.toBeNull();
    expect(rule![1]).toContain("width:100%");
    expect(rule![1]).toContain("max-width:var(--content-w)");
  });

  it("keeps the same side gutter as the rest of the site", () => {
    // Dropping it put the copyright hard against the window edge.
    expect(CSS).not.toMatch(/\.ft\{padding-left:0/);
    const wide = /@media \(min-width:900px\)\{\s*\n[\s\S]{0,200}?\.ft-main/.exec(CSS);
    expect(wide?.[0] ?? "").not.toContain("padding-left:0");
  });
});

describe("the WhatsApp button is WhatsApp's colour", () => {
  it("uses the shop's WhatsApp green, not its dark blue", () => {
    expect(FOOTER).toMatch(/className="btn btn-sm btn-wa"/);
  });

  it("is the same green the product page's WhatsApp button uses", () => {
    /* One colour for one thing. .btn-wa is WhatsApp green darkened
       exactly as far as white text needs to stay legible -- the brand
       #25D366 measures 2.2:1 against white, and tests/contrast.test.ts
       holds --wa above 4.5. */
    const PDP = read("src/components/ProductInteractive.tsx");
    expect(PDP).toContain("btn btn-wa");
    expect(CSS).toMatch(/\.btn-wa\{background:var\(--wa\)/);
  });
});

describe("a placeholder looks like a hint, not an answer", () => {
  it("is smaller than the value it stands in for", () => {
    /* At the field's own size an example like "ORD-2026-0001" reads as
       though the box were already filled. */
    const rule = /input::placeholder,textarea::placeholder\{([^}]*)\}/.exec(CSS);
    expect(rule, "the placeholder rule").not.toBeNull();
    expect(rule![1]).toContain("font-size:var(--fs-sm)");
  });

  it("is quieter than the value too", () => {
    const rule = /input::placeholder,textarea::placeholder\{([^}]*)\}/.exec(CSS);
    expect(rule![1]).toContain("color:var(--muted-2)");
    // Firefox dims placeholders by default; without this the two browsers
    // disagree about how faint it is.
    expect(rule![1]).toContain("opacity:1");
  });
});

describe("the new wording exists in all three languages", () => {
  it("says the same thing in Tetun, Portuguese and English", () => {
    for (const key of ["help", "information", "footWaTitle", "footWaBody", "footWaMsg"]) {
      const m = new RegExp(key + ':\\["([^"]*)","([^"]*)","([^"]*)"\\]').exec(I18N);
      expect(m, key).not.toBeNull();
      for (const one of [m![1], m![2], m![3]]) {
        expect(one.length, key).toBeGreaterThan(0);
      }
    }
  });

  it("reuses the wording that already existed", () => {
    /* orderWa and quoteOnRequest were already written. A second key
       saying the same thing in slightly different words is how two
       screens come to disagree about what the shop calls something. */
    expect(FOOTER).toContain('t("orderWa"');
    expect(I18N).not.toMatch(/\n  orderOnWa:/);
    expect(I18N).not.toMatch(/\n  zoneQuoted:/);
  });
});
