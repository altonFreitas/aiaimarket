import { execFileSync } from "node:child_process";

/* TALKING TO A REAL DATABASE, WITHOUT A NEW DEPENDENCY.
 *
 * These tests shell out to psql rather than adding a Postgres driver.
 * Three reasons, and the third is the one that decided it:
 *
 *   1. `pg` would be a production-adjacent dependency added for tests
 *      alone, in an application whose whole database access goes through
 *      supabase-js.
 *   2. psql is already on every GitHub runner and in the postgres image.
 *   3. SET ROLE has to persist across statements within one session, and
 *      that is exactly what a driver's connection pool does not guarantee.
 *      One psql invocation is one session by construction.
 *
 * The cost is that everything comes back as text. For assertions about
 * "can this role see this row at all", text is the whole answer.
 */

/** Where the test database is. Absent means these tests do not run -- see
 * describeDb below. */
export const DATABASE_URL = process.env.TEST_DATABASE_URL || "";

export interface SqlResult {
  ok: boolean;
  rows: string[];
  /** The Postgres error, when the statement was refused. This is usually
   * the interesting half: a security test is mostly about what is denied. */
  error: string;
}

/** Runs SQL as a given role, in one session.
 *
 * `role` is applied with SET ROLE, which is what makes anon actually anon:
 * connecting as the superuser and hoping RLS applies would test nothing,
 * because a superuser bypasses it. */
export function sql(statement: string, role?: string): SqlResult {
  const script = role ? `set role ${role};\n${statement}` : statement;
  try {
    const out = execFileSync(
      "psql",
      [DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-tAX", "-c", script],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return {
      ok: true,
      // psql echoes a "SET" line for the SET ROLE above. It is command
      // output, not a row, and counting it as one silently turns every
      // scalar assertion into a comparison against the string "SET".
      rows: out.split("\n").map((r) => r.trim())
        .filter((r) => r && r !== "SET"),
      error: "",
    };
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return { ok: false, rows: [], error: (err.stderr || err.message || "").trim() };
  }
}

/** One scalar, or null when the statement was refused. */
export function scalar(statement: string, role?: string): string | null {
  const r = sql(statement, role);
  return r.ok ? (r.rows[0] ?? null) : null;
}

/** True when the role was refused outright -- a missing GRANT rather than
 * an RLS policy returning no rows.
 *
 * THESE TWO ARE DIFFERENT and the difference is the point. "Permission
 * denied" means the table is not reachable at all; "0 rows" means it is
 * reachable and a policy decided you see nothing. Both are safe today, but
 * only the first stays safe if somebody later adds a permissive policy --
 * so the tests say which one they expect. */
export function denied(statement: string, role: string): boolean {
  const r = sql(statement, role);
  return !r.ok && /permission denied/i.test(r.error);
}

/** True when the write was refused BY A POLICY rather than by a grant. */
export function blockedByPolicy(statement: string, role: string): boolean {
  const r = sql(statement, role);
  return !r.ok && /row-level security/i.test(r.error);
}
