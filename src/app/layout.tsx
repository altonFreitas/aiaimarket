import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import TopBar from "@/components/TopBar";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import BottomNav from "@/components/BottomNav";
import { ToastProvider } from "@/components/Toast";
import { getSettings } from "@/lib/data/public";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { serializeJsonLd, siteLd } from "@/lib/jsonLd";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const description =
    settings.tagline_tet ||
    "Katálogu online — folin, tamañu, disponibilidade no fatin, hotu iha pájina.";
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
    title: { default: settings.store_name, template: `%s · ${settings.store_name}` },
    description,
    icons: { icon: "/icon.png", apple: "/apple-touch-icon.png" },
    openGraph: { type: "website", siteName: settings.store_name, description },
    twitter: { card: "summary_large_image", title: settings.store_name, description },
  };
}
export const viewport: Viewport = { themeColor: "#152341", colorScheme: "light" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  const settings = await getSettings();
  const needsSetup = settings.id === 0;

  /* The shop's own identity, emitted once for the whole site rather than
     per page. Built from the settings row the admin filled in, so it says
     nothing the shop has not already said about itself; siteLd returns
     null when it has no absolute origin or no name to give. */
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  const proto = h.get("x-forwarded-proto") || "https";
  const site = siteLd({
    origin: host ? `${proto}://${host}` : "",
    storeName: settings.store_name,
    description: settings.tagline_tet || undefined,
    locality: settings.suku || undefined,
    region: settings.municipality || undefined,
    phone: settings.wa_number || undefined,
  });

  return (
    <html lang={lang}>
      <body>
        {site && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: serializeJsonLd(site) }}
          />
        )}
        <ToastProvider>
          {needsSetup && (
            <div style={{
              background: "#c43d2c", color: "#fff", padding: "8px 12px",
              fontSize: 13, textAlign: "center",
            }}>
              Database not connected. Add your Supabase keys to <code>.env.local</code> (or Vercel
              env vars) and run <code>supabase/schema.sql</code>, then reload.
            </div>
          )}
          {/* FIRST FOCUSABLE THING ON EVERY PAGE. The header carries a
              search box, a language switch, an account link, a cart and a
              row of aisles that opens into a mega menu -- so a keyboard
              user reached the content of a product page somewhere past the
              fortieth tab stop, on every page, forever. Visually hidden
              until focused (.skip in globals.css), which is the whole
              convention: it costs a sighted mouse user nothing and gives a
              keyboard user the page. */}
          <a className="skip" href="#view">{t("skipToContent", lang)}</a>
          <TopBar lang={lang} settings={settings} />
          <Header settings={settings} />
          {/* tabIndex -1 so the skip link actually MOVES focus here. An anchor
              to a non-focusable element scrolls in every browser and moves
              focus in only some, which makes the link look like it worked
              and leave the next Tab back at the top of the header. */}
          <main id="view" tabIndex={-1}>{children}</main>
          <Footer settings={settings} lang={lang} />
          <BottomNav lang={lang} />
        </ToastProvider>
      </body>
    </html>
  );
}
