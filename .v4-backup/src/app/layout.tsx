import type { Metadata, Viewport } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import BottomNav from "@/components/BottomNav";
import { ToastProvider } from "@/components/Toast";
import { getSettings } from "@/lib/data/public";
import { getLang } from "@/lib/lang";

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

  return (
    <html lang={lang}>
      <body>
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
          <Header settings={settings} />
          <main id="view">{children}</main>
          <Footer settings={settings} lang={lang} />
          <BottomNav lang={lang} />
        </ToastProvider>
      </body>
    </html>
  );
}
