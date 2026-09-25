import type { Metadata } from "next";
import ContactView from "@/components/ContactView";
import { getSettings } from "@/lib/data/public";
import { getLang } from "@/lib/lang";
import { localeMetadata } from "@/lib/locale";
import { t } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const [lang, settings] = await Promise.all([getLang(), getSettings()]);
  return {
    title: `${t("contactTitle", lang)} — ${settings.store_name}`,
    ...localeMetadata(lang, "/contact"),
  };
}

export default async function ContactPage() {
  const [lang, settings] = await Promise.all([getLang(), getSettings()]);
  return <ContactView settings={settings} lang={lang} />;
}
