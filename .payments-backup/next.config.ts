import type { NextConfig } from "next";
import path from "node:path";

const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  images: {
    // Product images are served from Supabase Storage
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }],
    // AVIF first: on a 360px phone it is routinely 30-50% smaller than the
    // WebP the browser already uploaded, and mobile data is the running
    // cost this whole store is designed around.
    formats: ["image/avif", "image/webp"],
    deviceSizes: [360, 414, 640, 750, 828, 1080, 1200],
    imageSizes: [64, 96, 128, 200, 256, 384],
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },

  // Hides the floating "N" dev-tools badge that appears in the corner
  // during `next dev`. It never appears in production builds anyway,
  // but this removes it locally too.
  devIndicators: false,

  // Suppresses the per-request "└─ ƒ actionName(arg1, arg2) in Xms"
  // dev-terminal trace, which otherwise prints every Server Action call
  // with its raw arguments — including things like login passwords and
  // TOTP codes — straight into your local terminal. Dev-only; this has
  // no effect on production, which never logs this way regardless.
  logging: { serverFunctions: false },

  // Server Actions already reject any request whose Origin doesn't match
  // the Host — that same-origin check is on by default and needs no
  // configuration. This list only adds EXTRA origins, so anything left in
  // it is a permanently trusted third origin. Driving it from an env var
  // keeps production clean instead of shipping "localhost:3000" as a
  // trusted origin to the live site forever.
  experimental: {
    serverActions: {
      allowedOrigins: (process.env.SERVER_ACTION_ORIGINS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    },
  },

  // Response headers. Next sets none of these on its own; without them the
  // site can be framed, sniffed, and leaks full URLs (which used to carry a
  // buyer's phone number) in the Referer of every outbound WhatsApp link.
  async headers() {
    const csp = [
      "default-src 'self'",
      // Next's runtime needs inline/eval for hydration and dev HMR.
      "script-src 'self' 'unsafe-inline'" + (isDev ? " 'unsafe-eval'" : ""),
      "style-src 'self' 'unsafe-inline'",
      // Product photos come from Supabase Storage; placeholders are inline SVG.
      "img-src 'self' data: blob: https://*.supabase.co",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co" + (isDev ? " ws: wss:" : ""),
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      isDev ? "" : "upgrade-insecure-requests",
    ].filter(Boolean).join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          // The old checkout flow put a phone number in the query string.
          // strict-origin-when-cross-origin stops any such URL reaching
          // wa.me or an image CDN in a Referer header.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          ...(isDev ? [] : [{
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          }]),
        ],
      },
      {
        // Admin, seller and buyer-dashboard responses must never be cached
        // by a CDN or shared proxy — they are per-session by definition.
        source: "/:path(admin|seller|account|checkout|o|track)/:rest*",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
