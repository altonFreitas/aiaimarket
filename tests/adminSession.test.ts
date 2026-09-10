import { describe, it, expect } from "vitest";
import { sessionMinutes } from "@/lib/session";

/* How long an admin stays signed in.
 *
 * The default is ten minutes and that is deliberate. This is about the
 * escape hatch: a shop being built is not a shop being run, and being
 * asked for a fresh authenticator code on every other screen teaches the
 * person building it to leave their phone unlocked on the desk -- which is
 * the opposite of what the ten minutes is for.
 */
describe("sessionMinutes", () => {
  it("is ten minutes when nobody has said otherwise", () => {
    expect(sessionMinutes(undefined)).toBe(10);
    expect(sessionMinutes("")).toBe(10);
    expect(sessionMinutes("   ")).toBe(10);
  });

  it("takes the number it is given", () => {
    expect(sessionMinutes("480")).toBe(480);
    expect(sessionMinutes(" 60 ")).toBe(60);
  });

  it("refuses to make the login unusable", () => {
    // A one-minute session is not a security setting, it is a shop nobody
    // can administer. Nobody typed it on purpose.
    expect(sessionMinutes("1")).toBe(5);
    expect(sessionMinutes("0")).toBe(10);
    expect(sessionMinutes("-30")).toBe(10);
  });

  it("refuses to hand out a year for one extra zero", () => {
    expect(sessionMinutes("43200")).toBe(43200);      // thirty days, the ceiling
    expect(sessionMinutes("432000")).toBe(43200);
  });

  it("falls back rather than returning NaN", () => {
    // THE ONE THAT MATTERS. NaN compares false against every age, so a
    // typo'd variable would not make sessions long or short -- it would
    // expire every session the instant it was issued, and the shop would
    // look broken rather than misconfigured.
    expect(sessionMinutes("half an hour")).toBe(10);
    expect(Number.isFinite(sessionMinutes("abc"))).toBe(true);
  });

  it("does not accept a fractional minute", () => {
    expect(sessionMinutes("10.9")).toBe(10);
  });
});
