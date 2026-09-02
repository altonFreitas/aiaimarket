import { describe, it, expect } from "vitest";
import { cappedPlain } from "@/lib/data/capped";

/* readCapped itself takes a query runner and is exercised through
 * cappedPlain's shared arithmetic plus the runner contract below; the part
 * worth pinning is the boundary, because an off-by-one here is the
 * difference between a page that admits it is truncated and one that lies. */

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));

describe("cappedPlain", () => {
  it("is not truncated when fewer rows than the cap come back", () => {
    const c = cappedPlain(10, rows(4));
    expect(c.truncated).toBe(false);
    expect(c.rows).toHaveLength(4);
  });

  it("is NOT truncated at exactly the cap", () => {
    // The read asks for cap + 1. Getting exactly `cap` back means the shop
    // has exactly that many rows, not that more were hidden -- warning here
    // would cry wolf at every store that happens to land on a round number.
    const c = cappedPlain(10, rows(10));
    expect(c.truncated).toBe(false);
    expect(c.rows).toHaveLength(10);
  });

  it("is truncated at one over the cap, and trims the extra", () => {
    const c = cappedPlain(10, rows(11));
    expect(c.truncated).toBe(true);
    expect(c.rows).toHaveLength(10);
  });

  it("survives a failed read without pretending it was complete", () => {
    const c = cappedPlain(10, null);
    expect(c.rows).toEqual([]);
    expect(c.truncated).toBe(false);
  });
});

describe("readCapped", () => {
  it("asks the database for one row more than the cap", async () => {
    const { readCapped } = await import("@/lib/data/capped");
    let asked = 0;
    await readCapped(50, async (limit) => { asked = limit; return []; });
    expect(asked).toBe(51);
  });

  it("reports the oldest row it kept, so a page can say from when", async () => {
    const { readCapped } = await import("@/lib/data/capped");
    const c = await readCapped(2, async () => [
      { created_at: "2026-08-03" }, { created_at: "2026-08-02" }, { created_at: "2026-08-01" },
    ]);
    expect(c.truncated).toBe(true);
    expect(c.rows).toHaveLength(2);
    expect(c.oldestKept).toBe("2026-08-02");
  });

  it("names no cut-off date when nothing was cut off", async () => {
    const { readCapped } = await import("@/lib/data/capped");
    const c = await readCapped(5, async () => [{ created_at: "2026-08-03" }]);
    expect(c.truncated).toBe(false);
    expect(c.oldestKept).toBeNull();
  });
});
