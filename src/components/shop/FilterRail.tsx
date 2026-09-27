import Link from "next/link";
import PriceFilter from "./PriceFilter";
import {
  toggleFilter, attributeFilterParams, hasFilters,
  type AttributeFilters as Filters,
} from "@/lib/attributeFilterParams";
import { describeColor } from "@/lib/colorName";
import { countIn } from "@/lib/categoryTree";
import type { CatalogFilter } from "@/lib/data/attributeFilters";
import { t } from "@/lib/i18n";
import type { Category, Lang, Product } from "@/lib/types";

/* EVERYTHING THE SHOPPER CAN NARROW BY, IN ONE RAIL.
 *
 * The aisles used to be a sidebar of their own and the attributes a panel
 * under it; the price and the in-stock tick were in the bar above the
 * grid, two feet away from both. Three places to narrow one catalogue.
 * They are one panel now -- the reference's -- and it is the only thing
 * the left-hand column holds.
 *
 * LINKS, NOT CHECKBOXES, and that is still the whole design. A filtered
 * catalogue is a PLACE: it can be bookmarked, opened in a second tab, sent
 * to somebody, and found by a search engine. It also means the page needs
 * no JavaScript at all to filter -- which on a phone on a slow connection
 * in Dili is the difference between a filter that works and one that does
 * not. The rail is off-canvas on a narrow screen and :target opens it, so
 * even that costs no script. Price is the one exception: it is typed, and
 * a form has to be submitted by something.
 *
 * WHAT IT OFFERS IS NOT WRITTEN DOWN EITHER. The attribute groups come
 * from what this catalogue's product types actually ask -- shoes get Shoe
 * Size, Terrain and Waterproof; protein gets Flavour and Weight -- so the
 * rail on a category page is that category's rail. See
 * lib/data/attributeFilters.ts.
 */

/** The colour axis is the one attribute worth drawing rather than
 *  spelling: a row of dots is read at a glance, a column of the words
 *  "Black, Navy, Brown" is read one line at a time. */
const COLOR_SLUG = "color";

export default function FilterRail({
  filters, active, basePath, params, cats, products, activeSlug, lang,
}: {
  /** What this catalogue can be filtered by, with counts. Empty until the
   * taxonomy is in use, and those groups simply do not appear. */
  filters: CatalogFilter[];
  /** Which of those are on right now. */
  active: Filters;
  basePath: string;
  /** The catalogue's own parameters -- sort, price, in-stock -- which
   * every filter link has to preserve, or picking a colour would silently
   * reset the sort. */
  params: Record<string, string | undefined>;
  cats: Category[];
  products: Product[];
  activeSlug?: string;
  lang: Lang;
}) {
  const roots = cats.filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order);
  const inStock = params.in === "1";

  /** A filter link: this catalogue, these attribute filters, everything
   *  else carried along. `page` is deliberately dropped -- page four of
   *  the old result set is rarely page four of the new one, and is often
   *  past its end. */
  const href = (next: Filters, over: Record<string, string | null> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v && k !== "page" && !k.startsWith("a_") && !(k in over)) q.set(k, v);
    }
    for (const [k, v] of Object.entries(over)) if (v) q.set(k, v);
    for (const [k, v] of Object.entries(attributeFilterParams(next))) q.set(k, v);
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  const activeCount =
    Object.values(active).reduce((n, v) => n + v.length, 0)
    + (inStock ? 1 : 0) + (params.min ? 1 : 0) + (params.max ? 1 : 0);

  return (
    <aside id="shop-filters" className="frail" aria-label={t("filters", lang)}>
      <div className="frail-hd">
        <h2>{t("filters", lang)}</h2>
        {(hasFilters(active) || activeCount > 0) && (
          <Link className="btn-link" href={href({}, { in: null, min: null, max: null })}>
            {t("clearFilters", lang)}
          </Link>
        )}
        {/* Closes the off-canvas rail on a phone by leaving the anchor it
            is opened by. A link, so it needs no script either. */}
        <a className="frail-x" href="#shop-top" aria-label={t("close", lang)}>×</a>
      </div>

      <details className="fgroup" open>
        <summary>{t("categories", lang)}</summary>
        <ul className="fopts">
          <li>
            <Link className={"fopt" + (activeSlug ? "" : " is-on")} href="/shop">
              <span>{t("all", lang)}</span>
              <span className="hint">{products.length}</span>
            </Link>
          </li>
          {roots.map((c) => {
            const n = countIn(cats, products, c.id);
            if (!n) return null;
            const kids = cats
              .filter((k) => k.parent_id === c.id)
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((k) => ({ cat: k, n: countIn(cats, products, k.id) }))
              .filter((k) => k.n > 0);
            return (
              <li key={c.id}>
                <Link className={"fopt" + (activeSlug === c.slug ? " is-on" : "")}
                  href={`/c/${c.slug}`} aria-current={activeSlug === c.slug || undefined}>
                  <span>{c.name}</span>
                  <span className="hint">{n}</span>
                </Link>
                {kids.length > 0 && (
                  <ul className="fopts fopts-sub">
                    {kids.map(({ cat: k, n: m }) => (
                      <li key={k.id}>
                        <Link className={"fopt" + (activeSlug === k.slug ? " is-on" : "")}
                          href={`/c/${k.slug}`} aria-current={activeSlug === k.slug || undefined}>
                          <span>{k.name}</span>
                          <span className="hint">{m}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </details>

      {filters.map((f, i) => {
        const on = active[f.slug] ?? [];
        const isColor = f.slug === COLOR_SLUG;
        return (
          /* OPEN IF IT IS IN USE, OR IF IT IS ONE OF THE FIRST TWO.
             A rail of nine closed headings makes the shopper open things
             to find out what they are. The groups arrive commonest-first
             (see attributeFilters.ts), so the first two are the axes this
             catalogue is actually sold on -- colour and size in a clothes
             shop, flavour and weight in a supplement one. */
          <details key={f.slug} className="fgroup" open={on.length > 0 || i < 2}>
            <summary>
              {f.name}
              {f.unit && <span className="hint"> ({f.unit})</span>}
              {on.length ? <span className="pill ok">{on.length}</span> : null}
            </summary>
            <ul className={isColor ? "fswatches" : "fchips"}>
              {f.options.map((o) => {
                const picked = on.includes(o.value);
                const link = href(toggleFilter(active, f.slug, o.value));
                if (isColor) {
                  const c = describeColor(o.value);
                  return (
                    <li key={o.value}>
                      <Link href={link} className={"fswatch" + (picked ? " is-on" : "")}
                        /* aria-pressed rather than a checkbox role: it IS a
                           link, and telling a screen reader otherwise would
                           promise behaviour it does not have. */
                        aria-pressed={picked}
                        title={`${c?.name ?? o.value} (${o.count})`}>
                        {/* The dot carries the colour; the name is what a
                            screen reader and a hover both get, because a
                            swatch on its own names nothing. */}
                        <span className="fswatch-dot"
                          style={c?.swatch ? { background: c.swatch } : undefined} />
                        <span className="sr-only">{c?.name ?? o.value}</span>
                      </Link>
                    </li>
                  );
                }
                return (
                  <li key={o.value}>
                    <Link href={link} className={"fchip" + (picked ? " is-on" : "")}
                      aria-pressed={picked}>
                      <span>{o.value}</span>
                      <span className="hint">{o.count}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}

      <details className="fgroup" open>
        <summary>{t("priceRange", lang)}</summary>
        {/* Keyed on the URL values so the back button, a cleared filter and
            a link with a range already in it all remount it with the right
            defaults. */}
        <PriceFilter key={`${params.min ?? ""}|${params.max ?? ""}`} lang={lang} />
      </details>

      <details className="fgroup" open>
        <summary>{t("stockIn", lang)}</summary>
        {/* A chip rather than a row, because a lone row of text in a panel
            of headings does not read as something to press. */}
        <ul className="fchips">
          <li>
            <Link className={"fchip" + (inStock ? " is-on" : "")}
              aria-pressed={inStock}
              href={href(active, { in: inStock ? null : "1" })}>
              <span>{t("onlyIn", lang)}</span>
            </Link>
          </li>
        </ul>
      </details>
    </aside>
  );
}
