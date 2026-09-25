import type { Metadata } from "next";
import AboutView from "@/components/AboutView";
import { getSettings } from "@/lib/data/public";
import { getLang } from "@/lib/lang";
import { localeMetadata } from "@/lib/locale";
import { t } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const [lang, settings] = await Promise.all([getLang(), getSettings()]);
  return {
    title: `${t("aboutTitle", lang)} — ${settings.store_name}`,
    ...localeMetadata(lang, "/about"),
  };
}

export default async function AboutPage() {
  const [lang, settings] = await Promise.all([getLang(), getSettings()]);
  return <AboutView settings={settings} lang={lang} />;
}
