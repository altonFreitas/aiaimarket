"use client";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { exportStatsExcel } from "@/lib/actions/export";
import { downloadBase64 } from "@/lib/downloadFile";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

export default function ExportExcelButton({ lang }: { lang: Lang }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const { base64, filename } = await exportStatsExcel();
      downloadBase64(base64, filename,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
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
