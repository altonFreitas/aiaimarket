import { schemaStatus } from "@/lib/data/schema";
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

  const outstanding = status.features.filter((f) => !f.applied);

  return (
    <div className="panel">
      <h2 className="crumb">{t("database", lang)}</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        {outstanding.length === 0
          ? t("schemaAllApplied", lang)
          : t("schemaOutstanding", lang).replace("{n}", String(outstanding.length))}
      </p>

      <div className="pay-ready">
        {status.features.map((f) => (
          <div key={f.file} className={"pay-row" + (f.applied ? " on" : "")}>
            <span className="pay-name">{t(f.labelKey, lang)}</span>
            <span className={"pill " + (f.applied ? "ok" : (f.core ? "bad" : "muted"))}>
              {t(f.applied ? "schemaApplied" : "schemaNotRun", lang)}
            </span>
            <span className="pay-todo">
              {!f.applied && (
                <>
                  <code className="pay-vars">supabase/{f.file}</code>
                  {/* What was looked for and not found. Without it a red row
                      is only a claim; with it the owner can check. */}
                  <span className="pay-manual">{f.missing.join(", ")}</span>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
