import SettingsAdmin from "@/components/admin/SettingsAdmin";
import { adminSettings } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";

export default async function SettingsPage() {
  const [lang, settings] = await Promise.all([getLang(), adminSettings()]);
  return <SettingsAdmin lang={lang} settings={settings} />;
}
