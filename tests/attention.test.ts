import { describe, it, expect } from "vitest";
import { buildAttention, type AttentionInput } from "@/lib/attention";
import type { Order, Product, PurchaseOrder } from "@/lib/types";
import type { ReplenishmentRow } from "@/lib/replenishment";

const NOW = Date.parse("2026-09-01T00:00:00Z");
const DAY = 86_400_000;
const day = (n: number) => new Date(NOW + n * DAY).toISOString().slice(0, 10);

const order = (over: Partial<Order> = {}): Order => ({
  id: "o" + Math.random(), ref: "CD1", status: "new", is_preorder: false,
  items: [], created_at: new Date(NOW).toISOString(), ...over,
} as unknown as Order);

const product = (over: Partial<Product> = {}): Product =>
  ({ id: "p" + Math.random(), status: "approved", archived: false, ...over } as Product);

const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder =>
  ({ id: "po" + Math.random(), status: "sent", payment_status: "unpaid",
     expected_arrival: null, ...over } as PurchaseOrder);

const repl = (over: Partial<ReplenishmentRow> = {}): ReplenishmentRow =>
  ({ productId: "x", ref: "R", name: "N", supplierId: null, supplierName: null,
     onHand: 5, onOrder: 0, promised: 0, position: 5, dailyRate: 0,
     daysOfCover: null, stockoutOn: null, leadDays: 14, leadKnown: false,
     reorderPoint: 0, suggestedQty: 0, urgency: "ok", ...over } as ReplenishmentRow);

const input = (over: Partial<AttentionInput> = {}): AttentionInput => ({
  orders: [], products: [], purchaseOrders: [], replenishment: [],
  pendingMessages: 0, driftCount: 0, nowMs: NOW, ...over,
});

const find = (i: AttentionInput, kind: string) =>
  buildAttention(i).find((x) => x.kind === kind);

describe("a cancelled card order whose money is still at the bank", () => {
  /* Cancelling stops the goods and does nothing at the acquirer, and this
   * application has no void or refund call to make. So the only thing that
   * gets the buyer their money back is a person being told to go and do
   * it -- which is what this item is. */
  const held = (over: Partial<Order> = {}) =>
    order({ status: "cancelled", pay_method: "card", pay_status: "paid", ...over });

  it("asks for it back, urgently", () => {
    const item = find(input({ orders: [held()] }), "cards_to_void");
    expect([item?.count, item?.severity]).toEqual([1, "urgent"]);
  });

  it("counts a deposit as money held too", () => {
    expect(find(input({ orders: [held({ pay_status: "deposit" })] }), "cards_to_void")?.count)
      .toBe(1);
  });

  it("stops asking once the payment says the money went back", () => {
    // The owner voids it at the portal and records that here. There is no
    // second flag to fall out of step with the first.
    expect(find(input({ orders: [held({ pay_status: "refunded" })] }), "cards_to_void"))
      .toBeUndefined();
    expect(find(input({ orders: [held({ pay_status: "unpaid" })] }), "cards_to_void"))
      .toBeUndefined();
  });

  it("says nothing about a cancelled order that was never paid by card", () => {
    // Cash on delivery that was cancelled has no money anywhere to get
    // back, and listing it would be a permanent line nobody can clear.
    expect(find(input({ orders: [held({ pay_method: "cod" })] }), "cards_to_void"))
      .toBeUndefined();
  });

  it("says nothing about a live card order", () => {
    // A paid, uncancelled order is the normal case, not a task.
    expect(find(input({ orders: [held({ status: "completed" })] }), "cards_to_void"))
      .toBeUndefined();
  });
});

describe("buildAttention", () => {
  it("says nothing at all when nothing is waiting", () => {
    expect(buildAttention(input())).toEqual([]);
  });

  it("never shows an item with a count of zero", () => {
    // A wall of zeroes is how a to-do list stops being read.
    const items = buildAttention(input({
      orders: [order({ status: "completed" })],
    }));
    expect(items.every((i) => i.count > 0)).toBe(true);
  });

  it("counts orders waiting to be confirmed", () => {
    const i = input({ orders: [order(), order(), order({ status: "completed" })] });
    expect(find(i, "orders_to_confirm")!.count).toBe(2);
  });

  it("counts pre-orders that are still open, not ones already delivered", () => {
    const i = input({ orders: [
      order({ is_preorder: true, status: "confirmed" }),
      order({ is_preorder: true, status: "completed" }),
      order({ is_preorder: true, status: "cancelled" }),
    ] });
    expect(find(i, "preorders_waiting")!.count).toBe(1);
  });

  it("counts products awaiting approval, ignoring archived ones", () => {
    const i = input({ products: [
      product({ status: "pending" }),
      product({ status: "pending", archived: true }),
      product({ status: "approved" }),
    ] });
    expect(find(i, "products_to_approve")!.count).toBe(1);
  });

  it("puts a store waiting for approval on the list", () => {
    // THE GAP THIS FILLS. The Sellers screen has had an Approve button all
    // along; nothing on the home page said a store was waiting for it, so
    // "where do I approve them" had no answer anywhere the owner looks
    // first. Urgent because a person is waiting on a person: they filled
    // the form they were invited to fill and cannot list anything until
    // this is done.
    const i = input({ pendingSellers: 2 });
    const row = find(i, "sellers_to_approve")!;
    expect(row.count).toBe(2);
    expect(row.severity).toBe("urgent");
    expect(row.href).toBe("/admin/sellers");
  });

  it("says nothing when no store is waiting", () => {
    expect(find(input({ pendingSellers: 0 }), "sellers_to_approve")).toBeUndefined();
    // Absent entirely, from a caller that could not read the sellers.
    expect(find(input({}), "sellers_to_approve")).toBeUndefined();
  });

  it("counts lines needing an order today", () => {
    const i = input({ replenishment: [
      repl({ urgency: "out", suggestedQty: 10 }),
      repl({ urgency: "urgent", suggestedQty: 5 }),
      repl({ urgency: "soon", suggestedQty: 5 }),
      repl({ urgency: "out", suggestedQty: 0 }),   // already fully on order
    ] });
    expect(find(i, "reorder_now")!.count).toBe(2);
  });

  it("flags empty shelves only where something is still selling", () => {
    const i = input({ replenishment: [
      repl({ position: 0, dailyRate: 1.5 }),   // empty and wanted
      repl({ position: 0, dailyRate: 0 }),     // empty and nobody asks
      repl({ position: -3, dailyRate: 0.2 }),  // oversold and wanted
    ] });
    expect(find(i, "out_of_stock_selling")!.count).toBe(2);
  });

  it("separates a late delivery from one merely due soon", () => {
    const i = input({ purchaseOrders: [
      po({ expected_arrival: day(-1) }),
      po({ expected_arrival: day(3) }),
      po({ expected_arrival: day(30) }),        // beyond the week
      po({ expected_arrival: day(-5), status: "received" }),  // arrived, not late
    ] });
    expect(find(i, "po_overdue")!.count).toBe(1);
    expect(find(i, "po_arriving")!.count).toBe(1);
  });

  it("counts an order arriving today as arriving, not overdue", () => {
    const i = input({ purchaseOrders: [po({ expected_arrival: day(0) })] });
    expect(find(i, "po_overdue")).toBeUndefined();
    expect(find(i, "po_arriving")!.count).toBe(1);
  });

  it("ignores a cancelled purchase order entirely", () => {
    const i = input({ purchaseOrders: [
      po({ expected_arrival: day(-9), status: "cancelled" }),
    ] });
    expect(find(i, "po_overdue")).toBeUndefined();
  });

  it("counts money owed: overdue anywhere, or unpaid once received", () => {
    const i = input({ purchaseOrders: [
      po({ payment_status: "overdue", status: "in_transit" }),
      po({ payment_status: "unpaid", status: "received" }),
      po({ payment_status: "unpaid", status: "draft" }),   // not owed yet
      po({ payment_status: "paid", status: "received" }),
    ] });
    expect(find(i, "po_unpaid")!.count).toBe(2);
  });

  it("raises the ledger disagreeing with itself", () => {
    expect(find(input({ driftCount: 3 }), "stock_drift")!.count).toBe(3);
    expect(find(input({ driftCount: 0 }), "stock_drift")).toBeUndefined();
  });

  it("puts what someone is waiting on above what merely approaches", () => {
    const items = buildAttention(input({
      purchaseOrders: [po({ expected_arrival: day(2) })],   // info
      orders: [order()],                                     // urgent
      products: [product({ status: "pending" })],            // warn
    }));
    expect(items.map((i) => i.severity)).toEqual(["urgent", "warn", "info"]);
  });

  it("breaks ties on severity by how many are waiting", () => {
    const items = buildAttention(input({
      orders: [order(), order(), order()],
      pendingMessages: 1,
    }));
    const urgent = items.filter((i) => i.severity === "urgent");
    expect(urgent[0].count).toBeGreaterThanOrEqual(urgent[1].count);
  });

  it("gives every item somewhere to go", () => {
    const items = buildAttention(input({
      orders: [order(), order({ is_preorder: true, status: "confirmed" })],
      products: [product({ status: "pending" })],
      purchaseOrders: [po({ expected_arrival: day(-1) }), po({ payment_status: "overdue" })],
      replenishment: [repl({ urgency: "out", suggestedQty: 4, position: 0, dailyRate: 1 })],
      pendingMessages: 2, driftCount: 1,
    }));
    expect(items.length).toBeGreaterThan(5);
    expect(items.every((i) => i.href.startsWith("/admin"))).toBe(true);
    expect(items.every((i) => i.labelKey && i.hintKey)).toBe(true);
  });
});
