import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sessionMinutes, encodeActor, decodeActor } from "@/lib/session";

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

/* ---------------------------------------------------------------------------
 * What the setting actually buys you
 * ------------------------------------------------------------------------ */

describe("the configured window, end to end", () => {
  /* sessionMinutes above only proves the NUMBER is parsed. These prove the
   * number is what a session is then measured against -- the thing an owner
   * is actually asking about when they set ADMIN_SESSION_MINUTES and want to
   * know why they were signed out. */
  const OWNER = { kind: "owner" as const, id: null, label: "Owner" };
  const maxAgeMs = sessionMinutes("100") * 60_000;
  const now = Date.UTC(2026, 8, 16, 12, 0, 0);
  const aged = (mins: number) => decodeActor(encodeActor(OWNER, now - mins * 60_000), now, maxAgeMs);

  it("keeps the session for the whole configured time", () => {
    for (const mins of [0, 1, 30, 60, 99]) {
      expect([mins, aged(mins) !== null]).toEqual([mins, true]);
    }
  });

  it("ends it after, not before", () => {
    for (const mins of [101, 120, 600]) {
      expect([mins, aged(mins)]).toEqual([mins, null]);
    }
  });

  it("counts from the login, not from the last click", () => {
    /* A FIXED WINDOW, NOT AN IDLE ONE, and worth pinning because the two
       are easy to confuse when explaining why somebody was signed out.
       Nothing here looks at activity: a session opened 99 minutes ago is
       alive whether it was used once or a hundred times, and two minutes
       later it is over regardless. */
    const tok = encodeActor(OWNER, now - 99 * 60_000);
    expect(decodeActor(tok, now, maxAgeMs)).not.toBeNull();
    expect(decodeActor(tok, now + 2 * 60_000, maxAgeMs)).toBeNull();
  });

  it("refuses a token whose issue time is missing or nonsense", () => {
    // Rather than treating an unreadable age as age zero, which would be a
    // session that never expires.
    const forged = "v2." + Buffer.from(JSON.stringify(
      { k: "owner", i: null, n: "Owner" })).toString("base64url");
    expect(decodeActor(forged, now, maxAgeMs)).toBeNull();
  });
});

describe("the seller's second factor lasts as long as the admin's", () => {
  it("reads the setting instead of hard-coding ten minutes", () => {
    /* These two are the same decision -- how long the shop trusts a second
       factor before asking again -- and the file said so in a comment while
       being hard-coded to 600 seconds. They matched only at the default, so
       ADMIN_SESSION_MINUTES=100 gave the owner 100 minutes and left sellers
       re-entering a code every 10.

       Source-level because the module is server-only and reads cookies; what
       matters is that the constant is derived, not typed out. */
    const src = fs.readFileSync(
      path.join(process.cwd(), "src", "lib", "sellerTotpSession.ts"), "utf8");
    const line = src.split("\n").find((l) => l.includes("const MAX_AGE"))!;
    expect(line).toContain("sessionMinutes()");
    expect(line).not.toMatch(/=\s*\d+\s*\*\s*\d+\s*;/);   // 60 * 10
  });
});
