import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { STORE_TZ, storeDay, storeDayStart, storeDayRange, storeStamp } from "@/lib/tz";

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

/* ---------------------------------------------------------------------------
 * storeStamp -- the one that caused a hydration error
 * ------------------------------------------------------------------------ */

describe("storeStamp", () => {
  // 12:09 UTC is 21:09 the same day in Dili (UTC+9).
  const AT = "2026-09-03T12:09:00Z";

  it("reads the shop's clock, not the server's", () => {
    expect(storeStamp(AT)).toBe("03 Sep 21:09");
  });

  it("gives the same answer for a Date, a number and a string", () => {
    // The call sites pass all three. They are the same moment, so they are
    // the same string -- anything else is the table disagreeing with itself
    // depending on which query loaded the row.
    const ms = Date.parse(AT);
    expect(storeStamp(new Date(ms))).toBe(storeStamp(ms));
    expect(storeStamp(ms)).toBe(storeStamp(AT));
  });

  it("does not take a month name from Intl", () => {
    /* THE HYDRATION BUG, and the half that survives a timezone fix.
       A locale's short month is ICU data: en-GB is "Sep" in one ICU build
       and "Sept" in the next, so Node and the browser can disagree about
       the same locale. The server rendered "03 Sept 09:09 pm" while the
       browser rendered "03 Sep 21:09" and React threw the markup away.

       Asserting against Intl's own answer rather than against a literal,
       so this fails if the month ever starts coming from ICU again. */
    const viaIntl = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: STORE_TZ })
      .format(new Date(AT));
    expect(["Sep", "Sept"]).toContain(viaIntl);   // whichever this ICU has
    expect(storeStamp(AT).split(" ")[1]).toBe("Sep");  // always this one
  });

  it("is 24-hour, so 21:09 is never 09:09", () => {
    // The server was rendering "09:09 pm" against the browser's "21:09".
    // Losing the "pm" in a table of timestamps turns evening into morning.
    expect(storeStamp(AT)).not.toMatch(/[ap]m/i);
    expect(storeStamp("2026-09-03T00:30:00Z")).toBe("03 Sep 09:30");
  });

  it("crosses midnight on the shop's clock, not on UTC's", () => {
    // 16:00 UTC on the 3rd is 01:00 on the 4th in Dili.
    expect(storeStamp("2026-09-03T16:00:00Z")).toBe("04 Sep 01:00");
    // And 23:30 in Dili is still the 3rd, though UTC has not got there.
    expect(storeStamp("2026-09-03T14:30:00Z")).toBe("03 Sep 23:30");
  });

  it("pads the day and the hour, so the column lines up", () => {
    expect(storeStamp("2026-01-01T00:00:00Z")).toBe("01 Jan 09:00");
  });

  it("names every month", () => {
    const seen = Array.from({ length: 12 }, (_, m) =>
      storeStamp(Date.UTC(2026, m, 15, 0, 0)).split(" ")[1]);
    expect(seen).toEqual(
      ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
       "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
  });

  it("renders nothing for a timestamp it cannot read", () => {
    // Rather than the words "Invalid Date" in the middle of a table.
    expect(storeStamp("not a date")).toBe("");
    expect(storeStamp(Number.NaN)).toBe("");
  });
});

/* ---------------------------------------------------------------------------
 * The whole class, not just the one that was reported
 * ------------------------------------------------------------------------ */

describe("nothing formats with the runtime's own locale", () => {
  /* WHY THIS IS A GREP AND NOT A BEHAVIOUR TEST.
   *
   * The defect is that the answer depends on the process: its default
   * locale and its default timezone. Vitest runs in one process, so a test
   * that calls the function cannot see the difference -- the server and the
   * browser have to disagree for the bug to show, and that is not a thing
   * that happens inside a test runner.
   *
   * What CAN be checked is that nobody asks the runtime in the first place.
   * toLocaleString() with no locale is the shape of the bug: it rendered
   * "Sep 03 12:09 PM" on a UTC server and "03 Sep 21:09" in a browser in
   * Dili, and React threw away the server's markup on every admin page that
   * showed a timestamp. */
  const SRC = path.join(process.cwd(), "src");

  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return /\.tsx?$/.test(e.name) ? [full] : [];
    });
  }

  it("never leaves the locale to whoever is running the code", () => {
    const bad: string[] = [];
    for (const file of walk(SRC)) {
      const body = fs.readFileSync(file, "utf8");
      body.split("\n").forEach((line, i) => {
        // toLocaleString() / toLocaleDateString(undefined, ...) and friends:
        // an empty first argument, or an explicit undefined, both mean
        // "whatever this machine prefers".
        if (/\.toLocale(Date|Time)?String\(\s*(\)|undefined)/.test(line)) {
          bad.push(`${path.relative(process.cwd(), file)}:${i + 1}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });

  it("routes every timestamp shown to a person through the shop's clock", () => {
    // nowIso is the name twenty call sites use; it must not grow its own
    // formatting again. If it stops delegating, the grep above would still
    // pass while the bug came back with an explicit locale and the wrong
    // timezone.
    const utils = fs.readFileSync(path.join(SRC, "lib", "utils.ts"), "utf8");
    const body = utils.slice(utils.indexOf("export function nowIso"));
    expect(body.slice(0, body.indexOf("}"))).toContain("storeStamp");
  });
});
