import { describe, it, expect } from "vitest";
import {
  customerReturnStats, byReason, mostReturnedProducts,
  supplierReturnStats, bySupplier, chaseList, monthlyReturns,
  isFaultReason, unitsIn,
  RETURN_REASONS, SUPPLIER_RETURN_REASONS, SUPPLIER_RETURN_STATUSES,
  returnReasonKey, supplierReasonKey, supplierStatusKey,
  type CustomerReturnRow, type SupplierReturnRow,
} from "@/lib/returns";
import { STR } from "@/lib/i18n";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* WHAT CAME BACK.
 *
 * Two directions, and the one thing this file exists to prove is that they
 * are never added together. A customer return costs the shop money; a
 * supplier return is money owed to it, and a combined figure would be a
 * number with no meaning that somebody would nonetheless make a decision on.
 */

function ret(p: Partial<CustomerReturnRow> = {}): CustomerReturnRow {
  return {
    id: "r1", ref: "RET1", orderId: "o1", orderRef: "ORD1",
    reason: "changed_mind", note: "", refundTotal: 0, refundedAt: null,
    createdAt: "2026-03-04T10:00:00Z", lines: [],
    ...p,
  };
}

function sup(p: Partial<SupplierReturnRow> = {}): SupplierReturnRow {
  return {
    id: "s1", ref: "SRT1", supplierId: "sup1", supplierName: "Guangzhou Co",
    poNumber: null, reason: "damaged", status: "sent", note: "",
    creditExpectedUsd: 0, creditReceivedUsd: 0, creditedAt: null,
    shippedOn: null, createdAt: "2026-03-04T10:00:00Z", lines: [],
    ...p,
  };
}

const line = (qty: number, restock = true, productId = "p1", productName = "Shirt") =>
  ({ productId, productName, qty, restock });

describe("the customer side", () => {
  it("counts documents, not units", () => {
    const s = customerReturnStats([
      ret({ id: "a", lines: [line(2), line(3, true, "p2", "Hat")] }),
      ret({ id: "b", lines: [line(1)] }),
    ], 100);
    expect([s.count, s.units]).toEqual([2, 6]);
  });

  it("divides returns by orders, and refuses to divide by nothing", () => {
    expect(customerReturnStats([ret()], 20).returnRate).toBeCloseTo(0.05);
    // A shop with no orders has no rate. Zero would read as "we have never
    // had a return", which on an empty shop is true of everything and
    // therefore says nothing.
    expect(customerReturnStats([], 0).returnRate).toBeNull();
  });

  it("separates money agreed from money that actually moved", () => {
    const s = customerReturnStats([
      ret({ id: "a", refundTotal: 40, refundedAt: "2026-03-05T00:00:00Z" }),
      ret({ id: "b", refundTotal: 25, refundedAt: null }),
    ], 10);
    expect([s.refundTotal, s.refundSettled, s.refundPending]).toEqual([65, 40, 25]);
  });

  it("reports what went back on the shelf, and what did not", () => {
    const s = customerReturnStats([
      ret({ lines: [line(3, true), line(1, false)] }),
    ], 10);
    expect(s.restockRate).toBeCloseTo(0.75);
  });

  it("has no restock rate when nothing has come back", () => {
    // 0% would read as "we recover nothing", which is the opposite of the
    // truth on a shop that has never had a return.
    expect(customerReturnStats([], 50).restockRate).toBeNull();
    expect(customerReturnStats([], 50).faultRate).toBeNull();
  });

  it("tells a changed mind apart from a breakage", () => {
    // THE distinction on this screen. A 5% return rate is healthy retail
    // when it is people changing their minds and an emergency when it is
    // damage, and a single rate cannot say which.
    expect(isFaultReason("damaged")).toBe(true);
    expect(isFaultReason("wrong_item")).toBe(true);
    expect(isFaultReason("not_as_described")).toBe(true);
    expect(isFaultReason("changed_mind")).toBe(false);
    expect(isFaultReason("other")).toBe(false);
  });

  it("measures how much of it is the shop's own doing", () => {
    const s = customerReturnStats([
      ret({ id: "a", reason: "damaged" }),
      ret({ id: "b", reason: "not_as_described" }),
      ret({ id: "c", reason: "changed_mind" }),
      ret({ id: "d", reason: "other" }),
    ], 100);
    expect(s.faultRate).toBeCloseTo(0.5);
  });
});

describe("why goods came back", () => {
  it("ranks by how often, not by how expensive", () => {
    // A reason is a diagnosis. One very costly return does not make its
    // reason the shop's biggest problem.
    const rows = byReason([
      ret({ id: "a", reason: "damaged", refundTotal: 500, lines: [line(1)] }),
      ret({ id: "b", reason: "changed_mind", refundTotal: 10, lines: [line(1)] }),
      ret({ id: "c", reason: "changed_mind", refundTotal: 10, lines: [line(1)] }),
      ret({ id: "d", reason: "changed_mind", refundTotal: 10, lines: [line(1)] }),
    ]);
    expect(rows[0].reason).toBe("changed_mind");
    expect([rows[0].count, rows[0].value]).toEqual([3, 30]);
    expect(rows[1].reason).toBe("damaged");
  });

  it("shares add up to one", () => {
    const rows = byReason([
      ret({ id: "a", reason: "damaged" }),
      ret({ id: "b", reason: "other" }),
      ret({ id: "c", reason: "other" }),
    ]);
    expect(rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1);
  });

  it("has nothing to say about an empty shop", () => {
    expect(byReason([])).toEqual([]);
  });
});

describe("what came back most", () => {
  it("ranks by units and counts the returns behind them", () => {
    const rows = mostReturnedProducts([
      ret({ id: "a", lines: [line(3, true, "p1", "Shirt")] }),
      ret({ id: "b", lines: [line(2, true, "p1", "Shirt"), line(4, true, "p2", "Hat")] }),
    ]);
    expect(rows.map((r) => [r.productId, r.units, r.returns]))
      .toEqual([["p1", 5, 2], ["p2", 4, 1]]);
  });

  it("counts a product once per return even on two lines of it", () => {
    const rows = mostReturnedProducts([
      ret({ lines: [line(1, true, "p1"), line(2, false, "p1")] }),
    ]);
    expect([rows[0].units, rows[0].returns, rows[0].scrapped]).toEqual([3, 1, 2]);
  });

  it("drops lines whose product is gone rather than grouping them under ''", () => {
    // A bar labelled "" tells nobody anything, and on a shop that has
    // deleted a few products it would frequently be the tallest one.
    const rows = mostReturnedProducts([
      ret({ lines: [{ productId: null, productName: "", qty: 99, restock: true }] }),
    ]);
    expect(rows).toEqual([]);
  });

  it("keeps a name that arrives on a later line", () => {
    const rows = mostReturnedProducts([
      ret({ id: "a", lines: [line(1, true, "p1", "")] }),
      ret({ id: "b", lines: [line(1, true, "p1", "Shirt")] }),
    ]);
    expect(rows[0].name).toBe("Shirt");
  });
});

describe("the supplier side", () => {
  it("never mixes what the shop owes with what it is owed", () => {
    // The two halves of this screen answer opposite questions, and there is
    // deliberately no function anywhere that adds them.
    const customer = customerReturnStats([ret({ refundTotal: 100 })], 10);
    const supplier = supplierReturnStats([sup({ creditExpectedUsd: 100 })]);
    expect(customer.refundTotal).toBe(100);
    expect(supplier.creditOutstanding).toBe(100);
    expect(Object.keys(customer)).not.toContain("creditOutstanding");
    expect(Object.keys(supplier)).not.toContain("refundTotal");
  });

  it("counts a claim answered short as still outstanding", () => {
    // A partial credit is an unfinished argument, not a closed one.
    const s = supplierReturnStats([
      sup({ status: "sent", creditExpectedUsd: 300, creditReceivedUsd: 120 }),
    ]);
    expect([s.creditExpected, s.creditReceived, s.creditOutstanding])
      .toEqual([300, 120, 180]);
  });

  it("stops counting a settled claim as owed", () => {
    const s = supplierReturnStats([
      sup({ status: "credited", creditExpectedUsd: 300, creditReceivedUsd: 300 }),
    ]);
    expect(s.creditOutstanding).toBe(0);
    expect(s.recoveryRate).toBeCloseTo(1);
  });

  it("leaves a rejected claim out of what is owed but reports it", () => {
    const s = supplierReturnStats([
      sup({ status: "rejected", creditExpectedUsd: 400, creditReceivedUsd: 0 }),
    ]);
    expect([s.creditOutstanding, s.rejected]).toEqual([0, 1]);
    // Still counted in what was claimed, so the recovery rate tells the
    // truth about this supplier rather than quietly forgetting the loss.
    expect(s.recoveryRate).toBe(0);
  });

  it("ignores a cancelled claim entirely", () => {
    const s = supplierReturnStats([
      sup({ id: "a", status: "cancelled", creditExpectedUsd: 900, lines: [
        { productId: "p1", productName: "X", qty: 5, unitCost: 1, fromStock: true }] }),
      sup({ id: "b", status: "sent", creditExpectedUsd: 100 }),
    ]);
    expect([s.count, s.units, s.creditExpected]).toEqual([1, 0, 100]);
  });

  it("has no recovery rate before anything is claimed", () => {
    expect(supplierReturnStats([]).recoveryRate).toBeNull();
  });

  it("counts only sent claims as awaiting an answer", () => {
    const s = supplierReturnStats([
      sup({ id: "a", status: "draft" }),
      sup({ id: "b", status: "sent" }),
      sup({ id: "c", status: "credited" }),
    ]);
    expect(s.awaiting).toBe(1);
  });
});

describe("ranking suppliers", () => {
  it("ranks by value claimed, not by number of claims", () => {
    // The shop's next conversation with a supplier is about money. Twenty
    // claims over packaging do not outrank one carton of faulty phones.
    const rows = bySupplier([
      sup({ id: "a", supplierId: "s1", supplierName: "A", creditExpectedUsd: 2000 }),
      sup({ id: "b", supplierId: "s2", supplierName: "B", creditExpectedUsd: 50 }),
      sup({ id: "c", supplierId: "s2", supplierName: "B", creditExpectedUsd: 50 }),
      sup({ id: "d", supplierId: "s2", supplierName: "B", creditExpectedUsd: 50 }),
    ]);
    expect(rows[0].supplierId).toBe("s1");
    expect([rows[1].supplierId, rows[1].returns]).toEqual(["s2", 3]);
  });

  it("carries what each supplier still owes", () => {
    const rows = bySupplier([
      sup({ id: "a", status: "sent", creditExpectedUsd: 100, creditReceivedUsd: 30 }),
      sup({ id: "b", status: "credited", creditExpectedUsd: 200, creditReceivedUsd: 200 }),
    ]);
    expect([rows[0].creditExpected, rows[0].creditOutstanding]).toEqual([300, 70]);
  });
});

describe("the chase list", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("puts the oldest unanswered claim first", () => {
    // Age is the point: a claim raised three months ago that nobody chased
    // deserves more attention than a larger one raised on Friday, and
    // sorting by value would bury it.
    const rows = chaseList([
      sup({ id: "new", shippedOn: "2026-05-30", creditExpectedUsd: 5000 }),
      sup({ id: "old", shippedOn: "2026-03-01", creditExpectedUsd: 10 }),
    ], now);
    expect(rows.map((r) => r.id)).toEqual(["old", "new"]);
    expect(rows[0].ageDays).toBe(92);
  });

  it("leaves out anything already settled or closed", () => {
    const rows = chaseList([
      sup({ id: "a", status: "credited", creditedAt: "2026-05-01T00:00:00Z" }),
      sup({ id: "b", status: "rejected" }),
      sup({ id: "c", status: "cancelled" }),
      sup({ id: "d", status: "sent" }),
    ], now);
    expect(rows.map((r) => r.id)).toEqual(["d"]);
  });

  it("shows what is still outstanding, not what was claimed", () => {
    const rows = chaseList([
      sup({ status: "sent", creditExpectedUsd: 500, creditReceivedUsd: 200 }),
    ], now);
    expect(rows[0].outstanding).toBe(300);
  });

  it("falls back to when the claim was raised if it was never shipped", () => {
    const rows = chaseList([
      sup({ status: "draft", shippedOn: null, createdAt: "2026-05-01T00:00:00Z" }),
    ], now);
    expect(rows[0].ageDays).toBe(31);
  });

  it("never reports a negative age for a date in the future", () => {
    const rows = chaseList([sup({ status: "sent", shippedOn: "2026-12-01" })], now);
    expect(rows[0].ageDays).toBe(0);
  });
});

describe("both directions over time", () => {
  it("keeps the two series apart", () => {
    const out = monthlyReturns(
      [ret({ id: "a", createdAt: "2026-03-04T00:00:00Z" }),
       ret({ id: "b", createdAt: "2026-03-20T00:00:00Z" })],
      [sup({ id: "c", shippedOn: "2026-03-09" })],
      ["2026-02", "2026-03"],
    );
    expect(out).toEqual([
      { month: "2026-02", customer: 0, supplier: 0 },
      { month: "2026-03", customer: 2, supplier: 1 },
    ]);
  });

  it("gives every month asked for, including empty ones", () => {
    // A gap in the axis reads as missing data. A zero reads as a quiet
    // month, which is what it is.
    const out = monthlyReturns([], [], ["2026-01", "2026-02", "2026-03"]);
    expect(out.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("leaves a cancelled supplier return out of the trend", () => {
    const out = monthlyReturns([], [
      sup({ status: "cancelled", shippedOn: "2026-03-01" }),
    ], ["2026-03"]);
    expect(out[0].supplier).toBe(0);
  });
});

describe("the vocabularies", () => {
  it("can name every customer reason, in all three languages", () => {
    // The invariant the delivery zones violated: an id with no translation
    // renders as the raw key at whoever is reading the screen.
    for (const r of RETURN_REASONS) {
      expect([r, returnReasonKey(r) in STR]).toEqual([r, true]);
      expect([r, STR[returnReasonKey(r)].filter(Boolean).length]).toEqual([r, 3]);
    }
  });

  it("can name every supplier reason and status, in all three languages", () => {
    for (const r of SUPPLIER_RETURN_REASONS) {
      expect([r, supplierReasonKey(r) in STR]).toEqual([r, true]);
      expect([r, STR[supplierReasonKey(r)].filter(Boolean).length]).toEqual([r, 3]);
    }
    for (const s of SUPPLIER_RETURN_STATUSES) {
      expect([s, supplierStatusKey(s) in STR]).toEqual([s, true]);
      expect([s, STR[supplierStatusKey(s)].filter(Boolean).length]).toEqual([s, 3]);
    }
  });

  it("does not let a supplier change their mind", () => {
    // The two vocabularies are deliberately different. Sharing one would
    // have meant a list where half the options are wrong whichever screen
    // you are on.
    expect(SUPPLIER_RETURN_REASONS).not.toContain("changed_mind");
    expect(RETURN_REASONS).not.toContain("over_delivery");
  });

  it("matches the check constraints in the migrations", () => {
    // Two lists that can disagree is how a reason is offered in the UI and
    // rejected by the database.
    const sql = readFileSync(
      resolve(__dirname, "../supabase/supplier-returns.sql"), "utf8");
    for (const r of SUPPLIER_RETURN_REASONS) {
      expect([r, sql.includes(`'${r}'`)]).toEqual([r, true]);
    }
    for (const s of SUPPLIER_RETURN_STATUSES) {
      expect([s, sql.includes(`'${s}'`)]).toEqual([s, true]);
    }
    const returnsSql = readFileSync(resolve(__dirname, "../supabase/returns.sql"), "utf8");
    for (const r of RETURN_REASONS) {
      expect([r, returnsSql.includes(`'${r}'`)]).toEqual([r, true]);
    }
  });

  it("teaches the stock ledger the word it needs", () => {
    // Without 'supplier_return' in the reason constraint the trigger's
    // insert fails and the goods never leave the shelf.
    const sql = readFileSync(
      resolve(__dirname, "../supabase/supplier-returns.sql"), "utf8");
    expect(sql).toContain("'supplier_return'");
    // And it rebuilds the constraint rather than adding a second one, so
    // re-running the file is a no-op.
    expect(sql).toContain("drop constraint if exists stock_movements_reason_check");
    // Every reason the earlier files added has to survive the rebuild.
    for (const r of ["purchase_receipt", "sale", "adjustment", "return",
                     "correction", "reservation"]) {
      expect([r, sql.includes(`'${r}'`)]).toEqual([r, true]);
    }
  });
});

describe("counting units", () => {
  it("adds up the lines", () => {
    expect(unitsIn({ lines: [{ qty: 2 }, { qty: 3 }] })).toBe(5);
  });

  it("counts a return with no lines as nothing, not as one", () => {
    expect(unitsIn({ lines: [] })).toBe(0);
  });
});
