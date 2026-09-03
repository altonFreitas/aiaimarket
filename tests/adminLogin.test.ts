import { describe, it, expect, vi, beforeEach } from "vitest";

/* Who a login actually signs you in as.
 *
 * The one file in this suite that mocks anything. It earns that: the bug
 * it locks down was a real one on a live shop, it was invisible to every
 * pure test because each piece was individually correct, and it cost the
 * owner their own admin. The mocks are the three edges only -- the cookie
 * jar, the redirect, and the admin_users table. The session and the guard
 * are the real ones.
 */

let COOKIE: string | undefined;
let ROW: Record<string, unknown> | null = null;
let ROW_ERROR: unknown = null;
const queries: string[] = [];

vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  return { ...real };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => COOKIE ? { name: n, value: COOKIE } : undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error("NEXT_REDIRECT:" + to); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: (t: string) => { queries.push(t); return {
      // Faithful to Postgres: naming a column that does not exist fails the
      // WHOLE query. So the error is returned only when the select asks for
      // the columns the pretend database is missing -- otherwise the retry
      // would look broken when it is not.
      select: (cols: string) => {
        queries.push(cols);
        const missing = ROW_ERROR !== null && /role|sections/.test(cols);
        const answer = async () => ({
          data: missing ? null : ROW,
          error: missing ? ROW_ERROR : null,
        });
        return { eq: () => ({ maybeSingle: answer }), ilike: () => ({ maybeSingle: answer }) };
      },
    };},
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => ({}) }));
vi.mock("@/lib/sellerTotpSession", () => ({ hasSellerTotpSession: async () => true }));

process.env.SESSION_SECRET = "probe-secret";
process.env.ADMIN_EMAIL = "owner@example.com";
process.env.ADMIN_PASSWORD = "a-long-enough-password";

const crypto = await import("node:crypto");
const S = await import("@/lib/session");
const G = await import("@/lib/actions/guard");

function cookieFor(a: { kind: "owner" | "staff"; id: string | null; label: string }) {
  const v = S.encodeActor(a, Date.now());
  return `${v}.${crypto.createHmac("sha256", process.env.SESSION_SECRET!).update(v).digest("hex")}`;
}

beforeEach(() => { COOKIE = undefined; ROW = null; ROW_ERROR = null; queries.length = 0; });

describe("the owner, end to end", () => {
  it("resolves the owner from the environment credentials", async () => {
    const actor = await S.resolveLogin("owner@example.com", "a-long-enough-password");
    expect(actor).not.toBeNull();
    expect(actor!.kind).toBe("owner");
    expect(actor!.role).toBe("admin");
  });

  it("never touches admin_users for the owner", async () => {
    await S.resolveLogin("owner@example.com", "a-long-enough-password");
    expect(queries).toEqual([]);
  });

  it("round-trips the owner through the cookie and back", async () => {
    COOKIE = cookieFor(S.OWNER_IDENTITY);
    const back = await S.currentActor();
    expect(back?.kind).toBe("owner");
    expect(back?.role).toBe("admin");
  });

  it("lets the owner write", async () => {
    COOKIE = cookieFor(S.OWNER_IDENTITY);
    expect((await G.requireAdmin()).kind).toBe("owner");
  });

  it("lets the owner write even with admin_users broken or absent", async () => {
    COOKIE = cookieFor(S.OWNER_IDENTITY);
    ROW_ERROR = { code: "42703", message: 'column "role" does not exist' };
    expect((await G.requireAdmin()).kind).toBe("owner");
  });

  it("lets the owner into every section", async () => {
    COOKIE = cookieFor(S.OWNER_IDENTITY);
    for (const s of ["home","sales","catalog","procurement","sellers","storefront","settings"] as const) {
      expect((await G.requireSection(s)).kind).toBe("owner");
    }
  });
});

describe("a staff account sharing the owner's email cannot shadow them", () => {
  /** A shadow row whose password REALLY matches what gets typed. Without
   * a genuine hash the login would fail anyway and the test would pass
   * without proving anything. */
  async function shadowRow() {
    const { hashPassword } = await import("@/lib/password");
    return {
      id: "u-9", name: "Shadow", active: true, role: "reader", sections: [],
      password_hash: await hashPassword("the-staff-password"),
    };
  }

  it("refuses the owner's address at the staff login, even with its right password", async () => {
    // The reported bug, exactly. A staff row created under the owner's own
    // email answered for it whenever the owner password did not match --
    // so the owner, typing that account's password, was signed in as it.
    // Theirs was read-only, and their own shop stopped saving.
    ROW = await shadowRow();
    expect(await S.resolveLogin("owner@example.com", "the-staff-password")).toBeNull();
    expect(await S.resolveLogin("OWNER@EXAMPLE.COM", "the-staff-password")).toBeNull();
    expect(await S.resolveLogin("  owner@example.com  ", "the-staff-password")).toBeNull();
  });

  it("still signs the owner in with the owner password", async () => {
    ROW = await shadowRow();
    const actor = await S.resolveLogin("owner@example.com", "a-long-enough-password");
    expect(actor?.kind).toBe("owner");
  });

  it("leaves every other staff address alone", async () => {
    const { hashPassword } = await import("@/lib/password");
    ROW = { id: "u-1", name: "Zita", active: true, role: "admin",
            sections: ["catalog"], password_hash: await hashPassword("her-own-password") };
    const actor = await S.resolveLogin("zita@example.com", "her-own-password");
    expect(actor?.kind).toBe("staff");
    expect(actor?.label).toBe("Zita");
  });
});

describe("what happens when supabase/admin-roles.sql has NOT been run", () => {
  // Postgres 42703 = undefined_column. This is what Supabase returns when
  // the select names role/sections and the migration is outstanding.
  const MISSING = { code: "42703", message: 'column admin_users.role does not exist' };

  it("staff can still log in, as a reader holding nothing", async () => {
    // Asking again without the two columns. "This database cannot tell me
    // what they may do" reads as the least privilege, not as a locked door.
    const { hashPassword } = await import("@/lib/password");
    ROW = { id: "u-1", name: "Zita", active: true,
            password_hash: await hashPassword("her-own-password") };
    ROW_ERROR = MISSING;
    const actor = await S.resolveLogin("zita@example.com", "her-own-password");
    expect(actor?.kind).toBe("staff");
    expect(actor?.role).toBe("reader");
    expect(actor?.sections).toEqual([]);
  });

  it("keeps an existing staff session alive, also as a reader", async () => {
    COOKIE = cookieFor({ kind: "staff", id: "u-1", label: "Zita" });
    ROW = { id: "u-1", name: "Zita", active: true, password_hash: "x" };
    ROW_ERROR = MISSING;
    const back = await S.currentActor();
    expect(back?.kind).toBe("staff");
    expect(back?.role).toBe("reader");
  });

  it("still refuses a disabled account", async () => {
    COOKIE = cookieFor({ kind: "staff", id: "u-1", label: "Zita" });
    ROW = { id: "u-1", name: "Zita", active: false, password_hash: "x" };
    ROW_ERROR = MISSING;
    expect(await S.currentActor()).toBeNull();
  });
});
