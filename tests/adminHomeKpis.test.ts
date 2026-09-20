import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildKpis, stockOnHand, deltaText, toneOf, basisKeyFor,
} from "@/lib/adminHomeKpis";
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
    grossProfit: { value: 62.4 as number | null, pct: 0.08, margin: 0.451 as number | null },
    orders: { value: 9, pct: 0.125 },
    catalog: { value: 1420.5, units: 31, live: 24, priced: 21 },
    procurement: { value: 70, pct: 0.142 },
    finance: { value: 41.87, margin: 0.302 },
  };
  const WORDS = { units: "units", products: "products", priced: "priced" };

  it("reads left to right as money in, kept, orders, parked, out, profit", () => {
    // The order is a sentence about the business, so it is fixed here
    // rather than left to whoever renders it.
    expect(buildKpis(full, WORDS).map((k) => k.key))
      .toEqual(["sales", "grossProfit", "orders", "catalog", "procurement", "finance"]);
  });

  it("says what period every single figure covers", () => {
    /* THE BUG THIS EXISTS FOR. The first version put a 30-day revenue
       beside an all-time net profit with nothing to say so, and the row
       read as a shop that had kept almost twice what it took:
       $138.23 in, $259.43 kept. Both figures were right; the row was
       wrong. A basis is not documentation, it is part of the number. */
    for (const k of buildKpis(full, WORDS)) {
      expect(k.basisKey, k.key).toBeTruthy();
    }
    const by = Object.fromEntries(buildKpis(full, WORDS).map((k) => [k.key, k.basisKey]));
    expect(by.sales).toBe("kpiBasisPeriod");
    expect(by.procurement).toBe("kpiBasisPeriod");
    // Stock is not a period at all, and the books are not windowed.
    expect(by.catalog).toBe("kpiBasisNow");
    expect(by.finance).toBe("kpiBasisAllTime");
  });

  it("explains where the stock figure comes from", () => {
    /* "I don't know where $66 is coming from" was the report. It is the
       unit cost of everything on the shelves, so the note says across how
       much. */
    const k = buildKpis(full, WORDS).find((x) => x.key === "catalog")!;
    expect(k.note).toContain("31 units");
    // 21 of 24 products have a cost recorded, so the total covers 21.
    expect(k.note).toContain("21/24 priced");
  });

  it("drops the units and the products when it has no words for them", () => {
    // Rather than printing an English sentence to a Tetun reader.
    const k = buildKpis(full).find((x) => x.key === "catalog")!;
    expect(k.note).toBeNull();
  });

  it("sends each figure to the screen that explains it", () => {
    const hrefs = Object.fromEntries(buildKpis(full, WORDS).map((k) => [k.key, k.href]));
    expect(hrefs).toEqual({
      sales: "/admin/sales", grossProfit: "/admin/sales", orders: "/admin/orders",
      catalog: "/admin/stock", procurement: "/admin/procurement",
      finance: "/admin/finance",
    });
    // Every tile is a link. A dashboard tile you cannot open is a poster.
    for (const k of buildKpis(full, WORDS)) expect(k.href.startsWith("/admin/")).toBe(true);
  });

  it("builds nothing for a section this account cannot open", () => {
    /* The same rule the to-do cards follow: a figure from a screen
       somebody cannot reach is a leak, however small. */
    const only = buildKpis(
      { ...full, sales: null, grossProfit: null, orders: null, finance: null }, WORDS);
    expect(only.map((k) => k.key)).toEqual(["catalog", "procurement"]);
    expect(buildKpis({
      sales: null, grossProfit: null, orders: null,
      catalog: null, procurement: null, finance: null,
    })).toEqual([]);
  });

  it("does not report an unpriced catalogue as an empty one", () => {
    /* "$0.00" reads as a shop with nothing on its shelves. A shop that has
       filled in no unit costs has not answered the question at all. */
    const k = buildKpis({ ...full, catalog: { value: 0, units: 0, live: 12, priced: 0 } }, WORDS)
      .find((x) => x.key === "catalog")!;
    expect(k.value).toBe("—");
    expect(k.note).toBeNull();
  });

  it("passes no judgement on spending more", () => {
    // A growing shop buys more stock. Up is not bad here.
    const k = buildKpis(full, WORDS).find((x) => x.key === "procurement")!;
    expect(k.note).toBe("+14.2%");
    expect(k.tone).toBe("flat");
  });

  it("judges profit on the figure, not on the change", () => {
    // A loss is a loss whether or not last month was worse.
    const loss = buildKpis({ ...full, finance: { value: -20, margin: -0.1 } }, WORDS)
      .find((x) => x.key === "finance")!;
    expect(loss.tone).toBe("bad");
    expect(buildKpis(full, WORDS).find((x) => x.key === "finance")!.tone).toBe("good");
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

describe("the range picker changes what the figures cover", () => {
  const full = {
    sales: { value: 138.23, pct: -0.396 },
    grossProfit: { value: 62.4, pct: 0.08, margin: 0.451 },
    orders: { value: 9, pct: 0.125 },
    catalog: { value: 1420.5, units: 31, live: 24, priced: 21 },
    procurement: { value: 70, pct: 0.142 },
    finance: { value: 41.87, margin: 0.302 },
  };
  const WORDS = { units: "units", products: "products", priced: "priced" };

  it("names a basis for every range the picker offers", () => {
    for (const r of ["1d", "5d", "1m", "6m", "ytd", "1y", "5y", "max"]) {
      expect(basisKeyFor(r)).toBe(`kpiBasis_${r}`);
    }
  });

  it("carries the chosen span onto the windowed figures", () => {
    const by = Object.fromEntries(
      buildKpis(full, WORDS, basisKeyFor("6m")).map((k) => [k.key, k.basisKey]));
    expect(by.sales).toBe("kpiBasis_6m");
    expect(by.grossProfit).toBe("kpiBasis_6m");
    expect(by.orders).toBe("kpiBasis_6m");
    expect(by.procurement).toBe("kpiBasis_6m");
  });

  it("does not let the filter rewrite the two it cannot window", () => {
    /* Stock on hand is what is on the shelves at this moment and the books
       are not kept by date. A picker that silently relabelled those would
       be telling the reader something untrue about them -- which is the
       exact failure this whole basis line exists to prevent. */
    for (const r of ["1d", "6m", "max"]) {
      const by = Object.fromEntries(
        buildKpis(full, WORDS, basisKeyFor(r)).map((k) => [k.key, k.basisKey]));
      expect(by.catalog, r).toBe("kpiBasisNow");
      expect(by.finance, r).toBe("kpiBasisAllTime");
    }
  });
});

describe("gross profit with nothing costed", () => {
  const WORDS = { units: "units", products: "products", priced: "priced" };
  const base = {
    sales: { value: 138.23, pct: null },
    orders: null, catalog: null, procurement: null, finance: null,
  };

  it("is a dash, not zero", () => {
    /* THE BUG. Gross profit is revenue less what the goods cost, over the
       lines that HAVE a cost -- so a shop with unit costs on two products
       out of eight has not answered the question for the other six. The
       screen reported $0.00 against a month that took $138 in, which says
       "you made nothing" where the truth is "nobody has told me". */
    const k = buildKpis(
      { ...base, grossProfit: { value: null, pct: null, margin: null } }, WORDS)
      .find((x) => x.key === "grossProfit")!;
    expect(k.value).toBe("—");
    expect(k.tone).toBe("flat");
  });

  it("still reports a real zero as zero", () => {
    // Sold at exactly cost is a fact, and different from not knowing.
    const k = buildKpis(
      { ...base, grossProfit: { value: 0, pct: null, margin: 0 } }, WORDS)
      .find((x) => x.key === "grossProfit")!;
    expect(k.value).toBe("$0.00");
  });
});
