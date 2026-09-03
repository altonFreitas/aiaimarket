import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { STR, t } from "@/lib/i18n";

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "src", "lib", "i18n.ts"), "utf8");

describe("the string table", () => {
  it("has no key defined twice", () => {
    // TypeScript reports this, but only as one error among many in a long
    // build, and the LAST definition silently wins at runtime -- so a
    // duplicate quietly changes what an existing screen says. Reading the
    // source rather than the object, because the object has already
    // collapsed the duplicates by the time it is imported.
    const counts = new Map<string, number>();
    for (const m of SOURCE.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*):\[/gm)) {
      counts.set(m[1], (counts.get(m[1]) || 0) + 1);
    }
    const dupes = [...counts].filter(([, n]) => n > 1).map(([k]) => k);
    expect(dupes).toEqual([]);
  });

  it("gives every key all three languages", () => {
    const wrong = Object.entries(STR)
      .filter(([, v]) => !Array.isArray(v) || v.length !== 3)
      .map(([k]) => k);
    expect(wrong).toEqual([]);
  });

  it("leaves no translation empty", () => {
    // An empty string renders as nothing at all, which reads as a broken
    // screen rather than as a missing translation.
    const blank = Object.entries(STR)
      .filter(([, v]) => v.some((s) => typeof s !== "string" || s.trim() === ""))
      .map(([k]) => k);
    expect(blank).toEqual([]);
  });

  it("returns the key itself for one that does not exist", () => {
    expect(t("noSuchKeyAnywhere", "en")).toBe("noSuchKeyAnywhere");
  });
});
