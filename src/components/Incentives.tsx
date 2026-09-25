import { incentives, MIN_INCENTIVES, type IncentiveIcon } from "@/lib/incentives";
import { t } from "@/lib/i18n";
import type { Lang, Settings } from "@/lib/types";

/* THE STRIP UNDER THE HEADER.
 *
 * A row of reassurances that slides by, pauses when a pointer is over it,
 * and fades out at both edges. What it SAYS is decided in
 * lib/incentives.ts, out of the settings row -- see the note there about
 * why "Free Shipping" is not simply printed.
 *
 * NO JAVASCRIPT. The list is rendered twice and the track is translated
 * by -50% forever, so the second copy arrives exactly where the first
 * began and the seam never shows. Pausing is
 * animation-play-state on :hover, and the fade is a mask. A component
 * that does nothing but slide does not need to ship a runtime to do it,
 * and this is a shop built for mobile data.
 *
 * THE SECOND COPY IS HIDDEN FROM ASSISTIVE TECHNOLOGY. It exists to make
 * the loop seamless, and a screen reader that reads the list twice has
 * been told the shop delivers to Dili twice.
 *
 * REDUCED MOTION STOPS IT DEAD. Something moving forever at the top of
 * every page is exactly what that setting is for; it becomes an ordinary
 * row you can scroll with a finger. See globals.css.
 */
export default function Incentives({ settings, lang }: { settings: Settings; lang: Lang }) {
  const items = incentives(settings);
  /* Fewer than a few and the strip is not a marquee, it is two facts
     that will not keep still. It draws nothing rather than a little. */
  if (items.length < MIN_INCENTIVES) return null;

  const line = (key: string, n?: string, nIsKey?: boolean) =>
    n === undefined ? t(key, lang)
      : t(key, lang).replace("{n}", nIsKey ? t(n, lang) : n);

  const row = (copy: number) =>
    items.map((it, i) => (
      <div className="inc-item" key={`${copy}-${it.titleKey}-${i}`}>
        <span className="inc-ic"><Glyph icon={it.icon} /></span>
        <span className="inc-text">
          <b>{line(it.titleKey, it.n, it.nIsKey)}</b>
          <small>{line(it.bodyKey, it.n, it.nIsKey)}</small>
        </span>
      </div>
    ));

  return (
    <div className="inc">
      {/* The duration follows the number of items, so a shop with eight
          reassurances scrolls at the same speed as one with four rather
          than twice as fast. */}
      <div className="inc-track" style={{ "--inc-n": items.length } as React.CSSProperties}>
        <div className="inc-row">{row(0)}</div>
        <div className="inc-row" aria-hidden="true">{row(1)}</div>
      </div>
    </div>
  );
}

function Glyph({ icon }: { icon: IncentiveIcon }) {
  const p = {
    width: 20, height: 20, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.8,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (icon) {
    case "wa":
      return (
        <svg {...p} strokeWidth={0} fill="currentColor">
          <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 2a8 8 0 1 1-4.1 14.8l-.3-.2-2.6.7.7-2.5-.2-.3A8 8 0 0 1 12 4zm-3.2 4c-.2 0-.5.1-.7.4-.3.3-.9.9-.9 2.1 0 1.2.9 2.4 1 2.6.1.2 1.7 2.8 4.3 3.8 2.1.8 2.5.7 3 .6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.7-.4-1.4-.7c-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1-.2-.1-1-.4-1.9-1.2-.7-.6-1.2-1.4-1.3-1.6-.1-.2 0-.3.1-.4l.4-.5.3-.5v-.4l-.7-1.6c-.2-.4-.4-.4-.5-.4h-.1z" />
        </svg>
      );
    case "truck":
      return (
        <svg {...p}>
          <path d="M1 6h12v10H1zM13 10h4l3 3v3h-7z" />
          <circle cx="6" cy="18" r="1.7" /><circle cx="17" cy="18" r="1.7" />
        </svg>
      );
    case "store":
      return (
        <svg {...p}>
          <path d="M3 9l1.5-5h15L21 9" /><path d="M4 9v11h16V9" /><path d="M10 20v-6h4v6" />
        </svg>
      );
    case "return":
      return (
        <svg {...p}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
      );
    case "bank":
      return (
        <svg {...p}>
          <path d="M3 10h18M5 10v9M19 10v9M9 10v9M15 10v9M3 21h18M12 3 3 8h18z" />
        </svg>
      );
    case "wallet":
      return (
        <svg {...p}>
          <path d="M3 7a2 2 0 0 1 2-2h12v4" /><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9H5a2 2 0 0 1-2-2z" />
          <circle cx="17" cy="14" r="1.2" />
        </svg>
      );
    case "stock":
      return (
        <svg {...p}>
          <path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" />
        </svg>
      );
    default:
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" /><path d="M3 12h18" />
          <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
        </svg>
      );
  }
}
