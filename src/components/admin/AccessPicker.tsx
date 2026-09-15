"use client";
import { useId } from "react";
import {
  ADMIN_SECTIONS, GRANTABLE_SECTIONS, grantableSubsection, type AdminRole,
} from "@/lib/adminSections";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/* What an account may do, and where.
 *
 * One component, used when adding an account and when changing an existing
 * one, so the two can never offer different choices -- which would leave
 * you unable to grant on the second screen something you granted on the
 * first.
 *
 * The section list is read from ADMIN_SECTIONS rather than typed out here.
 * Add a section to the admin and it appears in this checklist by itself;
 * type it out twice and one of the two eventually goes stale. */
export default function AccessPicker({
  lang, role, sections, onRole, onSections, disabled,
}: {
  lang: Lang;
  role: AdminRole;
  /** Area keys and tab keys together -- see lib/adminSections.ts. */
  sections: string[];
  onRole: (r: AdminRole) => void;
  onSections: (s: string[]) => void;
  disabled?: boolean;
}) {
  const group = useId();

  return (
    <div className="access">
      <fieldset className="access-role" disabled={disabled}>
        <legend>{t("accessRole", lang)}</legend>
        {(["admin", "reader"] as const).map((r) => (
          <label key={r} className={"access-role-opt" + (role === r ? " on" : "")}>
            <input type="radio" name={group} checked={role === r}
              onChange={() => onRole(r)} />
            <span>
              <b>{t(r === "admin" ? "roleAdmin" : "roleReader", lang)}</b>
              <em>{t(r === "admin" ? "roleAdminHint" : "roleReaderHint", lang)}</em>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="access-sections" disabled={disabled}>
        <legend>{t("accessSections", lang)}</legend>

        {/* TWO LEVELS, BOTH REAL GRANTS AND NOT THE SAME GRANT.
            The area box means the whole area, INCLUDING tabs added in a
            later version. The tab boxes mean exactly those. See
            canOpenSubsection -- which of the two was ticked is what decides
            whether a new tab appears for this person by itself. */}
        {ADMIN_SECTIONS
          .filter((sec) => GRANTABLE_SECTIONS.includes(sec.key))
          .map((sec) => {
            const tabs = sec.subsections.filter(grantableSubsection);
            const whole = sections.includes(sec.key);
            const picked = tabs.filter((sub) => whole || sections.includes(sub.key));
            const some = picked.length > 0 && !whole;
            /* EVERY TAB TICKED IS STILL NOT THE AREA, and the note below
               says so in words because the checkbox cannot. Indeterminate
               means "not all of them", which is wrong here -- all of them
               ARE ticked -- but checked would be worse: it would look
               exactly like the whole-area grant while granting something
               narrower, and the difference only shows up a release later
               when a new tab appears and this person cannot see it. */
            const allNow = some && picked.length === tabs.length;

            return (
              <div key={sec.key}
                className={"access-area" + (whole ? " on" : some ? " part" : "")}>
                <label className="access-area-head">
                  <input type="checkbox" checked={whole}
                    // A box that is neither on nor off, because some of the
                    // tabs under it are. Without it "Settings" reads as
                    // ungranted while three of its tabs are ticked.
                    ref={(el) => { if (el) el.indeterminate = some; }}
                    // TICKING IT GRANTS THE AREA, from either of the two
                    // unticked states. The label on this box says "the whole
                    // area, including anything added later", and a box that
                    // cleared your tabs when you clicked it would be doing
                    // the opposite of what it is labelled -- losing the
                    // selection rather than widening it. Only unticking a
                    // box that is fully on clears, and it clears the tabs
                    // with it, which otherwise would survive invisibly.
                    onChange={() => onSections(
                      whole
                        ? sections.filter((k) => k !== sec.key && !k.startsWith(sec.key + "."))
                        : [...sections.filter((k) => !k.startsWith(sec.key + ".")), sec.key])} />
                  <span>
                    <b>{t(sec.labelKey, lang)}</b>
                    <em>{whole
                      ? t("accessWholeArea", lang)
                      : allNow
                        ? t("accessAllTabsNow", lang).replace("{n}", String(picked.length))
                        : some
                          ? t("accessSomeTabs", lang).replace("{n}", String(picked.length))
                          : t("accessNoTabs", lang)}</em>
                  </span>
                </label>

                <div className="access-subs">
                  {tabs.map((sub) => (
                    <label key={sub.key}
                      className={"access-box" + (whole || sections.includes(sub.key) ? " on" : "")}>
                      <input type="checkbox"
                        checked={whole || sections.includes(sub.key)}
                        onChange={() => {
                          const has = whole || sections.includes(sub.key);
                          if (whole) {
                            /* Unticking one tab of a whole-area grant turns
                               it into a list of the rest. The person meant
                               "all but this", and the only way to say that
                               is to name what remains. */
                            const rest = tabs.filter((x) => x.key !== sub.key).map((x) => x.key);
                            onSections([...sections.filter((k) => k !== sec.key), ...rest]);
                            return;
                          }
                          onSections(has
                            ? sections.filter((k) => k !== sub.key)
                            : [...sections, sub.key]);
                        }} />
                      <span>{t(sub.labelKey, lang)}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}

        <div className="access-quick">
          <button type="button" className="linkish"
            onClick={() => onSections([...GRANTABLE_SECTIONS])}>
            {t("selectAll", lang)}
          </button>
          <button type="button" className="linkish" onClick={() => onSections([])}>
            {t("selectNone", lang)}
          </button>
          {/* Home is not a checkbox. Every account that can sign in lands
              there, and its cards are filtered to what is ticked above -- so
              saying so here stops it reading as an omission. */}
          <span className="hint">{t("accessHomeNote", lang)}</span>
        </div>
      </fieldset>
    </div>
  );
}

/** The one-line version, for a table row.
 *
 * "Read-only · Sales, Settings (2 of 5)" -- an area granted whole is named
 * plainly, an area granted in part says so with the count, because those
 * are different permissions and a row that showed them the same way would
 * be the screen lying about who can see the books. */
export function accessSummary(
  lang: Lang, role: AdminRole, sections: string[]
): string {
  const what = t(role === "admin" ? "roleAdmin" : "roleReader", lang);
  if (!sections.length) return `${what} · ${t("accessNoAreas", lang)}`;

  const whole = GRANTABLE_SECTIONS.filter((k) => sections.includes(k));
  if (whole.length === GRANTABLE_SECTIONS.length) {
    return `${what} · ${t("accessAllAreas", lang)}`;
  }

  const names: string[] = [];
  for (const sec of ADMIN_SECTIONS) {
    if (!GRANTABLE_SECTIONS.includes(sec.key)) continue;
    const label = t(sec.labelKey, lang);
    if (sections.includes(sec.key)) { names.push(label); continue; }
    const tabs = sec.subsections.filter(grantableSubsection);
    const picked = tabs.filter((sub) => sections.includes(sub.key)).length;
    if (picked > 0) names.push(`${label} (${picked}/${tabs.length})`);
  }
  return `${what} · ${names.join(", ")}`;
}
