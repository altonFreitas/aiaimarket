import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* No LIKE pattern may be built from something a stranger typed.
 *
 * THE BUG THIS PINS. isAdminEmail() answered, unauthenticated and
 * unthrottled, whether a given address belonged to a staff account -- and
 * asked the question with .ilike(). In Postgres, % and _ are LIKE
 * wildcards, so "%" matched every staff row and "a%", "b%", … read the
 * real addresses back a character at a time. resolveLogin() had the same
 * call, where "%" additionally matched the FIRST staff row and walked
 * around the "the owner's email is nobody else's" guard directly above it.
 *
 * The codebase already knew: lib/actions/orders.ts chose .eq() over
 * .ilike() for exactly this reason, with a comment saying so. Knowing it
 * in one file is what this test is for -- the next .ilike() somebody adds
 * to a lookup will be added by somebody who has not read that comment.
 *
 * The rule is narrow on purpose: .ilike() is right for a SEARCH, where a
 * wildcard is what the user meant. It is never right for a lookup that
 * decides who somebody is. This test bans it from lib/ entirely, which is
 * where the lookups are; a future search feature belongs behind the
 * catalog's own full-text query anyway (see supabase/marketplace-v2.sql).
 */
const ROOT = path.join(__dirname, "..");
const LIB = path.join(ROOT, "src", "lib");

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** A call, not a mention. The three files that explain why not to use it
 * name it in prose, and a test that failed on its own explanation would
 * be deleted rather than obeyed. */
const CALL = /(?<!\/\/.*)\.ilike\s*\(/;

describe("lookups never take a LIKE pattern from user input", () => {
  it("has no .ilike() call anywhere in src/lib", () => {
    const offenders: string[] = [];
    for (const file of sources(LIB)) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (line.trim().startsWith("*") || line.trim().startsWith("//")) return;
        if (CALL.test(line)) {
          offenders.push(`${path.relative(ROOT, file)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("still finds the pattern when it is really there", () => {
    // Otherwise a regex that silently stopped matching would make the test
    // above pass forever without checking anything.
    expect(CALL.test('sb.from("admin_users").select("id").ilike("email", typed)')).toBe(true);
    expect(CALL.test('.ilike ("email", x)')).toBe(true);
    expect(CALL.test('.eq("email", typed)')).toBe(false);
  });
});
