import type { NextConfig } from "next";
import path from "node:path";

const isDev = process.env.NODE_ENV !== "production";

// The card gateway's origin (e.g. https://bnctl.gateway.mastercard.com).
// A hosted-checkout redirect and any gateway-hosted script have to be
// allowed through the CSP explicitly, or the payment page silently fails to
// load -- with the only clue in the browser console, which the buyer will
// never read. Empty by default so a store with no gateway configured ships
// the tightest possible policy.
const paymentOrigin = (process.env.PAYMENT_GATEWAY_ORIGIN || "").trim();
const withPayment = (base: string) => (paymentOrigin ? `${base} ${paymentOrigin}` : base);

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
      withPayment("script-src 'self' 'unsafe-inline'" + (isDev ? " 'unsafe-eval'" : "")),
      "style-src 'self' 'unsafe-inline'",
      // Product photos come from Supabase Storage; placeholders are inline SVG.
      withPayment("img-src 'self' data: blob: https://*.supabase.co"),
      // Hero videos, also from Supabase Storage. Without this they fall back
      // to default-src 'self' and are blocked with nothing in the UI to say
      // so -- the banner simply stays on its poster frame forever.
      "media-src 'self' blob: https://*.supabase.co",
      /* WHY BLOB WORKERS ARE ALLOWED. A photo taken on an iPhone arrives
         as .HEIC, which no browser will decode into an <img>, so the
         uploader falls back to a WebAssembly decoder (heic-to). Every
         build of it starts that decoder in a Worker created from a blob:
         URL. Without this line workers fall back to default-src 'self',
         the browser refuses the blob, and the upload fails with the same
         "decode failed" it always did -- which is exactly what the first
         attempt at this did, caught by running it in a browser rather
         than reasoning about it.

         What it costs: a blob: worker runs script the PAGE constructed.
         script-src above already allows 'unsafe-inline', so anything able
         to put script in the page can already run it there; being able to
         run it in a worker as well is not new ground. 'self' and blob:
         only -- no remote origin may start one. */
      "worker-src 'self' blob:",
      "font-src 'self' data:",
      withPayment("connect-src 'self' https://*.supabase.co" + (isDev ? " ws: wss:" : "")),
      // The hosted checkout is reached by a top-level redirect, but some
      // gateway flows POST a form to the acquirer instead -- allow both.
      withPayment("form-action 'self'"),
      withPayment("frame-src 'self'"),
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
