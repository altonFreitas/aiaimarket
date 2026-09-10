import { describe, it, expect } from "vitest";
import {
  loginAccountKey, LOGIN_IP_LIMIT, LOGIN_IP_WINDOW,
  LOGIN_ACCOUNT_LIMIT, LOGIN_ACCOUNT_WINDOW, LOGIN_THROTTLED,
} from "@/lib/loginThrottle";
import { MIN_PASSWORD_LEN } from "@/lib/passwordRules";
import { MIN_PASSWORD } from "@/lib/sellerRegistration";

describe("loginAccountKey", () => {
  it("counts one address as one account however it was typed", () => {
    // Somebody who types Jorge@Example.com and jorge@example.com is one
    // person making two guesses, not two people making one each.
    const a = loginAccountKey("jorge@example.com");
    expect(loginAccountKey("  JORGE@Example.COM  ")).toBe(a);
  });

  it("keeps two addresses apart", () => {
    expect(loginAccountKey("a@example.com")).not.toBe(loginAccountKey("b@example.com"));
  });

  it("does not carry the address itself into the key", () => {
    // rate_limits rows are readable by anything holding the service role.
    // A table listing the addresses people have recently tried to log in
    // as is a mailing list nobody agreed to be on.
    const key = loginAccountKey("jorge@example.com");
    expect(key).not.toContain("jorge");
    expect(key).not.toContain("example.com");
    expect(key).not.toContain("@");
  });
});

describe("the two windows", () => {
  it("makes the per-address window the looser of the two", () => {
    // The IP window is what stops the attack. The account window is the
    // backstop for a botnet -- and if it were the tight one, guessing at
    // somebody's email would be a way to lock them out of their own shop.
    const ipRate = LOGIN_IP_LIMIT / LOGIN_IP_WINDOW;
    const accountRate = LOGIN_ACCOUNT_LIMIT / LOGIN_ACCOUNT_WINDOW;
    expect(accountRate).toBeLessThan(ipRate);
  });

  it("still allows an ordinary person who mistypes their password", () => {
    expect(LOGIN_IP_LIMIT).toBeGreaterThanOrEqual(5);
    expect(LOGIN_ACCOUNT_LIMIT).toBeGreaterThanOrEqual(5);
  });

  it("says the same thing whether or not the account exists", () => {
    // A throttle that only fires on real accounts answers "does this
    // address have an account here" -- which is the question the whole
    // enumeration fix was about.
    expect(LOGIN_THROTTLED).not.toMatch(/account|user|email|seller/i);
  });
});

describe("one password rule", () => {
  it("holds a seller to the same length as staff", () => {
    // A seller login opens somebody's storefront, their customers' orders
    // and their payouts. It used to be 8 while staff were held to 12.
    expect(MIN_PASSWORD).toBe(MIN_PASSWORD_LEN);
  });
});
