import { describe, it, expect } from "vitest";
import { STORE_TZ, storeDay, storeDayStart, storeDayRange } from "@/lib/tz";

/* These tests are only meaningful because vitest runs them in ONE server
 * timezone while asserting answers in the SHOP's. That is exactly the
 * failure being fixed: the old rule gave a different answer depending on
 * where the server happened to be. */

describe("the shop's timezone", () => {
  it("defaults to Timor-Leste", () => {
    expect(STORE_TZ).toBe("Asia/Dili");
  });
});

describe("storeDay", () => {
  it("files an early-morning Dili sale under that morning, not the day before", () => {
    // 22:15 UTC on the 27th is 07:15 on the 28th in Dili (UTC+9).
    // This is the bug: a third of every trading day was landing on
    // yesterday whenever the server ran in UTC.
    expect(storeDay(new Date("2026-08-27T22:15:00Z"))).toBe("2026-08-28");
  });

  it("files a late-evening Dili sale under that evening", () => {
    // 14:30 UTC = 23:30 the same day in Dili.
    expect(storeDay(new Date("2026-08-28T14:30:00Z"))).toBe("2026-08-28");
  });

  it("rolls over at midnight in Dili, not at midnight in UTC", () => {
    // 14:59:59 UTC is 23:59:59 on the 28th; one second later it is the 29th.
    expect(storeDay(new Date("2026-08-28T14:59:59Z"))).toBe("2026-08-28");
    expect(storeDay(new Date("2026-08-28T15:00:00Z"))).toBe("2026-08-29");
  });

  it("crosses a year boundary on the shop's clock", () => {
    expect(storeDay(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
    expect(storeDay(new Date("2026-12-31T14:59:59Z"))).toBe("2026-12-31");
  });

  it("accepts a timestamp as readily as a Date", () => {
    const ms = Date.parse("2026-08-27T22:15:00Z");
    expect(storeDay(ms)).toBe(storeDay(new Date(ms)));
  });

  it("returns empty for a date it cannot read, rather than 'Invalid Date'", () => {
    expect(storeDay(new Date("nonsense"))).toBe("");
    expect(storeDay(NaN)).toBe("");
  });
});

describe("storeDayStart", () => {
  it("is 15:00 UTC the previous day, because Dili is nine hours ahead", () => {
    expect(new Date(storeDayStart("2026-08-28")).toISOString())
      .toBe("2026-08-27T15:00:00.000Z");
  });

  it("brackets the day exactly: the last second in, the next day out", () => {
    const start = storeDayStart("2026-08-28");
    const next = storeDayStart("2026-08-29");
    expect(next - start).toBe(86_400_000);
    expect(storeDay(start)).toBe("2026-08-28");
    expect(storeDay(next - 1)).toBe("2026-08-28");
    expect(storeDay(next)).toBe("2026-08-29");
  });

  it("round-trips every day of a month", () => {
    for (let d = 1; d <= 28; d++) {
      const day = `2026-02-${String(d).padStart(2, "0")}`;
      expect(storeDay(storeDayStart(day))).toBe(day);
    }
  });

  it("is NaN for an unreadable day rather than silently meaning 1970", () => {
    expect(Number.isNaN(storeDayStart("not-a-day"))).toBe(true);
  });
});

describe("storeDayRange", () => {
  const noon = new Date("2026-08-28T03:00:00Z"); // midday in Dili

  it("today is the whole of today in Dili", () => {
    const [start, end] = storeDayRange(0, noon);
    expect(new Date(start).toISOString()).toBe("2026-08-27T15:00:00.000Z");
    expect(new Date(end).toISOString()).toBe("2026-08-28T15:00:00.000Z");
  });

  it("counts back in the shop's days", () => {
    const [start] = storeDayRange(3, noon);
    expect(storeDay(start)).toBe("2026-08-25");
  });

  it("always spans one day exactly", () => {
    for (let i = 0; i < 14; i++) {
      const [s, e] = storeDayRange(i, noon);
      expect(e - s).toBe(86_400_000);
      expect(storeDay(s)).toBe(storeDay(e - 1));
    }
  });

  it("brackets an instant into exactly one of its days", () => {
    const at = Date.parse("2026-08-26T22:00:00Z"); // 07:00 on the 27th in Dili
    const hits = [];
    for (let i = 0; i < 5; i++) {
      const [s, e] = storeDayRange(i, noon);
      if (at >= s && at < e) hits.push(storeDay(s));
    }
    expect(hits).toEqual(["2026-08-27"]);
  });
});
