import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* WHERE A BUYER LANDS AFTER PAYING, AND HOW MANY SCREENS IT TAKES.
 *
 * Confirming an order used to show three screens to deliver one:
 *
 *   1. /checkout, while the server worked
 *   2. /o/<ref> rendering "enter your phone" -- a gate the buyer had just
 *      proved they did not need
 *   3. the order, once a SECOND round trip came back
 *
 * Screen 2 was the bug, and it was structural: the phone was handed over in
 * sessionStorage and read in an effect, so the first paint could only be the
 * gate. It had a second symptom nobody would connect to the first --
 * RELOADING the order page threw the buyer back to the gate for good,
 * because the handoff was read once and erased.
 *
 * Now the link carries the same signed token the store's own SMS carries,
 * the page verifies it and fetches the order before sending any HTML, and
 * the order is in the first paint.
 *
 * The token's own properties -- that it cannot be moved to another order,
 * survive a tampered MAC, outlive 120 days, or carry the phone number into
 * the URL -- are proved in tests/trackToken.test.ts and deliberately not
 * restated here. This file is about the journey.
 */

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const CHECKOUT = read("src/components/CheckoutForm.tsx");
const TRACK = read("src/components/TrackForm.tsx");
const PAGE = read("src/app/o/[ref]/page.tsx");

describe("checkout, when the order goes through", () => {
  it("sends the buyer to their order carrying the token", () => {
    expect(CHECKOUT).toMatch(/router\.replace\(`\/o\/\$\{ref\}\?t=\$\{encodeURIComponent\(token\)\}`\)/);
  });

  it("replaces the checkout rather than stacking on it", () => {
    /* The basket is emptied on success, so a /checkout left in history is a
       form for goods that are no longer in it -- and a browser restoring
       that form is an invitation to order the same thing twice. */
    expect(CHECKOUT).not.toMatch(/router\.push\(`\/o\//);
  });

  it("no longer hands the phone over in sessionStorage", () => {
    // The handoff could not survive a reload and could not be read before
    // the first paint. Both were symptoms of the same thing.
    expect(CHECKOUT).not.toContain("justOrdered");
    expect(TRACK).not.toContain("justOrdered");
  });
});

describe("the order page", () => {
  it("fetches the order itself when the token checks out", () => {
    expect(PAGE).toMatch(/unlockedPhone\s*\?\s*await lookupOrder\(ref, unlockedPhone\)\s*:\s*null/);
    expect(PAGE).toMatch(/initialOrder=\{initialOrder\}/);
  });

  it("paints that order instead of the gate", () => {
    /* `if (!order && !history)` is what renders the gate, so the order has
       to be in state on the FIRST render -- not moved there by an effect,
       which is one paint too late. */
    expect(TRACK).toMatch(/useState<Order \| null>\(initialOrder \?\? null\)/);
  });

  it("carries the phone with it, or every button on the order breaks", () => {
    /* THE TRAP IN THIS CHANGE. The gate used to fill `phone` in as a side
       effect of asking. Nothing asks any more -- so an order rendered from
       a token with `phone` left empty would look perfect and fail on every
       action: cancellation, address change, payment proof, returns, Pay
       now, seller rating, product review. They all take it and they all
       re-check it server-side. */
    expect(TRACK).toMatch(/useState\(unlockedPhone \?\? ""\)/);
    for (const action of [
      "requestCancellation", "updateOrderAddress", "uploadPaymentProof",
    ]) {
      expect([action, new RegExp(`${action}\\([^)]*phone`).test(TRACK)])
        .toEqual([action, true]);
    }
  });

  it("still asks anyone who arrives without a token", () => {
    // The gate is not removed, it is skipped for people who have already
    // passed it. Somebody typing /o/<ref> cold must still be asked.
    expect(TRACK).toMatch(/if \(!order && !history\)/);
  });

  it("still honours a legacy ?phone= link", () => {
    // Bookmarked before tokens existed. The phone in that URL is a claim,
    // not a proof, so it can only be resolved by lookupOrder in the browser.
    expect(TRACK).toMatch(/params\.get\("phone"\)/);
  });
});

describe("everywhere else that left a dead page behind", () => {
  /* THE SAME MISTAKE, FOUND BY LOOKING FOR IT. router.push is right for a
   * forward move a reader may want to undo. It is wrong when the page being
   * left has ceased to exist or has finished its job, because Back then
   * returns somebody to a URL that no longer resolves, or to a form whose
   * work is already done -- and a browser restoring a submitted form is how
   * an order or a registration gets made twice. */
  const has = (rel: string, needle: string) =>
    readFileSync(resolve(ROOT, rel), "utf8").includes(needle);

  it("does not go Back into a purchase order it just deleted", () => {
    expect(has("src/components/admin/procurement/PurchaseOrderForm.tsx",
      'router.replace("/admin/procurement")')).toBe(true);
  });

  it("does not go Back to a sign-in screen once signed in", () => {
    // Both steps of the admin login -- password and the TOTP code -- plus
    // the seller's.
    const admin = readFileSync(resolve(ROOT, "src/components/admin/LoginForm.tsx"), "utf8");
    expect(admin.match(/router\.replace\("\/admin"\)/g)?.length).toBe(2);
    expect(admin).not.toMatch(/router\.push\("\/admin"\)/);
    expect(has("src/components/seller/SellerLoginForm.tsx",
      'router.replace("/seller/dashboard")')).toBe(true);
  });

  it("does not go Back into a store it just signed out of", () => {
    expect(has("src/components/seller/LogoutButton.tsx",
      'router.replace("/seller/login")')).toBe(true);
  });
});
