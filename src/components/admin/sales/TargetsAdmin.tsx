"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { deleteSalesTarget, setSalesTarget } from "@/lib/actions/sales";
import { money } from "@/lib/utils";
import { targetProgress, type SalesTarget } from "@/lib/sales";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/* Revenue targets, per period. Without one, section 21 of the dashboard has
 * nothing to say and "are we on track" has no answer -- which is why the
 * dashboard reports achievement as null rather than 0% when no target
 * exists. */

export default function TargetsAdmin({
  lang, targets, actualByPeriod, ready,
}: {
  lang: Lang; targets: SalesTarget[];
  /** Recognised revenue per period key, so each row shows progress. */
  actualByPeriod: Record<string, number>;
  ready: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  const [period, setPeriod] = useState(String(new Date().getFullYear()));
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  async function onAdd() {
    setBusy(true);
    try {
      await setSalesTarget(period, amount);
      setAmount("");
      toast(t("saved", lang) + " ✓");
      startTransition(() => router.refresh());
    } catch (e) {
      toast(String((e as Error).message), true);
    }
    setBusy(false);
  }

  async function onDelete(id: string) {
    setBusy(true);
    try {
      await deleteSalesTarget(id);
      startTransition(() => router.refresh());
    } catch (e) {
      toast(String((e as Error).message), true);
    }
    setBusy(false);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("salesTargets", lang)}</h1>
          <p className="sub">{t("salesTargetsSub", lang)}</p>
        </div>
      </div>

      {!ready && (
        <div className="note info" style={{ marginBottom: 12 }}>{t("salesMigrationNeeded", lang)}</div>
      )}

      <div className="panel">
        <div className="bar">
          <label className="fld">
            <span>{t("period", lang)}</span>
            <input type="text" value={period} placeholder="2026 / 2026-Q3 / 2026-08"
              onChange={(e) => setPeriod(e.target.value)} />
          </label>
          <label className="fld">
            <span>{t("target", lang)}</span>
            <input type="number" min="0" step="0.01" inputMode="decimal"
              value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <button type="button" className="btn btn-sm btn-amber"
            disabled={!period || !amount || busy || !ready} onClick={onAdd}>
            {t("save", lang)}
          </button>
        </div>
        <p className="hint">{t("periodFormatHint", lang)}</p>
      </div>

      <div className="scroll-x">
        <table className="tbl tbl-compact">
          <thead>
            <tr>
              <th>{t("period", lang)}</th>
              <th className="num">{t("target", lang)}</th>
              <th className="num">{t("actual", lang)}</th>
              <th className="num">{t("achievement", lang)}</th>
              <th className="num">{t("remaining", lang)}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {targets.length ? targets.map((x) => {
              const p = targetProgress(targets, x.period, actualByPeriod[x.period] || 0, x.scope, x.scope_id);
              const hit = p.achievement != null && p.achievement >= 1;
              return (
                <tr key={x.id}>
                  <td className="mono">{x.period}</td>
                  <td className="num">{money(x.amount)}</td>
                  <td className="num">{money(p.actual)}</td>
                  <td className={"num " + (hit ? "up" : "")}>
                    {p.achievement == null ? "—" : `${Math.round(p.achievement * 100)}%`}
                  </td>
                  <td className="num">{money(p.remaining)}</td>
                  <td>
                    <button type="button" className="btn btn-sm btn-ghost"
                      disabled={busy} onClick={() => onDelete(x.id)}>
                      {t("delete", lang)}
                    </button>
                  </td>
                </tr>
              );
            }) : (
              <tr><td colSpan={6} className="hint">{t("noTargetsYet", lang)}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
