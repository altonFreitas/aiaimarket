import SettingsAdmin from "@/components/admin/SettingsAdmin";
import PaymentReadiness from "@/components/admin/PaymentReadiness";
import { adminSettings } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

export default async function SettingsPage() {
  await requireSection("settings");
  const [lang, settings] = await Promise.all([getLang(), adminSettings()]);
  return (
    <>
      <SettingsAdmin lang={lang} settings={settings} />
      {/* A server component, deliberately below the form rather than inside
          it: it reads process.env, and only the NAMES of missing variables
          and a yes/no ever reach the browser. */}
      <PaymentReadiness lang={lang} />
    </>
  );
}
