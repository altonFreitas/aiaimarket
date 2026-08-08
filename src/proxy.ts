import { NextResponse, type NextRequest } from "next/server";

/** A2 — every /admin route is protected server-side, never only in the
 * client. The cookie's signature is verified in the route itself
 * (lib/session); middleware just does the cheap presence check and
 * redirect so unauthenticated requests never reach the admin render. */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/admin")) return NextResponse.next();
  if (pathname.startsWith("/admin/login")) return NextResponse.next();

  const has = req.cookies.get("loja_admin_session");
  if (!has) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*"] };
