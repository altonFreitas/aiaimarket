import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/* THE INDEX HAS TO STAY TRUE.
 *
 * docs/DECISIONS.md is a map, not a copy: one line per decision and a
 * pointer at the comment that holds the argument. A map is only worth
 * having while it points at things that exist -- an index full of paths to
 * files that were renamed two refactors ago is worse than no index,
 * because somebody follows it, finds nothing, and stops trusting the rest
 * of it.
 *
 * So the pointers are checked. The prose is not, and should not be: this
 * cannot tell whether a line still describes what the code does, only
 * whether the file it names is still there.
 */

const ROOT = resolve(__dirname, "..");
const DOC = readFileSync(resolve(ROOT, "docs/DECISIONS.md"), "utf8");

/** Every `path/like/this.ts` inside backticks. Deliberately narrow: it
 * matches a path with a known source extension and nothing else, so an
 * identifier in backticks (`placeOrder()`) is not mistaken for a file. */
function pathsNamed(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/`([a-zA-Z0-9_./-]+\.(?:ts|tsx|sql|mjs|css|md|json))`/g)) {
    out.add(m[1]);
  }
  return [...out];
}

describe("docs/DECISIONS.md", () => {
  it("points only at files that exist", () => {
    const missing = pathsNamed(DOC).filter((p) => !existsSync(resolve(ROOT, p)));
    expect(missing).toEqual([]);
  });

  it("points at enough of them to be an index", () => {
    // If the extraction above ever stops matching, this test would quietly
    // check an empty list forever and pass.
    expect(pathsNamed(DOC).length).toBeGreaterThan(20);
  });

  it("is linked from the README, or nobody will ever find it", () => {
    const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");
    expect(readme).toContain("docs/DECISIONS.md");
  });
});
