import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Inter, Space_Grotesk } from "next/font/google";
import { headingFontAttr } from "@/lib/headingFont";
import { headers } from "next/headers";
import "./globals.css";
import TopBar from "@/components/TopBar";
import Header from "@/components/Header";
import Incentives from "@/components/Incentives";
import Footer from "@/components/Footer";
import BottomNav from "@/components/BottomNav";
import CookieNotice from "@/components/CookieNotice";
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

/* THE HEADING FACE.
 *
 * HEADINGS ONLY, and that is the whole of the decision. This shop is
 * built for mobile data in Timor-Leste and every comment in the
 * stylesheet about page weight means it; body text stays on the system
 * stack, which costs nothing and is already the face the reader's own
 * phone renders best. One variable file, latin subset, and it is spent
 * where it shows -- the h1 on a product page, the row headings on the
 * homepage.
 *
 * display:"swap", so the words are readable in the fallback from the
 * first paint and re-render in Jakarta when it lands. A heading that is
 * invisible for 300ms on a slow connection is worse than a heading in
 * Helvetica.
 *
 * Self-hosted by next/font: Google is never asked for anything at run
 * time, so no third-party request, no extra DNS round trip, and nothing
 * for the cookie notice to have to mention.
 */
/* EACH CALL WRITTEN OUT IN FULL, and it has to be: next/font reads its
   arguments at build time from the source, so a shared options object
   spread into three calls fails the build with "Unexpected spread". The
   duplication is the API's, not a choice.

   THE WEIGHTS ARE 600 AND 700, the two every one of these faces has.
   800 was in the list until Space Grotesk refused it -- that face's
   variable range stops at 700, so the browser would have synthesised an
   800 and drawn it heavier and wider than the real thing.

   preload:false on the three the shop has not chosen. Without it
   next/font puts a <link rel=preload> on every page for faces nothing
   renders: four fonts fetched to draw one. The @font-face still exists,
   so the moment the shop picks one it is fetched on the first paint of a
   heading and display:swap covers the gap. */
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"], display: "swap", weight: ["600", "700"],
  variable: "--font-jakarta",
});
const inter = Inter({
  subsets: ["latin"], display: "swap", weight: ["600", "700"],
  variable: "--font-inter", preload: false,
});
const grotesk = Space_Grotesk({
  subsets: ["latin"], display: "swap", weight: ["600", "700"],
  variable: "--font-grotesk", preload: false,
});

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  const settings = await getSettings();
  const needsSetup = settings.id === 0;
  /* Which face the shop picked. Tolerates a database without the column
     and a name this build no longer loads -- see lib/headingFont.ts. */
  const face = headingFontAttr((settings as { heading_font?: string }).heading_font);

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
    <html lang={lang} data-face={face}
      /* All three variables are declared; the stylesheet picks one by
         data-face. Only the chosen face is ever fetched, because a font
         is downloaded when something renders in it and nothing renders
         in the other two. */
      className={`${jakarta.variable} ${inter.variable} ${grotesk.variable}`}>
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
          {/* UNDER THE HEADER, ABOVE EVERYTHING ELSE. Not inside <main>:
              it is the same on every page and repeating it inside the
              page's landmark would make every page's content start with
              the same eight sentences. */}
          <Incentives settings={settings} lang={lang} />
          {/* tabIndex -1 so the skip link actually MOVES focus here. An anchor
              to a non-focusable element scrolls in every browser and moves
              focus in only some, which makes the link look like it worked
              and leave the next Tab back at the top of the header. */}
          <main id="view" tabIndex={-1}>{children}</main>
          <Footer settings={settings} lang={lang} />
          <BottomNav lang={lang} />
          {/* Last in the tree so it sits above everything, and outside the
              page content so it does not move when a page renders. */}
          <CookieNotice lang={lang} />
        </ToastProvider>
      </body>
    </html>
  );
}
