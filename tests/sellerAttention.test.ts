import { describe, it, expect } from "vitest";
import { buildSellerAttention } from "@/lib/sellerAttention";
import { STR } from "@/lib/i18n";
import type { Product } from "@/lib/types";

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1", seller_id: "sel1", ref: "PRD-1", name: "Widget", slug: "widget",
  category_id: null, price: 10, discount_price: null, sizes: [], tags: [],
  stock_status: "in", qty: 5, description: "", images: [], municipality: null,
  post: null, suku: null, landmark: null, pay_cod: true, pay_cop: false,
  pay_bank: false, pay_wallet: false, pay_fiar: false, archived: false,
  status: "approved", views: 0, wa_clicks: 0, created_at: "2026-01-01T00:00:00Z",
  ...over,
});
const find = (items: ReturnType<typeof buildSellerAttention>, kind: string) =>
  items.find((i) => i.kind === kind);

describe("buildSellerAttention", () => {
  it("says nothing at all for a store with nothing waiting", () => {
    // A wall of zeroes is how a to-do list stops being read.
    expect(buildSellerAttention({ orders: [], products: [] })).toEqual([]);
  });

  it("puts a new order first, because a person is already waiting", () => {
    const items = buildSellerAttention({
      orders: [{ status: "new" }, { status: "new" }, { status: "completed" }],
      products: [product({ status: "pending" })],
    });
    expect(items[0].kind).toBe("my_orders_new");
    expect(items[0].count).toBe(2);
    expect(items[0].severity).toBe("urgent");
  });

  it("counts what is listed and unbuyable", () => {
    const items = buildSellerAttention({ orders: [], products: [
      product({ id: "a", stock_status: "out" }),
      product({ id: "b", stock_status: "out", archived: true }),   // not listed
      product({ id: "c", stock_status: "in" }),
    ] });
    expect(find(items, "my_out_of_stock")!.count).toBe(1);
  });

  it("treats waiting on the marketplace as news, not as a task", () => {
    // There is nothing for the seller to DO about a pending product.
    // Ranking it as work would be asking somebody to act on something they
    // cannot; leaving it out would leave "why is my product not showing"
    // unanswered.
    const items = buildSellerAttention({
      orders: [], products: [product({ status: "pending" })],
    });
    const row = find(items, "my_products_pending")!;
    expect(row.severity).toBe("info");
    expect(items[items.length - 1].kind).toBe("my_products_pending");
  });

  it("sends every card somewhere a seller can actually open", () => {
    // THE ONE THAT MATTERS. The owner's version of this list links into
    // /admin, and a card that leads to a redirect reads as the shop being
    // broken. /seller/orders and /seller/products are included with every
    // store -- never a feature that may not be granted.
    const items = buildSellerAttention({
      orders: [{ status: "new" }],
      products: [
        product({ id: "a", stock_status: "out" }),
        product({ id: "b", status: "pending" }),
        product({ id: "c", qty: 1, stock_status: "low" }),
      ],
    });
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect([i.kind, ["/seller/orders", "/seller/products"].includes(i.href)])
        .toEqual([i.kind, true]);
    }
  });

  it("says everything it shows in words the app has", () => {
    const items = buildSellerAttention({
      orders: [{ status: "new" }],
      products: [
        product({ id: "a", stock_status: "out" }),
        product({ id: "b", status: "pending" }),
      ],
    });
    for (const i of items) {
      expect([i.kind, i.labelKey in STR]).toEqual([i.kind, true]);
      expect([i.kind, i.hintKey in STR]).toEqual([i.kind, true]);
    }
  });

  it("ranks urgent before warn before info", () => {
    const items = buildSellerAttention({
      orders: [{ status: "new" }],
      products: [product({ id: "a", status: "pending" }), product({ id: "b", stock_status: "out" })],
    });
    expect(items.map((i) => i.severity)).toEqual(["urgent", "urgent", "info"]);
  });
});
