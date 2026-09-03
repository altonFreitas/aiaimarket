import SettingsAdmin from "@/components/admin/SettingsAdmin";
import { adminSettings } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

export default async function SettingsPage() {
  await requireSection("settings");
  const [lang, settings] = await Promise.all([getLang(), adminSettings()]);
  return <SettingsAdmin lang={lang} settings={settings} />;
}
