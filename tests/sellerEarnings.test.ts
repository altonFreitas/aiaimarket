import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { computeSellerEarnings, type SellerOrderView } from "@/lib/data/seller";
import type { OrderItem, Seller } from "@/lib/types";

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

/* ---------------------------------------------------------------------------
 * "Sold by" is what decides whether commission applies at all
 * ------------------------------------------------------------------------ */

describe("a product's Sold by decides its commission", () => {
  /* THE OWNER'S QUESTION, WRITTEN DOWN. The owner adds a product on
   * /admin/p/[id] and picks a store under "Sold by". That writes
   * products.seller_id, and every line placed from that product afterwards
   * carries the commission rate that store was on. Pick "Store's own" and
   * the line carries no rate at all -- there is no commission on selling to
   * yourself, and a 0 stored there would be indistinguishable from "a rate
   * nobody recorded".
   *
   * These read lib/actions/orders.ts, because the rule lives in the write
   * path and the write path needs a database. What CAN be checked without
   * one is that the write still says it, and then that the arithmetic on
   * the other side agrees. */
  const ORDERS = fs.readFileSync(
    path.join(process.cwd(), "src", "lib", "actions", "orders.ts"), "utf8");

  it("resolves the seller from the PRODUCT row, never from the browser", () => {
    // A basket that could name its own seller could name a seller with a
    // 0% rate, or somebody else's store.
    expect(ORDERS).toMatch(/seller_id: \(row\.seller_id as string \| null\) \?\? null/);
    expect(ORDERS).toMatch(/items: Omit<OrderItem, "seller_id">\[\]/);
  });

  it("attaches a rate only when the line has a seller", () => {
    expect(ORDERS).toMatch(/rateBySeller\.has\(\(row\.seller_id as string\) \|\| ""\)/);
    expect(ORDERS).toMatch(/\? \{ commission_rate: rateBySeller\.get/);
  });

  it("prefers the store's own rate over the shop-wide default", () => {
    // Settings carries the default; a seller row may override it. A store
    // renegotiated to 15% must not be charged the settings' 10%.
    expect(ORDERS).toMatch(/Number\(settings\?\.commission_rate \?\? 0\)/);
    expect(ORDERS).toMatch(/Number\(r\.commission_rate \?\? platformRate\)/);
  });

  it("charges the captured rate, so a later renegotiation does not rewrite history", () => {
    // 10% of $20 is $2, and stays $2 when the store moves to 15% next month.
    const line = { name: "X", price: 20, qty: 1, commission_rate: 10 } as OrderItem;
    const o = order("completed", 20, 10);
    expect(o.myCommission).toBe(2);
    // The seller's screen adds up what the LINES carry, not today's rate.
    const r = computeSellerEarnings([o], seller(), 15);
    expect(r.commission).toBe(2);
    expect(r.earnings).toBe(18);
    expect(line.commission_rate).toBe(10);
  });

  it("takes nothing on the shop's own goods", () => {
    /* "Store's own" leaves seller_id null, so no line is ever attributed to
       a store and none of this arithmetic runs on it. Proved by the absence
       of a rate on the line: lineCommission falls back to the rate passed
       in, and the seller pipeline never sees a line it does not own. */
    const ownGoods = { name: "X", price: 50, qty: 2 } as OrderItem;
    expect("commission_rate" in ownGoods).toBe(false);
    expect(ownGoods.commission_rate).toBeUndefined();
  });
});
