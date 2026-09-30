import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { STR, t } from "@/lib/i18n";

const ROOT = path.join(__dirname, "..");
const SOURCE = fs.readFileSync(path.join(ROOT, "src", "lib", "i18n.ts"), "utf8");

/** Every .ts/.tsx under src/, except the string table itself. */
function sourceFiles(dir = path.join(ROOT, "src"), out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(e.name) && !full.endsWith("i18n.ts")) out.push(full);
  }
  return out;
}

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

  it("gives every key all four languages", () => {
    // Tetun, Portuguese, English, Indonesian -- and in that order, because
    // t() indexes the tuple positionally. A key with three strings compiles
    // only through an `as`, and renders Tetun to a reader who asked for
    // Indonesian rather than throwing, so nothing but this notices it.
    const wrong = Object.entries(STR)
      .filter(([, v]) => !Array.isArray(v) || v.length !== 4)
      .map(([k]) => k);
    expect(wrong).toEqual([]);
  });

  it("answers in the language asked for", () => {
    // t() indexes the tuple positionally, so an off-by-one here is silent:
    // every screen renders, in the wrong language. One key with four
    // visibly different strings pins each column to its language.
    expect(t("home", "tet")).toBe("Uma");
    expect(t("home", "pt")).toBe("Início");
    expect(t("home", "en")).toBe("Home");
    expect(t("home", "id")).toBe("Beranda");
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

  it("defines every key the app asks for by name", () => {
    // t() returns the KEY when it is not defined, so a typo does not throw
    // -- it renders "restockAlertHint" on the page, in every language, and
    // is only ever caught by somebody looking at the screen. This is the
    // thing looking at the screen.
    //
    // Literal keys only. Computed ones (t("productStatus_" + s)) cannot be
    // checked this way and are left to the tests that exercise them.
    const missing: string[] = [];
    for (const file of sourceFiles()) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/\bt\(\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*,/g)) {
        if (!(m[1] in STR)) {
          missing.push(`${path.relative(ROOT, file)}: ${m[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
