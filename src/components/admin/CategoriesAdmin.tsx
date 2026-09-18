"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import {
  createCategory, deleteCategory, mergeCategory, moveCategory, renameCategory,
  setCategoryTaxRate,
} from "@/lib/actions/categories";
import { parseNum } from "@/lib/numberInput";
import { taxRateAsPercent } from "@/lib/money";
import { t } from "@/lib/i18n";
import WriteOnly from "./Access";
import type { Category, Lang, Product } from "@/lib/types";

export default function CategoriesAdmin({
  lang, cats, products,
}: { lang: Lang; cats: Category[]; products: Product[] }) {
  /* What is being TYPED into a category's tax box, by category id. A
     category with no entry shows its saved rate. Same shape as the delivery
     fee editor in Settings, and for the same reason: a box that saves on
     every keystroke saves three figures nobody meant on the way to "12.5". */
  const [taxDraft, setTaxDraft] = useState<Record<string, string>>({});
  /** The stored fraction as the percentage a person reads, or "" when the
   * category has not been given one. "" is what makes the placeholder --
   * "Shop's rate" -- visible, which is the whole distinction. */
  const pctText = (rate: number | null | undefined) =>
    rate == null ? "" : String(taxRateAsPercent(rate));
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<Category | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [merging, setMerging] = useState<Category | null>(null);
  const [mergeTo, setMergeTo] = useState("");

  const roots = cats.filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order);
  const count = (id: string) => {
    const ids = [id, ...cats.filter((c) => c.parent_id === id).map((c) => c.id)];
    return products.filter((p) => ids.includes(p.category_id || "")).length;
  };
  const refresh = () => startTransition(() => router.refresh());

  async function run(fn: () => Promise<unknown>, msg?: string) {
    setBusy(true);
    try { await fn(); if (msg) toast(msg); refresh(); }
    catch (e) { toast(String((e as Error).message), true); }
    setBusy(false);
  }

  const Row = ({ c, depth }: { c: Category; depth: number }) => {
    const n = count(c.id);
    /* Deleting is only offered for a category holding nothing of its own.
       A product whose category is deleted is not deleted with it -- the
       foreign key sets category_id to null, and it disappears from every
       category page and every menu while still being live, buyable stock.
       Merge is the tool for a category with contents; the button says which
       of the two is in the way. deleteCategory enforces this again on the
       server, where the rule actually lives. */
    const own = products.filter((p) => p.category_id === c.id).length;
    const kids = cats.filter((k) => k.parent_id === c.id).length;
    const blocked = kids ? t("deleteBlockedChildren", lang)
      : own ? t("deleteBlockedProducts", lang)
      : "";
    return (
      <div className="item">
        <div className="g" style={{ paddingLeft: depth * 14 }}>
          <b>{c.name}</b>
          <span>{n} {t("results", lang)} · /{c.slug}{n === 0 ? " · " + t("hiddenEmpty", lang) : ""}</span>
        </div>
        {/* WHAT THESE GOODS ARE TAXED AT.
            Different goods are taxed differently in most tax codes -- food
            against electronics is the usual example -- so one rate for a
            whole shop is the special case, not the general one.

            EMPTY AND ZERO ARE DIFFERENT ANSWERS, which is why this is a box
            and not a number that defaults to 0. Empty means "whatever the
            shop charges", and follows the shop's rate when it changes. Zero
            means "these are not taxed", and stays zero when the shop raises
            its own rate. A picker that collapsed the two would silently tax
            zero-rated food the next time the shop-wide figure moved. */}
        <WriteOnly>
          <label className="cat-tax" title={t("catTaxHint", lang)}>
            <span>{t("catTax", lang)}</span>
            <input type="number" min={0} max={100} step={0.01}
              inputMode="decimal"
              placeholder={t("catTaxShop", lang)}
              disabled={busy}
              value={taxDraft[c.id] ?? pctText(c.tax_rate)}
              onChange={(e) => setTaxDraft((d) => ({ ...d, [c.id]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              onBlur={(e) => {
                const raw = e.target.value;
                setTaxDraft((d) => { const { [c.id]: _drop, ...rest } = d; return rest; });
                const next = raw.trim() === "" ? null : parseNum(raw, Number.NaN);
                if (next != null && !Number.isFinite(next)) return;   // gibberish: leave it alone
                const before = c.tax_rate == null ? null : taxRateAsPercent(c.tax_rate);
                if (next === before) return;                          // nothing changed: no write
                run(() => setCategoryTaxRate(c.id, next), t("saved", lang));
              }} />
          </label>
        </WriteOnly>
        <div className="acts"><WriteOnly>
          <button className="btn btn-sm btn-ghost" disabled={busy}
            onClick={() => run(() => moveCategory(c.id, -1))} aria-label={t("moveUp", lang)}>↑</button>
          <button className="btn btn-sm btn-ghost" disabled={busy}
            onClick={() => run(() => moveCategory(c.id, 1))} aria-label={t("moveDown", lang)}>↓</button>
          <button className="btn btn-sm btn-ghost" disabled={busy}
            onClick={() => { setRenaming(c); setRenameVal(c.name); }}>{t("rename", lang)}</button>
          <button className="btn btn-sm btn-ghost" disabled={busy}
            onClick={() => { setMerging(c); setMergeTo(cats.find((x) => x.id !== c.id)?.id || ""); }}>
            {t("merge", lang)}
          </button>
          <button className="btn btn-sm btn-danger" disabled={busy || blocked !== ""}
            title={blocked || undefined} aria-label={`${t("delete", lang)} ${c.name}`}
            onClick={() => {
              if (!window.confirm(`${t("deleteCategoryAsk", lang)}\n\n${c.name}`)) return;
              run(() => deleteCategory(c.id), t("saved", lang));
            }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
            </svg>
          </button>
        </WriteOnly></div>
      </div>
    );
  };

  return (
    <>
      <h1>{t("categories", lang)}</h1>
      <p className="sub">{t("hiddenEmpty", lang)} — C3. {t("merge", lang)} — C4.</p>

      {/* ONE FORM MAKES BOTH, and it now says so. The second field was
          labelled "Subcategory" over a list of the categories that already
          exist, which reads as "pick a subcategory" -- there was no way to
          tell that it is asking where the new one should GO. Naming it
          "Inside" and spelling out both outcomes is the whole fix; nothing
          about what it does has changed. */}
      <div className="panel">
        <h3>{t("newCategory", lang)}</h3>
        <div className="two">
          <div className="field">
            <label htmlFor="nc">{t("categoryName", lang)}</label>
            <input id="nc" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Sapatu, Kosmétiku…" />
          </div>
          <div className="field">
            <label htmlFor="np">{t("insideCategory", lang)}</label>
            <select id="np" value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">{t("none", lang)}</option>
              {roots.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <p className="hint">{t("insideCategoryHint", lang)}</p>
          </div>
        </div>
        <button className="btn btn-sm" disabled={busy || !name.trim()}
          onClick={() => run(async () => { await createCategory(name.trim(), parent || null); setName(""); }, t("saved", lang))}>
          {parent ? t("newSubcategory", lang) : t("newCategory", lang)}
        </button>
      </div>

      {renaming && (
        <div className="panel">
          <h3>{t("rename", lang)}: {renaming.name}</h3>
          <div className="field">
            <input value={renameVal} onChange={(e) => setRenameVal(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-sm" disabled={busy}
              onClick={() => run(async () => { await renameCategory(renaming.id, renameVal.trim()); setRenaming(null); }, t("saved", lang))}>
              {t("save", lang)}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setRenaming(null)}>{t("cancel", lang)}</button>
          </div>
        </div>
      )}

      {merging && (
        <div className="panel">
          <h3>{t("merge", lang)}: {merging.name}</h3>
          <div className="field">
            <label>{t("mergeInto", lang)}</label>
            <select value={mergeTo} onChange={(e) => setMergeTo(e.target.value)}>
              {cats.filter((x) => x.id !== merging.id && x.parent_id !== merging.id).map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-sm" disabled={busy || !mergeTo}
              onClick={() => run(async () => { await mergeCategory(merging.id, mergeTo); setMerging(null); }, t("merge", lang) + " ✓")}>
              {t("merge", lang)}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setMerging(null)}>{t("cancel", lang)}</button>
          </div>
        </div>
      )}

      <div className="list">
        {roots.map((c) => (
          <div key={c.id} style={{ display: "contents" }}>
            <Row c={c} depth={0} />
            {cats.filter((k) => k.parent_id === c.id).sort((a, b) => a.sort_order - b.sort_order)
              .map((k) => <Row key={k.id} c={k} depth={1} />)}
          </div>
        ))}
      </div>
    </>
  );
}
