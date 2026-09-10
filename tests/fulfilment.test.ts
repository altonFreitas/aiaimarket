import { describe, it, expect } from "vitest";
import {
  FULFILMENT_FLOW, FULFILMENT_LABEL, checkFulfilmentTransition,
  assertFulfilmentTransition, suggestedOrderStatus, fulfilmentProgress,
  type FulfilmentStatus,
} from "@/lib/fulfilment";
import { STR } from "@/lib/i18n";

/* THE RULES THAT END THE READ-ONLY MIXED ORDER.
 *
 * orders.status is one column shared by everyone in an order, so a seller
 * moving it would be speaking for the other seller too -- which is why a
 * mixed-seller order was read-only, and why this app could not honestly
 * call itself multi-vendor. Each seller's LINES now carry their own status
 * instead, and these are the rules for moving one.
 */

describe("checkFulfilmentTransition", () => {
  it("moves forward through the flow", () => {
    expect(checkFulfilmentTransition("pending", "preparing").ok).toBe(true);
    expect(checkFulfilmentTransition("preparing", "ready").ok).toBe(true);
    expect(checkFulfilmentTransition("ready", "dispatched").ok).toBe(true);
    // And may skip a step: a seller who packs and hands over in one go
    // should not have to click twice to say so.
    expect(checkFulfilmentTransition("pending", "dispatched").ok).toBe(true);
  });

  it("never moves backward", () => {
    // A status that can go backwards is a status nobody can act on --
    // "ready" would mean it was ready and then was not.
    for (const [from, to] of [
      ["dispatched", "ready"], ["ready", "preparing"], ["preparing", "pending"],
      ["dispatched", "pending"],
    ] as [FulfilmentStatus, FulfilmentStatus][]) {
      const v = checkFulfilmentTransition(from, to);
      expect([from, to, v.ok]).toEqual([from, to, false]);
    }
  });

  it("refuses a move to where it already is", () => {
    // Not an error worth a stack trace, but not a silent no-op either: a
    // seller clicking "ready" twice should be told nothing changed.
    expect(checkFulfilmentTransition("ready", "ready").ok).toBe(false);
  });

  it("is terminal once cancelled", () => {
    for (const to of FULFILMENT_FLOW) {
      expect([to, checkFulfilmentTransition("cancelled", to).ok]).toEqual([to, false]);
    }
  });

  it("lets a seller withdraw a line until it has gone", () => {
    for (const from of ["pending", "preparing", "ready"] as FulfilmentStatus[]) {
      expect([from, checkFulfilmentTransition(from, "cancelled").ok]).toEqual([from, true]);
    }
    // Once it is with the courier the honest answer is a return, not a
    // retroactive cancellation.
    expect(checkFulfilmentTransition("dispatched", "cancelled").ok).toBe(false);
  });

  it("refuses a status it has never heard of", () => {
    expect(checkFulfilmentTransition("pending", "teleported" as FulfilmentStatus).ok).toBe(false);
  });

  it("throws the same rule it checks", () => {
    expect(() => assertFulfilmentTransition("pending", "preparing")).not.toThrow();
    expect(() => assertFulfilmentTransition("dispatched", "pending")).toThrow();
  });
});

describe("suggestedOrderStatus", () => {
  /* The buyer has ONE question -- where is my order -- and it does not
   * become three questions because the shop bought from three sellers. */

  it("is the slowest line, not the fastest", () => {
    // One seller dispatching does not make the order dispatched. This is
    // the whole reason it is a derivation and not a copy.
    expect(suggestedOrderStatus(["dispatched", "pending"])).toBe("preparing");
    expect(suggestedOrderStatus(["dispatched", "dispatched"])).toBe("out");
  });

  it("says nothing has started when nothing has", () => {
    expect(suggestedOrderStatus(["pending", "pending"])).toBe("new");
  });

  it("counts everybody being ready as preparing, not as gone", () => {
    // Ready is packed, not handed over. An order is only out when it is
    // actually out.
    expect(suggestedOrderStatus(["ready", "ready"])).toBe("preparing");
  });

  it("ignores cancelled lines", () => {
    // A withdrawn line must not hold the whole order back forever.
    expect(suggestedOrderStatus(["dispatched", "cancelled"])).toBe("out");
    expect(suggestedOrderStatus(["cancelled", "ready"])).toBe("preparing");
  });

  it("refuses to guess when every line is cancelled", () => {
    // That is not "ready to dispatch", it is a cancelled order -- and
    // that is a decision for a person, not a derivation.
    expect(suggestedOrderStatus(["cancelled", "cancelled"])).toBeNull();
    expect(suggestedOrderStatus([])).toBeNull();
  });
});

describe("fulfilmentProgress", () => {
  it("counts dispatched lines out of live ones", () => {
    expect(fulfilmentProgress(["dispatched", "ready", "pending"]))
      .toEqual({ done: 1, total: 3 });
  });

  it("does not count a cancelled line towards either number", () => {
    expect(fulfilmentProgress(["dispatched", "cancelled"]))
      .toEqual({ done: 1, total: 1 });
  });
});

describe("the vocabulary", () => {
  it("is shorter than the order's own, deliberately", () => {
    // orders.status runs through 'out' and 'arrived', which are about
    // DELIVERY -- something the seller is not doing and cannot observe.
    // Giving them those would be inviting them to guess.
    expect(FULFILMENT_FLOW).not.toContain("arrived");
    expect(FULFILMENT_FLOW).not.toContain("completed");
    expect(FULFILMENT_FLOW.length).toBeLessThan(5);
  });

  it("can be said in all three languages", () => {
    for (const key of Object.values(FULFILMENT_LABEL)) {
      expect([key, key in STR]).toEqual([key, true]);
    }
  });
});
