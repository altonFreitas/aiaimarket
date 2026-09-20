import { describe, it, expect } from "vitest";
import {
  normalizeVariantQty, variantQtyTotal, receiptMovementsFor,
} from "@/lib/variantStock";
import { NO_SIZE } from "@/lib/sizeStock";

const V1 = "11111111-1111-1111-1111-111111111111";
const V2 = "22222222-2222-2222-2222-222222222222";

describe("normalizing what the column holds", () => {
  /* jsonb arrives as unknown, and a half-typed form can put a string, a
     negative or a fraction in it. None of those may reach the ledger,
     where they would become stock. */
  it("keeps positive whole numbers", () => {
    expect(normalizeVariantQty({ [V1]: 20, [V2]: 30 })).toEqual({ [V1]: 20, [V2]: 30 });
  });

  it("drops zero, negative and fractional counts", () => {
    expect(normalizeVariantQty({ [V1]: 0, [V2]: -5 })).toEqual({});
    expect(normalizeVariantQty({ [V1]: 2.7 })).toEqual({ [V1]: 2 });
  });

  it("survives anything that is not a map", () => {
    for (const junk of [null, undefined, [], "x", 7]) {
      expect(normalizeVariantQty(junk)).toEqual({});
    }
  });

  it("reads a number that arrived as a string", () => {
    // Form fields are strings all the way to the database.
    expect(normalizeVariantQty({ [V1]: "20" })).toEqual({ [V1]: 20 });
  });

  it("totals what the line buys", () => {
    expect(variantQtyTotal({ [V1]: 20, [V2]: 30 })).toBe(50);
    expect(variantQtyTotal({})).toBe(0);
  });
});

describe("the movements a line produces", () => {
  it("writes one per variant when the line names variants", () => {
    const out = receiptMovementsFor({}, { [V1]: 20, [V2]: 30 }, 99);
    expect(out).toHaveLength(2);
    expect(out.map((m) => m.qty).sort((a, b) => a - b)).toEqual([20, 30]);
    expect(out.every((m) => m.variantId !== null)).toBe(true);
  });

  it("carries the variant's own size, because the column has not retired", () => {
    /* The per-size views and the reorder report still read `size`. A
       variant receipt that left it empty would quietly move that stock
       into the "no size recorded" pool, which backs every size. */
    const out = receiptMovementsFor({}, { [V1]: 20 }, 99,
      (id) => (id === V1 ? "M" : ""));
    expect(out).toEqual([{ variantId: V1, size: "M", qty: 20 }]);
  });

  it("falls back to no size for a variant that has none", () => {
    const out = receiptMovementsFor({}, { [V1]: 5 }, 99, () => "");
    expect(out[0].size).toBe(NO_SIZE);
  });

  it("IGNORES the size map entirely when variants are named", () => {
    /* The one that would double the shop's stock. A variant already
       carries its size -- that is what "Black / M" means -- so honouring
       both maps would count the same shirts twice, once under M and once
       under Black/M. */
    const out = receiptMovementsFor(
      { S: 5, M: 10 }, { [V1]: 20 }, 99, () => "M");
    expect(out).toHaveLength(1);
    expect(out[0].variantId).toBe(V1);
    expect(out[0].qty).toBe(20);
  });

  it("behaves exactly as before when no variants are named", () => {
    const out = receiptMovementsFor({ S: 5, M: 10 }, {}, 99);
    expect(out).toEqual([
      { size: "S", qty: 5, variantId: null },
      { size: "M", qty: 10, variantId: null },
    ]);
  });

  it("writes one unsized movement for goods with neither", () => {
    // A fridge.
    expect(receiptMovementsFor({}, {}, 12))
      .toEqual([{ size: NO_SIZE, qty: 12, variantId: null }]);
  });

  it("writes nothing for a line that buys nothing", () => {
    expect(receiptMovementsFor({}, {}, 0)).toEqual([]);
    expect(receiptMovementsFor({}, {}, -4)).toEqual([]);
  });

  it("ignores a variant entry of zero rather than writing an empty movement", () => {
    const out = receiptMovementsFor({}, { [V1]: 0, [V2]: 30 }, 99);
    expect(out).toEqual([{ variantId: V2, size: NO_SIZE, qty: 30 }]);
  });
});
