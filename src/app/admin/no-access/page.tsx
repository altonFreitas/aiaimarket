import { requireSection } from "@/lib/actions/guard";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";

/** Where requireSection() sends somebody who opened a part of the admin
 * their account does not hold.
 *
 * A sentence, inside the normal admin layout, with the navigation still
 * above it -- so the way out is the row of sections they DO have, already
 * on screen. Throwing instead would render the error boundary: no
 * navigation, and a message that reads as "the admin is broken" rather
 * than "this part is not yours".
 *
 * Guarded on "home", which every signed-in account holds. Not an
 * exception to the rule that every page guards itself -- if it were, this
 * page would be readable by someone with no session at all. */
export default async function NoAccessPage() {
  await requireSection("home");
  const lang = await getLang();

  return (
    <div className="panel">
      <h1>{t("noAccessTitle", lang)}</h1>
      <p className="hint">{t("noAccessBody", lang)}</p>
    </div>
  );
}
