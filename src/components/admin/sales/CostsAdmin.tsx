"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { setProductCosts } from "@/lib/actions/sales";
import { money } from "@/lib/utils";
import { t } from "@/lib/i18n";
import WriteOnly from "../Access";
import { describeColor } from "@/lib/colorName";
import type { Category, Lang, Product, ProductCost } from "@/lib/types";
import type { VariantCostRow } from "@/lib/data/variantCosts";

/* Unit cost entry. This is the screen that turns every blank margin on the
 * sales dashboard into a number, so it is built for filling in a catalog in
 * one sitting: everything editable on one page, one save.
 *
 * An empty box means "we do not know", which is deliberately different from
 * 0. Zero cost reports 100% margin; unknown reports nothing and excludes the
 * product from margin aggregates. */

export default function CostsAdmin({
  lang, products, categories, costs, ready, variants = {},
}: {
  lang: Lang; products: Product[]; categories: Category[];
  costs: ProductCost[]; ready: boolean;
  /** product id -> its SKUs, with the cost and price the purchase order
   * set for each. Empty on a database without the variant tables, and the
   * screen then reads exactly as it did before: one row per product. */
  variants?: Record<string, VariantCostRow[]>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState("");
  const [catId, setCatId] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  /* Which products are showing their SKUs. Open by id, not by row
     position: filtering the list would otherwise leave the chevron open
     on whatever slid into that slot. */
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const initial = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of costs) m[c.product_id] = String(c.cost_price);
    return m;
  }, [costs]);

  const [draft, setDraft] = useState<Record<string, string>>(initial);

  const live = useMemo(() => products.filter((p) => !p.archived), [products]);

  const list = useMemo(() => {
    let a = live;
    if (q) {
      const s = q.toLowerCase();
      a = a.filter((p) => (p.name + " " + p.ref).toLowerCase().includes(s));
    }
    if (catId) a = a.filter((p) => p.category_id === catId);
    if (onlyMissing) a = a.filter((p) => !draft[p.id]);
    return a;
  }, [live, q, catId, onlyMissing, draft]);

  // Dirty rows only. Sending the whole catalog on every save would rewrite
  // updated_at for hundreds of untouched products and make the audit trail
  // useless.
  const dirty = useMemo(
    () => live
      .filter((p) => (draft[p.id] ?? "") !== (initial[p.id] ?? ""))
      .map((p) => ({ productId: p.id, costPrice: draft[p.id] === "" ? null : draft[p.id] })),
    [live, draft, initial]
  );

  const missing = live.filter((p) => !draft[p.id]).length;
  const coverage = live.length ? (live.length - missing) / live.length : 0;

  async function onSave() {
    if (!dirty.length) return;
    setSaving(true);
    try {
      await setProductCosts(dirty);
      toast(t("saved", lang) + " ✓");
      startTransition(() => router.refresh());
    } catch (e) {
      toast(String((e as Error).message), true);
    }
    setSaving(false);
  }

  function marginFor(p: Product): number | null {
    const cost = Number(draft[p.id]);
    if (!draft[p.id] || !Number.isFinite(cost)) return null;
    const price = p.discount_price != null && p.discount_price > 0 ? p.discount_price : p.price;
    if (!price) return null;
    return (price - cost) / price;
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("unitCosts", lang)}</h1>
          <p className="sub">{t("unitCostsSub", lang)}</p>
        </div>
      </div>

      {!ready && (
        <div className="note info" style={{ marginBottom: 12 }}>{t("salesMigrationNeeded", lang)}</div>
      )}

      <div className="stat stat-fit">
        <div><b>{live.length}</b><span>{t("liveProducts", lang)}</span></div>
        <div><b>{missing}</b><span>{t("missingCost", lang)}</span></div>
        <div><b>{Math.round(coverage * 100)}%</b><span>{t("costCoverage", lang)}</span></div>
      </div>

      <div className="bar">
        <input type="search" placeholder={t("search", lang)} value={q}
          onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
        <select value={catId} onChange={(e) => setCatId(e.target.value)}>
          <option value="">{t("categories", lang)}</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="toggle">
          <input type="checkbox" checked={onlyMissing}
            onChange={(e) => setOnlyMissing(e.target.checked)} />{" "}
          {t("missingCost", lang)}
        </label>
        <WriteOnly>
          <button type="button" className="btn btn-sm btn-amber"
            disabled={!dirty.length || saving || !ready} onClick={onSave}>
            {saving ? t("saving", lang) : `${t("save", lang)} (${dirty.length})`}
          </button>
        </WriteOnly>
      </div>

      <div className="scroll-x" tabIndex={0}>
        <table className="tbl tbl-compact">
          <thead>
            <tr>
              <th>{t("product", lang)}</th>
              <th>{t("ref", lang)}</th>
              <th className="num">{t("sellingPrice", lang)}</th>
              <th className="num">{t("unitCost", lang)}</th>
              <th className="num">{t("grossProfit", lang)}</th>
              <th className="num">{t("margin", lang)}</th>
            </tr>
          </thead>
          <tbody>
            {list.length ? list.flatMap((p) => {
              const price = p.discount_price != null && p.discount_price > 0 ? p.discount_price : p.price;
              const cost = draft[p.id] ? Number(draft[p.id]) : null;
              const m = marginFor(p);
              const skus = variants[p.id] ?? [];
              const isOpen = !!open[p.id];
              return [
                <tr key={p.id}>
                  <td>
                    {/* THE SKUs BEHIND THE AVERAGE.
                        One row per product is one number for a shirt
                        bought in three sizes at three prices -- an average
                        of three facts the row does not show. The purchase
                        order recorded each of them; this opens them.
                        Only where there are any: a fridge is one thing and
                        a chevron that reveals nothing is furniture. */}
                    {skus.length > 0 && (
                      <button type="button" className="row-exp"
                        aria-expanded={isOpen}
                        aria-label={`${p.name} — ${skus.length} SKU`}
                        onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}>
                        {isOpen ? "▾" : "▸"}
                      </button>
                    )}
                    {p.name}
                    {skus.length > 0 && <span className="hint"> · {skus.length} SKU</span>}
                  </td>
                  <td className="mono">{p.ref}</td>
                  <td className="num">{money(price)}</td>
                  <td className="num">
                    <input
                      type="number" min="0" step="0.01" inputMode="decimal"
                      className="cost-input" value={draft[p.id] ?? ""}
                      placeholder="—"
                      aria-label={`${t("unitCost", lang)} — ${p.name}`}
                      onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                    />
                  </td>
                  <td className="num">{cost == null ? "—" : money(price - cost)}</td>
                  <td className={"num " + (m != null && m < 0.1 ? "bad-text" : "")}>
                    {m == null ? "—" : `${(m * 100).toFixed(1)}%`}
                  </td>
                </tr>,
                /* The breakdown, as one full-width row carrying a small
                   table. Nested rather than interleaved into the outer
                   one: the columns are different -- colour and size
                   against product and ref -- and forcing them to share a
                   grid would misalign both. */
                ...(isOpen && skus.length ? [(
                  <tr key={p.id + "-skus"} className="sku-row">
                    <td colSpan={6}>
                      <table className="tbl tbl-compact sku-tbl">
                        <thead>
                          <tr>
                            <th>{t("color", lang)}</th>
                            <th>{t("size", lang)}</th>
                            <th>{t("sku", lang)}</th>
                            <th className="num">{t("unitCost", lang)}</th>
                            <th className="num">{t("sellingPrice", lang)}</th>
                            <th className="num">{t("margin", lang)}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {skus.map((v) => {
                            /* The variant's own price, or the product's
                               when it has none -- null on a variant means
                               "same as the product", which is what the
                               storefront charges for it. */
                            const sell = v.price ?? price;
                            const c = describeColor(v.axes.color || "");
                            const vm = v.costPrice != null && sell
                              ? (sell - v.costPrice) / sell : null;
                            return (
                              <tr key={v.id}>
                                <td>
                                  {c ? (
                                    <span className="spec-color">
                                      {c.swatch && (
                                        <span className="spec-swatch"
                                          style={{ background: c.swatch }} aria-hidden="true" />
                                      )}
                                      {c.name}
                                    </span>
                                  ) : "—"}
                                </td>
                                {/* The label as the fallback: a variant
                                    whose axes this cannot name still has
                                    the generated "Black / XL" to show. */}
                                <td>{v.axes.size || (c ? "—" : v.label)}</td>
                                <td className="mono">{v.sku || "—"}</td>
                                {/* An em dash, not 0: nothing has landed
                                    for this SKU yet, which is a different
                                    thing from costing nothing. */}
                                <td className="num">{v.costPrice == null ? "—" : money(v.costPrice)}</td>
                                <td className="num">{money(sell)}</td>
                                <td className={"num " + (vm != null && vm < 0.1 ? "bad-text" : "")}>
                                  {vm == null ? "—" : `${(vm * 100).toFixed(1)}%`}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )] : []),
              ];
            }) : (
              <tr><td colSpan={6} className="hint">{t("noResults", lang)}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
