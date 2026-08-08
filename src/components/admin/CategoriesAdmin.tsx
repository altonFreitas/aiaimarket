"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { createCategory, mergeCategory, moveCategory, renameCategory } from "@/lib/actions/categories";
import { t } from "@/lib/i18n";
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
    return (
      <div className="item">
        <div className="g" style={{ paddingLeft: depth * 14 }}>
          <b>{c.name}</b>
          <span>{n} {t("results", lang)} · /{c.slug}{n === 0 ? " · " + t("hiddenEmpty", lang) : ""}</span>
        </div>
        <div className="acts">
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
        </div>
      </div>
    );
  };

  return (
    <>
      <h1>{t("categories", lang)}</h1>
      <p className="sub">{t("hiddenEmpty", lang)} — C3. {t("merge", lang)} — C4.</p>

      <div className="panel">
        <div className="two">
          <div className="field">
            <label htmlFor="nc">{t("newCategory", lang)}</label>
            <input id="nc" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="np">{t("subcategory", lang)}</label>
            <select id="np" value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">{t("none", lang)}</option>
              {roots.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <button className="btn btn-sm" disabled={busy || !name.trim()}
          onClick={() => run(async () => { await createCategory(name.trim(), parent || null); setName(""); }, t("saved", lang))}>
          {t("add", lang)}
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
