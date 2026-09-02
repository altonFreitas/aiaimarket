import { describe, it, expect } from "vitest";
import { packSalesLines, unpackSalesLines } from "@/lib/salesWire";
import { buildSalesLines } from "@/lib/sales";
import type { SalesLine } from "@/lib/sales";
import type { Order, Product, Category, Seller } from "@/lib/types";

/* The dashboard is unchanged only if what comes out is what went in. Every
 * test here is a form of that one claim. */

/* The derived fields are computed here rather than typed, so an override
 * of qty or a price cannot leave the fixture internally inconsistent --
 * which is exactly what it did on the first run of these tests, and what
 * the unpacker correctly refused to reproduce. */
const line = (over: Partial<SalesLine> = {}): SalesLine => {
  const base = {
    orderId: "o1", ref: "CD20265678000001", date: "2026-08-27",
    createdAt: "2026-08-27T02:15:00.000Z",
    customerPhone: "+67077125678", customerName: "Zita Felicia", municipality: "Dili",
    sellerId: null, sellerName: "",
    productId: "p1", productName: "Nike Adidas Samba", categoryId: "c1", categoryName: "Sapatu",
    qty: 2, unitPrice: 45, listPrice: 50, netSales: 90, unitCost: 20.74 as number | null,
    status: "completed", payStatus: "paid", payMethod: "cod",
    expectedDelivery: "2026-08-28", deliveredAt: "2026-08-28", invoicedAt: null,
    ...over,
  } as SalesLine;

  const cost = base.unitCost == null ? null : base.unitCost * base.qty;
  const grossProfit = cost == null ? null : base.netSales - cost;
  return {
    ...base,
    discount: (base.listPrice - base.unitPrice) * base.qty,
    cost,
    grossProfit,
    margin: grossProfit == null || base.netSales === 0 ? null : grossProfit / base.netSales,
  };
};

const roundTrip = (ls: SalesLine[]) => unpackSalesLines(packSalesLines(ls));

describe("packing the order book", () => {
  it("returns exactly what it was given", () => {
    const ls = [line()];
    expect(roundTrip(ls)).toEqual(ls);
  });

  it("keeps nulls null, and empty strings empty", () => {
    // A missing seller and a seller called "" are different facts and the
    // dashboard distinguishes them.
    const ls = [line({ sellerId: null, sellerName: "", categoryId: null, categoryName: "" })];
    const [out] = roundTrip(ls);
    expect(out.sellerId).toBeNull();
    expect(out.sellerName).toBe("");
    expect(out.categoryId).toBeNull();
    expect(out.categoryName).toBe("");
  });

  it("keeps an unknown cost unknown, not zero", () => {
    // Zero cost would report 100% margin on every uncosted line.
    const [out] = roundTrip([line({ unitCost: null, cost: null, grossProfit: null, margin: null })]);
    expect(out.unitCost).toBeNull();
    expect(out.cost).toBeNull();
    expect(out.grossProfit).toBeNull();
    expect(out.margin).toBeNull();
  });

  it("recomputes the derived fields rather than trusting the wire", () => {
    // Sent with deliberately wrong derived values: the unpacked line must
    // carry the correct ones, computed from the inputs.
    const wrong = { ...line(), discount: 99999, cost: 99999, grossProfit: 99999, margin: 9 };
    const [out] = roundTrip([wrong]);
    expect(out.discount).toBe(10);        // (50 - 45) * 2
    expect(out.cost).toBeCloseTo(41.48, 6);
    expect(out.grossProfit).toBeCloseTo(48.52, 6);
    expect(out.margin).toBeCloseTo(48.52 / 90, 9);
  });

  it("survives a JSON round trip, which is what actually happens", () => {
    const ls = [line(), line({ orderId: "o2", productId: "p2", unitCost: null })];
    const overTheWire = JSON.parse(JSON.stringify(packSalesLines(ls)));
    expect(unpackSalesLines(overTheWire)).toEqual(ls.map((l) =>
      l.unitCost == null ? { ...l, cost: null, grossProfit: null, margin: null } : l));
  });

  it("keeps every line distinct when many share the same strings", () => {
    const ls = Array.from({ length: 50 }, (_, i) =>
      line({ orderId: "o" + i, qty: i + 1, netSales: (i + 1) * 45 }));
    const out = roundTrip(ls);
    expect(out).toEqual(ls);
    expect(new Set(out.map((l) => l.orderId)).size).toBe(50);
  });

  it("does not confuse two fields that hold the same text", () => {
    // deliveredAt and expectedDelivery share a value here; a packer keyed
    // on value rather than position would still have to keep them apart.
    const ls = [line({ expectedDelivery: "2026-09-01", deliveredAt: "2026-09-01",
                       invoicedAt: "2026-09-01" })];
    expect(roundTrip(ls)).toEqual(ls);
  });

  it("handles an empty book", () => {
    expect(roundTrip([])).toEqual([]);
    expect(packSalesLines([]).dict).toEqual([]);
  });

  it("passes plain lines straight through, for a caller not yet converted", () => {
    const ls = [line()];
    expect(unpackSalesLines(ls)).toBe(ls);
  });
});

describe("packing real lines from real orders", () => {
  const product: Product = {
    id: "p1", seller_id: "sel1", ref: "PRD-001", name: "Widget", slug: "widget",
    category_id: "c1", price: 10, discount_price: null, sizes: [], tags: [],
    stock_status: "in", qty: 5, description: "", images: [], municipality: null,
    post: null, suku: null, landmark: null, pay_cod: true, pay_cop: false,
    pay_bank: false, pay_wallet: false, pay_fiar: false, archived: false,
    status: "approved", views: 0, wa_clicks: 0, created_at: "2026-01-01T00:00:00Z",
  } as Product;
  const category = { id: "c1", name: "Furniture", slug: "f", parent_id: null, sort_order: 0 } as Category;
  const seller = { id: "sel1", store_name: "Ana's Store" } as Seller;
  const order = (id: string, over: Partial<Order> = {}): Order => ({
    id, ref: "DL-" + id, buyer_name: "Bob", buyer_phone: "77000001",
    items: [{ product_id: "p1", seller_id: "sel1", name: "Widget", size: "", price: 10, qty: 2 }],
    mode: "delivery", fee: 3, subtotal: 20, total: 23, municipality: "Dili",
    pay_method: "cod", pay_status: "unpaid", status: "completed",
    created_at: "2026-06-01T10:00:00Z", ...over,
  } as unknown as Order);

  it("round-trips lines built the way the dashboard builds them", () => {
    const lines = buildSalesLines(
      [order("a"), order("b", { status: "cancelled" }), order("c", { pay_status: "paid" })],
      { products: [product], categories: [category], sellers: [seller], costs: new Map([["p1", 6]]) });
    expect(roundTrip(lines)).toEqual(lines);
  });

  it("serialises identically to lines that never went over the wire", () => {
    // toEqual ignores key order; JSON.stringify does not, and a caller that
    // compares or hashes serialised lines would see a difference that is
    // not really there. Field order therefore follows buildSalesLines
    // exactly -- checked against the real builder, not against a fixture
    // that would only be testing its own literal order.
    const lines = buildSalesLines([order("a"), order("b", { pay_status: "paid" })],
      { products: [product], categories: [category], sellers: [seller], costs: new Map([["p1", 6]]) });
    expect(JSON.stringify(roundTrip(lines))).toBe(JSON.stringify(lines));
  });

  it("round-trips lines with no cost data at all", () => {
    const lines = buildSalesLines([order("a")],
      { products: [product], categories: [category], sellers: [seller], costs: new Map() });
    expect(lines[0].cost).toBeNull();
    expect(roundTrip(lines)).toEqual(lines);
  });
});
