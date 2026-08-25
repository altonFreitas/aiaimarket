import type { MetadataRoute } from "next";
import { getSettings } from "@/lib/data/public";

/** Installable-to-home-screen metadata.
 *
 * Worth the ~30 lines specifically for this market: a home-screen icon means
 * a returning buyer opens the store without typing a URL or paying for a
 * search, and a standalone window drops the browser chrome on a small
 * screen. This is the manifest only — no service worker, so nothing here
 * caches pages or claims to work offline; adding one is a deliberate
 * separate decision, since a stale cached price is worse than a slow page.
 *
 * The name follows the store's own settings, so a rebrand doesn't leave the
 * installed icon reading the wrong thing. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const settings = await getSettings();
  return {
    name: settings.store_name,
    short_name: settings.store_name.slice(0, 12),
    description:
      settings.tagline_tet ||
      "Katálogu online — folin, tamañu, disponibilidade no fatin, hotu iha pájina.",
    start_url: "/",
    display: "standalone",
    background_color: "#eceff3", // --paper
    theme_color: "#152341",      // --ink, matches the viewport themeColor
    icons: [
      { src: "/icon.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
