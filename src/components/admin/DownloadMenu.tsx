"use client";
import { useEffect, useRef, useState } from "react";

/** ONE BUTTON FOR A DOCUMENT THAT COMES IN TWO FORMATS.
 *
 * "Download PDF" and "Download Excel" sat side by side, at opposite ends
 * of a heading row, as though they were two different things to do. They
 * are one thing to do -- take this order away with me -- and a format to
 * pick while doing it. Two buttons made the shop read both labels to find
 * the difference, and the difference is the last word of each.
 *
 * The format is not a setting to be remembered. Someone downloads a PDF to
 * send a supplier and a spreadsheet to work on, often the same afternoon,
 * so neither is "their" format and the menu opens the same way every time.
 */
export interface DownloadFormat {
  key: string;
  /** What the menu row says: the format, not the verb. The button above
   * already said "Download". */
  label: string;
  /** A word under it, when the two need telling apart by more than their
   * name -- "to send a supplier" against "to work on". */
  note?: string;
  run: () => void | Promise<void>;
}

export default function DownloadMenu({
  label, formats, disabled = false,
}: {
  label: string;
  formats: DownloadFormat[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  /* Anywhere else, and Escape, closes it. Pointerdown rather than click,
     so the menu is gone before whatever was tapped behind it reacts --
     the same rule LangSwitch uses, for the same reason. */
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
    <div className="dlmenu" ref={box}>
      <button type="button" className="btn btn-sm btn-ghost" disabled={disabled}
        aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12M7 11l5 5 5-5M4 20h16" />
        </svg>
        {label}
        <span className="dlmenu-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="dlmenu-list" role="menu">
          {formats.map((f) => (
            <button key={f.key} type="button" role="menuitem" disabled={disabled}
              onClick={() => { setOpen(false); void f.run(); }}>
              <b>{f.label}</b>
              {f.note && <em>{f.note}</em>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
