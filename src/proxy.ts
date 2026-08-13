import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/** A2 — every /admin route is protected server-side, never only in the
 * client. The cookie's signature is verified in the route itself
 * (lib/session); middleware just does the cheap presence check and
 * redirect so unauthenticated requests never reach the admin render.
 *
 * /seller routes use real Supabase Auth sessions instead (see
 * lib/actions/seller-auth.ts) — checked here the same way Supabase's own
 * Next.js docs recommend for middleware: a request-scoped client whose
 * cookie writes are mirrored onto the response, so a refreshed session
 * token actually persists. */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

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
      url.pathname = "/seller/login";
      return NextResponse.redirect(url);
    }
    return response;
  }

  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*", "/seller/:path*"] };
