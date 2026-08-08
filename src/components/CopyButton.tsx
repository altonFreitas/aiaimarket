"use client";
import { useToast } from "@/components/Toast";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

export default function CopyButton({ value, lang }: { value: string; lang: Lang }) {
  const { toast } = useToast();

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // clipboard API unavailable (very old browser / non-HTTPS) — fall back
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      ta.remove();
    }
    toast(t("copied", lang));
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={t("copyNumber", lang)}
      title={t("copyNumber", lang)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 26,
        marginLeft: 6,
        padding: 0,
        border: "1px solid var(--line)",
        borderRadius: 6,
        background: "#fff",
        color: "var(--muted)",
        cursor: "pointer",
        verticalAlign: "middle",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    </button>
  );
}
