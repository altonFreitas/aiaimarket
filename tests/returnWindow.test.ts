import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { returnWindow, returnDays, DEFAULT_RETURN_DAYS } from "@/lib/returnWindow";
import type { Order } from "@/lib/types";

/* A RETURN THAT STAYED OPEN FOR EVER.
 *
 * Reported from a live shop: "Ask to return something" was still on an
 * order that had been paid, collected and completed a month earlier. The
 * only condition was that the order had arrived -- and an order that has
 * arrived stays arrived.
 *
 * The shop's own Returns page has meanwhile always said "contact us within
 * N days of receiving your order", with N typed into Settings. The page
 * promised a deadline that nothing kept.
 */

const DAY = 86_400_000;
const order = (status: string, placedDaysAgo: number, now = Date.now()): Order =>
  ({ status, created_at: new Date(now - placedDaysAgo * DAY).toISOString() }) as Order;

describe("how long a buyer has", () => {
  it("is the shop's own published number", () => {
    /* Not a constant in the source. A shop that publishes 3 days and a
       button that still works on day 30 is the same contradiction the other
       way round. */
    expect(returnDays({ legal_return_days: 3 })).toBe(3);
    expect(returnDays({ legal_return_days: 30 })).toBe(30);
  });

  it("falls back to a week when the shop has not said", () => {
    // The Returns page says "FILL IN" until then, so nobody has been
    // promised anything else.
    expect(returnDays({})).toBe(DEFAULT_RETURN_DAYS);
    expect(returnDays(null)).toBe(7);
    expect(returnDays({ legal_return_days: 0 })).toBe(7);
    expect(returnDays({ legal_return_days: -5 })).toBe(7);
  });
});

describe("whether this order can still go back", () => {
  it("closes once the window has passed", () => {
    // THE REPORTED CASE: completed, paid, a month old.
    expect(returnWindow(order("completed", 30), { legal_return_days: 7 }).open).toBe(false);
  });

  it("stays open inside it", () => {
    expect(returnWindow(order("completed", 2), { legal_return_days: 7 }).open).toBe(true);
    expect(returnWindow(order("arrived", 6), { legal_return_days: 7 }).open).toBe(true);
  });

  it("honours a shorter window a shop has published", () => {
    // This shop publishes 3 days. On day 5 the button must be gone, or the
    // policy page is a statement the app contradicts.
    expect(returnWindow(order("completed", 5), { legal_return_days: 3 }).open).toBe(false);
    expect(returnWindow(order("completed", 2), { legal_return_days: 3 }).open).toBe(true);
  });

  it("is closed before the goods have arrived", () => {
    for (const s of ["new", "confirmed", "preparing", "out", "cancelled"]) {
      expect(returnWindow(order(s, 1), { legal_return_days: 7 }).open, s).toBe(false);
    }
  });

  it("does not refuse a right because a timestamp is missing", () => {
    /* A row with an unparseable created_at is a data problem, not a reason
       to tell a customer they cannot return a faulty item. It stays open
       and the admin can still decline. */
    const broken = { status: "completed", created_at: "not a date" } as unknown as Order;
    expect(returnWindow(broken, { legal_return_days: 7 }).open).toBe(true);
  });

  it("counts from placement, which is generous rather than short", () => {
    /* Nothing records the doorstep, so placement is the earliest
       defensible start. That makes the window slightly generous, which is
       the right direction to be wrong in on a consumer right. */
    const w = returnWindow(order("completed", 0), { legal_return_days: 7 });
    expect(w.closedOn).toBeGreaterThan(Date.now() + 6 * DAY);
  });
});

describe("the rule lives on the server too", () => {
  it("is enforced where it cannot be bypassed", () => {
    /* Hiding a button is not a rule. requestReturn() is unauthenticated and
       takes a ref and a phone number, so anything the browser can be
       persuaded to send, it will send. */
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/actions/return-requests.ts"), "utf8");
    expect(src).toMatch(/returnWindow\(/);
    expect(src).toMatch(/if \(!win\.open\)/);
  });

  it("and the form hides it for the same reason, from the same function", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/ReturnRequest.tsx"), "utf8");
    expect(src).toMatch(/returnWindow\(order, settings\)/);
    expect(src).toMatch(/!win\.open/);
  });
});
