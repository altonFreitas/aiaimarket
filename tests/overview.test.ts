import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  overviewSeries, earliestActivity, resaleQty, bucketKey, bucketLabels,
  weekStart, rangeSpec, purchasesResolvable, RANGES,
  compare, totalsIn, partialMonth, shiftMonth, periodShape,
  salesToPurchaseRatio, headlineMetrics, buildOverviewInsights,
  METRIC_KEYS, type MetricRow,
} from "@/lib/overview";
import { STR } from "@/lib/i18n";
import type { SalesLine } from "@/lib/sales";
import type { PurchaseOrder, PurchaseOrderItem } from "@/lib/types";

const line = (date: string, netSales: number, qty: number, extra: Partial<SalesLine> = {}): SalesLine => ({
  orderId: "o" + date + netSales, ref: "ORD", date, createdAt: date + "T00:00:00Z",
  customerPhone: "77", customerName: "Ana", municipality: "Dili",
  sellerId: null, sellerName: "", productId: "p1", productName: "P",
  categoryId: null, categoryName: "", qty, unitPrice: netSales / (qty || 1),
  listPrice: netSales / (qty || 1), discount: 0, netSales,
  unitCost: null, cost: null, grossProfit: null, margin: null,
  status: "completed", payStatus: "paid", payMethod: "cod",
  expectedDelivery: null, deliveredAt: null, invoicedAt: null,
  ...extra,
} as SalesLine);

const item = (qty: number, unit_price: number, category = "goods_for_resale"): PurchaseOrderItem =>
  ({ qty, unit_price, category } as PurchaseOrderItem);

const po = (
  order_date: string, items: PurchaseOrderItem[], extra: Partial<PurchaseOrder> = {}
): PurchaseOrder => ({
  id: "po" + order_date + items.length, ref: "PO", supplier_id: "s1",
  order_date, status: "received", items,
  fx_rate: 1, tax: 0, shipping: 0, discount: 0,
  ...extra,
} as PurchaseOrder);

describe("units purchased counts goods for resale only", () => {
  it("ignores packaging, equipment and services", () => {
    // THE DECISION THIS FILE EXISTS TO PROTECT. poQty() sums every line on
    // an order. Comparing units sold against a total that includes boxes,
    // an office chair and a delivery fee is not a stock-movement chart.
    const order = po("2026-09-01", [
      item(100, 2, "goods_for_resale"),
      item(500, 0.1, "packaging"),
      item(1, 300, "equipment"),
      item(1, 50, "services"),
    ]);
    expect(resaleQty(order)).toBe(100);
  });

  it("counts nothing on an order with no resale lines", () => {
    expect(resaleQty(po("2026-09-01", [item(1, 300, "equipment")]))).toBe(0);
  });
});

describe("money out is the landed cost", () => {
  it("includes tax and freight, which is what leaves the bank", () => {
    const order = po("2026-09-01", [item(10, 5)], { tax: 3, shipping: 7, discount: 2 });
    // 10*5 = 50, plus 3 + 7 - 2 = 8.
    const t = totalsIn([], [order], { from: "2026-09-01", to: "2026-09-30" });
    expect(t.purchaseCost).toBe(58);
  });

  it("converts a foreign-currency order at its own rate", () => {
    const order = po("2026-09-01", [item(10, 5)], { fx_rate: 2 });
    const t = totalsIn([], [order], { from: "2026-09-01", to: "2026-09-30" });
    expect(t.purchaseCost).toBe(100);
  });

  it("leaves a cancelled order out entirely", () => {
    // It is not a purchase. Counting it inflates spend and makes the
    // comparison against sales wrong in the direction that looks alarming.
    const order = po("2026-09-01", [item(10, 5)], { status: "cancelled" });
    const t = totalsIn([], [order], { from: "2026-09-01", to: "2026-09-30" });
    expect(t.purchaseCost).toBe(0);
    expect(t.qtyPurchased).toBe(0);
  });
});

describe("gross profit is not revenue minus purchases", () => {
  it("is null when no sold line carried a cost, whatever was bought", () => {
    // Revenue 100, purchases 500. A screen that called -400 "gross profit"
    // would report a healthy shop as catastrophic every time it restocked.
    const t = totalsIn(
      [line("2026-09-02", 100, 1)],
      [po("2026-09-01", [item(100, 5)])],
      { from: "2026-09-01", to: "2026-09-30" });
    expect(t.revenue).toBe(100);
    expect(t.purchaseCost).toBe(500);
    expect(t.grossProfit).toBeNull();
  });

  it("comes from the cost of goods SOLD when the lines carry it", () => {
    const sold = line("2026-09-02", 100, 2, { cost: 60, grossProfit: 40, margin: 0.4, unitCost: 30 });
    const t = totalsIn([sold], [], { from: "2026-09-01", to: "2026-09-30" });
    expect(t.grossProfit).toBe(40);
  });
});

describe("the sales-to-purchase ratio", () => {
  it("is revenue over spend", () => {
    expect(salesToPurchaseRatio(
      { revenue: 300, purchaseCost: 100, qtySold: 0, qtyPurchased: 0, grossProfit: null }
    )).toBe(3);
  });

  it("is null rather than infinity in a month with no buying", () => {
    expect(salesToPurchaseRatio(
      { revenue: 300, purchaseCost: 0, qtySold: 0, qtyPurchased: 0, grossProfit: null }
    )).toBeNull();
  });
});

describe("the ranges", () => {
  it("pairs every range with a bucket that fits it", () => {
    // A day read in hours, five days in days, half a year in weeks, longer
    // in months. Choosing the bucket from the window is what stops anybody
    // asking for five years by the hour.
    const byKey = Object.fromEntries(RANGES.map((r) => [r.key, r.bucket]));
    expect(byKey).toEqual({
      "1d": "hour", "5d": "day", "1m": "day", "6m": "week",
      ytd: "month", "1y": "month", "5y": "month", max: "month",
    });
  });

  it("falls back to a real range rather than crashing on a bad key", () => {
    expect(rangeSpec("nonsense" as never).bucket).toBeTruthy();
  });

  it("knows purchases cannot be resolved by the hour", () => {
    // purchase_orders.order_date is a DATE. There is no time of day on a
    // purchase order, so an hourly chart would put every order ever placed
    // at midnight and invite somebody to read "we buy at midnight".
    expect(purchasesResolvable("hour")).toBe(false);
    for (const b of ["day", "week", "month"] as const) {
      expect([b, purchasesResolvable(b)]).toEqual([b, true]);
    }
  });
});

describe("bucketing", () => {
  it("keys each bucket off the right slice", () => {
    expect(bucketKey("hour", "2026-09-04T14")).toBe("2026-09-04T14");
    expect(bucketKey("day", "2026-09-04T14")).toBe("2026-09-04");
    expect(bucketKey("month", "2026-09-04")).toBe("2026-09");
  });

  it("puts a week on its Monday, from either end of it", () => {
    // 2026-09-04 is a Friday; 2026-09-06 the Sunday after it. Both belong
    // to the week beginning Monday the 31st of August.
    expect(weekStart("2026-09-04")).toBe("2026-08-31");
    expect(weekStart("2026-09-06")).toBe("2026-08-31");
    expect(weekStart("2026-08-31")).toBe("2026-08-31");
    // The Monday after is its own week, not the previous one.
    expect(weekStart("2026-09-07")).toBe("2026-09-07");
  });

  it("labels the axis short and the tooltip in full", () => {
    expect(bucketLabels("hour", "2026-09-04T14"))
      .toEqual({ label: "14:00", full: "2026-09-04 14:00" });
    expect(bucketLabels("day", "2026-09-04").label).toBe("04/09");
    expect(bucketLabels("month", "2026-09").label).toBe("09/26");
  });
});

describe("overviewSeries", () => {
  const lines = [line("2026-09-02", 30, 3), line("2026-09-04", 10, 1)];
  const pos = [po("2026-09-03", [item(5, 4)])];

  it("gives one point per day across a five-day window", () => {
    const s = overviewSeries(lines, pos, "5d", "2026-09-04");
    expect(s.map((p) => p.key))
      .toEqual(["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]);
  });

  it("keeps an empty day as a zero rather than dropping it", () => {
    const s = overviewSeries(lines, pos, "5d", "2026-09-04");
    const quiet = s.find((p) => p.key === "2026-09-01")!;
    expect(quiet).toMatchObject({ revenue: 0, purchaseCost: 0 });
    // And the days that did trade are on the right points.
    expect(s.find((p) => p.key === "2026-09-02")!.revenue).toBe(30);
    expect(s.find((p) => p.key === "2026-09-03")!.purchaseCost).toBe(20);
  });

  it("draws no purchase figures at all on the intraday range", () => {
    // THE ONE THAT MATTERS. Every purchase would otherwise land at 00:00.
    const s = overviewSeries(lines, pos, "1d", "2026-09-04");
    expect(s).toHaveLength(24);
    expect(s.every((p) => p.purchaseCost === 0 && p.qtyPurchased === 0)).toBe(true);
  });

  it("gives twenty-four hourly points ending at the current hour", () => {
    const s = overviewSeries([], [], "1d", "2026-09-04");
    expect(s).toHaveLength(24);
    expect(s.every((p) => /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(p.key))).toBe(true);
    expect(s.every((p) => /^\d{2}:00$/.test(p.label))).toBe(true);
  });

  it("puts an intraday sale in the shop's own hour, not UTC's", () => {
    /* THE ONE THAT NEARLY GOT AWAY. Dili is UTC+9. Bucketing on the raw
     * timestamp -- createdAt.slice(0,13) -- passes every other test in
     * this file and draws the shop's busiest hour nine hours from where it
     * happened, so the morning rush appears at midnight.
     *
     * 01:00 UTC is 10:00 in Dili. */
    const sale = line("2026-09-04", 42, 2);
    sale.createdAt = "2026-09-04T01:00:00Z";
    // 12:00 UTC = 21:00 Dili, so the last 24 hours include 10:00 that day.
    const s = overviewSeries([sale], [], "1d", "2026-09-04",
      Date.parse("2026-09-04T12:00:00Z"));

    const atTen = s.find((p) => p.label === "10:00");
    expect(atTen).toBeTruthy();
    expect(atTen!.revenue).toBe(42);
    // And nothing at midnight, which is where a UTC bucket would put it.
    expect(s.find((p) => p.label === "01:00")?.revenue ?? 0).toBe(0);
  });

  it("starts a year-to-date window at the first of January", () => {
    const s = overviewSeries(
      [line("2026-03-01", 10, 1)], [], "ytd", "2026-09-04");
    expect(s[0].key).toBe("2026-01");
    expect(s[s.length - 1].key).toBe("2026-09");
  });

  it("shows the quiet days on a short window rather than hiding them", () => {
    // Three days of trading in a five-day window is three days of trading,
    // not five. The short ranges therefore do NOT clamp to the first sale.
    const s = overviewSeries([line("2026-09-04", 10, 1)], [], "5d", "2026-09-04");
    expect(s).toHaveLength(5);
    expect(s.filter((p) => p.revenue === 0)).toHaveLength(4);
  });

  it("never runs further back than the first thing that happened", () => {
    // A shop three months old asking for five years should not be shown
    // fifty-seven empty months before it existed.
    const s = overviewSeries(
      [line("2026-07-04", 10, 1)], [], "5y", "2026-09-04");
    expect(s[0].key).toBe("2026-07");
  });

  it("runs from the first activity on EITHER side for max", () => {
    const s = overviewSeries(
      [line("2026-08-01", 10, 1)], [po("2026-05-01", [item(1, 1)])], "max", "2026-09-04");
    expect(s[0].key).toBe("2026-05");
  });

  it("gives the current bucket even with no data at all", () => {
    expect(overviewSeries([], [], "max", "2026-09-04").map((p) => p.key)).toEqual(["2026-09"]);
  });

  it("is bounded on every bucket, so one bad date cannot spin a render", () => {
    const ancient = [line("1900-01-01", 1, 1)];
    for (const r of RANGES) {
      const n = overviewSeries(ancient, [], r.key, "2400-01-01").length;
      expect([r.key, n <= 600]).toEqual([r.key, true]);
    }
  });

  it("finds the earliest day across both sides", () => {
    expect(earliestActivity(
      [line("2026-08-01", 1, 1)], [po("2026-05-01", [item(1, 1)])])).toBe("2026-05-01");
    expect(earliestActivity([], [])).toBeNull();
  });
});

describe("compare", () => {
  it("reports the absolute and the percentage difference", () => {
    expect(compare(142, 125)).toMatchObject({ current: 142, previous: 125, diff: 17 });
    expect(compare(142, 125).pct).toBeCloseTo(0.136, 3);
  });

  it("says nothing rather than infinity with no previous period", () => {
    // A first month of trading must not print +Infinity%.
    expect(compare(142, 0).pct).toBeNull();
  });

  it("reports a fall as negative", () => {
    expect(compare(80, 100).pct).toBe(-0.2);
    expect(compare(80, 100).diff).toBe(-20);
  });
});

describe("like for like", () => {
  it("clamps a part-month window to days already elapsed", () => {
    expect(partialMonth("2026-09", 4)).toEqual({ from: "2026-09-01", to: "2026-09-04" });
  });

  it("clamps to a shorter month rather than inventing a 31st of February", () => {
    expect(partialMonth("2026-02", 31)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(partialMonth("2024-02", 31).to).toBe("2024-02-29");
  });

  it("shifts months across year boundaries in both directions", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-09", -12)).toBe("2025-09");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
  });

  it("knows when a month is finished", () => {
    expect(periodShape("2026-09-04")).toMatchObject({ dayOfMonth: 4, complete: false });
    expect(periodShape("2026-09-30").complete).toBe(true);
    expect(periodShape("2026-02-28").complete).toBe(true);
  });
});

describe("headlineMetrics", () => {
  /* THE TRAP. Four days into September, a whole-month comparison reports a
   * business doing exactly as well as last month as having collapsed. */
  const lines = [
    // August: $100 over the first four days, $900 over the rest.
    line("2026-08-02", 50, 5), line("2026-08-03", 50, 5),
    line("2026-08-20", 900, 90),
    // September: $100 over the first four days. Same pace as August.
    line("2026-09-02", 50, 5), line("2026-09-03", 50, 5),
  ];

  it("compares the same span of each month, not part against whole", () => {
    const m = headlineMetrics(lines, [], "2026-09-04");
    const revenue = m.find((x) => x.key === "revenue")!;
    // 1-4 Sep ($100) against 1-4 Aug ($100): flat, which is the truth.
    expect(revenue.current).toBe(100);
    expect(revenue.mom!.previous).toBe(100);
    expect(revenue.mom!.pct).toBe(0);
  });

  it("would have reported a collapse if it compared whole months", () => {
    // Proof the guard above is doing something: the whole of August is
    // $1000 against September's $100.
    const whole = totalsIn(lines, [], { from: "2026-08-01", to: "2026-08-31" });
    expect(whole.revenue).toBe(1000);
    expect(compare(100, whole.revenue).pct).toBeCloseTo(-0.9, 5);
  });

  it("compares whole months once the month is over", () => {
    const m = headlineMetrics(lines, [], "2026-08-31");
    expect(m.find((x) => x.key === "revenue")!.current).toBe(1000);
  });

  it("compares against the same span last year", () => {
    const withLastYear = [...lines, line("2025-09-02", 80, 8)];
    const m = headlineMetrics(withLastYear, [], "2026-09-04");
    const revenue = m.find((x) => x.key === "revenue")!;
    expect(revenue.yoy!.previous).toBe(80);
    expect(revenue.yoy!.pct).toBeCloseTo(0.25, 5);
  });

  it("returns every headline metric", () => {
    const m = headlineMetrics(lines, [], "2026-09-04");
    expect(m.map((x) => x.key)).toEqual([...METRIC_KEYS]);
  });

  it("reports no comparison rather than a wrong one on a new shop", () => {
    const m = headlineMetrics([line("2026-09-02", 50, 5)], [], "2026-09-04");
    const revenue = m.find((x) => x.key === "revenue")!;
    expect(revenue.current).toBe(50);
    expect(revenue.mom!.pct).toBeNull();
    expect(revenue.yoy!.pct).toBeNull();
  });

  it("carries the purchase side through the same windows", () => {
    const m = headlineMetrics(
      [], [po("2026-09-02", [item(10, 5)]), po("2026-08-02", [item(20, 5)])], "2026-09-04");
    const spend = m.find((x) => x.key === "purchaseCost")!;
    expect(spend.current).toBe(50);
    expect(spend.mom!.previous).toBe(100);
    expect(spend.mom!.pct).toBe(-0.5);
  });
});

describe("the written summary", () => {
  const metrics = (over: Partial<Record<string, MetricRow>>): MetricRow[] =>
    METRIC_KEYS.map((key) => over[key] ?? { key, current: 0, mom: null, yoy: null });
  const money = (n: number) => `$${n.toFixed(2)}`;

  const row = (key: string, yoyPct: number | null, momPct: number | null = null): MetricRow => ({
    key: key as MetricRow["key"], current: 100,
    yoy: yoyPct == null ? null : { current: 100, previous: 80, diff: 20, pct: yoyPct },
    mom: momPct == null ? null : { current: 100, previous: 90, diff: 10, pct: momPct },
  });

  it("says nothing at all with nothing to compare", () => {
    expect(buildOverviewInsights({ metrics: metrics({}), money })).toEqual([]);
  });

  it("calls out sales growing faster than spend", () => {
    const out = buildOverviewInsights({
      metrics: metrics({ revenue: row("revenue", 0.2), purchaseCost: row("purchaseCost", 0.08) }),
      money,
    });
    expect(out.map((i) => i.kind)).toContain("growing_well");
    expect(out.find((i) => i.kind === "growing_well")!.tone).toBe("good");
  });

  it("calls out spend growing faster than sales", () => {
    const out = buildOverviewInsights({
      metrics: metrics({ revenue: row("revenue", 0.02), purchaseCost: row("purchaseCost", 0.3) }),
      money,
    });
    const found = out.find((i) => i.kind === "spending_faster")!;
    expect(found).toBeTruthy();
    expect(found.tone).toBe("bad");
  });

  it("does not call spending more, on its own, bad news", () => {
    // A growing shop buys more. Whether that is a problem is the
    // sales-versus-spend line's job, not this one's.
    const out = buildOverviewInsights({
      metrics: metrics({ purchaseCost: row("purchaseCost", 0.3) }), money,
    });
    expect(out.find((i) => i.kind === "spend_up")!.tone).toBe("neutral");
  });

  it("flags buying more while selling less", () => {
    const out = buildOverviewInsights({
      metrics: metrics({
        qtySold: row("qtySold", -0.1), qtyPurchased: row("qtyPurchased", 0.4),
      }), money,
    });
    expect(out.map((i) => i.kind)).toContain("buying_more_selling_less");
  });

  it("does not flag it when both are rising", () => {
    const out = buildOverviewInsights({
      metrics: metrics({
        qtySold: row("qtySold", 0.1), qtyPurchased: row("qtyPurchased", 0.4),
      }), money,
    });
    expect(out.map((i) => i.kind)).not.toContain("buying_more_selling_less");
  });

  it("names the biggest customer and supplier when there are any", () => {
    const out = buildOverviewInsights({
      metrics: metrics({}), money,
      topCustomer: { label: "Ana", value: 500 },
      topSupplier: { label: "Fornecedor X", value: 900 },
    });
    expect(out.find((i) => i.kind === "top_customer")!.vars)
      .toEqual({ name: "Ana", value: "$500.00" });
    expect(out.find((i) => i.kind === "top_supplier")!.vars.name).toBe("Fornecedor X");
  });

  it("stays short", () => {
    // A summary of eleven bullets is a second dashboard in prose.
    const out = buildOverviewInsights({
      metrics: metrics({
        revenue: row("revenue", 0.2, 0.1), purchaseCost: row("purchaseCost", 0.08),
        qtySold: row("qtySold", -0.1), qtyPurchased: row("qtyPurchased", 0.4),
      }),
      money,
      topCustomer: { label: "Ana", value: 500 },
      topSupplier: { label: "X", value: 900 },
    });
    expect(out.length).toBeLessThanOrEqual(7);
  });
});

describe("every sentence the summary can produce has words", () => {
  /* tests/i18n.test.ts scans for LITERAL t("key") calls and cannot see
   * these: the component builds them as t("ovi_" + kind). t() returns the
   * key when it is missing, so a gap here renders "ovi_spending_faster" on
   * the dashboard, in three languages, until somebody looks at the screen.
   * The union is closed, so it can be checked exhaustively instead. */
  const KINDS = [
    "revenue_up", "revenue_down", "spend_up", "spend_down",
    "growing_well", "spending_faster", "buying_more_selling_less",
    "month_better", "month_worse", "top_customer", "top_supplier",
  ] as const;

  it("has a string for every insight kind", () => {
    const missing = KINDS.filter((k) => !(`ovi_${k}` in STR));
    expect(missing).toEqual([]);
  });

  it("uses only placeholders the code actually substitutes", () => {
    // A sentence asking for {name} where the code supplies {pct} renders
    // the braces to the reader.
    const SUPPLIED: Record<string, string[]> = {
      revenue_up: ["pct"], revenue_down: ["pct"],
      spend_up: ["pct"], spend_down: ["pct"],
      growing_well: ["sales", "spend"], spending_faster: ["sales", "spend"],
      buying_more_selling_less: ["bought", "sold"],
      month_better: ["pct"], month_worse: ["pct"],
      top_customer: ["name", "value"], top_supplier: ["name", "value"],
    };
    const bad: string[] = [];
    for (const k of KINDS) {
      for (const text of STR[`ovi_${k}`] ?? []) {
        for (const m of text.matchAll(/\{(\w+)\}/g)) {
          if (!SUPPLIED[k].includes(m[1])) bad.push(`ovi_${k}: {${m[1]}}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("has a label for every range tab and every bucket", () => {
    // Also built by concatenation: t("rng_" + key), t("bkt_" + bucket).
    const missingRanges = RANGES.filter((r) => !(`rng_${r.key}` in STR)).map((r) => r.key);
    expect(missingRanges).toEqual([]);
    const buckets = [...new Set(RANGES.map((r) => r.bucket))];
    expect(buckets.filter((b) => !(`bkt_${b}` in STR))).toEqual([]);
  });

  it("has a label for every headline metric", () => {
    // Same blind spot: the component reads these through a lookup table.
    const LABELS = [
      "totalSalesRevenue", "totalPurchaseValue", "quantitySold",
      "quantityPurchased", "grossProfit", "salesToPurchaseRatio",
    ];
    expect(LABELS.length).toBe(METRIC_KEYS.length);
    expect(LABELS.filter((k) => !(k in STR))).toEqual([]);
  });
});

describe("the selected range is visible", () => {
  /* This is a stylesheet bug, so the test reads the stylesheet. .chip.is-on
   * had no rule for the whole life of the class: every range button looked
   * like every other one, and there was no way to tell which was chosen.
   * TypeScript cannot catch a class that is applied and never styled, and
   * neither can a render test that only measures geometry. */
  const CSS = fs.readFileSync(
    path.join(__dirname, "..", "src", "app", "globals.css"), "utf8");

  it("styles every state class the components actually apply", () => {
    const files = [
      "src/components/admin/BusinessOverview.tsx",
      "src/components/admin/sales/SalesDashboard.tsx",
      "src/components/seller/SellerSales.tsx",
    ];
    const missing: string[] = [];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
      // Matches: "chip" + (cond ? " is-on" : "")
      for (const m of src.matchAll(/"([a-z-]+)"\s*\+\s*\([^)]*\?\s*" ([a-z-]+)"/g)) {
        const rule = `.${m[1]}.${m[2]}`;
        if (!CSS.includes(rule + "{")) missing.push(`${rel}: ${rule}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("fills the chosen chip rather than only outlining it", () => {
    // "Filled" is the ask: an outline shift is not visible enough across a
    // row of eight.
    const rule = /\.chip\.is-on\{([^}]*)\}/.exec(CSS);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/background:/);
    expect(rule![1]).toMatch(/color:#fff/);
  });
});
