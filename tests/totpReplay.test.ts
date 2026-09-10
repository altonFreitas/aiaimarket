import { describe, it, expect } from "vitest";
import { counterFor } from "@/lib/totp";

/* The arithmetic behind "this code has already been used".
 *
 * otpauth's validate() answers with a DELTA -- how many 30-second steps
 * away from now the submitted code was, within the +/-1 window this app
 * allows. What has to be stored is the ABSOLUTE step, because "0 steps
 * from now" means something different a minute later. Getting that
 * conversion wrong in either direction is invisible in manual testing and
 * fatal: too high and every subsequent login is refused as a replay, too
 * low and nothing is ever refused at all.
 *
 * A fixed clock, because the alternative is a test that waits half a
 * minute to find out.
 */
const AT = (seconds: number) => seconds * 1000;

describe("counterFor", () => {
  it("turns a delta into the absolute time step", () => {
    // 300s past the epoch is step 10 of 30 seconds each.
    expect(counterFor(0, AT(300))).toBe(10);
    expect(counterFor(-1, AT(300))).toBe(9);
    expect(counterFor(1, AT(300))).toBe(11);
  });

  it("gives one answer for every moment inside the same step", () => {
    // Every second from 300 to 329 is step 10. If this drifted, a second
    // login one second later would look like a new code.
    for (let s = 300; s < 330; s++) {
      expect([s, counterFor(0, AT(s))]).toEqual([s, 10]);
    }
    expect(counterFor(0, AT(330))).toBe(11);
  });

  it("never goes backwards as the clock goes forwards", () => {
    let previous = counterFor(0, AT(0));
    for (let s = 0; s < 600; s += 7) {
      const now = counterFor(0, AT(s));
      expect(now).toBeGreaterThanOrEqual(previous);
      previous = now;
    }
  });

  it("makes a replayed code compare as not-newer", () => {
    // The whole rule, stated as the comparison the login makes: a code
    // accepted at step 10 leaves last=10, and the SAME code submitted
    // again anywhere in its ~90-second life still resolves to 10, 9 or
    // 11 -- and 10 and 9 are refused.
    const accepted = counterFor(0, AT(300));
    expect(counterFor(0, AT(310)) <= accepted).toBe(true);   // same step, replayed
    expect(counterFor(-1, AT(330)) <= accepted).toBe(true);  // one step behind
    // The next code up is genuinely new and must still work, or 2FA locks
    // the owner out of their own shop thirty seconds after they log in.
    expect(counterFor(0, AT(330)) <= accepted).toBe(false);
  });
});
