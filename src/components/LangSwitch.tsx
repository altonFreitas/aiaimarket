"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLangAction } from "@/lib/actions/lang";
import type { Lang } from "@/lib/types";

/** What each language is called in itself. A language picker that names
 * languages in a language you do not read is a picker you cannot use. */
const NAMES: Record<Lang, string> = {
  tet: "Tetun",
  pt: "Português",
  en: "English",
};

const ORDER: Lang[] = ["tet", "pt", "en"];

/** One button, not three.
 *
 * Three side-by-side buttons cost about 90px of a header that also holds a
 * logo, a search box, an account button and a basket -- and two of the
 * three are always the wrong answer, sitting there being ignored. A single
 * control showing the language in use, opening the other two on demand,
 * costs a third of that and says more: TET|PT|EN never made clear which of
 * the three you were actually reading. */
export default function LangSwitch({ current }: { current: Lang }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  function pick(l: Lang) {
    setOpen(false);
    if (l === current) return;
    start(async () => {
      await setLangAction(l);
      router.refresh();
    });
  }

  // Anywhere else, and Escape, closes it. Pointerdown rather than click so
  // the menu is gone before whatever was tapped behind it reacts.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="lang" ref={box}>
      <button type="button" className="lang-btn" disabled={pending}
        aria-haspopup="menu" aria-expanded={open}
        aria-label="Lian / Idioma / Language"
        onClick={() => setOpen((o) => !o)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.6 2.5 15 0 18M12 3c-2.5 2.6-2.5 15 0 18" />
        </svg>
        <b>{current.toUpperCase()}</b>
      </button>

      {open && (
        <div className="lang-menu" role="menu">
          {ORDER.map((l) => (
            <button key={l} type="button" role="menuitemradio" aria-checked={current === l}
              disabled={pending} onClick={() => pick(l)}>
              <span>{NAMES[l]}</span>
              <span className="lang-code">{l.toUpperCase()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
