import { describe, it, expect } from "vitest";
import {
  canTransitionPayment, decideTransition, isPaidStatus,
  isTerminalPaymentStatus, orderPayStatusFor, type PaymentStatus,
} from "@/lib/payments/state";

const ALL: PaymentStatus[] = [
  "initiated", "pending", "authorized", "captured", "failed", "cancelled", "refunded",
];

describe("isPaidStatus", () => {
  it("counts ONLY captured as paid", () => {
    // The important negative case: an authorization is a hold that can
    // expire or be voided. Shipping against one means delivering goods
    // that were never actually paid for.
    expect(isPaidStatus("authorized")).toBe(false);
    expect(isPaidStatus("captured")).toBe(true);
    for (const s of ALL.filter((x) => x !== "captured")) {
      expect(isPaidStatus(s)).toBe(false);
    }
  });
});

describe("terminal states", () => {
  it("treats failed/cancelled/refunded as terminal", () => {
    expect(isTerminalPaymentStatus("failed")).toBe(true);
    expect(isTerminalPaymentStatus("cancelled")).toBe(true);
    expect(isTerminalPaymentStatus("refunded")).toBe(true);
  });

  it("does not treat captured as terminal — it can still be refunded", () => {
    expect(isTerminalPaymentStatus("captured")).toBe(false);
    expect(canTransitionPayment("captured", "refunded")).toBe(true);
  });

  it("allows nothing out of a terminal state", () => {
    for (const from of ["failed", "cancelled", "refunded"] as PaymentStatus[]) {
      for (const to of ALL) {
        expect(canTransitionPayment(from, to)).toBe(false);
      }
    }
  });
});

describe("canTransitionPayment", () => {
  it("permits the happy paths", () => {
    expect(canTransitionPayment("initiated", "pending")).toBe(true);
    expect(canTransitionPayment("pending", "authorized")).toBe(true);
    expect(canTransitionPayment("authorized", "captured")).toBe(true);
    // Many gateways report a single CAPTURED with no AUTHORIZED first.
    expect(canTransitionPayment("pending", "captured")).toBe(true);
    expect(canTransitionPayment("initiated", "captured")).toBe(true);
  });

  it("refuses to walk backwards", () => {
    expect(canTransitionPayment("captured", "pending")).toBe(false);
    expect(canTransitionPayment("captured", "authorized")).toBe(false);
    expect(canTransitionPayment("authorized", "pending")).toBe(false);
    expect(canTransitionPayment("pending", "initiated")).toBe(false);
  });

  it("treats a same-state event as no transition", () => {
    for (const s of ALL) expect(canTransitionPayment(s, s)).toBe(false);
  });

  it("never allows un-capturing money", () => {
    // Refund is the ONLY legal exit from captured.
    for (const to of ALL.filter((s) => s !== "refunded")) {
      expect(canTransitionPayment("captured", to)).toBe(false);
    }
  });
});

describe("decideTransition — webhook reality", () => {
  it("ignores a duplicate delivery instead of erroring", () => {
    // Providers retry. Treating a retry as an error makes them retry harder.
    const v = decideTransition("captured", "captured");
    expect(v.action).toBe("ignore");
  });

  it("ignores an out-of-order AUTHORIZED arriving after CAPTURED", () => {
    const v = decideTransition("captured", "authorized");
    expect(v.action).toBe("ignore");
    if (v.action === "ignore") expect(v.reason).toMatch(/illegal transition/);
  });

  it("ignores anything after a terminal state", () => {
    const v = decideTransition("refunded", "captured");
    expect(v.action).toBe("ignore");
    if (v.action === "ignore") expect(v.reason).toMatch(/terminal/);
  });

  it("applies a genuine forward move", () => {
    const v = decideTransition("pending", "captured");
    expect(v).toEqual({ action: "apply", to: "captured" });
  });
});

describe("orderPayStatusFor", () => {
  it("maps onto the order's existing pay_status vocabulary", () => {
    expect(orderPayStatusFor("captured")).toBe("paid");
    expect(orderPayStatusFor("refunded")).toBe("refunded");
    // Everything in flight leaves the order unpaid — including authorized.
    expect(orderPayStatusFor("authorized")).toBe("unpaid");
    expect(orderPayStatusFor("pending")).toBe("unpaid");
    expect(orderPayStatusFor("failed")).toBe("unpaid");
  });
});
