import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(
  path.join(process.cwd(), "src/components/SearchBar.tsx"), "utf8");

/* THE SEARCH BOX EMPTIED ITSELF WHILE IT SEARCHED.
 *
 * submit() cleared the typed value immediately, on the reasoning that the
 * URL was about to become the source of truth. But router.push is
 * asynchronous, and until the results land the URL still says whatever the
 * old address said -- from the homepage, nothing. So "sapato" vanished the
 * instant Search was pressed, stayed gone for the whole search, and came
 * back when the results arrived.
 *
 * Reproduced and fixed in a real browser, holding the /search navigation
 * open for 2.5s and sampling the field six times:
 *   before  ["","","","","",""]
 *   after   ["sapato","sapato","sapato","sapato","sapato","sapato"]
 */

describe("the query stays in the box while the search runs", () => {
  it("does not throw the typed value away on submit", () => {
    const submit = /function submit\([^)]*\)\s*\{([\s\S]*?)\n  \}/.exec(SRC);
    expect(submit, "the submit handler").not.toBeNull();
    // THE BUG, exactly: clearing the local value hands the field back to a
    // URL that has not moved yet.
    expect(submit![1]).not.toMatch(/setTyped\(null\)/);
    expect(submit![1]).toMatch(/router\.push/);
  });

  it("hands control back only once the address has actually moved", () => {
    /* Keyed on the URL CHANGING rather than on it matching what was typed.
       Matching is enough for a search that lands, and strands the box on a
       stale query for somebody who presses Search and then taps Catalog
       before the results come back -- the field would go on offering
       "sapato" on every page afterwards. */
    expect(SRC).toMatch(/const here = pathname \+/);
    expect(SRC).toMatch(/if \(here !== shownFor\)/);
    // And the release itself.
    const guard = /if \(here !== shownFor\) \{([\s\S]*?)\}/.exec(SRC);
    expect(guard, "the release").not.toBeNull();
    expect(guard![1]).toMatch(/setTyped\(null\)/);
  });

  it("settles during render rather than in an effect", () => {
    /* An effect runs after paint, so there would be a frame showing the
       old value -- which is the bug in miniature. Same pattern MegaNav
       uses to close itself on navigation. */
    expect(SRC).not.toMatch(/useEffect/);
  });

  it("still lets the URL win when nothing is being typed", () => {
    // Opening /search?q=sapato directly must fill the box.
    expect(SRC).toMatch(/const q = typed \?\? urlQ/);
    expect(SRC).toMatch(/pathname === "\/search" \? params\.get\("q"\)/);
  });
});
