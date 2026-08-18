import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rateLimit } from "@/lib/rateLimit";

let n = 0;
const key = () => `test-key-${++n}`;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("rateLimit", () => {
  it("allows up to the limit then blocks", () => {
    const k = key();
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(k, 5, 60).allowed).toBe(true);
    }
    const blocked = rateLimit(k, 5, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts down remaining accurately", () => {
    const k = key();
    expect(rateLimit(k, 3, 60).remaining).toBe(2);
    expect(rateLimit(k, 3, 60).remaining).toBe(1);
    expect(rateLimit(k, 3, 60).remaining).toBe(0);
  });

  it("keeps separate buckets per key", () => {
    const a = key(), b = key();
    for (let i = 0; i < 5; i++) rateLimit(a, 5, 60);
    expect(rateLimit(a, 5, 60).allowed).toBe(false);
    // A different caller must be unaffected by someone else's exhaustion.
    expect(rateLimit(b, 5, 60).allowed).toBe(true);
  });

  it("resets once the window elapses", () => {
    const k = key();
    for (let i = 0; i < 3; i++) rateLimit(k, 3, 60);
    expect(rateLimit(k, 3, 60).allowed).toBe(false);

    vi.advanceTimersByTime(61_000);
    expect(rateLimit(k, 3, 60).allowed).toBe(true);
  });

  it("does not reset early", () => {
    const k = key();
    for (let i = 0; i < 3; i++) rateLimit(k, 3, 60);
    vi.advanceTimersByTime(30_000);
    expect(rateLimit(k, 3, 60).allowed).toBe(false);
  });
});
