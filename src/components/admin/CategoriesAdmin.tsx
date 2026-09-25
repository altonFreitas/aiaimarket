"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { createCategory, deleteCategory, mergeCategory, moveCategory, renameCategory } from "@/lib/actions/categories";
import { t } from "@/lib/i18n";
import WriteOnly from "./Access";
import type { Category, Lang, Product } from "@/lib/types";

export default function CategoriesAdmin({
  lang, cats, products,
}: { lang: Lang; cats: Category[]; products: Product[] }) {
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
  const [q, setQ] = useState("");

  const roots = cats.filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order);

  /* THE SEARCH KEEPS A MATCHING CHILD'S PARENT, and keeps a matching
     parent's children. A flat list of hits would strip the one thing this
     screen is for -- showing what sits inside what -- so "shoes" shows
     Clothing with Shoes under it, and "clothing" shows Clothing with
     everything it holds. Matching on the slug as well as the name because
     the slug is on screen and is what a URL complaint will quote. */
  const needle = q.trim().toLowerCase();
  const hit = (c: Category) =>
    !needle || c.name.toLowerCase().includes(needle) || c.slug.toLowerCase().includes(needle);
  const kidsOf = (id: string) =>
    cats.filter((k) => k.parent_id === id).sort((a, b) => a.sort_order - b.sort_order);
  const shown = roots
    .map((c) => ({ c, kids: kidsOf(c.id) }))
    .map(({ c, kids }) => ({ c, kids: hit(c) ? kids : kids.filter(hit) }))
    .filter(({ c, kids }) => hit(c) || kids.length > 0);
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

      {/* Above the list, because it is what the list is filtered by. A
          shop with twenty-five categories and a subcategory under each has
          fifty rows here, and finding one meant scrolling past the rest. */}
      <div className="cat-find">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
          aria-label={t("searchCategories", lang)}
          placeholder={t("searchCategories", lang)} />
        {needle !== "" && (
          <span className="hint">
            {shown.reduce((a, s) => a + (hit(s.c) ? 1 : 0) + s.kids.length, 0)} {t("results", lang)}
          </span>
        )}
      </div>

      <div className="list">
        {shown.map(({ c, kids }) => (
          <div key={c.id} style={{ display: "contents" }}>
            <Row c={c} depth={0} />
            {kids.map((k) => <Row key={k.id} c={k} depth={1} />)}
          </div>
        ))}
      </div>
      {/* Said plainly. An empty list under a box you have just typed in
          reads as a broken screen rather than as an answer. */}
      {needle !== "" && shown.length === 0 && (
        <div className="empty"><p>{t("noResults", lang)}</p></div>
      )}
    </>
  );
}
