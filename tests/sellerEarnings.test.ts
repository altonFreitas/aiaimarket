import { describe, it, expect } from "vitest";
import { computeSellerEarnings, type SellerOrderView } from "@/lib/data/seller";
import type { Seller } from "@/lib/types";

const seller = (over: Partial<Seller> = {}): Seller => ({
  id: "s1", user_id: "u1", full_name: "A", store_name: "Store", slug: "store",
  email: "a@b.c", phone: "", description: "", address: "", city: "", country: "",
  seller_type: "individual", status: "approved", commission_rate: null,
  delivery_available: true, pickup_available: true, delivery_fee: null,
  delivery_area: "", totp_enabled: false, created_at: "2026-01-01T00:00:00Z",
  ...over,
});

/* An order as getSellerOrdersCapped() hands it over: the commission is
 * already worked out per line there, from the rate each line captured when
 * it was placed. `ratePercent` here stands in for that -- the reader adds
 * the figures up, it does not derive them. */
const order = (
  status: SellerOrderView["status"], mySubtotal: number, ratePercent = 10
): SellerOrderView => ({
  id: "o", ref: "R", buyer_name: "B", buyer_phone: "+670", mode: "delivery",
  address_line: null, municipality: null, post: null, suku: null, aldeia: null,
  landmark: null, status, created_at: "2026-01-01T00:00:00Z",
  myItems: [], mySubtotal, myCommission: mySubtotal * (ratePercent / 100),
  allItemsMine: true,
  pay_status: "paid", pay_method: "cod", cancel_requested_at: null,
});

describe("computeSellerEarnings", () => {
  it("counts ONLY completed orders as realized earnings", () => {
    const r = computeSellerEarnings(
      [order("completed", 100), order("new", 500), order("cancelled", 900)],
      seller(), 10
    );
    expect(r.completedOrderCount).toBe(1);
    expect(r.grossSales).toBe(100);
  });

  it("uses the platform default when the seller has no override", () => {
    const r = computeSellerEarnings([order("completed", 200)], seller(), 10);
    expect(r.commissionRatePercent).toBe(10);
    expect(r.commission).toBe(20);
    expect(r.earnings).toBe(180);
  });

  it("lets a seller's own rate override the platform default", () => {
    const r = computeSellerEarnings([order("completed", 200, 5)], seller({ commission_rate: 5 }), 10);
    expect(r.commissionRatePercent).toBe(5);
    expect(r.commission).toBe(10);
    expect(r.earnings).toBe(190);
  });

  it("treats a 0% negotiated rate as zero, not as 'unset'", () => {
    // `?? ` not `||` in the implementation — 0 is a real rate.
    const r = computeSellerEarnings([order("completed", 200, 0)], seller({ commission_rate: 0 }), 10);
    expect(r.commissionRatePercent).toBe(0);
    expect(r.commission).toBe(0);
    expect(r.earnings).toBe(200);
  });

  it("does not rewrite history when the rate is renegotiated", () => {
    // THE BUG THIS PINS. Commission used to be grossSales × the rate set
    // NOW, applied to every historical order -- so moving a store from 10%
    // to 8% retroactively increased everything the platform appeared to
    // owe them, and every payout and statement already issued stopped
    // agreeing with the dashboard.
    //
    // These two orders were placed at 10%. The seller has since been moved
    // to 5%. What they earned on those orders has not changed.
    const placedAtTen = [order("completed", 100, 10), order("completed", 200, 10)];
    const r = computeSellerEarnings(placedAtTen, seller({ commission_rate: 5 }), 10);
    expect(r.grossSales).toBe(300);
    expect(r.commission).toBe(30);        // not 15
    expect(r.earnings).toBe(270);
    // The new rate is still what the screen calls "your rate", because it
    // is what the NEXT order will be placed at.
    expect(r.commissionRatePercent).toBe(5);
  });

  it("adds up lines placed at different rates", () => {
    const r = computeSellerEarnings(
      [order("completed", 100, 10), order("completed", 100, 5)], seller(), 10);
    expect(r.commission).toBe(15);
    expect(r.earnings).toBe(185);
  });

  it("handles a seller with no sales", () => {
    const r = computeSellerEarnings([], seller(), 10);
    expect(r).toMatchObject({ grossSales: 0, commission: 0, earnings: 0, completedOrderCount: 0 });
  });
});
