"use client";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { exportStatsExcel } from "@/lib/actions/export";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

export default function ExportExcelButton({ lang }: { lang: Lang }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const { base64, filename } = await exportStatsExcel();
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(String((e as Error).message || "Error"), true);
    }
    setBusy(false);
  }

  return (
    <button className="btn btn-ghost btn-sm" type="button" onClick={run} disabled={busy}>
      {busy ? t("exporting", lang) : t("exportExcel", lang)}
    </button>
  );
}
