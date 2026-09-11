import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* SENDING MONEY BACK.
 *
 * The provider interface had createCheckout, verifyWebhook, parseEvent and
 * fetchStatus -- and no way to move a cent in the other direction. So
 * recordReturn() wrote a refund_total and the database asserted the buyer
 * had been refunded while their money was still with the acquirer, and a
 * cancelled order left funds on hold until the authorization expired on the
 * bank's own schedule.
 *
 * These are structural: no gateway to call here, and the adapter is
 * explicitly unverified against BNCTL's own integration pack (finding C1,
 * which is a phone call, not code). What is checked is that the properties
 * the design depends on are still stated.
 */

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const TYPES = read("src/lib/payments/types.ts");
const MPGS = read("src/lib/payments/providers/mpgs.ts");
const SERVICE = read("src/lib/payments/service.ts");
const RETURNS = read("src/lib/actions/returns.ts");
const ORDERS = read("src/lib/actions/orders.ts");

describe("the provider interface", () => {
  it("can move money in both directions", () => {
    expect(TYPES).toMatch(/refund\(providerRef: string, amountMinor\?: number\): Promise<ProviderResult>/);
    expect(TYPES).toMatch(/voidAuthorization\(providerRef: string\): Promise<ProviderResult>/);
  });

  it("reports where the payment ended up, not just whether it was accepted", () => {
    // An accepted refund can still be pending settlement. Treating
    // acceptance as completion is the conflation that let the database
    // claim a refund had happened.
    expect(TYPES).toMatch(/interface ProviderResult[\s\S]*ok: boolean[\s\S]*status: PaymentStatus/);
  });
});

describe("the MPGS adapter", () => {
  it("derives the transaction id, so a retry is not a second refund", () => {
    // MPGS keys a transaction by an id the merchant chooses. A random one
    // would move the money twice on a retry; a derived one returns the
    // first result.
    expect(MPGS).toMatch(/const txnId = `\$\{operation\.toLowerCase\(\)\}-\$\{providerRef\}`/);
  });

  it("sends an amount for a refund and never for a void", () => {
    // A partial void is not a thing; the operation for that is a refund.
    expect(MPGS).toMatch(/if \(operation === "REFUND" && amountMinor != null\)/);
    expect(MPGS).toMatch(/moveMoney\("VOID", providerRef\)/);
  });

  it("treats a timeout as unknown rather than as failure", () => {
    // The gateway may well have processed it; we simply did not hear.
    // Recording either outcome would be inventing one.
    expect(MPGS).toMatch(/It may still have gone through/);
    expect(MPGS).toMatch(/ok: false/);
  });

  it("keeps the unverified-against-BNCTL warning", () => {
    // Finding C1 is still open and this file is the thing it is about.
    expect(MPGS).toMatch(/NOT confirmed against BNCTL/);
  });
});

describe("the service", () => {
  it("records a refund through the same door a webhook comes in by", () => {
    // One state machine, one set of rules about what may follow what, and
    // no second way for a payment to reach 'refunded'.
    expect(SERVICE).toMatch(/refundOrderPayment[\s\S]*applyProviderEvent\(/);
    expect(SERVICE).toMatch(/voidOrderAuthorization[\s\S]*applyProviderEvent\(/);
  });

  it("refuses to refund what was never captured, and to void what was", () => {
    expect(SERVICE).toMatch(/never captured -- void it instead/);
    expect(SERVICE).toMatch(/already captured -- refund it instead/);
  });

  it("picks the most recent live payment, not just any", () => {
    // An order that failed a card payment and then succeeded has two rows,
    // and only one of them has money behind it.
    expect(SERVICE).toMatch(/\.in\("status", \["authorized", "captured"\]\)/);
    expect(SERVICE).toMatch(/\.order\("created_at", \{ ascending: false \}\)/);
  });

  it("says 'no card payment' rather than failing, for a cash order", () => {
    // Most orders in this shop are cash, transfer or credit. For those the
    // money moves at a counter and there is nothing to call.
    expect(SERVICE).toMatch(/has no card payment to refund/);
  });
});

describe("settling a return through the gateway", () => {
  it("does not stamp refunded_at when the gateway refuses", () => {
    // The whole point of refunded_at is that it means the money moved.
    // Writing it after a refusal puts the lie back.
    const fn = RETURNS.slice(RETURNS.indexOf("export async function settleRefundThroughGateway"));
    const refusal = fn.indexOf("if (!result.ok)");
    const stamp = fn.indexOf("refunded_at: new Date()");
    expect(refusal).toBeGreaterThan(-1);
    expect(stamp).toBeGreaterThan(refusal);
    expect(fn).toMatch(/return\.refund_failed/);
    expect(fn).toMatch(/throw new Error\(result\.reason/);
  });

  it("keeps the manual path", () => {
    // A gateway can be down, a merchant profile can refuse an API refund,
    // and somebody may have refunded by hand before this existed.
    expect(RETURNS).toMatch(/export async function markRefundSettled/);
    expect(RETURNS).toMatch(/export async function settleRefundThroughGateway/);
  });

  it("sends minor units, which is the only representation without a lost cent", () => {
    expect(RETURNS).toMatch(/toMinorUnits\(amount, "USD"\)/);
  });
});

describe("cancelling an order", () => {
  it("tries to release the hold rather than leaving it to expire", () => {
    expect(ORDERS).toMatch(/voidOrderAuthorization\(orderId\)/);
  });

  it("still says what to do by hand when the void does not happen", () => {
    expect(ORDERS).toMatch(/voided\.ok[\s\S]{0,400}BNCTL/);
  });

  it("does not let a failed void undo the cancellation", () => {
    // The order is already cancelled. The money is a separate question and
    // a failure there must not reopen an order the shop has closed.
    const fn = ORDERS.slice(ORDERS.indexOf('if (status === "cancelled" && before)'));
    const block = fn.slice(0, fn.indexOf("await notifyStatusChange"));
    expect(block).not.toMatch(/throw /);
  });
});
