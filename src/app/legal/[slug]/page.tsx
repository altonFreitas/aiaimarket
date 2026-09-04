import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSettings } from "@/lib/data/public";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import {
  LEGAL_DOCS, pick, fillLegal, hasPlaceholders, type LegalSlug,
} from "@/lib/legal";

const SLUGS: LegalSlug[] = ["terms", "privacy", "returns"];

export function generateStaticParams() {
  return SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params;
  const doc = LEGAL_DOCS[slug as LegalSlug];
  if (!doc) return {};
  const lang = await getLang();
  return { title: pick(doc.title, lang) };
}

/** The three policy pages, from one template.
 *
 * They share a shape and differ only in content, so three page files would
 * be three places to fix a heading. The content lives in lib/legal.ts,
 * which is also where the warning about having them reviewed is. */
export default async function LegalPage(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const doc = LEGAL_DOCS[slug as LegalSlug];
  if (!doc) notFound();

  const [lang, settings] = await Promise.all([getLang(), getSettings()]);
  const vars = {
    store: settings.store_name || "",
    contact: settings.wa_number || "",
  };
  const fill = (three: [string, string, string]) => fillLegal(pick(three, lang), vars);

  return (
    <div className="wrap legal">
      <h1>{fill(doc.title)}</h1>
      <p className="sub">{fill(doc.intro)}</p>

      {hasPlaceholders(doc) && (
        // Shown to shoppers as well as to the owner, on purpose. An
        // unfinished policy that looks finished is the failure worth
        // avoiding; one that says so is merely embarrassing.
        <p className="note warn">{t("legalDraft", lang)}</p>
      )}

      {doc.sections.map((sec, i) => (
        <section key={i}>
          <h2>{fill(sec.heading)}</h2>
          {sec.body.map((p, j) => <p key={j}>{fill(p)}</p>)}
        </section>
      ))}

      <p className="hint">{t("legalUpdated", lang)}</p>
    </div>
  );
}
