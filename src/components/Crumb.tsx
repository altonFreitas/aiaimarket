import Link from "next/link";

export interface CrumbStep {
  label: string;
  /** Absent on the last step, which is where you already are. */
  href?: string;
}

/* THE TRAIL BACK, THE WAY THE REFERENCE DRAWS IT.
 *
 * A home icon, then chevrons, in ordinary sentence case. It was uppercase
 * mono separated by slashes, which is the shop's caption style -- and that
 * style is still what `.crumb` means everywhere else in the admin, where a
 * dozen screens use it for small headings that are not trails at all. So
 * this is its own class rather than a change to that one: restyling
 * `.crumb` would have quietly re-dressed "TOP PRODUCTS" and "REVENUE" on
 * the sales screens.
 *
 * THE LAST STEP IS NOT A LINK. It is the page you are on, and a link to
 * here is a link that does nothing. Marked aria-current so a screen reader
 * says the same thing the styling does.
 *
 * Server-rendered: it is links and an SVG, and holds no state.
 */
export default function Crumb({ steps, homeLabel }: {
  steps: CrumbStep[];
  homeLabel: string;
}) {
  return (
    <nav className="crumbs" aria-label={homeLabel}>
      <Link className="crumbs-home" href="/" aria-label={homeLabel}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" />
        </svg>
      </Link>
      {steps.map((s, i) => (
        <span key={`${s.label}-${i}`} className="crumbs-step">
          <Chevron />
          {s.href ? (
            <Link href={s.href}>{s.label}</Link>
          ) : (
            <span aria-current="page">{s.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

function Chevron() {
  return (
    <svg className="crumbs-sep" width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}
