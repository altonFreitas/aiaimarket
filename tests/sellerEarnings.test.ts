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

const order = (status: SellerOrderView["status"], mySubtotal: number): SellerOrderView => ({
  id: "o", ref: "R", buyer_name: "B", buyer_phone: "+670", mode: "delivery",
  address_line: null, municipality: null, post: null, suku: null, aldeia: null,
  landmark: null, status, created_at: "2026-01-01T00:00:00Z",
  myItems: [], mySubtotal, allItemsMine: true,
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
    const r = computeSellerEarnings([order("completed", 200)], seller({ commission_rate: 5 }), 10);
    expect(r.commissionRatePercent).toBe(5);
    expect(r.commission).toBe(10);
    expect(r.earnings).toBe(190);
  });

  it("treats a 0% negotiated rate as zero, not as 'unset'", () => {
    // `?? ` not `||` in the implementation — 0 is a real rate.
    const r = computeSellerEarnings([order("completed", 200)], seller({ commission_rate: 0 }), 10);
    expect(r.commissionRatePercent).toBe(0);
    expect(r.commission).toBe(0);
    expect(r.earnings).toBe(200);
  });

  it("handles a seller with no sales", () => {
    const r = computeSellerEarnings([], seller(), 10);
    expect(r).toMatchObject({ grossSales: 0, commission: 0, earnings: 0, completedOrderCount: 0 });
  });
});
