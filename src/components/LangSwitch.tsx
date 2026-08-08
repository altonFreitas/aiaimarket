"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLangAction } from "@/lib/actions/lang";
import type { Lang } from "@/lib/types";

export default function LangSwitch({ current }: { current: Lang }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function pick(l: Lang) {
    start(async () => {
      await setLangAction(l);
      router.refresh();
    });
  }

  return (
    <div className="lang" role="group" aria-label="Lian / Idioma / Language">
      {(["tet", "pt", "en"] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          disabled={pending}
          aria-pressed={current === l}
          onClick={() => pick(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
