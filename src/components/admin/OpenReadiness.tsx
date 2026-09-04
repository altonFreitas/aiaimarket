import Fold from "./Fold";
import { openChecks } from "@/lib/launchReadiness";
import { t } from "@/lib/i18n";
import type { Lang, Settings } from "@/lib/types";

/* Before you open: the checks nothing else makes.
 *
 * Each of these is invisible from the admin side and visible from the
 * shopper's -- an unfinished policy page, a privacy notice telling somebody
 * to contact "—", an order confirmation that is never sent. See
 * lib/launchReadiness.ts for why each one is on the list.
 *
 * Payment credentials and outstanding SQL are NOT restated here; they have
 * their own panels immediately below.
 *
 * The env var is read on the server and only its NAME reaches the browser
 * when unset -- and when it IS set, its value is a public URL that every
 * page already carries in its canonical tag.
 */
export default function OpenReadiness({
  lang, settings,
}: { lang: Lang; settings: Settings }) {
  const checks = openChecks({
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "",
    storeName: settings.store_name || "",
    contact: settings.wa_number || "",
  });
  const bad = checks.filter((c) => !c.ok);

  return (
    <Fold
      lang={lang}
      title={t("readyTitle", lang)}
      status={bad.length === 0
        ? t("readyAll", lang)
        : t("readyCount", lang).replace("{n}", String(bad.length))}
      tone={bad.length === 0 ? "ok" : "warn"}
      /* Open when there is something to do. A shop is opened once, and this
         is the panel that has to be read on that day. */
      defaultOpen={bad.length > 0}
    >
      <p className="hint" style={{ marginTop: 0 }}>{t("readyIntro", lang)}</p>
      <div className="pay-ready">
        {checks.map((c) => (
          <div key={c.key} className={"pay-row" + (c.ok ? " on" : "")}>
            <span className="pay-name">{t(c.key, lang)}</span>
            <span className={"pill " + (c.ok ? "ok" : "bad")}>
              {t(c.ok ? "readyOk" : "readyNo", lang)}
            </span>
            <span className="pay-todo">
              {!c.ok && (
                <>
                  <code className="pay-vars">{c.detail}</code>
                  <span className="pay-manual">{t(c.fixKey, lang)}</span>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </Fold>
  );
}
