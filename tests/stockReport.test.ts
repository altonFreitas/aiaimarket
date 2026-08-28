import { describe, it, expect } from "vitest";
import { buildStockReport, sortStockRows, LOW_STOCK_THRESHOLD } from "@/lib/stockReport";
import type { Category, Order, OrderItem, Product } from "@/lib/types";

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1", seller_id: "s1", ref: "PRD-0001", name: "Item", slug: "item",
  category_id: null, price: 10, discount_price: null, sizes: [], tags: [],
  stock_status: "in", qty: 5, description: "", images: [],
  municipality: null, post: null, suku: null, landmark: null,
  pay_cod: true, pay_cop: true, pay_bank: false, pay_wallet: false, pay_fiar: false,
  archived: false, status: "approved", views: 0, wa_clicks: 0,
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

const item = (product_id: string, qty: number): OrderItem =>
  ({ product_id, seller_id: "s1", name: "x", size: "", price: 10, qty });

const order = (status: Order["status"], items: OrderItem[], created_at = "2026-06-01T00:00:00Z"): Order => ({
  id: "o" + Math.random(), ref: "R", buyer_name: "B", buyer_phone: "+670",
  items, mode: "pickup", zone_id: null, fee: 0, quote_requested: false,
  subtotal: 0, total: 0, address_line: null, municipality: null, post: null,
  suku: null, aldeia: null, landmark: null, pay_method: "cop", pay_status: "unpaid",
  proof_url: null, note: "", status, cancel_reason: null, cancel_requested_at: null,
  created_at,
});

const rowFor = (report: ReturnType<typeof buildStockReport>, id: string) =>
  report.rows.find((r) => r.id === id)!;

describe("available vs on hand", () => {
  it("subtracts unconfirmed orders, because stock is only deducted on confirm", () => {
    // The whole reason this screen exists: qty still counts units that are
    // already promised to someone whose order has not been confirmed yet.
    const r = buildStockReport(
      [product({ qty: 5 })],
      [order("new", [item("p1", 3)])],
      []
    );
    const row = rowFor(r, "p1");
    expect(row.onHand).toBe(5);
    expect(row.awaitingConfirm).toBe(3);
    expect(row.available).toBe(2);
  });

  it("does NOT subtract confirmed orders, whose units are already gone from qty", () => {
    // Double-counting these would understate availability on every order in
    // the shop at once.
    const r = buildStockReport(
      [product({ qty: 5 })],
      [order("confirmed", [item("p1", 3)])],
      []
    );
    const row = rowFor(r, "p1");
    expect(row.available).toBe(5);
    expect(row.inFulfilment).toBe(3);
    expect(row.awaitingConfirm).toBe(0);
  });

  it("counts every fulfilment stage as in transit, not just confirmed", () => {
    const r = buildStockReport(
      [product({ qty: 9 })],
      [
        order("confirmed", [item("p1", 1)]),
        order("preparing", [item("p1", 2)]),
        order("out", [item("p1", 3)]),
        order("arrived", [item("p1", 4)]),
      ],
      []
    );
    expect(rowFor(r, "p1").inFulfilment).toBe(10);
  });

  it("goes negative when more is promised than held", () => {
    const r = buildStockReport(
      [product({ qty: 2 })],
      [order("new", [item("p1", 5)])],
      []
    );
    expect(rowFor(r, "p1").available).toBe(-3);
    expect(r.summary.oversold).toBe(1);
  });

  it("ignores cancelled orders entirely", () => {
    const r = buildStockReport(
      [product({ qty: 5 })],
      [order("cancelled", [item("p1", 3)])],
      []
    );
    const row = rowFor(r, "p1");
    expect(row.available).toBe(5);
    expect(row.unitsSold).toBe(0);
    expect(row.awaitingConfirm).toBe(0);
  });

  it("sums several orders against the same product", () => {
    const r = buildStockReport(
      [product({ qty: 10 })],
      [order("new", [item("p1", 2)]), order("new", [item("p1", 3)])],
      []
    );
    expect(rowFor(r, "p1").awaitingConfirm).toBe(5);
  });
});

describe("sales", () => {
  it("counts only completed orders as sold", () => {
    const r = buildStockReport(
      [product({ qty: 5 })],
      [
        order("completed", [item("p1", 4)]),
        order("new", [item("p1", 9)]),
        order("cancelled", [item("p1", 9)]),
      ],
      []
    );
    expect(rowFor(r, "p1").unitsSold).toBe(4);
  });

  it("takes the most recent completed order as the last sale", () => {
    const r = buildStockReport(
      [product()],
      [
        order("completed", [item("p1", 1)], "2026-03-01T00:00:00Z"),
        order("completed", [item("p1", 1)], "2026-07-01T00:00:00Z"),
        order("completed", [item("p1", 1)], "2026-05-01T00:00:00Z"),
      ],
      []
    );
    expect(rowFor(r, "p1").lastSoldAt).toBe("2026-07-01T00:00:00Z");
  });

  it("reports null, not zero days, for something never sold", () => {
    // null and 0 mean opposite things here: "never" versus "today".
    const r = buildStockReport([product()], [], []);
    const row = rowFor(r, "p1");
    expect(row.lastSoldAt).toBeNull();
    expect(row.daysSinceLastSale).toBeNull();
  });
});

describe("stock value", () => {
  it("values stock at the discounted price when one is running", () => {
    // Valuing at list price would overstate the inventory of everything on
    // sale, which is exactly the stock a shop most wants a true number for.
    const r = buildStockReport([product({ qty: 4, price: 100, discount_price: 60 })], [], []);
    expect(rowFor(r, "p1").stockValue).toBe(240);
  });

  it("ignores a zero discount rather than valuing stock at nothing", () => {
    const r = buildStockReport([product({ qty: 4, price: 100, discount_price: 0 })], [], []);
    expect(rowFor(r, "p1").stockValue).toBe(400);
  });
});

describe("urgency and summary", () => {
  it("ranks oversold above out-of-stock, and selling above never-sold", () => {
    const r = buildStockReport(
      [
        product({ id: "oversold", ref: "A", qty: 1 }),
        product({ id: "outSelling", ref: "B", qty: 0, stock_status: "out" }),
        product({ id: "outDead", ref: "C", qty: 0, stock_status: "out" }),
        product({ id: "low", ref: "D", qty: LOW_STOCK_THRESHOLD, stock_status: "low" }),
        product({ id: "fine", ref: "E", qty: 50 }),
      ],
      [
        order("new", [item("oversold", 4)]),
        order("completed", [item("outSelling", 2)]),
      ],
      []
    );
    expect(rowFor(r, "oversold").urgency).toBe(4);
    expect(rowFor(r, "outSelling").urgency).toBe(3);
    expect(rowFor(r, "outDead").urgency).toBe(2);
    expect(rowFor(r, "low").urgency).toBe(1);
    expect(rowFor(r, "fine").urgency).toBe(0);
    // Worst first, so the screen opens on the problems.
    expect(r.rows[0].id).toBe("oversold");
  });

  it("never marks an archived listing urgent, and keeps it out of the summary", () => {
    // An archived product cannot be sold, so its empty shelf is not a problem
    // to fix -- and counting it would drown the numbers that are.
    const r = buildStockReport(
      [product({ id: "gone", qty: 0, stock_status: "out", archived: true })],
      [],
      []
    );
    expect(rowFor(r, "gone").urgency).toBe(0);
    expect(r.summary.skus).toBe(0);
    expect(r.summary.outOfStock).toBe(0);
  });

  it("totals units, value and never-sold across live listings only", () => {
    const r = buildStockReport(
      [
        product({ id: "a", qty: 3, price: 10 }),
        product({ id: "b", qty: 2, price: 5 }),
        product({ id: "c", qty: 99, price: 99, archived: true }),
      ],
      [order("completed", [item("a", 1)])],
      []
    );
    expect(r.summary.skus).toBe(2);
    expect(r.summary.unitsOnHand).toBe(5);
    expect(r.summary.stockValue).toBe(40);
    expect(r.summary.neverSold).toBe(1); // b only; c is archived
  });

  it("labels category with its parent path and resolves the seller name", () => {
    const cats: Category[] = [
      { id: "c1", name: "Electronics", slug: "e", parent_id: null, sort_order: 0 },
      { id: "c2", name: "Phones", slug: "p", parent_id: "c1", sort_order: 0 },
    ];
    const r = buildStockReport(
      [product({ category_id: "c2", seller_id: "s9" })],
      [],
      cats,
      [{ id: "s9", store_name: "Loja Nova" } as never]
    );
    expect(rowFor(r, "p1").categoryName).toBe("Electronics › Phones");
    expect(rowFor(r, "p1").sellerName).toBe("Loja Nova");
  });
});

describe("sortStockRows", () => {
  const report = buildStockReport(
    [
      product({ id: "a", ref: "PRD-3", name: "Cacau", qty: 1, price: 10 }),
      product({ id: "b", ref: "PRD-1", name: "Arroz", qty: 9, price: 10 }),
      product({ id: "c", ref: "PRD-2", name: "Bee", qty: 5, price: 10 }),
    ],
    [order("completed", [item("b", 7)], "2026-07-01T00:00:00Z")],
    []
  );

  it("sorts numerically in both directions", () => {
    expect(sortStockRows(report.rows, "onHand", true).map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(sortStockRows(report.rows, "onHand", false).map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  it("sorts by name and reference alphabetically", () => {
    expect(sortStockRows(report.rows, "name", false).map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(sortStockRows(report.rows, "ref", false).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("treats never-sold as the stalest, not as a gap", () => {
    // Ascending = most recently sold first, so the two that never sold sit at
    // the far end rather than pretending to be day zero.
    expect(sortStockRows(report.rows, "lastSold", false)[0].id).toBe("b");
  });

  it("does not mutate the array it is given", () => {
    const before = report.rows.map((r) => r.id);
    sortStockRows(report.rows, "onHand", true);
    expect(report.rows.map((r) => r.id)).toEqual(before);
  });
});
