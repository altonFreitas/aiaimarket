import { describe, it, expect } from "vitest";
import {
  toMinorUnits, fromMinorUnits, formatMinorUnits, amountsMatch,
  isSupportedCurrency, MAX_MINOR_UNITS,
} from "@/lib/payments/money";

describe("toMinorUnits", () => {
  it("converts whole and fractional dollars", () => {
    expect(toMinorUnits(1)).toBe(100);
    expect(toMinorUnits(0.01)).toBe(1);
    expect(toMinorUnits(12.34)).toBe(1234);
  });

  it("rounds the IEEE-754 cases that would otherwise undercharge", () => {
    // 19.99 * 100 === 1998.9999999999998 in binary floating point.
    // Truncating here is the classic off-by-one-cent bug.
    expect(toMinorUnits(19.99)).toBe(1999);
    expect(toMinorUnits(0.29)).toBe(29);
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
  });

  it("documents the exact-half boundary, which is not reachable from real prices", () => {
    // The literal 1.005 is not 1.005: the nearest double is
    // 1.00499999999999989341858963598497211933135986328125, genuinely BELOW
    // the half-cent line, so rounding down to 100 is arithmetically right.
    // No amount of rounding-mode cleverness changes that -- the precision
    // was lost before this function was called.
    //
    // It cannot bite in practice: every price and total originates from a
    // Postgres numeric(10,2), which is exact decimal and can only ever hold
    // two places. This test exists so that if someone later feeds computed
    // floats (a percentage discount, a currency conversion) straight in,
    // the behaviour is already written down rather than discovered.
    expect(toMinorUnits(1.005)).toBe(100);
    expect(1.005 * 100).toBeLessThan(100.5);
  });

  it("refuses amounts that are not real money", () => {
    expect(() => toMinorUnits(0)).toThrow();
    expect(() => toMinorUnits(-5)).toThrow();
    expect(() => toMinorUnits(NaN)).toThrow();
    expect(() => toMinorUnits(Infinity)).toThrow();
    // A sub-half-cent amount must not silently become a free order.
    expect(() => toMinorUnits(0.0001)).toThrow();
  });

  it("refuses an amount above the store's ceiling", () => {
    expect(() => toMinorUnits(MAX_MINOR_UNITS / 100 + 1)).toThrow();
  });
});

describe("fromMinorUnits / formatMinorUnits", () => {
  it("round-trips", () => {
    for (const dollars of [0.01, 1, 19.99, 250.5, 9999.99]) {
      expect(fromMinorUnits(toMinorUnits(dollars))).toBeCloseTo(dollars, 10);
    }
  });

  it("formats with fixed precision, never a float literal", () => {
    expect(formatMinorUnits(1999)).toBe("19.99");
    expect(formatMinorUnits(100)).toBe("1.00");
    expect(formatMinorUnits(5)).toBe("0.05");
    // The whole reason formatting goes through the integer:
    expect(formatMinorUnits(toMinorUnits(0.1 + 0.2))).toBe("0.30");
  });

  it("rejects non-integer minor units", () => {
    expect(() => fromMinorUnits(10.5)).toThrow();
  });
});

describe("amountsMatch", () => {
  it("is exact — a one-cent difference is a mismatch", () => {
    expect(amountsMatch(1999, 1999)).toBe(true);
    expect(amountsMatch(1999, 1998)).toBe(false);
    expect(amountsMatch(1999, 2000)).toBe(false);
  });

  it("rejects non-integers rather than coercing them", () => {
    expect(amountsMatch(19.99, 19.99)).toBe(false);
  });
});

describe("isSupportedCurrency", () => {
  it("accepts USD and nothing else yet", () => {
    expect(isSupportedCurrency("USD")).toBe(true);
    expect(isSupportedCurrency("EUR")).toBe(false);
    expect(isSupportedCurrency("")).toBe(false);
  });
});
