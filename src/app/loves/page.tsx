import type { Metadata } from "next";
import LovesView from "@/components/LovesView";
import { getLang } from "@/lib/lang";
import { getLiveProducts, getSettings, getApprovedSellersById } from "@/lib/data/public";
import { localeMetadata } from "@/lib/locale";
import { t } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const [lang, settings] = await Promise.all([getLang(), getSettings()]);
  return {
    title: `${t("lovesTitle", lang)} — ${settings.store_name}`,
    /* Not indexed: the page is empty for a crawler by construction --
       the list lives in the visitor's own browser -- so every copy of it
       Google could fetch is the "nothing saved yet" screen. */
    robots: { index: false, follow: true },
    ...localeMetadata(lang, "/loves"),
  };
}

/** THE THINGS THIS BROWSER HAS HEARTED.
 *
 * The hearts have existed on every card since loves.sql; what they never
 * had was a page. The header now carries a count, and a count you cannot
 * click is a tease.
 *
 * WHICH products are loved is local to the browser (see lib/useLoves --
 * buyers here have no account, so there is nowhere else to keep it), and
 * the server therefore cannot render this list. So the whole live
 * catalogue is handed to the client and filtered there. That is affordable
 * for exactly the reason the header's nav is: getLiveProducts is cached
 * and deduped across requests, and this shop's catalogue is hundreds, not
 * hundreds of thousands. A shop that grows past that wants an account
 * system first, and then this becomes a real query.
 */
export default async function LovesPage() {
  const [lang, products, sellersById] = await Promise.all([
    getLang(), getLiveProducts(), getApprovedSellersById(),
  ]);
  return (
    <LovesView
      lang={lang}
      products={products}
      sellerNames={Object.fromEntries(
        Object.entries(sellersById).map(([id, s]) => [id, s.store_name])
      )}
    />
  );
}
