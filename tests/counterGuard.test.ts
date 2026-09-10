import { describe, it, expect } from "vitest";
import {
  COUNT_WINDOW_SECONDS, LOVE_LIMIT, LOVE_WINDOW_SECONDS,
} from "@/lib/counterGuard";
import { rateLimitLocal } from "@/lib/rateLimit";

/* What the guard in front of the view/click/love counters has to be.
 *
 * shouldCount() itself reads request headers and a database, so what is
 * pinned here is the SHAPE of the rule -- the numbers, and the behaviour
 * of the window they are used with. The failure this is guarding against
 * is somebody quietly raising the limit from 1 to 10 later, which would
 * turn "count one person once" back into "count a script ten times" with
 * nothing visibly broken.
 */

describe("the counter windows", () => {
  it("counts one person's interest in one product once", () => {
    // Not a high ceiling -- a ceiling of one. Ten refreshes of a product
    // page is one person looking at one product, and one is the BETTER
    // number, not a degraded one.
    const window = rateLimitLocal("count:view:abc", 1, COUNT_WINDOW_SECONDS);
    expect(window.allowed).toBe(true);
    expect(rateLimitLocal("count:view:abc", 1, COUNT_WINDOW_SECONDS).allowed).toBe(false);
    expect(rateLimitLocal("count:view:abc", 1, COUNT_WINDOW_SECONDS).allowed).toBe(false);
  });

  it("keeps the three counters in separate buckets", () => {
    // Looking at a product must not use up its WhatsApp click.
    expect(rateLimitLocal("count:view:xyz", 1, COUNT_WINDOW_SECONDS).allowed).toBe(true);
    expect(rateLimitLocal("count:wa:xyz", 1, COUNT_WINDOW_SECONDS).allowed).toBe(true);
  });

  it("keeps two products apart, so browsing still counts", () => {
    expect(rateLimitLocal("count:view:one", 1, COUNT_WINDOW_SECONDS).allowed).toBe(true);
    expect(rateLimitLocal("count:view:two", 1, COUNT_WINDOW_SECONDS).allowed).toBe(true);
  });

  it("holds the window long enough to be worth having", () => {
    // A one-second window is not deduplication, it is a formality.
    expect(COUNT_WINDOW_SECONDS).toBeGreaterThanOrEqual(300);
  });

  it("lets a real person fill a page with hearts", () => {
    // Hearts are a per-person toggle, not a page view. Somebody going
    // through a category filling in a dozen is doing nothing wrong, so
    // this one is a real limit rather than a deduplication.
    for (let i = 0; i < LOVE_LIMIT; i++) {
      expect([i, rateLimitLocal("count:love:ip", LOVE_LIMIT, LOVE_WINDOW_SECONDS).allowed])
        .toEqual([i, true]);
    }
    expect(rateLimitLocal("count:love:ip", LOVE_LIMIT, LOVE_WINDOW_SECONDS).allowed).toBe(false);
    expect(LOVE_LIMIT).toBeGreaterThanOrEqual(24);
  });
});
