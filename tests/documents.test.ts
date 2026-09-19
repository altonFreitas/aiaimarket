import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { taxSummary } from "@/lib/pdfFiscal";
import type { Order } from "@/lib/types";

/* THE PAPER THIS SHOP ISSUES.
 *
 * The invoice and the delivery note describe one sale. They were two
 * different layouts, neither showed tax, and a customer holding both could
 * not tell they were the same order. They now share one renderer.
 */

const ROOT = process.cwd();
const code = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const order = (o: Partial<Order>) => o as Order;

describe("the tax summary at the foot of a document", () => {
  it("states the base the tax was charged on, not the subtotal", () => {
    /* They are not the same figure: the delivery fee is taxed with the
       goods, so the base is subtotal + fee. An accountant checking the
       document multiplies the base by the rate and expects the tax. */
    const s = taxSummary(order({ subtotal: 79, fee: 1, tax: 8, total: 88, tax_rate: 0.1 }));
    expect(s.base).toBe(80);
    expect(s.tax).toBe(8);
    expect(s.total).toBe(88);
    expect(Math.round(s.base * s.rate * 100) / 100).toBe(s.tax);
  });

  it("takes the base back out of the price when tax was included", () => {
    // $110 inclusive at 10%: the base is 100 and the tax 10, NOT 110 and 11.
    const s = taxSummary(order({ subtotal: 110, fee: 0, tax: 10, total: 110, tax_rate: 0.1 }));
    expect(s.included).toBe(true);
    expect(s.base).toBe(100);
    expect(s.tax).toBe(10);
  });

  it("uses the rate frozen on the order, not the shop's rate today", () => {
    // A shop that changes its rate in March must not restate February.
    const s = taxSummary(order({ subtotal: 100, fee: 0, tax: 5, total: 105, tax_rate: 0.05 }));
    expect(s.rate).toBe(0.05);
  });

  it("derives a rate for an order placed before the column existed", () => {
    const s = taxSummary(order({ subtotal: 100, fee: 0, tax: 10, total: 110 }));
    expect(s.rate).toBe(0.1);
  });

  it("says nothing was taxed rather than dividing by zero", () => {
    const s = taxSummary(order({ subtotal: 0, fee: 0, tax: 0, total: 0 }));
    expect([s.rate, s.base, s.tax]).toEqual([0, 0, 0]);
  });
});

describe("both documents are built from one renderer", () => {
  it("the invoice and the delivery note share it", () => {
    for (const f of ["src/lib/pdfInvoice.ts", "src/lib/pdfPackingSlip.ts"]) {
      expect(code(f), f).toMatch(/from "@\/lib\/pdfFiscal"/);
      expect(code(f), f).toMatch(/fiscalHeader\(/);
    }
    expect(code("src/lib/pdfInvoice.ts")).toMatch(/fiscalBody\(/);
    expect(code("src/lib/pdfPackingSlip.ts")).toMatch(/fiscalBody\(/);
  });

  it("names the shop from its settings", () => {
    /* The invoice printed "Loja AIAI" from a string literal, so a shop that
       renamed itself went on issuing paper in the old name. */
    expect(code("src/lib/pdfFiscal.ts")).toMatch(/settings\?\.store_name/);
    expect(code("src/lib/pdfInvoice.ts")).not.toMatch(/"Loja AIAI"/);
    expect(code("src/lib/pdfPackingSlip.ts")).not.toMatch(/"Loja AIAI"/);
  });

  it("claims no certification it does not have", () => {
    /* A Portuguese fatura carries a line naming the certified program that
       issued it. Printing one here would be a false statement about
       software that has been through no such process -- the shop's own
       registration number is printed because the shop supplied it, and
       nothing else is asserted. */
    /* Read with the COMMENTS STRIPPED, because the comment above this rule
       in pdfFiscal.ts explains why no certification is claimed -- and
       explanations are not what gets printed. Checking the raw file let the
       prose fail its own test, which is the mirror image of letting prose
       vouch for code that says something else. */
    expect(code("src/lib/pdfFiscal.ts"))
      .not.toMatch(/certificad|certified program|Processado por/i);
  });

  it("keeps what a driver needs on the delivery note", () => {
    // It carries the invoice's figures now, at the shop's request, but it
    // still has to get a parcel to a house.
    const slip = code("src/lib/pdfPackingSlip.ts");
    expect(slip).toMatch(/addressLines\(o, settings\)/);
    expect(slip).toMatch(/COLLECT ON DELIVERY/);
    expect(slip).toMatch(/Signature/);
  });
});

describe("the checkout summary reads like a receipt", () => {
  const co = code("src/components/CheckoutForm.tsx");

  it("shows subtotal, discount, delivery, tax, total in that order", () => {
    const order = ["subtotal", "discount", "deliveryFee", "taxName", "total"]
      .map((k) => co.indexOf(k === "taxName" ? "{taxName}" : `t("${k}", lang)`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("shows the discount only when there is one", () => {
    // A "Discount $0.00" row invites the reader to look for something that
    // is not there.
    expect(co).toMatch(/\{discount > 0 && \(/);
  });

  it("carries the rate beside the tax", () => {
    // "Tax $3.15" cannot be checked by the person paying it; "Tax (10%)" can.
    expect(co).toMatch(/\$\{shopTaxPct\}%/);
  });

  it("takes the discount from the price the line was listed at", () => {
    /* The line price is ALREADY the discounted one -- that is what is being
       charged and what the subtotal is built from -- so the saving needs the
       pre-discount figure, captured when the product was added. */
    expect(co).toMatch(/l\.listPrice \? \(l\.listPrice - l\.price\) \* l\.qty : 0/);
  });
});

describe("tax belongs to the shop, not to each category", () => {
  it("is gone from the code", () => {
    /* Built, then removed at the shop's request: it asked every category to
       answer a question this shop does not have, and a setting nobody can
       answer is one that gets answered wrongly. */
    for (const f of ["src/lib/tax.ts", "src/components/CheckoutForm.tsx",
                     "src/lib/actions/orders.ts", "src/lib/actions/categories.ts",
                     "src/components/admin/CategoriesAdmin.tsx"]) {
      expect(code(f), f).not.toMatch(/categoryRate|categoryTaxRates|setCategoryTaxRate/);
    }
  });

  it("is dropped from the database, not left half-populated", () => {
    // A column nothing reads is how a figure ends up on an invoice two
    // years later with no code behind it.
    const sql = fs.readFileSync(path.join(ROOT, "supabase/legal-currency-tax.sql"), "utf8");
    expect(sql).toMatch(/alter table categories drop column if exists tax_rate/);
  });
});

describe("the discount reaches the invoice, not just the checkout", () => {
  it("is recorded on the order", () => {
    /* THE GAP: the checkout showed "Discount −$11.00" and the invoice had
       no such line, because nothing on the order said what the goods would
       have cost at full price. A customer's two documents disagreed about
       their own purchase. */
    const orders = code("src/lib/actions/orders.ts");
    expect(orders).toMatch(/const discount = Math\.round\(itemsWithSeller\.reduce/);
    /* It reaches the INSERT, wherever in the call it is named.
       This used to require `discount,` on a line of its own in the
       always-written object -- which pinned the very arrangement that
       broke checkout on any shop without supabase/order-discount.sql:
       Postgres fails the whole statement over one unknown column, and
       nothing was dropping this one. It belongs in writeTolerating's
       optional set now, and the test asks that it is written at all
       rather than exactly where. See tests/migrationWindow.test.ts. */
    expect(orders).toMatch(/writeTolerating<Order>\([\s\S]{0,800}?discount/);
  });

  it("is computed from the product rows, never from the basket", () => {
    // A basket that can name its own saving can name any saving.
    const orders = code("src/lib/actions/orders.ts");
    expect(orders).toMatch(/byId\.get\(i\.product_id\)/);
    expect(orders).toMatch(/row\?\.discount_price != null/);
  });

  it("leaves the subtotal and the total alone", () => {
    /* Line prices are the DISCOUNTED ones and always were, so the money
       owed is unaffected. Subtracting it again would charge the discount
       twice -- in the customer's favour, which is still wrong. */
    const orders = code("src/lib/actions/orders.ts");
    expect(orders).not.toMatch(/subtotal\s*-\s*discount/);
    expect(orders).not.toMatch(/total\s*-\s*discount/);
  });

  it("prints on all three: checkout, tracking page and invoice", () => {
    expect(code("src/components/CheckoutForm.tsx")).toMatch(/\{discount > 0 && \(/);
    expect(code("src/components/TrackForm.tsx")).toMatch(/Number\(o\.discount\) > 0/);
    expect(code("src/lib/pdfFiscal.ts")).toMatch(/if \(discount > 0\) row\("Discount"/);
  });
});

describe("the admin's own copy of the order", () => {
  const admin = code("src/components/admin/OrderAdmin.tsx");

  it("shows the same rows the customer's does", () => {
    /* It listed the lines, the delivery fee and the total -- no subtotal,
       no discount, no tax -- so an admin answering "why is this $14.30 when
       the goods were $12" had to work it out, while the customer's own copy
       already said. Four documents describing one sale should not disagree
       about which figures exist. */
    expect(admin).toMatch(/t\("subtotal", lang\)/);
    expect(admin).toMatch(/Number\(o\.discount\) > 0/);
    expect(admin).toMatch(/Number\(o\.tax\) > 0/);
    expect(admin).toMatch(/t\("total", lang\)/);
  });

  it("says when the tax was already inside the price", () => {
    expect(admin).toMatch(/taxWasIncluded\(o\)/);
  });

  it("does not quote a delivery fee that is still to be quoted", () => {
    expect(admin).toMatch(/o\.quote_requested \? t\("quoteOnRequest", lang\)/);
  });
});

describe("who is signed in, in the header", () => {
  const header = code("src/components/Header.tsx");

  it("shows initials once somebody has an account", () => {
    /* The person outline was the same drawing signed in or out, so the one
       question it is asked -- am I signed in, and as whom? -- it could not
       answer. */
    expect(header).toMatch(/emailInitials\(customerEmail\)/);
    expect(header).toMatch(/className="avatar"/);
  });

  it("keeps the icon for a visitor, and for an unusable address", () => {
    // `initials ? badge : icon`, not the other way round: an empty circle
    // is worse than the drawing it replaced.
    expect(header).toMatch(/\{initials \? \(/);
    expect(header).toMatch(/<circle cx="12" cy="8" r="4" \/>/);
  });

  it("never lets the header fail on the auth service", () => {
    // A header that cannot render because auth is slow is a shop nobody
    // can browse.
    expect(header).toMatch(/catch \{ customerEmail = null; \}/);
  });
});
