import SettingsAdmin from "@/components/admin/SettingsAdmin";
import OpenReadiness from "@/components/admin/OpenReadiness";
import PaymentReadiness from "@/components/admin/PaymentReadiness";
import SchemaHealth from "@/components/admin/SchemaHealth";
import AdminTotpSettings from "@/components/admin/AdminTotpSettings";
import { adminSettings } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";
import { currentActor } from "@/lib/session";
import { getTotpStatus } from "@/lib/totp";

export default async function SettingsPage() {
  await requireSection("settings.shop");
  const [lang, settings, actor] = await Promise.all([
    getLang(), adminSettings(), currentActor(),
  ]);
  // Whose second factor this screen is offering to switch: the owner's
  // lives on the settings row, a staff account's on its own -- the same
  // split the login makes. requireSection already refused anyone without
  // a session, so actor is never null by here.
  const totpOn = actor
    ? await getTotpStatus(actor.kind === "owner"
        ? { table: "settings", idValue: 1 }
        : { table: "admin_users", idValue: actor.id as string })
    : false;
  return (
    <>
      <SettingsAdmin lang={lang} settings={settings} />
      {/* A server component, deliberately below the form rather than inside
          it: it reads process.env, and only the NAMES of missing variables
          and a yes/no ever reach the browser. */}
      <OpenReadiness lang={lang} settings={settings} />
      {/* Read on the server: the status is a boolean, so no secret
          reaches the browser. */}
      <AdminTotpSettings lang={lang} initiallyEnabled={totpOn} />
      <PaymentReadiness lang={lang} />
      <SchemaHealth lang={lang} />
    </>
  );
}
