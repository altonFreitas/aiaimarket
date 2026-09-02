import { t } from "@/lib/i18n";
import type { DataCoverage } from "@/lib/data/sales";
import type { Lang } from "@/lib/types";

/* Said out loud, or not said at all.
 *
 * Reads are capped so one busy year cannot time out the page reporting on
 * it, and they are ordered newest first, so what falls off the end is the
 * shop's OLDEST history. Before this the page simply showed smaller numbers
 * and looked exactly as confident as it had the day before.
 *
 * Renders nothing in the ordinary case. A permanent banner about a limit
 * nobody is near is noise, and noise is how a real warning gets ignored. */
export default function CoverageNotice({ lang, coverage }: {
  lang: Lang; coverage: DataCoverage | undefined;
}) {
  if (!coverage?.truncated) return null;

  const from = coverage.oldestKept ? coverage.oldestKept.slice(0, 10) : null;
  return (
    <p className="note coverage-note">
      <b>{t("coverageCapped", lang).replace("{n}", coverage.cap.toLocaleString("en-US"))}</b>{" "}
      {from
        ? t("coverageSince", lang).replace("{date}", from)
        : t("coverageOlderMissing", lang)}
    </p>
  );
}
