import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildKpis, stockOnHand, deltaText, toneOf, basisKeyFor,
} from "@/lib/adminHomeKpis";
import { STR } from "@/lib/i18n";
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
    grossProfit: {
      value: 62.4 as number | null, pct: 0.08,
      margin: 0.451 as number | null, coverage: 1,
    },
    orders: { value: 9, pct: 0.125, cancelled: 0 },
    catalog: { value: 1420.5, units: 31, pricedUnits: 31, live: 24, priced: 21 },
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

  it("counts the units the money covers, not every unit on the shelf", () => {
    /* THE BUG. `units` spans every live product and `value` spans only the
       priced ones, so the note printed one beside the other's total:
       "114 units - 3/9 priced" over $96.00, which divides out to eighty-
       four cents a unit for stock that averages several dollars. The note
       describes the figure above it or it is not a note. */
    const k = buildKpis({
      ...full,
      catalog: { value: 96, units: 114, pricedUnits: 12, live: 9, priced: 3 },
    }, WORDS).find((x) => x.key === "catalog")!;
    expect(k.note).toBe("12 units · 3/9 priced");
    expect(k.note).not.toContain("114");
    // $96 over 12 units is $8 each, which the reader can now check.
    expect(96 / 12).toBe(8);
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
    const k = buildKpis({
      ...full, catalog: { value: 0, units: 0, pricedUnits: 0, live: 12, priced: 0 },
    }, WORDS)
      .find((x) => x.key === "catalog")!;
    expect(k.value).toBe("—");
    expect(k.note).toBeNull();
  });

  it("gives every tile a sentence saying what it counts", () => {
    /* ASKED FOR IN THOSE WORDS -- "make everything explainable" -- after
       the front page said 4 orders and the orders screen listed 10. A
       tile with no explanation is a number that can only be believed. */
    for (const k of buildKpis(full, WORDS)) {
      expect(k.explainKey, k.key).toBeTruthy();
      expect(k.explainKey, k.key).toMatch(/^kpiWhy/);
    }
    expect(new Set(buildKpis(full, WORDS).map((k) => k.explainKey)).size)
      .toBe(buildKpis(full, WORDS).length);
  });

  it("says how many orders it left out, and only when it left any out", () => {
    /* THE REPORT: "the card says its only 4 in all time while theres 10
       orders in all time in orders". A cancelled order is not revenue and
       must not be counted beside one; what was wrong was saying so
       nowhere. */
    const clean = buildKpis(full, WORDS).find((x) => x.key === "orders")!;
    expect(clean.explainKey).toBe("kpiWhyOrders");

    const some = buildKpis(
      { ...full, orders: { value: 4, pct: null, cancelled: 6 } }, WORDS)
      .find((x) => x.key === "orders")!;
    expect(some.explainKey).toBe("kpiWhyOrdersCancelled");
    expect(some.explainVars?.n).toBe("6");
  });

  it("says what share of the trade its margin speaks for", () => {
    /* Gross profit counts only the lines whose cost is known. A margin
       quoted from a third of the trade with nothing saying so is a
       sample presented as a figure. */
    const whole = buildKpis(full, WORDS).find((x) => x.key === "grossProfit")!;
    expect(whole.explainKey).toBe("kpiWhyGrossProfit");

    const part = buildKpis({
      ...full, grossProfit: { value: 62.4, pct: 0.08, margin: 0.451, coverage: 0.34 },
    }, WORDS).find((x) => x.key === "grossProfit")!;
    expect(part.explainKey).toBe("kpiWhyGrossProfitPart");
    expect(part.explainVars?.pct).toBe("34%");

    /* A rounding-error gap is not worth a disclaimer: 99.6% covered is
       covered, and a tile that hedges on every load teaches the reader to
       stop reading it. */
    const nearly = buildKpis({
      ...full, grossProfit: { value: 62.4, pct: 0.08, margin: 0.451, coverage: 0.996 },
    }, WORDS).find((x) => x.key === "grossProfit")!;
    expect(nearly.explainKey).toBe("kpiWhyGrossProfit");
  });

  it("says how many products the stock total could not price", () => {
    const k = buildKpis({
      ...full,
      catalog: { value: 96, units: 114, pricedUnits: 12, live: 9, priced: 3 },
    }, WORDS).find((x) => x.key === "catalog")!;
    expect(k.explainKey).toBe("kpiWhyStockPart");
    expect(k.explainVars?.n).toBe("6");
    // And the plain sentence once every product has a cost.
    expect(buildKpis({
      ...full,
      catalog: { value: 96, units: 12, pricedUnits: 12, live: 3, priced: 3 },
    }, WORDS).find((x) => x.key === "catalog")!.explainKey).toBe("kpiWhyStock");
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

describe("the sentences under the figures", () => {
  /** Every explanation buildKpis can choose, whatever the data. */
  const KEYS = [
    "kpiWhyTitle",
    "kpiWhyRevenue", "kpiWhyGrossProfit", "kpiWhyGrossProfitPart",
    "kpiWhyOrders", "kpiWhyOrdersCancelled",
    "kpiWhyStock", "kpiWhyStockPart", "kpiWhyPurchases", "kpiWhyNetProfit",
  ];

  it("has all of them in the string table", () => {
    // t() returns the key itself for one that does not exist, so a missing
    // sentence renders as "kpiWhyOrders" on the shop's front page.
    for (const k of KEYS) expect(Object.keys(STR), k).toContain(k);
  });

  it("keeps the placeholder in every language of a sentence that has one", () => {
    /* A translation that drops {n} loses the number silently: the sentence
       still reads, and the one fact that made it worth putting on the card
       is gone. Checked per language, not on the English. */
    const withVar: Record<string, string> = {
      kpiWhyGrossProfitPart: "{pct}",
      kpiWhyOrdersCancelled: "{n}",
      kpiWhyStockPart: "{n}",
    };
    for (const [key, token] of Object.entries(withVar)) {
      for (const [i, text] of (STR as Record<string, string[]>)[key].entries()) {
        expect(text, `${key}[${i}]`).toContain(token);
      }
    }
  });

  it("puts no placeholder in a sentence nothing fills", () => {
    // The other way round: a {n} left in a sentence buildKpis passes no
    // vars for prints the braces to the shop.
    const plain = KEYS.filter((k) => !/Part$|Cancelled$/.test(k));
    for (const key of plain) {
      for (const [i, text] of (STR as Record<string, string[]>)[key].entries()) {
        expect(text, `${key}[${i}]`).not.toMatch(/\{[a-z]+\}/);
      }
    }
  });

  it("is rendered on the page, once per tile, tied to its tile", () => {
    const HOME = fs.readFileSync(
      path.join(process.cwd(), "src/components/admin/AdminHome.tsx"), "utf8")
      // Comments are prose. A guard that a comment can satisfy is a guard
      // that passes when somebody writes about the fix instead of making it.
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(HOME).toMatch(/fill\(t\(k\.explainKey, lang\), k\.explainVars\)/);
    // Tied to the tile, so a screen reader hears it as part of the link
    // rather than having to find the list and match it up by label.
    expect(HOME).toMatch(/aria-describedby=\{"kpi-why-" \+ k\.key\}/);
    expect(HOME).toMatch(/id=\{"kpi-why-" \+ k\.key\}/);
  });
});

describe("the figures the page hands to the row", () => {
  /* Comments stripped first, every time. Four separate guards in this
     project have been satisfied by a comment mentioning the thing they
     were meant to check. */
  const PAGE = fs.readFileSync(
    path.join(process.cwd(), "src/app/admin/page.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("asks both sources the same question about how many orders", () => {
    /* THE BUG. The rollup branch filtered to the statuses that count as
       sales; the order-book branch counted every status including
       cancelled. So the figure changed its meaning depending on which
       source happened to answer -- and which one answers depends on
       whether a cron has run. */
    expect(PAGE).toMatch(/rollupOrderCount\(rollup\.orders, from, to, keep\)/);
    expect(PAGE).toMatch(/keep\(o\.status\)/);
    // One predicate, passed in, rather than one written into each branch.
    expect(PAGE).not.toMatch(/rollupOrderCount\([^)]*LIVE_STATUSES/);
  });

  it("counts orders from the orders, never from their lines", () => {
    /* An order with nothing readable in its items is still an order, and
       a set of lines can never see it. That is half of why the card said
       4 while the orders screen listed 10. */
    expect(PAGE).toMatch(/orderRows\.filter/);
    expect(PAGE).toMatch(/orderDate\(o\)/);
    expect(PAGE).not.toMatch(/new Set\(\s*lines\b/);
  });

  it("takes the margin over the revenue the profit was computed on", () => {
    /* gross profit counts only the lines whose cost is known, so dividing
       it by ALL revenue mixes two bases and understates the margin by the
       width of the gap. */
    expect(PAGE).toMatch(/margin: winTotals\?\.margin/);
    expect(PAGE).not.toMatch(/gp\.current\s*\/\s*revenue/);
  });

  it("reads the rollup from the beginning, not from a moving horizon", () => {
    /* The card underneath says ALL TIME. A read that started 2000 days
       ago would have made that a lie the day the shop turned five and a
       half. */
    expect(PAGE).toMatch(/salesRollup\("1970-01-01", todayIso\(\)\)/);
    expect(PAGE).not.toMatch(/salesRollup\(shiftDays/);
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
    grossProfit: { value: 62.4, pct: 0.08, margin: 0.451, coverage: 1 },
    orders: { value: 9, pct: 0.125, cancelled: 0 },
    catalog: { value: 1420.5, units: 31, pricedUnits: 31, live: 24, priced: 21 },
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
      { ...base, grossProfit: { value: null, pct: null, margin: null, coverage: 0 } }, WORDS)
      .find((x) => x.key === "grossProfit")!;
    expect(k.value).toBe("—");
    expect(k.tone).toBe("flat");
  });

  it("still reports a real zero as zero", () => {
    // Sold at exactly cost is a fact, and different from not knowing.
    const k = buildKpis(
      { ...base, grossProfit: { value: 0, pct: null, margin: 0, coverage: 1 } }, WORDS)
      .find((x) => x.key === "grossProfit")!;
    expect(k.value).toBe("$0.00");
  });
});
