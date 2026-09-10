import "server-only";
import { rateLimit, callerKey } from "@/lib/rateLimit";

/* THE COUNTERS THAT DECIDE WHAT THE HOMEPAGE SHOWS.
 *
 * increment_views, increment_wa_clicks and increment_loves are SECURITY
 * DEFINER functions, deliberately: an anonymous visitor has to be able to
 * move them without holding UPDATE on products. That part is right. What
 * was missing is any ceiling -- they were unauthenticated AND unbounded,
 * so a loop could add a hundred thousand views to a product in a minute.
 *
 * That is not just a wrong number on an admin screen. The homepage's
 * "best sellers" strip ranks by real units sold and then TOPS UP from the
 * most-viewed (see getBestSellers), and the reorder and demand planning
 * read the same signals. A seller who can inflate their own view count can
 * put their product on the front page of the shop and skew what the owner
 * buys next.
 *
 * ONE PER WINDOW, NOT N PER WINDOW. A view counter does not want a high
 * ceiling -- it wants deduplication. The same person refreshing a product
 * page ten times is one person looking at one product, and counting that
 * once is a BETTER number than counting it ten times, not a degraded one.
 * So the limit is 1 and the window is long. The honest name for this is
 * "unique-ish views", which is what every analytics product reports
 * anyway.
 *
 * FAILS OPEN, inherited from rateLimit: if the database cannot be reached
 * the count still happens. A counter is not worth an outage.
 */

/** How long one caller's interest in one product counts as one event. */
export const COUNT_WINDOW_SECONDS = 900; // 15 minutes

/** True when this caller's bump of this product should actually be
 * recorded. `kind` keeps the three counters in separate buckets, so
 * viewing a product does not use up its WhatsApp click. */
export async function shouldCount(kind: string, productId: string): Promise<boolean> {
  // The product id is part of the key, so browsing twelve products counts
  // twelve times -- it is only the SAME product from the same caller that
  // is folded together.
  const key = await callerKey(`count:${kind}:${productId}`);
  const { allowed } = await rateLimit(key, 1, COUNT_WINDOW_SECONDS);
  return allowed;
}

/** Hearts are different: they are a per-person toggle, and somebody
 * genuinely going through a category filling in a dozen is normal. This
 * one is a real rate limit rather than a deduplication -- it stops a
 * script, and a person will never reach it. */
export const LOVE_LIMIT = 30;
export const LOVE_WINDOW_SECONDS = 300;

export async function shouldCountLove(): Promise<boolean> {
  const { allowed } = await rateLimit(await callerKey("count:love"), LOVE_LIMIT, LOVE_WINDOW_SECONDS);
  return allowed;
}
