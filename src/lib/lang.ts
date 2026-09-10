import { cookies, headers } from "next/headers";
import { isLocale } from "./locale";
import type { Lang } from "./types";

/** Which language to render in.
 *
 * THE URL FIRST, then the cookie. A prefixed URL is an explicit request for
 * one language -- it is what a search engine indexed, what somebody shared,
 * and what the person clicking it expects -- so it has to beat a cookie set
 * on some earlier visit. Without that precedence, sharing a Portuguese link
 * with somebody whose cookie says Tetun would show them Tetun, and the
 * three URLs would stop being three languages.
 *
 * The header is set by the proxy, which strips the prefix before routing
 * (see proxy.ts and lib/locale.ts) -- by the time a server component runs,
 * the path no longer says which locale was asked for.
 */
export async function getLang(): Promise<Lang> {
  try {
    const h = await headers();
    const fromUrl = h.get("x-loja-lang");
    if (isLocale(fromUrl)) return fromUrl;
  } catch {
    // No request headers here (a build-time render). The cookie below is
    // absent too, so this falls through to the default, which is correct.
  }

  const jar = await cookies();
  const v = jar.get("lang")?.value;
  return isLocale(v) ? v : "tet";
}
