import { describe, it, expect } from "vitest";
import { computeSellerLedger, type SellerEarnings } from "@/lib/data/seller";
import type { SellerPayout } from "@/lib/types";

const earnings = (net: number): SellerEarnings => ({
  commissionRatePercent: 10,
  completedOrderCount: 3,
  grossSales: net / 0.9,
  commission: (net / 0.9) * 0.1,
  earnings: net,
});

const payout = (amount: number): SellerPayout => ({
  id: "x", seller_id: "s1", amount, method: "bank",
  reference: "", note: "", paid_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
});

describe("computeSellerLedger", () => {
  it("owes the full net earnings when nothing has been paid", () => {
    const l = computeSellerLedger(earnings(90), []);
    expect(l.paidOut).toBe(0);
    expect(l.outstanding).toBe(90);
  });

  it("subtracts every payout, not just the most recent", () => {
    const l = computeSellerLedger(earnings(90), [payout(20), payout(30)]);
    expect(l.paidOut).toBe(50);
    expect(l.outstanding).toBe(40);
  });

  it("settles to exactly zero once paid in full", () => {
    const l = computeSellerLedger(earnings(90), [payout(90)]);
    expect(l.outstanding).toBe(0);
  });

  it("reports a negative balance rather than hiding an overpayment", () => {
    // A max(0, …) here would make the one number worth investigating —
    // "we paid this seller more than they earned" — invisible.
    const l = computeSellerLedger(earnings(90), [payout(150)]);
    expect(l.outstanding).toBe(-60);
  });

  it("carries the underlying earnings figures through unchanged", () => {
    const base = earnings(90);
    const l = computeSellerLedger(base, [payout(10)]);
    expect(l.grossSales).toBe(base.grossSales);
    expect(l.commission).toBe(base.commission);
    expect(l.commissionRatePercent).toBe(10);
    expect(l.completedOrderCount).toBe(3);
  });

  it("handles amounts arriving from Postgres numeric as strings", () => {
    // supabase-js hands numeric(10,2) back as a string in some driver
    // versions; a string here would otherwise concatenate into "010".
    const l = computeSellerLedger(earnings(90), [
      { ...payout(0), amount: "10.50" as unknown as number },
    ]);
    expect(l.paidOut).toBe(10.5);
    expect(l.outstanding).toBe(79.5);
  });
});
