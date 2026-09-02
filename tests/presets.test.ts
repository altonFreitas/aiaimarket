import { describe, it, expect } from "vitest";
import { PERIOD_PRESETS, presetRange, activePreset, weekStart } from "@/lib/sales";

/* Sunday 2026-08-30 is deliberately the "today" for the week tests: a
 * preset that quietly starts the week on Sunday would pass every Tuesday
 * and fail only on the day the shop most wants to look back. */

describe("presetRange", () => {
  const today = "2026-08-27";   // a Thursday

  it("today is a single day", () => {
    expect(presetRange("today", today)).toEqual({ from: today, to: today });
  });

  it("this week runs from Monday to today, not from seven days ago", () => {
    expect(presetRange("week", today)).toEqual({ from: "2026-08-24", to: today });
    expect(weekStart(today)).toBe("2026-08-24");
  });

  it("keeps Sunday in the week that has just ended", () => {
    // Sunday 30 August belongs to the week beginning Monday 24th.
    expect(presetRange("week", "2026-08-30")).toEqual({ from: "2026-08-24", to: "2026-08-30" });
  });

  it("on a Monday, this week is just that Monday", () => {
    expect(presetRange("week", "2026-08-24")).toEqual({ from: "2026-08-24", to: "2026-08-24" });
  });

  it("this month starts on the first and ends today, not at month end", () => {
    // A month that has not finished must not report itself as a full month
    // of trading.
    expect(presetRange("month", today)).toEqual({ from: "2026-08-01", to: today });
  });

  it("last month is the whole of the previous month", () => {
    expect(presetRange("lastMonth", today)).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });

  it("gets February right, including a leap year", () => {
    expect(presetRange("lastMonth", "2026-03-15")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(presetRange("lastMonth", "2028-03-15")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("steps back across a year boundary", () => {
    expect(presetRange("lastMonth", "2026-01-09")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("this quarter starts at the quarter's first month", () => {
    expect(presetRange("quarter", "2026-08-27").from).toBe("2026-07-01");
    expect(presetRange("quarter", "2026-01-05").from).toBe("2026-01-01");
    expect(presetRange("quarter", "2026-06-30").from).toBe("2026-04-01");
    expect(presetRange("quarter", "2026-12-31").from).toBe("2026-10-01");
  });

  it("this year starts on 1 January", () => {
    expect(presetRange("year", today)).toEqual({ from: "2026-01-01", to: today });
  });

  it("never returns a range that ends before it starts", () => {
    for (const day of ["2026-01-01", "2026-02-28", "2026-08-27", "2026-12-31"]) {
      for (const p of PERIOD_PRESETS) {
        const r = presetRange(p, day);
        expect(r.from <= r.to).toBe(true);
      }
    }
  });
});

describe("activePreset", () => {
  const today = "2026-08-27";

  it("recognises each preset's own range", () => {
    for (const p of PERIOD_PRESETS) {
      const r = presetRange(p, today);
      expect(activePreset(r.from, r.to, today)).toBe(p);
    }
  });

  it("is null for a range somebody picked by hand", () => {
    expect(activePreset("2026-03-04", "2026-05-09", today)).toBeNull();
  });

  it("is null when only one end is set", () => {
    expect(activePreset("2026-08-01", undefined, today)).toBeNull();
    expect(activePreset(undefined, "2026-08-27", today)).toBeNull();
    expect(activePreset(undefined, undefined, today)).toBeNull();
  });
});
