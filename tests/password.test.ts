import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, passwordProblem, MIN_PASSWORD_LEN } from "@/lib/password";

describe("password hashing", () => {
  it("accepts the right password", async () => {
    const h = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
  });

  it("rejects the wrong one", async () => {
    const h = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse batteru", h)).toBe(false);
    expect(await verifyPassword("", h)).toBe(false);
  });

  it("gives the same password a different hash every time", async () => {
    // Equal hashes would mean no salt, and no salt means one rainbow table
    // opens every account that shares a password.
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("correct horse battery", b)).toBe(true);
  });

  it("carries its parameters, so the cost can be raised later", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.split("$").slice(0, 4)).toEqual(["scrypt", "32768", "8", "1"]);
  });

  it("still verifies a hash made with a lower cost", async () => {
    // Simulates a password set before the cost was raised: the parameters
    // in the stored string are what must be used, not today's constants.
    const cheap = await (async () => {
      const crypto = await import("node:crypto");
      const salt = crypto.randomBytes(16);
      const key = crypto.scryptSync("correct horse battery", salt, 32,
        { N: 1024, r: 8, p: 1, maxmem: 256 * 1024 * 8 });
      return ["scrypt", 1024, 8, 1, salt.toString("base64"), key.toString("base64")].join("$");
    })();
    expect(await verifyPassword("correct horse battery", cheap)).toBe(true);
  });

  it("treats the same characters written two ways as the same password", async () => {
    // "é" can be one code point or two. A password typed on one keyboard
    // and re-typed on another must still open the account.
    const h = await hashPassword("café password one");
    expect(await verifyPassword("café password one", h)).toBe(true);
  });

  it("fails rather than throws on a corrupted or hand-edited hash", async () => {
    for (const bad of ["", "nonsense", "scrypt$", "scrypt$1$2$3$$", "bcrypt$1$2$3$a$b",
                       "scrypt$32768$8$1$notbase64$alsonot"]) {
      expect(await verifyPassword("correct horse battery", bad)).toBe(false);
    }
  });
});

describe("passwordProblem", () => {
  it("refuses anything short", () => {
    expect(passwordProblem("x".repeat(MIN_PASSWORD_LEN - 1))).toContain(String(MIN_PASSWORD_LEN));
  });
  it("accepts a long one", () => {
    expect(passwordProblem("x".repeat(MIN_PASSWORD_LEN))).toBeNull();
  });
});
