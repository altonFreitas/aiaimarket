import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/* WHAT A PAGE LOOKS LIKE BEFORE IT ARRIVES.
 *
 * Server components on this shop wait on Supabase before they render, and
 * until this file existed there was nothing to show while they did: the
 * browser held the PREVIOUS page, unchanged, until the new one was ready.
 * A tap that appears to do nothing gets tapped again.
 *
 * These are plain server components -- no state, no effects, no client
 * bundle. Next renders them from loading.tsx the instant navigation starts
 * and swaps in the real page when the data lands.
 *
 * THE SHAPES MATCH THE REAL ONES. A skeleton card is the size of a product
 * card, down to the 1:1 photo and the two-line title, so nothing moves when
 * the content replaces it. A skeleton that is the wrong shape is a layout
 * shift dressed as a courtesy. */

/** One grey block. `w` and `h` when a shape needs a size the classes do
 * not cover -- otherwise use the named shapes below. */
export function Sk({ className = "", w, h }: { className?: string; w?: number | string; h?: number }) {
  return <div className={"sk " + className} style={{ width: w, height: h }} />;
}

/** The product card, as it will be. */
export function SkCard() {
  return (
    <div className="sk-card">
      <div className="sk sk-ph" />
      <div className="sk-body">
        <div className="sk sk-title" />
        <div className="sk sk-title w-60" />
        <div className="sk sk-price" />
      </div>
    </div>
  );
}

/** A grid of them, in the same .grid the real products use so the columns
 * break at exactly the same widths. */
export function SkGrid({ n = 8 }: { n?: number }) {
  return (
    <div className="grid">
      {Array.from({ length: n }, (_, i) => <SkCard key={i} />)}
    </div>
  );
}

/** Rows, for the tables the admin and seller screens are made of. */
export function SkRows({ n = 6 }: { n?: number }) {
  return (
    <div className="rows">
      {Array.from({ length: n }, (_, i) => <div key={i} className="sk sk-row" />)}
    </div>
  );
}

/** The wrapper that says out loud what the grey boxes mean.
 *
 * ONE announcement for the whole page, not one per box: aria-busy on the
 * region and a single visually-hidden word. Marking forty skeletons
 * individually is forty interruptions for somebody listening to it.
 *
 * `polite` because a page on its way is not an emergency -- it waits for a
 * gap rather than cutting across what is being read. */
export default function Skeleton({
  lang, children,
}: { lang: Lang; children: React.ReactNode }) {
  return (
    <div className="sk-wrap" aria-busy="true" aria-live="polite">
      <span className="sr">{t("loading", lang)}</span>
      {children}
    </div>
  );
}
