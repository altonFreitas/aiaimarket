import { describe, it, expect } from "vitest";
import {
  filterOrders, orderFilterIsActive, orderKpis, flagCounts, sortOrders,
  municipalitiesIn, ordersByDay, isLate, isOpen, orderDay, hasFlag,
  ORDER_FLAGS, ORDER_SORTS, PAY_METHODS, PAY_STATUSES,
} from "@/lib/orderBook";
import {
  PERIOD_PRESETS, presetRange, activePreset, coincidingPresets,
} from "@/lib/sales";
import { STR } from "@/lib/i18n";
import type { Order } from "@/lib/types";

/* THE ORDER BOOK, AND THE PERIOD CHIPS ABOVE IT.
 *
 * The chip tests come first because they pin a bug that was reported as
 * "the button does nothing": on Monday 14 September 2026, "This week" and
 * "Today" are the same range, and the code that decided which chip to light
 * matched by range and so always answered "today".
 */

const TODAY = "2026-09-14"; // a Monday -- see below

function ord(p: Partial<Order> = {}): Order {
  return {
    id: "o1", ref: "PP20260001", buyer_name: "Zita", buyer_phone: "+6707001",
    items: [], mode: "delivery", zone_id: null, fee: 0, quote_requested: false,
    subtotal: 10, total: 10,
    address_line: null, municipality: null, post: null, suku: null,
    aldeia: null, landmark: null,
    pay_method: "cod", pay_status: "paid", proof_url: null, note: "",
    status: "completed", cancel_reason: null, cancel_requested_at: null,
    created_at: "2026-09-14T09:00:00Z",
    ...p,
  } as Order;
}

describe("the period chips", () => {
  it("14 September 2026 really is a Monday", () => {
    // The whole bug below depends on it, so it is asserted rather than
    // assumed -- a wrong date here would make every test after it vacuous.
    expect(new Date(TODAY + "T00:00:00Z").getUTCDay()).toBe(1);
  });

  it("makes 'this week' and 'today' the same range on a Monday", () => {
    // Not a fault: on a Monday, this week SO FAR is today. The fault was
    // the screen being unable to say so.
    expect(presetRange("week", TODAY)).toEqual(presetRange("today", TODAY));
  });

  it("cannot tell those two apart by range alone", () => {
    // THE BUG, pinned. activePreset answers with the first preset in list
    // order, so on a Monday it says "today" no matter which chip was
    // clicked -- the highlight never moved and the chip looked dead.
    const r = presetRange("week", TODAY);
    expect(activePreset(r.from, r.to, TODAY)).toBe("today");
    expect(activePreset(r.from, r.to, TODAY)).not.toBe("week");
  });

  it("names every preset that means the same days", () => {
    expect(coincidingPresets("week", TODAY).sort()).toEqual(["today", "week"]);
    expect(coincidingPresets("today", TODAY).sort()).toEqual(["today", "week"]);
  });

  it("collapses four presets into one day on 1 January", () => {
    // The worst case, and the reason the fix is "remember the click"
    // rather than "reorder the list": no ordering makes all four right.
    const jan1 = "2026-01-01";
    expect(coincidingPresets("year", jan1).sort())
      .toEqual(["month", "quarter", "today", "year"]);
    expect(activePreset(jan1, jan1, jan1)).toBe("today");
  });

  it("keeps the presets distinct on an ordinary day", () => {
    // Tuesday the 15th: nothing coincides, which is why the bug went
    // unnoticed for so long -- it is invisible six days in seven.
    const tue = "2026-09-15";
    for (const p of PERIOD_PRESETS) {
      expect([p, coincidingPresets(p, tue)]).toEqual([p, [p]]);
    }
  });

  it("can name every preset, and the same-range note, in all three languages", () => {
    for (const p of PERIOD_PRESETS) {
      expect([p, `range_${p}` in STR]).toEqual([p, true]);
      expect([p, STR[`range_${p}`].filter(Boolean).length]).toEqual([p, 3]);
    }
    expect(STR.periodSameAs.filter(Boolean).length).toBe(3);
    // The note is useless without both slots.
    for (const s of STR.periodSameAs) {
      expect(s).toContain("{a}");
      expect(s).toContain("{b}");
    }
  });
});

describe("reading an order's day", () => {
  it("takes the calendar day off the timestamp rather than parsing it", () => {
    // An order placed at 23:00 in Dili must not land on the previous day
    // for somebody reading the screen from Europe.
    expect(orderDay({ created_at: "2026-09-14T23:30:00Z" })).toBe("2026-09-14");
  });

  it("survives a row with no timestamp", () => {
    expect(orderDay({ created_at: "" })).toBe("");
  });
});

describe("filtering the book", () => {
  const book = [
    ord({ id: "a", created_at: "2026-09-14T09:00:00Z", total: 12, status: "new",
          pay_status: "unpaid", buyer_name: "Zita", buyer_phone: "+670700001",
          municipality: "Dili" }),
    ord({ id: "b", created_at: "2026-09-10T09:00:00Z", total: 34, status: "completed",
          pay_status: "paid", buyer_name: "Jorge", buyer_phone: "+670700002",
          municipality: "Baucau", pay_method: "bank", mode: "pickup" }),
    ord({ id: "c", created_at: "2026-08-30T09:00:00Z", total: 5, status: "cancelled",
          pay_status: "refunded", buyer_name: "Maia", buyer_phone: "+670700003" }),
  ];

  it("filters on the order date, inclusive at both ends", () => {
    expect(filterOrders(book, { from: "2026-09-10", to: "2026-09-14" }, TODAY)
      .map((o) => o.id)).toEqual(["a", "b"]);
    expect(filterOrders(book, { from: "2026-09-14", to: "2026-09-14" }, TODAY)
      .map((o) => o.id)).toEqual(["a"]);
  });

  it("searches the reference, the name and the phone", () => {
    expect(filterOrders(book, { q: "jorge" }, TODAY).map((o) => o.id)).toEqual(["b"]);
    expect(filterOrders(book, { q: "700003" }, TODAY).map((o) => o.id)).toEqual(["c"]);
    expect(filterOrders(book, { q: "ZITA" }, TODAY).map((o) => o.id)).toEqual(["a"]);
  });

  it("searches the address and the note, which nothing else holds", () => {
    // "the blue house near the school" is how a delivery gets found again.
    const rows = [ord({ id: "x", landmark: "blue house near the school" }),
                  ord({ id: "y", note: "leave with the neighbour" })];
    expect(filterOrders(rows, { q: "blue house" }, TODAY).map((o) => o.id)).toEqual(["x"]);
    expect(filterOrders(rows, { q: "neighbour" }, TODAY).map((o) => o.id)).toEqual(["y"]);
  });

  it("filters by status, payment, method, mode and municipality", () => {
    expect(filterOrders(book, { status: "new" }, TODAY).map((o) => o.id)).toEqual(["a"]);
    expect(filterOrders(book, { payStatus: "paid" }, TODAY).map((o) => o.id)).toEqual(["b"]);
    expect(filterOrders(book, { payMethod: "bank" }, TODAY).map((o) => o.id)).toEqual(["b"]);
    expect(filterOrders(book, { mode: "pickup" }, TODAY).map((o) => o.id)).toEqual(["b"]);
    expect(filterOrders(book, { municipality: "Baucau" }, TODAY).map((o) => o.id)).toEqual(["b"]);
  });

  it("narrows to one buyer by phone, because the phone is the customer", () => {
    // There are no accounts in this shop. Two people called Zita Felicia
    // are two customers, and only the number separates them.
    const two = [ord({ id: "p", buyer_name: "Zita", buyer_phone: "+1" }),
                 ord({ id: "q", buyer_name: "Zita", buyer_phone: "+2" })];
    expect(filterOrders(two, { customer: "+2" }, TODAY).map((o) => o.id)).toEqual(["q"]);
  });

  it("combines every filter rather than picking one", () => {
    expect(filterOrders(book, { from: "2026-09-01", status: "completed" }, TODAY)
      .map((o) => o.id)).toEqual(["b"]);
    expect(filterOrders(book, { from: "2026-09-01", status: "completed", q: "zita" }, TODAY))
      .toEqual([]);
  });

  it("knows when a filter is doing anything", () => {
    expect(orderFilterIsActive({})).toBe(false);
    expect(orderFilterIsActive({ q: "", status: "" })).toBe(false);
    expect(orderFilterIsActive({ status: "new" })).toBe(true);
  });
});

describe("what counts as late", () => {
  it("is a promise that has passed with nothing delivered", () => {
    expect(isLate(ord({ status: "out", expected_delivery: "2026-09-13" }), TODAY)).toBe(true);
  });

  it("is never late when nothing was promised", () => {
    // Inventing a deadline the buyer was never given turns a quiet shop
    // into a failing one.
    expect(isLate(ord({ status: "out", expected_delivery: null }), TODAY)).toBe(false);
    expect(isLate(ord({ status: "out" }), TODAY)).toBe(false);
  });

  it("is not late on the day it is due", () => {
    expect(isLate(ord({ status: "out", expected_delivery: TODAY }), TODAY)).toBe(false);
  });

  it("stops being late once it arrives or is cancelled", () => {
    expect(isLate(ord({ status: "out", expected_delivery: "2026-09-01",
                        delivered_at: "2026-09-12" }), TODAY)).toBe(false);
    expect(isLate(ord({ status: "cancelled", expected_delivery: "2026-09-01" }), TODAY)).toBe(false);
    expect(isLate(ord({ status: "completed", expected_delivery: "2026-09-01" }), TODAY)).toBe(false);
  });
});

describe("the flags", () => {
  it("treats a cancelled order as nothing to chase", () => {
    // Its money is not owed, its parcel is not late, and it is not a
    // pre-order waiting on stock. Counting it would put permanent work on
    // a list whose whole purpose is to reach zero.
    const dead = ord({ status: "cancelled", pay_status: "unpaid",
                       is_preorder: true, cancel_requested_at: "2026-09-01T00:00:00Z" });
    for (const flag of ORDER_FLAGS) {
      expect([flag, hasFlag(dead, flag, TODAY)]).toEqual([flag, false]);
    }
  });

  it("counts what is still open as the working queue", () => {
    expect(isOpen(ord({ status: "new" }))).toBe(true);
    expect(isOpen(ord({ status: "arrived" }))).toBe(true);
    expect(isOpen(ord({ status: "completed" }))).toBe(false);
    expect(isOpen(ord({ status: "cancelled" }))).toBe(false);
  });

  it("counts each flag over the window", () => {
    const c = flagCounts([
      ord({ id: "a", status: "new", pay_status: "unpaid" }),
      ord({ id: "b", status: "out", expected_delivery: "2026-09-01" }),
      ord({ id: "c", status: "completed", is_preorder: true }),
    ], TODAY);
    expect([c.pending, c.unpaid, c.late, c.preorder, c.unfulfilled])
      .toEqual([1, 1, 1, 1, 2]);
  });

  it("can name every flag and sort, in all three languages", () => {
    for (const f of ORDER_FLAGS) {
      expect([f, `flag_${f}` in STR]).toEqual([f, true]);
      expect([f, STR[`flag_${f}`].filter(Boolean).length]).toEqual([f, 3]);
    }
    for (const s of ORDER_SORTS) {
      expect([s, `sort_${s}` in STR]).toEqual([s, true]);
      expect([s, STR[`sort_${s}`].filter(Boolean).length]).toEqual([s, 3]);
    }
    for (const m of PAY_METHODS) {
      expect([m, `pm_${m}` in STR]).toEqual([m, true]);
    }
    for (const p of PAY_STATUSES) {
      expect([p, `ps_${p}` in STR]).toEqual([p, true]);
    }
  });
});

describe("the figures", () => {
  it("leaves a cancelled order out of revenue", () => {
    // Nothing was sold. Counting its value would report money that never
    // existed -- and it is still counted in `count`, because it happened.
    const k = orderKpis([
      ord({ id: "a", total: 100, status: "completed" }),
      ord({ id: "b", total: 900, status: "cancelled" }),
    ], TODAY);
    expect([k.count, k.revenue, k.cancelled]).toEqual([2, 100, 1]);
  });

  it("averages over live orders only", () => {
    const k = orderKpis([
      ord({ id: "a", total: 100 }),
      ord({ id: "b", total: 200 }),
      ord({ id: "c", total: 900, status: "cancelled" }),
    ], TODAY);
    expect(k.avgOrderValue).toBe(150);
  });

  it("has no average on an empty window", () => {
    // Not zero: a window with no orders has no average order value, and
    // "$0.00" would read as "we sold things and they were worthless".
    expect(orderKpis([], TODAY).avgOrderValue).toBeNull();
    expect(orderKpis([], TODAY).fulfilmentRate).toBeNull();
  });

  it("adds up what is actually owed", () => {
    const k = orderKpis([
      ord({ id: "a", total: 40, pay_status: "unpaid" }),
      ord({ id: "b", total: 25, pay_status: "unpaid" }),
      ord({ id: "c", total: 99, pay_status: "paid" }),
      // Cancelled and unpaid is not a receivable.
      ord({ id: "d", total: 500, pay_status: "unpaid", status: "cancelled" }),
    ], TODAY);
    expect([k.unpaid, k.unpaidValue]).toEqual([2, 65]);
  });

  it("counts a customer once however many times they order", () => {
    const k = orderKpis([
      ord({ id: "a", buyer_phone: "+1" }),
      ord({ id: "b", buyer_phone: "+1" }),
      ord({ id: "c", buyer_phone: "+2" }),
    ], TODAY);
    expect(k.customers).toBe(2);
  });

  it("rounds money rather than trailing floating point", () => {
    const k = orderKpis([ord({ total: 0.1 }), ord({ id: "b", total: 0.2 })], TODAY);
    expect(k.revenue).toBe(0.3);
  });
});

describe("sorting", () => {
  const rows = [
    ord({ id: "a", total: 50, buyer_name: "Zita", created_at: "2026-09-10T00:00:00Z", status: "completed" }),
    ord({ id: "b", total: 10, buyer_name: "Ana", created_at: "2026-09-14T00:00:00Z", status: "new" }),
    ord({ id: "c", total: 90, buyer_name: "Mario", created_at: "2026-09-12T00:00:00Z", status: "out" }),
  ];

  it("orders by date both ways", () => {
    expect(sortOrders(rows, "newest").map((o) => o.id)).toEqual(["b", "c", "a"]);
    expect(sortOrders(rows, "oldest").map((o) => o.id)).toEqual(["a", "c", "b"]);
  });

  it("orders by value both ways", () => {
    expect(sortOrders(rows, "highest").map((o) => o.id)).toEqual(["c", "a", "b"]);
    expect(sortOrders(rows, "lowest").map((o) => o.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts status into the order work happens in, not alphabetically", () => {
    // "arrived" before "confirmed" is not a sequence anybody works to.
    expect(sortOrders(rows, "status").map((o) => o.id)).toEqual(["b", "c", "a"]);
  });

  it("does not mutate what it was given", () => {
    const before = rows.map((o) => o.id);
    sortOrders(rows, "highest");
    expect(rows.map((o) => o.id)).toEqual(before);
  });
});

describe("the municipality list", () => {
  it("offers only places the shop has actually delivered to", () => {
    // A dropdown of thirteen municipalities where twelve return nothing
    // teaches people not to use it.
    expect(municipalitiesIn([
      ord({ id: "a", municipality: "Dili" }),
      ord({ id: "b", municipality: "Baucau" }),
      ord({ id: "c", municipality: "Dili" }),
      ord({ id: "d", municipality: null }),
    ])).toEqual(["Baucau", "Dili"]);
  });
});

describe("the daily shape", () => {
  it("includes the empty days", () => {
    // A week with three orders on Monday and nothing after is a different
    // business from one with an order a day, and skipping the gaps would
    // draw them identically.
    const out = ordersByDay([
      ord({ id: "a", created_at: "2026-09-10T09:00:00Z", total: 10 }),
      ord({ id: "b", created_at: "2026-09-10T11:00:00Z", total: 5 }),
    ], "2026-09-09", "2026-09-11");
    expect(out.map((d) => [d.day, d.orders])).toEqual([
      ["2026-09-09", 0], ["2026-09-10", 2], ["2026-09-11", 0],
    ]);
    expect(out[1].revenue).toBe(15);
  });

  it("leaves cancelled orders out of the bars", () => {
    const out = ordersByDay([
      ord({ id: "a", created_at: "2026-09-10T09:00:00Z", status: "cancelled" }),
    ], "2026-09-10", "2026-09-10");
    expect(out[0].orders).toBe(0);
  });

  it("draws nothing rather than a truncated span past its cap", () => {
    // A year of daily bars two pixels wide is not a chart. Returning
    // nothing lets the screen omit it; returning a slice would silently
    // show one quarter labelled as the year.
    expect(ordersByDay([], "2026-01-01", "2026-12-31")).toEqual([]);
    expect(ordersByDay([], "2026-09-01", "2026-09-30")).toHaveLength(30);
  });

  it("refuses a backwards or missing range", () => {
    expect(ordersByDay([], "2026-09-30", "2026-09-01")).toEqual([]);
    expect(ordersByDay([], "", "2026-09-01")).toEqual([]);
  });
});
