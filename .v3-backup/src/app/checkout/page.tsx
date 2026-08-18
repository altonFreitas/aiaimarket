import CheckoutForm from "@/components/CheckoutForm";
import { getSettings } from "@/lib/data/public";
import { getLang } from "@/lib/lang";

export default async function CheckoutPage() {
  const [lang, settings] = await Promise.all([getLang(), getSettings()]);
  return <CheckoutForm lang={lang} settings={settings} />;
}
