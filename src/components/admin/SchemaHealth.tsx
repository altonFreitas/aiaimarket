import { schemaStatus } from "@/lib/data/schema";
import Fold from "./Fold";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/* Which of the SQL files in supabase/ have been run.
 *
 * A server component: it uses the service-role key, and the answer is
 * about the shape of the database, not its contents. Only names cross to
 * the browser.
 *
 * The order is the order to run them in, and only the outstanding ones
 * carry detail -- a list where every row explains itself is a list nobody
 * reads. */
export default async function SchemaHealth({ lang }: { lang: Lang }) {
  const status = await schemaStatus();

  if (!status.ok) {
    return (
      <div className="panel">
        <h2 className="crumb">{t("database", lang)}</h2>
        <p className="note warn" style={{ marginTop: 0 }}>
          {t("schemaUnknown", lang)}
        </p>
        <p className="hint">
          <code className="pay-vars">supabase/schema-health.sql</code>
        </p>
      </div>
    );
  }

  const outstanding = status.features.filter((f) => !f.applied && !f.unknown);
  // Not folded into `outstanding`: telling the owner to run a file is a
  // claim, and these are the ones nothing was able to check.
  const unchecked = status.features.filter((f) => f.unknown);

  const done = status.features.filter((f) => f.applied).length;

  return (
    <Fold
      lang={lang}
      title={t("database", lang)}
      status={`${done}/${status.features.length} ${t("schemaAppliedCount", lang)}`}
      tone={outstanding.length === 0 && unchecked.length === 0 ? "ok" : "warn"}
      /* A file that has not been run is the thing that breaks a screen with
         no other warning, so this one opens itself when there is one. A
         drawer nobody opens is where that fact would go to be missed.
         Unchecked counts too: today it always comes with schema-health.sql
         outstanding, but that is a consequence of how the check is written,
         not something this line should depend on. */
      defaultOpen={outstanding.length > 0 || unchecked.length > 0}
    >
      <p className="hint" style={{ marginTop: 0 }}>
        {/* A singular of its own rather than "1 files": one outstanding file
            is not an edge case here, it is the state every existing shop is
            in the moment it pulls this change and has not yet re-run
            schema-health.sql. */}
        {outstanding.length === 1
          ? t("schemaOutstandingOne", lang)
          : outstanding.length > 1
            ? t("schemaOutstanding", lang).replace("{n}", String(outstanding.length))
            : unchecked.length > 0
              ? t("schemaSomeUnchecked", lang).replace("{n}", String(unchecked.length))
              : t("schemaAllApplied", lang)}
      </p>

      <div className="pay-ready">
        {status.features.map((f) => (
          <div key={f.file} className={"pay-row" + (f.applied ? " on" : "")}>
            <span className="pay-name">{t(f.labelKey, lang)}</span>
            <span className={"pill " + (f.applied ? "ok" : f.unknown ? "muted" : (f.core ? "bad" : "muted"))}>
              {t(f.applied ? "schemaApplied" : f.unknown ? "schemaNotChecked" : "schemaNotRun", lang)}
            </span>
            <span className="pay-todo">
              {!f.applied && (
                <>
                  <code className="pay-vars">supabase/{f.file}</code>
                  {/* What was looked for and not found, and -- for the one
                      file that works by removing things -- what is still
                      there. Without it a red row is only a claim; with it
                      the owner can check. */}
                  <span className="pay-manual">
                    {f.unknown
                      ? t("schemaNotCheckedWhy", lang)
                      : [...f.missing, ...f.lingering].join(", ")}
                  </span>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </Fold>
  );
}
