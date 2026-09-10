import { describe, it, expect } from "vitest";
import { isMissingColumnError, writeTolerating, readTolerating } from "@/lib/missingColumn";

/* The shapes these actually arrive in. */
const PGRST204 = {
  code: "PGRST204",
  details: null,
  hint: null,
  message: "Could not find the 'audience' column of 'products' in the schema cache",
};
const PG_42703 = {
  code: "42703",
  details: null,
  hint: null,
  message: 'column "audience" of relation "products" does not exist',
};

describe("isMissingColumnError", () => {
  it("recognises PostgREST's schema-cache miss", () => {
    expect(isMissingColumnError(PGRST204)).toBe(true);
    expect(isMissingColumnError(PGRST204, "audience")).toBe(true);
  });

  it("recognises Postgres' own undefined_column", () => {
    expect(isMissingColumnError(PG_42703)).toBe(true);
    expect(isMissingColumnError(PG_42703, "audience")).toBe(true);
  });

  it("insists the message names the column when one is given", () => {
    // Otherwise a retry would drop the wrong field and fail identically.
    expect(isMissingColumnError(PGRST204, "restock_level")).toBe(false);
    expect(isMissingColumnError(PG_42703, "sizes")).toBe(false);
  });

  it("is not fooled by the errors that must still fail loudly", () => {
    const real = [
      { code: "23505", message: "duplicate key value violates unique constraint" },
      { code: "23514", message: 'new row violates check constraint "products_audience_check"' },
      { code: "42501", message: "permission denied for table products" },
      { code: "PGRST301", message: "JWT expired" },
      new Error("fetch failed"),
      null, undefined, "", "audience", 42, [],
    ];
    for (const e of real) expect([e, isMissingColumnError(e, "audience")]).toEqual([e, false]);
  });

  it("still recognises a schema-cache miss reported without a code", () => {
    expect(isMissingColumnError(
      { message: "Could not find the 'audience' column of 'products'" }, "audience")).toBe(true);
  });
});

describe("writeTolerating", () => {
  it("writes the optional fields when the database has them", async () => {
    const calls: Record<string, unknown>[] = [];
    const out = await writeTolerating({ audience: "men" }, async (extra) => {
      calls.push(extra);
      return { error: null };
    });
    expect(out.error).toBeNull();
    expect(out.degraded).toBe(false);
    expect(calls).toEqual([{ audience: "men" }]);
  });

  it("drops them and retries once when it does not", async () => {
    const calls: Record<string, unknown>[] = [];
    const out = await writeTolerating({ audience: "men" }, async (extra) => {
      calls.push(extra);
      return { error: calls.length === 1 ? PGRST204 : null };
    });
    expect(out.error).toBeNull();
    // The save succeeded, and the caller can say the field was not kept.
    expect(out.degraded).toBe(true);
    expect(calls).toEqual([{ audience: "men" }, {}]);
  });

  it("does not retry a real failure", async () => {
    const calls: unknown[] = [];
    const dup = { code: "23505", message: "duplicate key" };
    const out = await writeTolerating({ audience: "men" }, async (extra) => {
      calls.push(extra);
      return { error: dup };
    });
    expect(out.error).toBe(dup);
    expect(out.degraded).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("gives up after one retry rather than looping", async () => {
    let n = 0;
    const out = await writeTolerating({ audience: "men" }, async () => {
      n++;
      return { error: PGRST204 };
    });
    expect(n).toBe(2);
    expect(out.error).toBe(PGRST204);
    expect(out.degraded).toBe(false);
  });

  it("passes the returned data back through", async () => {
    const out = await writeTolerating<{ id: string }>(
      { audience: "men" }, async () => ({ error: null, data: { id: "p1" } }));
    expect(out.data).toEqual({ id: "p1" });
  });

  it("keeps the data from the retry, not from the failed attempt", async () => {
    let n = 0;
    const out = await writeTolerating<{ id: string }>({ audience: "men" }, async () => {
      n++;
      return n === 1 ? { error: PGRST204 } : { error: null, data: { id: "p2" } };
    });
    expect(out.data).toEqual({ id: "p2" });
  });
});

describe("the seller features column, which is the newest one", () => {
  // setSellerFeatures() turns these two into a message naming the SQL file
  // to run, because "column does not exist" on a screen tells the owner
  // nothing about what to do next.
  it("recognises both shapes a database gives before seller-features.sql", () => {
    expect(isMissingColumnError(
      { code: "PGRST204", message: "Could not find the 'features' column of 'sellers' in the schema cache" },
      "features"
    )).toBe(true);
    expect(isMissingColumnError(
      { code: "42703", message: 'column "features" of relation "sellers" does not exist' },
      "features"
    )).toBe(true);
  });

  it("does not swallow a value the constraint refused", () => {
    // A key outside the catalogue is a real failure and must surface as
    // itself -- silently reporting it as "the migration has not run" would
    // send the owner to run a file that is already there.
    expect(isMissingColumnError(
      { code: "23514", message: 'new row for relation "sellers" violates check constraint "sellers_features_check"' },
      "features"
    )).toBe(false);
  });
});

describe("readTolerating", () => {
  const missing = { code: "42703", message: 'column suppliers.seller_id does not exist' };

  it("uses the filtered query when the column is there", async () => {
    const seen: boolean[] = [];
    const out = await readTolerating("seller_id", (filtered) => {
      seen.push(filtered);
      return Promise.resolve({ error: null, data: ["ours"] });
    });
    expect(seen).toEqual([true]);
    expect(out.data).toEqual(["ours"]);
    expect(out.degraded).toBe(false);
  });

  it("falls back to the unfiltered one when the column is not there yet", async () => {
    // THE ONE THAT MATTERS. Without this the owner's purchasing book comes
    // back empty on a shop that has the code and has not run the SQL --
    // and an empty list looks like an answer rather than like a failure.
    const seen: boolean[] = [];
    const out = await readTolerating("seller_id", (filtered) => {
      seen.push(filtered);
      return Promise.resolve(filtered
        ? { error: missing, data: null }
        : { error: null, data: ["everything"] });
    });
    expect(seen).toEqual([true, false]);
    expect(out.data).toEqual(["everything"]);
    expect(out.degraded).toBe(true);
  });

  it("does not retry a failure that is not a missing column", async () => {
    // A permission error or a dropped connection must fail, not quietly
    // widen the query to every row in the table.
    let calls = 0;
    const out = await readTolerating("seller_id", () => {
      calls++;
      return Promise.resolve({ error: { code: "42501", message: "permission denied" }, data: null });
    });
    expect(calls).toBe(1);
    expect(out.error).toBeTruthy();
  });

  it("does not retry when a DIFFERENT column is missing", async () => {
    let calls = 0;
    await readTolerating("seller_id", () => {
      calls++;
      return Promise.resolve({
        error: { code: "42703", message: "column suppliers.country_code does not exist" },
        data: null,
      });
    });
    expect(calls).toBe(1);
  });
});
