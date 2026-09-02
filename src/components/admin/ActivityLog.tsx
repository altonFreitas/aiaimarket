"use client";
import { useMemo, useState } from "react";
import { nowIso } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { AuditRow } from "@/lib/data/admin";
import type { Lang } from "@/lib/types";

/* The record. Read-only by construction -- there is no action anywhere
 * that updates or deletes a row in audit_log, which is the only thing that
 * makes it worth reading. */

/** Grouped by the first segment of the action, so the filter offers
 * "stock" rather than every one of stock.adjust, stock.receive. */
function areaOf(action: string): string {
  return action.split(".")[0] || "other";
}

export default function ActivityLog({ lang, rows }: { lang: Lang; rows: AuditRow[] }) {
  const [q, setQ] = useState("");
  const [area, setArea] = useState("");
  const [who, setWho] = useState("");

  const areas = useMemo(
    () => [...new Set(rows.map((r) => areaOf(r.action)))].sort(), [rows]);
  const people = useMemo(
    () => [...new Set(rows.map((r) => r.actor_label).filter(Boolean))].sort(), [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) =>
      (!area || areaOf(r.action) === area) &&
      (!who || r.actor_label === who) &&
      (!needle ||
        r.summary.toLowerCase().includes(needle) ||
        r.action.toLowerCase().includes(needle) ||
        r.actor_label.toLowerCase().includes(needle)));
  }, [rows, q, area, who]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("activity", lang)}</h1>
          <p className="sub">{t("activitySub", lang)}</p>
        </div>
      </div>

      {!rows.length ? (
        <div className="panel">
          <div className="empty"><p>{t("activityEmpty", lang)}</p></div>
        </div>
      ) : (
        <div className="panel">
          <div className="bar">
            <input type="search" placeholder={t("searchActivity", lang)} value={q}
              onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
            <select value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">{t("allAreas", lang)}</option>
              {areas.map((a) => <option key={a} value={a}>{t("area_" + a, lang)}</option>)}
            </select>
            <select value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">{t("everyone", lang)}</option>
              {people.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <span className="hint">{shown.length} / {rows.length}</span>
          </div>

          <div className="scroll-x">
            <table className="tbl tbl-compact">
              <thead>
                <tr>
                  <th>{t("date", lang)}</th>
                  <th>{t("who", lang)}</th>
                  <th>{t("action", lang)}</th>
                  <th>{t("what", lang)}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{nowIso(r.at)}</td>
                    {/* No "owner" badge under the name: the owner's label
                        already reads "Owner", and printing it twice is
                        noise on every second row. */}
                    <td>{r.actor_label || "—"}</td>
                    <td><span className="pill muted">{r.action}</span></td>
                    <td>{r.summary || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
