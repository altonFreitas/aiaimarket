import BasketView from "@/components/BasketView";
import { getLang } from "@/lib/lang";
import { getSettings } from "@/lib/data/public";

export default async function ListPage() {
  const [lang, settings] = await Promise.all([getLang(), getSettings()]);
  return <BasketView lang={lang} storeName={settings.store_name} />;
}
