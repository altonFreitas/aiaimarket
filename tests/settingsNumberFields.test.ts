import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* YOU COULD NOT TYPE A NUMBER INTO THE TAX BOX.
 *
 * Reported from the admin: "i cant delete 0 and put directly 1". Exactly
 * right. The box held a NUMBER in React state and the handler was
 *
 *     onChange={(e) => set("tax_rate", Number(e.target.value))}
 *
 * Number("") is 0. So deleting the last digit immediately put a 0 back --
 * the box could never be empty. Reproduced in a browser before the fix:
 * backspace over the "0" left "0", and typing 1 after it gave "01".
 *
 * The only way to enter a value was to select the whole field first, which
 * is not something anybody thinks to do, so the setting reads as broken.
 *
 * Read out of the source because the bug lives in the WIRING -- which
 * value the handler stores -- and that is what has to stay changed.
 */

const SRC = fs.readFileSync(
  path.join(process.cwd(), "src/components/admin/SettingsAdmin.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("the number boxes keep what was typed", () => {
  it("never coerces a keystroke through Number()", () => {
    /* THE WHOLE BUG, IN ONE LINE. A half-typed number is a string -- "",
       "1.", "0.0" -- and none of those are numbers yet. Coercing on every
       keystroke throws that away and writes back whatever Number() made of
       it, which for an empty box is 0. */
    const bad = [...SRC.matchAll(/onChange=\{[^}]*Number\(e\.target\.value\)[^}]*\}/g)]
      .map((m) => m[0]);
    // <select> is exempt: it always has one of its own options as a value,
    // so there is no half-typed state to lose. None are left in this file.
    expect(bad).toEqual([]);
  });

  it("holds the three settings figures as text while editing", () => {
    for (const k of ["commission_rate", "restock_alert_pct", "tax_rate"]) {
      expect(SRC, k + " stored as a string")
        .toMatch(new RegExp(`${k}: String\\(`));
      expect(SRC, k + " keeps the raw keystroke")
        .toMatch(new RegExp(`set\\("${k}", e\\.target\\.value\\)`));
    }
  });

  it("parses once, on save, with a fallback for an empty box", () => {
    // An empty Tax box means "this shop charges none", not NaN.
    expect(SRC).toMatch(/commission_rate: num\(f\.commission_rate, 10\)/);
    expect(SRC).toMatch(/restock_alert_pct: num\(f\.restock_alert_pct, 0\)/);
    expect(SRC).toMatch(/tax_rate: num\(f\.tax_rate, 0\)/);
  });
});

describe("num()", () => {
  /* Re-implemented from the source rather than imported: the helper is
     inside a "use client" module that pulls in next/navigation, and this
     suite has no DOM. The point of the test is the RULES, and the source is
     checked above for having them. */
  const num = (v: string | number, fallback: number): number => {
    if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
    const n = Number(v.trim());
    return v.trim() === "" || !Number.isFinite(n) ? fallback : n;
  };

  it("reads an empty box as the fallback, not as zero-by-accident", () => {
    expect(num("", 10)).toBe(10);
    expect(num("   ", 0)).toBe(0);
  });

  it("does not turn a half-typed number into a different one", () => {
    // "-" and "1e" parse to NaN; "1." is 1 in JS, which is the value the
    // person is halfway to typing, so it is allowed through.
    expect(num("-", 5)).toBe(5);
    expect(num("1e", 5)).toBe(5);
    expect(num("1.", 5)).toBe(1);
  });

  it("keeps real numbers, including decimals and zero", () => {
    expect(num("0", 10)).toBe(0);       // a shop that charges no tax
    expect(num("2.5", 0)).toBe(2.5);
    expect(num("12", 0)).toBe(12);
  });
});

describe("a delivery fee is saved when it is finished, not per keystroke", () => {
  it("types into a draft and commits on blur", () => {
    /* The zone fee had the same coercion bug AND called saveZones() from
       its onChange -- so typing "12.5" was four round trips to the server,
       three of them saving a number nobody meant (1, 12, 12.). */
    expect(SRC).toMatch(/value=\{feeDraft\[zid\] \?\? String\(z\.fee\)\}/);
    expect(SRC).toMatch(/onBlur=\{\(\) => \{/);
    expect(SRC).toMatch(/const \[feeDraft, setFeeDraft\]/);
  });

  it("commits on Enter too, so a phone keyboard can finish the job", () => {
    expect(SRC).toMatch(/if \(e\.key === "Enter"\) e\.currentTarget\.blur\(\)/);
  });

  it("only writes when the figure actually changed", () => {
    // Leaving a box untouched should not queue a save.
    expect(SRC).toMatch(/if \(fee !== z\.fee\) update\(\{ fee \}\)/);
  });
});

describe("the buyer's return quantity box has the same shape fixed", () => {
  const RET = fs.readFileSync(
    path.join(process.cwd(), "src/components/ReturnRequest.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  it("can be emptied", () => {
    // Was value={qty[...] ?? 0} with Number(...) || 0 on change, so the 0
    // came straight back and the box could not be cleared.
    expect(RET).toMatch(/value=\{qty\[i\.product_id\] \?\? ""\}/);
    expect(RET).not.toMatch(/Number\(e\.target\.value\)/);
  });

  it("clamps when the figure is read, not while it is typed", () => {
    /* Clamping per keystroke rewrites the digit under the caret: with two
       left to return, a mistyped "12" became "2" before the 2 was seen,
       which looks like the box refusing input. */
    expect(RET).toMatch(/const qtyOf = \(productId: string, cap: number\): number/);
    expect(RET).toMatch(/Math\.max\(0, Math\.min\(cap, n\)\)/);
  });

  it("settles the box to the figure it will actually send", () => {
    /* Clamping only on read left the box disagreeing with the form: with
       two left to return, somebody who typed 12 saw 12 and would have got
       two back, finding out from the confirmation. The box now corrects
       itself the moment it is left. An EMPTY box is left empty -- rewriting
       it to "0" the instant it is touched is the original bug wearing a
       different hat. */
    expect(RET).toMatch(/onBlur=\{\(\) => setQty/);
    expect(RET).toMatch(/if \(raw === undefined \|\| raw\.trim\(\) === ""\) return q/);
    expect(RET).toMatch(/String\(qtyOf\(i\.product_id, cap\)\)/);
  });

  it("still sends a number, and still treats an empty box as none", () => {
    expect(RET).toMatch(/qty: qtyOf\(i\.product_id, capOf\(i\)\)/);
    expect(RET).toMatch(/Number\.isFinite\(n\) \? Math\.max/);
  });
});
