import { describe, it, expect } from "vitest";
import { checkOrderTransition, assertOrderTransition } from "@/lib/orderFlow";
import { FLOW, PICKUP_FLOW, flowFor } from "@/lib/utils";
import type { OrderStatus } from "@/lib/types";

const ALL: OrderStatus[] = [
  "new", "confirmed", "preparing", "out", "arrived", "completed", "cancelled",
];

describe("checkOrderTransition — forward-only", () => {
  it("allows each step to the next", () => {
    for (let i = 0; i < FLOW.length - 1; i++) {
      expect(checkOrderTransition(FLOW[i], FLOW[i + 1]).ok).toBe(true);
    }
  });

  it("allows skipping ahead (pickup orders skip out/arrived)", () => {
    expect(checkOrderTransition("preparing", "completed").ok).toBe(true);
  });

  it("refuses every backwards move", () => {
    for (let i = 1; i < FLOW.length; i++) {
      for (let j = 0; j < i; j++) {
        const v = checkOrderTransition(FLOW[i], FLOW[j]);
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.reason).toMatch(/earlier status/);
      }
    }
  });
});

describe("cancelled is terminal", () => {
  it("cannot be moved out of, to anything", () => {
    for (const to of ALL) {
      const v = checkOrderTransition("cancelled", to);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.reason).toMatch(/has been cancelled/);
    }
  });
});

describe("cancellation rules", () => {
  it("permits cancelling from any live status", () => {
    for (const from of ["new", "confirmed", "preparing", "out", "arrived"] as OrderStatus[]) {
      expect(checkOrderTransition(from, "cancelled").ok).toBe(true);
    }
  });

  it("refuses to cancel a completed order", () => {
    const v = checkOrderTransition("completed", "cancelled");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/no longer be cancelled/);
  });
});

describe("assertOrderTransition", () => {
  it("throws the same message the verdict carries", () => {
    expect(() => assertOrderTransition("completed", "new")).toThrow(/earlier status/);
    expect(() => assertOrderTransition("cancelled", "new")).toThrow(/has been cancelled/);
    expect(() => assertOrderTransition("new", "confirmed")).not.toThrow();
  });
});

describe("flowFor", () => {
  it("gives pickup orders a flow without the courier-only steps", () => {
    expect(flowFor("pickup")).toEqual(PICKUP_FLOW);
    expect(flowFor("pickup")).not.toContain("out");
    expect(flowFor("pickup")).not.toContain("arrived");
    expect(flowFor("delivery")).toEqual(FLOW);
  });
});
