import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  images: {
    // Product images are served from Supabase Storage
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }],
  },

  // Hides the floating "N" dev-tools badge that appears in the corner
  // during `next dev`. It never appears in production builds anyway,
  // but this removes it locally too.
  devIndicators: false,

  // Server Actions check the request's Origin header against this list
  // as a CSRF guard. localhost covers local dev; add your real domain(s)
  // once you deploy, or admin login (and every other form) will fail
  // with "Invalid Server Actions request" on your live site.
  experimental: {
    serverActions: {
      allowedOrigins: [
        "localhost:3000",
        "127.0.0.1:3000",
        // "yourdomain.tl",
        // "www.yourdomain.tl",
        // "your-project.vercel.app",
      ],
    },
  },
};

export default nextConfig;