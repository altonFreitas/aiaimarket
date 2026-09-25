import { t } from "@/lib/i18n";
import type { AnnounceHealth } from "@/lib/notify/announce";
import type { Lang } from "@/lib/types";

/* WHETHER THE SHOP'S "tell me about new products" PROMISE IS BEING KEPT.
 *
 * A shop reported adding a product and no customer hearing about it. The
 * queue was working; three separate things switch it off silently -- an
 * unset NEXT_PUBLIC_SITE_URL, an unrun migration, and nobody having ticked
 * the box -- and each of them returned 0 and said nothing. The screen that
 * should have reported it printed "every message has been sent", which was
 * true of the queue and false of the promise.
 *
 * So this panel states the position whether or not there is anything queued,
 * which is the whole point: the interesting case is the empty one. A fault
 * names the fix, because "announcements are off" that does not say what to
 * change is a second thing to investigate rather than an answer. */
export default function AnnounceState({
  health, lang,
}: { health: AnnounceHealth; lang: Lang }) {
  /* Ordered by what has to be true first: without an address nothing can be
     sent at all, so saying "nobody has asked" underneath it would be a
     second-order fact presented as the problem. */
  const faults: string[] = [];
  if (!health.origin) faults.push("announceNoOrigin");
  if (!health.migrated) faults.push("announceNoTable");

  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <h3>{t("announceTitle", lang)}</h3>
      {faults.map((key) => (
        <p className="hint" key={key} style={{ color: "var(--red)" }}>
          {t(key, lang)}
        </p>
      ))}
      {/* Not a fault, and not printed as one: a shop whose customers have
          not opted in has nothing to fix, it has nobody to tell. */}
      {!faults.length && health.recipients === 0 && (
        <p className="hint">{t("announceNoRecipients", lang)}</p>
      )}
      {health.ready && (
        <p className="hint">
          {t("announceReady", lang).replace("{n}", String(health.recipients))}
        </p>
      )}
      {/* The other reason a shop sees no message go out, and the one that is
          working as designed: a draft is not announced. */}
      <p className="hint">{t("announceDraftNote", lang)}</p>
      {health.ready && !health.automatic && (
        <p className="hint">{t("manualModeHint", lang)}</p>
      )}
    </div>
  );
}
