import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { splitLocale, takesLocale } from "@/lib/locale";

/** The header the rewrite below leaves behind, and the only way a server
 * component can know which locale the URL asked for -- the path it sees has
 * already had the prefix removed. */
export const LANG_HEADER = "x-loja-lang";

/** A2 — every /admin route is protected server-side, never only in the
 * client. The cookie's signature is verified in the route itself
 * (lib/session); middleware just does the cheap presence check and
 * redirect so unauthenticated requests never reach the admin render.
 *
 * /seller routes use real Supabase Auth sessions instead (see
 * lib/actions/seller-auth.ts) — checked here the same way Supabase's own
 * Next.js docs recommend for middleware: a request-scoped client whose
 * cookie writes are mirrored onto the response, so a refreshed session
 * token actually persists.
 *
 * Also strips the locale prefix from public URLs -- see below. */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  /* THE LOCALE PREFIX, TAKEN OFF BEFORE ROUTING.
   *
   * /pt/p/sapatu is rewritten to /p/sapatu with the language carried in a
   * request header, so the existing route file renders it and every
   * existing <Link> in the application keeps working. Three URLs that each
   * reliably serve one language is what Google needs; moving every public
   * route into src/app/[lang]/ would produce the same three URLs and
   * rewrite every href on the way. See lib/locale.ts.
   *
   * The cookie is still written, so the choice survives a click through to
   * an unprefixed link, and the language switch keeps working as it does
   * today for anyone who never sees a prefixed URL at all. */
  const { locale, rest } = splitLocale(pathname);
  if (locale && takesLocale(rest)) {
    const url = req.nextUrl.clone();
    url.pathname = rest;

    const headers = new Headers(req.headers);
    headers.set(LANG_HEADER, locale);

    const rewritten = NextResponse.rewrite(url, { request: { headers } });
    rewritten.cookies.set("lang", locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
    return rewritten;
  }

  if (pathname.startsWith("/admin") && !pathname.startsWith("/admin/login")) {
    const has = req.cookies.get("loja_admin_session");
    if (!has) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (
    pathname.startsWith("/seller") &&
    !pathname.startsWith("/seller/login") &&
    !pathname.startsWith("/seller/register")
  ) {
    let response = NextResponse.next({ request: req });
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => req.cookies.getAll(),
          setAll: (list) => {
            list.forEach(({ name, value }) => req.cookies.set(name, value));
            response = NextResponse.next({ request: req });
            list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          },
        },
      }
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const url = req.nextUrl.clone();
      url.pathname = "/account";
      return NextResponse.redirect(url);
    }
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/seller/:path*",
    // Every locale-prefixed URL, so the prefix can be taken off before
    // routing. Narrow on purpose: this runs on every matched request, and
    // matching everything to rewrite a handful of paths would put the proxy
    // in front of every asset in the application.
    "/tet/:path*", "/pt/:path*", "/en/:path*",
    "/tet", "/pt", "/en",
  ],
};
