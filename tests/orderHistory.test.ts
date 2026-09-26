import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { matches } from "@/components/OrderHistory";
import {
  canCancel, historyItems, sellableNow, CANCELLABLE_STATUSES,
} from "@/lib/orderActions";
import { returnWindow } from "@/lib/returnWindow";
import type { HistoryOrder } from "@/components/OrderHistory";

/* THE ORDER HISTORY.
 *
 * It was a flat list of links -- reference, date, total, two pills -- and
 * a navigation off the page for anything else. Somebody looking for "the
 * shoes I bought in March" had to open every order in turn to find out
 * what was in each one.
 *
 * It is now searchable by reference OR product name, filterable by
 * status, and each row opens in place with its items, its address and
 * what can still be done to it. The last part is where the care goes: a
 * row must offer only actions that would actually work.
 */

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const OH = code("src/components/OrderHistory.tsx");
const CSS = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const I18N = read("src/lib/i18n.ts");
const ORDERS = code("src/lib/actions/orders.ts");

const order = (o: Partial<HistoryOrder> = {}): HistoryOrder => ({
  ref: "CD2026-0007", buyer_name: "Z", buyer_phone: "+670", status: "completed",
  pay_status: "paid", total: 10, created_at: "2026-09-20T00:00:00Z", mode: "delivery",
  items: [{ product_id: "p1", name: "Running Shoes", size: "41", qty: 1, price: 55 }],
  ...o,
});

describe("finding an old order", () => {
  it("matches on the reference", () => {
    expect(matches(order(), "0007")).toBe(true);
    expect(matches(order(), "0008")).toBe(false);
  });

  it("matches on what was in it, which is what people actually remember", () => {
    expect(matches(order(), "shoes")).toBe(true);
    expect(matches(order(), "scarf")).toBe(false);
  });

  it("ignores case and surrounding space either side", () => {
    expect(matches(order(), "  SHOES ")).toBe(true);
    expect(matches(order(), "cd2026-0007")).toBe(true);
  });

  it("shows everything when nothing has been typed", () => {
    for (const q of ["", "   "]) expect([q, matches(order(), q)]).toEqual([q, true]);
  });
});

describe("which actions a row may offer", () => {
  it("offers cancellation only before the shop has started work", () => {
    for (const status of ["new", "confirmed"] as const) {
      expect([status, canCancel(order({ status }))]).toEqual([status, true]);
    }
    // Once it is being prepared somebody is picking goods off a shelf.
    for (const status of ["preparing", "out", "arrived", "completed", "cancelled"] as const) {
      expect([status, canCancel(order({ status }))]).toEqual([status, false]);
    }
  });

  it("offers no second cancellation while one is pending", () => {
    expect(canCancel(order({ status: "new", cancel_requested_at: "2026-09-21T00:00:00Z" })))
      .toBe(false);
  });

  it("is the same rule the server enforces", () => {
    // Written out in both places, they drift: the screen offers Cancel and
    // the server answers "Too late to cancel".
    expect(ORDERS).toMatch(/CANCELLABLE_STATUSES[^)]*\)\.includes\(order\.status\)/);
    expect(ORDERS).not.toMatch(/\["new", "confirmed"\]\.includes/);
    expect([...CANCELLABLE_STATUSES]).toEqual(["new", "confirmed"]);
  });

  it("offers a return only inside the shop's own published window", () => {
    const placed = Date.parse("2026-09-20T00:00:00Z");
    const settings = { legal_return_days: 7 };
    const day = (n: number) => placed + n * 86_400_000;
    // Arrived, and still inside seven days.
    expect(returnWindow(order({ status: "completed" }), settings, day(3)).open).toBe(true);
    // Same order, eight days on.
    expect(returnWindow(order({ status: "completed" }), settings, day(8)).open).toBe(false);
    // Nothing to send back before it has arrived.
    expect(returnWindow(order({ status: "out" }), settings, day(1)).open).toBe(false);
  });

  it("draws each one only when it would work", () => {
    // A button that answers "too late" is a button that should not have
    // been drawn.
    expect(OH).toMatch(/\{win\.open && \(/);
    expect(OH).toMatch(/\{showCancel && \(/);
    expect(OH).toMatch(/\{reorderable && \(/);
    // Tracking always works, so it is never conditional.
    expect(OH).toMatch(/t\("trackOrder", lang\)/);
  });

  it("reads the return window from the shop's settings, not a constant", () => {
    expect(OH).toMatch(/returnWindow\(o, settings\)/);
    expect(OH).not.toMatch(/\b(7|14|30)\s*\*\s*86_?400/);
  });
});

describe("buy again", () => {
  it("will not re-offer a delisted, unapproved or sold-out product", () => {
    const live = { slug: "s", images: ["i"], price: 10, qty: 4, archived: false, status: "approved" };
    expect(sellableNow(live)).toEqual({ slug: "s", image: "i", price: 10, stock: 4 });
    expect(sellableNow({ ...live, archived: true })).toBeNull();
    expect(sellableNow({ ...live, status: "pending" })).toBeNull();
    expect(sellableNow({ ...live, status: "rejected" })).toBeNull();
    expect(sellableNow({ ...live, qty: 0 })).toBeNull();
  });

  it("re-adds at today's price, not at what was paid months ago", () => {
    /* The order's line carries the price PAID. Adding at it puts a number
       in the basket that the checkout then quietly corrects. */
    expect(sellableNow({ slug: "s", images: [], price: 26, qty: 5 })!.price).toBe(26);
    // ...and the discount when there is one, because that is what is charged.
    expect(sellableNow({ slug: "s", images: [], price: 26, discount_price: 19, qty: 5 })!.price)
      .toBe(19);
    // The component must take it from the live entry, never from the line.
    expect(OH).toMatch(/price: it\.now\.price/);
    expect(OH).not.toMatch(/price: it\.price/);
  });

  it("carries today's stock ceiling in with it", () => {
    // Otherwise the + button counts past the shelf again.
    expect(OH).toMatch(/stock: it\.now\.stock/);
  });

  it("says what it could not add rather than dropping it quietly", () => {
    expect(OH).toMatch(/const gone = o\.items\.length - added/);
    expect(OH).toMatch(/ohBuyAgainGone/);
    expect(OH).toMatch(/if \(!added\)/);
  });
});

describe("what the row shows", () => {
  it("uses the address formatter the rest of the app uses", () => {
    // A second copy of this was written and deleted: utils.addrLine has
    // handled both address shapes (street, and the full hierarchy) since
    // long before this screen existed.
    expect(OH).toMatch(/import \{ addrLine.*\} from "@\/lib\/utils"/);
    expect(OH).not.toMatch(/function addressLine/);
  });

  it("says 'address' only for an order that was delivered somewhere", () => {
    expect(OH).toMatch(/o\.mode === "pickup" \? t\("ohPickupOrder", lang\)/);
  });

  it("does not print '1 items'", () => {
    expect(OH).toMatch(/o\.items\.length === 1 \? "ohItems1" : "ohItems"/);
    const one = /ohItems1:\["([^"]*)","([^"]*)","([^"]*)"\]/.exec(I18N)!;
    expect(one[3]).toBe("{n} item");
    expect(one[2]).toBe("{n} artigo");
    const many = /ohItems:\["([^"]*)","([^"]*)","([^"]*)"\]/.exec(I18N)!;
    expect(many[3]).toBe("{n} items");
  });

  it("links a product only while it is still listed", () => {
    // A link to a delisted product is a 404 wearing a product name.
    expect(OH).toMatch(/it\.now\s*\n?\s*\? <Link className="oh-line-a"/);
  });
});

describe("the filter", () => {
  it("offers only statuses this buyer's own orders are in", () => {
    /* A dropdown offering "Cancelled" to somebody who has never had an
       order cancelled is a filter that can only return nothing. */
    expect(OH).toMatch(/STATUSES\.filter\(\(s\) => orders\.some\(\(o\) => o\.status === s\)\)/);
  });

  it("lists them in the order an order moves through, not alphabetically", () => {
    const m = /const STATUSES: OrderStatus\[\] =\s*\n?\s*\[([^\]]*)\]/.exec(OH)!;
    const list = m[1].split(",").map((s) => s.trim().replace(/"/g, ""));
    expect(list).toEqual(
      ["new", "confirmed", "preparing", "out", "arrived", "completed", "cancelled"]);
  });
});

describe("the row opens in place", () => {
  it("makes the whole header the control, not a chevron beside it", () => {
    // 18px of chevron is not a phone target.
    expect(OH).toMatch(/<button type="button" className="oh-head"/);
    expect(CSS).toMatch(/\.oh-head\{[^}]*width:100%/);
  });

  it("tells a screen reader what it opens and whether it is open", () => {
    expect(OH).toMatch(/aria-expanded=\{isOpen\}/);
    expect(OH).toMatch(/aria-controls=\{`oh-b-\$\{o\.ref\}`\}/);
    expect(OH).toMatch(/id=\{`oh-b-\$\{o\.ref\}`\}/);
  });

  it("keeps one open at a time, and lets it close again", () => {
    expect(OH).toMatch(/setOpen\(isOpen \? null : o\.ref\)/);
  });

  it("wraps the pills under the reference on a narrow phone", () => {
    // "Out for delivery" beside a reference leaves neither readable.
    const m = /@media \(max-width:560px\)\{([\s\S]*?)\n\}/.exec(CSS);
    expect(m, "a narrow-phone rule for the history header").not.toBeNull();
    expect(m![1]).toMatch(/\.oh-head\{flex-wrap:wrap\}/);
    expect(m![1]).toMatch(/\.oh-pills\{[^}]*width:100%/);
  });
});

describe("shaping an order's stored items", () => {
  const live = new Map([["p1", { slug: "s", image: "i", price: 26, stock: 5 }]]);

  it("pairs each line with what the catalog holds today", () => {
    const [a, b] = historyItems(
      [{ product_id: "p1", name: "Shoes", size: "41", qty: 2, price: 24 },
       { product_id: "p9", name: "Gone", size: "", qty: 1, price: 5 }], live);
    // Bought at 24, still sold, now 26.
    expect(a).toEqual({ product_id: "p1", name: "Shoes", size: "41", qty: 2, price: 24,
      now: { slug: "s", image: "i", price: 26, stock: 5 } });
    // No longer sold: the line still renders, "buy again" cannot use it.
    expect(b.now).toBeUndefined();
  });

  it("survives an items column that is missing or not a list", () => {
    // Tolerated like every read in the migration window.
    for (const bad of [null, undefined, "", 7, {}]) {
      expect([bad, historyItems(bad, live)]).toEqual([bad, []]);
    }
  });

  it("does not crash on a line with nothing in it", () => {
    expect(historyItems([{}], live)).toEqual(
      [{ product_id: null, name: "", size: "", qty: 0, price: 0, now: undefined }]);
  });

  it("lives outside the file that queries the products table", () => {
    /* A `qty:` key in an object literal beside a products query is the
       shape the real oversell bug was written in, and tests/stockLedger
       rightly flags it. The quantity here is how many were ORDERED. */
    expect(ORDERS).not.toMatch(/qty: Number\(it\?\.qty\)/);
    expect(ORDERS).toMatch(/historyItems\(o\.items, live\)/);
  });
});
