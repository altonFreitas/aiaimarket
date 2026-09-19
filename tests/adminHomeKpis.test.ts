import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildKpis, stockOnHand, deltaText, toneOf } from "@/lib/adminHomeKpis";
import type { Product } from "@/lib/types";

/* ONE FIGURE FROM EACH AREA, ON THE FRONT PAGE.
 *
 * Home used to carry six figures, all of them from Sales and Procurement.
 * Catalog and the books were not represented at all, and reaching the
 * second thing on the page meant scrolling past the first.
 */

const product = (p: Partial<Product>): Product => ({
  id: "p1", seller_id: "s", ref: "R", name: "x", slug: "x", category_id: null,
  price: 10, discount_price: null, sizes: [], tags: [], stock_status: "in",
  qty: 0, description: "", images: [], municipality: null, post: null,
  suku: null, landmark: null, pay_cod: true, pay_cop: true, pay_bank: true,
  pay_wallet: true, pay_fiar: false, archived: false, status: "approved",
  views: 0, wa_clicks: 0, created_at: "2026-01-01T00:00:00Z", ...p,
} as Product);

describe("what the shelves are worth", () => {
  it("values stock at what the shop paid, not at what it hopes to get", () => {
    /* This is money already spent and still tied up, which is the question
       being asked. Retail value would be a forecast. */
    const products = [product({ id: "a", qty: 3, price: 50 }), product({ id: "b", qty: 2, price: 80 })];
    const costs = new Map([["a", 10], ["b", 20]]);
    expect(stockOnHand(products, costs).value).toBe(70);   // 3*10 + 2*20
  });

  it("leaves out what is not for sale", () => {
    // An archived product and one still awaiting approval are not stock
    // the shop can sell today.
    const products = [
      product({ id: "a", qty: 5, archived: true }),
      product({ id: "b", qty: 5, status: "pending" }),
      product({ id: "c", qty: 5 }),
    ];
    const costs = new Map([["a", 10], ["b", 10], ["c", 10]]);
    const out = stockOnHand(products, costs);
    expect(out.value).toBe(50);
    expect(out.live).toBe(1);
  });

  it("counts how much of the catalogue it can actually price", () => {
    /* A product with no recorded unit cost contributes nothing. Reporting
       the total without saying so would quietly understate the shelves. */
    const products = [product({ id: "a", qty: 2 }), product({ id: "b", qty: 9 })];
    const out = stockOnHand(products, new Map([["a", 10]]));
    expect(out.value).toBe(20);
    expect(out.live).toBe(2);
    expect(out.priced).toBe(1);
  });

  it("treats a negative quantity as none rather than as a credit", () => {
    // A ledger that has gone wrong must not make the shelves look cheaper.
    const out = stockOnHand([product({ id: "a", qty: -4 })], new Map([["a", 10]]));
    expect(out.value).toBe(0);
    expect(out.units).toBe(0);
  });
});

describe("the comparison under each figure", () => {
  it("says nothing rather than +100% when there is no basis", () => {
    /* A previous period with nothing in it makes every first sale look
       like infinite growth. */
    expect(deltaText(null)).toBeNull();
    expect(deltaText(Infinity)).toBeNull();
    expect(deltaText(0.142)).toBe("+14.2%");
    expect(deltaText(-0.396)).toBe("-39.6%");
  });

  it("only calls a change good or bad when the direction means something", () => {
    expect(toneOf(0.1)).toBe("good");
    expect(toneOf(-0.1)).toBe("bad");
    expect(toneOf(0)).toBe("flat");
    expect(toneOf(null)).toBe("flat");
  });
});

describe("the row itself", () => {
  const full = {
    sales: { value: 138.23, pct: -0.396 },
    catalog: { value: 1420.5, live: 24, priced: 21 },
    procurement: { value: 70, pct: 0.142 },
    finance: { value: 41.87, margin: 0.302 },
  };

  it("reads left to right as money in, parked, out, kept", () => {
    // The order is a sentence about the business, so it is fixed here
    // rather than left to whoever renders it.
    expect(buildKpis(full).map((k) => k.key))
      .toEqual(["sales", "catalog", "procurement", "finance"]);
  });

  it("sends each figure to the screen that explains it", () => {
    const hrefs = Object.fromEntries(buildKpis(full).map((k) => [k.key, k.href]));
    expect(hrefs).toEqual({
      sales: "/admin/sales", catalog: "/admin/stock",
      procurement: "/admin/procurement", finance: "/admin/finance",
    });
  });

  it("builds nothing for a section this account cannot open", () => {
    /* The same rule the to-do cards follow: a figure from a screen
       somebody cannot reach is a leak, however small. */
    const only = buildKpis({ ...full, sales: null, finance: null });
    expect(only.map((k) => k.key)).toEqual(["catalog", "procurement"]);
    expect(buildKpis({ sales: null, catalog: null, procurement: null, finance: null })).toEqual([]);
  });

  it("does not report an unpriced catalogue as an empty one", () => {
    /* "$0.00" reads as a shop with nothing on its shelves. A shop that has
       filled in no unit costs has not answered the question at all. */
    const k = buildKpis({ ...full, catalog: { value: 0, live: 12, priced: 0 } })
      .find((x) => x.key === "catalog")!;
    expect(k.value).toBe("—");
    expect(k.note).toBeNull();
  });

  it("passes no judgement on spending more", () => {
    // A growing shop buys more stock. Up is not bad here.
    const k = buildKpis(full).find((x) => x.key === "procurement")!;
    expect(k.note).toBe("+14.2%");
    expect(k.tone).toBe("flat");
  });

  it("judges profit on the figure, not on the change", () => {
    // A loss is a loss whether or not last month was worse.
    const loss = buildKpis({ ...full, finance: { value: -20, margin: -0.1 } })
      .find((x) => x.key === "finance")!;
    expect(loss.tone).toBe("bad");
    expect(buildKpis(full).find((x) => x.key === "finance")!.tone).toBe("good");
  });
});

describe("the page hands over only what the account may see", () => {
  const PAGE = fs.readFileSync(
    path.join(process.cwd(), "src/app/admin/page.tsx"), "utf8");

  it("guards each figure on its own section", () => {
    expect(PAGE).toMatch(/canSales && revenue/);
    expect(PAGE).toMatch(/canProcurement && spend/);
    expect(PAGE).toMatch(/canCatalog && sales/);
    // The books sit under Settings, being more sensitive than margin.
    expect(PAGE).toMatch(/canFinance = canSee\(actor, "settings"\)/);
  });

  it("does not read the books for an account without Settings", () => {
    for (const call of ["financeTables()", "cashSideTotals()", "adminSellerLedgers()"]) {
      const re = new RegExp("canFinance \\? " + call.replace("(", "\\(").replace(")", "\\)"));
      expect(PAGE, call).toMatch(re);
    }
  });
});
