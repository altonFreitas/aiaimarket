"use client";
import { useId } from "react";
import { GRANTABLE_SECTIONS, type AdminRole, type SectionKey } from "@/lib/adminSections";
import { ADMIN_SECTIONS } from "@/lib/adminSections";
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
  sections: SectionKey[];
  onRole: (r: AdminRole) => void;
  onSections: (s: SectionKey[]) => void;
  disabled?: boolean;
}) {
  const group = useId();

  const toggle = (key: SectionKey) =>
    onSections(sections.includes(key) ? sections.filter((s) => s !== key) : [...sections, key]);

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
        <div className="access-grid">
          {ADMIN_SECTIONS.filter((s) => GRANTABLE_SECTIONS.includes(s.key)).map((s) => (
            <label key={s.key} className={"access-box" + (sections.includes(s.key) ? " on" : "")}>
              <input type="checkbox" checked={sections.includes(s.key)}
                onChange={() => toggle(s.key)} />
              <span>{t(s.labelKey, lang)}</span>
            </label>
          ))}
        </div>
        <div className="access-quick">
          <button type="button" className="linkish"
            onClick={() => onSections([...GRANTABLE_SECTIONS])}>
            {t("selectAll", lang)}
          </button>
          <button type="button" className="linkish" onClick={() => onSections([])}>
            {t("selectNone", lang)}
          </button>
          {/* Home is not a checkbox. Every account that can sign in lands
              there, and its cards are filtered to the sections above -- so
              saying so here stops it reading as an omission. */}
          <span className="hint">{t("accessHomeNote", lang)}</span>
        </div>
      </fieldset>
    </div>
  );
}

/** The one-line version, for a table row: "Read-only · Sales, Catalog". */
export function accessSummary(
  lang: Lang, role: AdminRole, sections: SectionKey[]
): string {
  const what = t(role === "admin" ? "roleAdmin" : "roleReader", lang);
  if (!sections.length) return `${what} · ${t("accessNoAreas", lang)}`;
  if (sections.length === GRANTABLE_SECTIONS.length) {
    return `${what} · ${t("accessAllAreas", lang)}`;
  }
  const names = ADMIN_SECTIONS
    .filter((s) => sections.includes(s.key))
    .map((s) => t(s.labelKey, lang));
  return `${what} · ${names.join(", ")}`;
}
