import { describe, it, expect } from "vitest";
import {
  filterSellerOrders, sellerFilterIsActive, sellerOrderKpis, sellerFlagCounts,
  hasFlag, isLate, isOpen, sellerOrderDay,
  SELLER_ORDER_FLAGS,
} from "@/lib/sellerOrderBook";
import type { SellerOrderView } from "@/lib/data/seller";
import type { OrderItem } from "@/lib/types";

const TODAY = "2026-09-16";

const item = (name: string, price: number, qty = 1): OrderItem =>
  ({ name, price, qty } as OrderItem);

const o = (over: Partial<SellerOrderView> = {}): SellerOrderView => ({
  id: "o1", ref: "PP1", buyer_name: "Zita", buyer_phone: "+6701",
  mode: "delivery", address_line: "Rua Nova", municipality: "Dili",
  post: null, suku: null, aldeia: null, landmark: null,
  status: "completed", created_at: "2026-09-10T02:00:00Z",
  myItems: [item("Tais", 20)], mySubtotal: 20, myCommission: 2,
  allItemsMine: true,
  pay_status: "paid", pay_method: "cod", cancel_requested_at: null,
  ...over,
});

/* ---------------------------------------------------------------------------
 * The money. This is the half that would be wrong in the flattering
 * direction, so it is the half with the most tests.
 * ------------------------------------------------------------------------ */

describe("the figures are the seller's, not the shop's", () => {
  it("adds up this seller's own lines, never the basket", () => {
    /* THE BUG THIS FILE EXISTS TO AVOID. An order's `total` is the whole
       basket -- other sellers' lines and the delivery fee included. A
       seller reading that as their revenue is reading somebody else's
       money, and it is never smaller than the truth, so nothing on the
       screen would look wrong. mySubtotal is the only figure that is
       theirs, and it is the only one these tiles touch. */
    const k = sellerOrderKpis([
      o({ mySubtotal: 20, myCommission: 2 }),
      o({ id: "o2", mySubtotal: 30, myCommission: 3 }),
    ], TODAY);
    expect(k.grossSales).toBe(50);
    expect(k.commission).toBe(5);
    expect(k.earnings).toBe(45);
  });

  it("leaves cancelled orders out of every money figure", () => {
    // Nothing was sold, so counting it would report money that never
    // existed -- and would pay out on it.
    const k = sellerOrderKpis([
      o({ mySubtotal: 20, myCommission: 2 }),
      o({ id: "o2", status: "cancelled", mySubtotal: 900, myCommission: 90 }),
    ], TODAY);
    expect(k.grossSales).toBe(20);
    expect(k.commission).toBe(2);
    expect(k.earnings).toBe(18);
  });

  it("still counts a cancelled order as an order", () => {
    // It happened. It is just not money.
    const k = sellerOrderKpis([o(), o({ id: "o2", status: "cancelled" })], TODAY);
    expect(k.count).toBe(2);
  });

  it("averages over what sold, not over what was cancelled", () => {
    const k = sellerOrderKpis([
      o({ mySubtotal: 20 }),
      o({ id: "o2", mySubtotal: 40 }),
      o({ id: "o3", status: "cancelled", mySubtotal: 600 }),
    ], TODAY);
    expect(k.avgOrderValue).toBe(30);
  });

  it("says nothing rather than zero when there is nothing to average", () => {
    // 0 would read as "my orders are worth nothing".
    expect(sellerOrderKpis([], TODAY).avgOrderValue).toBeNull();
    expect(sellerOrderKpis([o({ status: "cancelled" })], TODAY).avgOrderValue).toBeNull();
  });

  it("counts a buyer once however many times they came back", () => {
    const k = sellerOrderKpis([
      o({ buyer_phone: "+6701" }),
      o({ id: "o2", buyer_phone: "+6701" }),
      o({ id: "o3", buyer_phone: "+6702" }),
    ], TODAY);
    expect(k.customers).toBe(2);
  });
});

describe("fulfilment rate", () => {
  it("is null while nothing has ended", () => {
    /* A seller whose only order is still being packed has not failed
       anything. 0% would say they had, on their own dashboard, which is
       the sort of number somebody quits over. */
    expect(sellerOrderKpis([o({ status: "preparing" })], TODAY).fulfilmentRate).toBeNull();
  });

  it("counts completed against everything that ended", () => {
    const k = sellerOrderKpis([
      o({ status: "completed" }),
      o({ id: "o2", status: "completed" }),
      o({ id: "o3", status: "cancelled" }),
      o({ id: "o4", status: "preparing" }),   // not ended, not counted
    ], TODAY);
    expect(k.fulfilmentRate).toBe(2 / 3);
  });
});

/* ---------------------------------------------------------------------------
 * Filtering
 * ------------------------------------------------------------------------ */

describe("filterSellerOrders", () => {
  const rows = [
    o({ id: "a", ref: "PP-A", created_at: "2026-09-01T02:00:00Z", status: "new",
        pay_status: "unpaid", mode: "delivery", myItems: [item("Tais", 20)] }),
    o({ id: "b", ref: "PP-B", created_at: "2026-09-10T02:00:00Z", status: "completed",
        pay_status: "paid", mode: "pickup", buyer_name: "Elderino",
        myItems: [item("Coffee", 5)] }),
  ];

  it("reads the day off the stored string, not the viewer's clock", () => {
    // 23:00 in Dili is the previous day in UTC; parsing into a local Date
    // would file it under the wrong one for anybody reading from Europe.
    expect(sellerOrderDay({ created_at: "2026-09-10T14:30:00Z" })).toBe("2026-09-10");
  });

  it("bounds the window inclusively at both ends", () => {
    expect(filterSellerOrders(rows, { from: "2026-09-01", to: "2026-09-01" }, TODAY)
      .map((r) => r.id)).toEqual(["a"]);
    expect(filterSellerOrders(rows, { from: "2026-09-01", to: "2026-09-10" }, TODAY)
      .map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("filters by status, payment and mode", () => {
    expect(filterSellerOrders(rows, { status: "new" }, TODAY).map((r) => r.id)).toEqual(["a"]);
    expect(filterSellerOrders(rows, { payStatus: "paid" }, TODAY).map((r) => r.id)).toEqual(["b"]);
    expect(filterSellerOrders(rows, { mode: "pickup" }, TODAY).map((r) => r.id)).toEqual(["b"]);
  });

  it("searches the reference, the buyer and the seller's own product names", () => {
    // A seller looks for "the coffee order" far more often than for a
    // reference number -- they know their stock, not the shop's numbering.
    expect(filterSellerOrders(rows, { q: "coffee" }, TODAY).map((r) => r.id)).toEqual(["b"]);
    expect(filterSellerOrders(rows, { q: "elder" }, TODAY).map((r) => r.id)).toEqual(["b"]);
    expect(filterSellerOrders(rows, { q: "PP-A" }, TODAY).map((r) => r.id)).toEqual(["a"]);
  });

  it("searches only this seller's lines", () => {
    /* myItems is already reduced to this seller by getSellerOrders. If the
       haystack ever reached past it, one seller could find an order by
       guessing at what a rival stocks. */
    const mixed = o({ id: "m", myItems: [item("Mine", 10)] });
    expect(filterSellerOrders([mixed], { q: "mine" }, TODAY)).toHaveLength(1);
    expect(filterSellerOrders([mixed], { q: "theirs" }, TODAY)).toHaveLength(0);
  });

  it("knows when a filter is doing anything", () => {
    expect(sellerFilterIsActive({})).toBe(false);
    expect(sellerFilterIsActive({ q: "" })).toBe(false);
    expect(sellerFilterIsActive({ status: "new" })).toBe(true);
  });
});

/* ---------------------------------------------------------------------------
 * The flags
 * ------------------------------------------------------------------------ */

describe("the flag chips", () => {
  it("never calls an order late when no date was promised", () => {
    // Inventing a deadline the buyer never got turns a quiet seller into a
    // failing one on their own screen.
    expect(isLate(o({ status: "out", expected_delivery: null }), TODAY)).toBe(false);
    expect(isLate(o({ status: "out", expected_delivery: "2026-09-15" }), TODAY)).toBe(true);
    expect(isLate(o({ status: "out", expected_delivery: "2026-09-20" }), TODAY)).toBe(false);
  });

  it("stops calling a finished order late", () => {
    for (const status of ["completed", "cancelled"] as const) {
      expect([status, isLate(o({ status, expected_delivery: "2026-01-01" }), TODAY)])
        .toEqual([status, false]);
    }
  });

  it("treats a cancelled order as needing nothing", () => {
    const dead = o({
      status: "cancelled", pay_status: "unpaid",
      cancel_requested_at: "2026-09-01T00:00:00Z", is_preorder: true,
    });
    for (const flag of SELLER_ORDER_FLAGS) {
      expect([flag, hasFlag(dead, flag, TODAY)]).toEqual([flag, false]);
    }
  });

  it("counts everything still owed as unfulfilled", () => {
    for (const status of ["new", "confirmed", "preparing", "out", "arrived"] as const) {
      expect([status, isOpen(o({ status }))]).toEqual([status, true]);
    }
    for (const status of ["completed", "cancelled"] as const) {
      expect([status, isOpen(o({ status }))]).toEqual([status, false]);
    }
  });

  it("counts over the window, so clicking one does not blank the others", () => {
    /* THE POINT OF COUNTING BEFORE THE FLAG IS APPLIED. Pass the rows that
       survived only the dates; if the caller passed the fully filtered set
       instead, every chip but the active one would read 0 the moment one
       was clicked, and the row would stop summarising anything. */
    const rows = [
      o({ id: "a", status: "new", pay_status: "unpaid" }),
      o({ id: "b", status: "out", pay_status: "unpaid", expected_delivery: "2026-01-01" }),
    ];
    const counts = sellerFlagCounts(rows, TODAY);
    expect(counts.pending).toBe(1);
    expect(counts.unpaid).toBe(2);
    expect(counts.late).toBe(1);
    expect(counts.unfulfilled).toBe(2);
  });

  it("gives every chip a number, including zero", () => {
    // A chip with no count renders blank; the owner's row has the same rule.
    const counts = sellerFlagCounts([], TODAY);
    for (const flag of SELLER_ORDER_FLAGS) {
      expect([flag, counts[flag]]).toEqual([flag, 0]);
    }
  });
});
