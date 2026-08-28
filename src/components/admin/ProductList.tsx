"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { cycleStock, duplicateProduct, toggleArchive, approveProduct, rejectProduct } from "@/lib/actions/products";
import { placeholder } from "@/lib/placeholder";
import { money } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Category, Lang, Product, StockStatus } from "@/lib/types";

const STOCK_KEY = { in: "stockIn", low: "stockLow", out: "stockOut" } as const;

function pathName(c: Category, cats: Category[]) {
  const p = c.parent_id ? cats.find((x) => x.id === c.parent_id) : null;
  return (p ? p.name + " › " : "") + c.name;
}

export default function ProductList({
  lang, products, cats,
}: { lang: Lang; products: Product[]; cats: Category[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState("");
  const [catId, setCatId] = useState("");
  const [stock, setStock] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const list = useMemo(() => {
    let a = products.filter((p) => (showArchived ? p.archived : !p.archived));
    if (q) {
      const s = q.toLowerCase();
      a = a.filter((p) => (p.name + " " + p.ref).toLowerCase().includes(s));
    }
    if (catId) a = a.filter((p) => p.category_id === catId);
    if (stock) a = a.filter((p) => p.stock_status === stock);
    return a;
  }, [products, q, catId, stock, showArchived]);

  const live = products.filter((p) => !p.archived);
  const outCount = live.filter((p) => p.stock_status === "out").length;
  const clicks = live.reduce((a, p) => a + (p.wa_clicks || 0), 0);

  async function onCycle(p: Product) {
    setBusyId(p.id);
    try {
      await cycleStock(p.id, p.stock_status);
      startTransition(() => router.refresh());
    } catch { toast("Error", true); }
    setBusyId(null);
  }
  async function onDuplicate(p: Product) {
    setBusyId(p.id);
    try {
      const newId = await duplicateProduct(p.id);
      toast(t("duplicate", lang) + " ✓");
      router.push(`/admin/p/${newId}`);
    } catch { toast("Error", true); setBusyId(null); }
  }
  async function onArchive(p: Product) {
    if (!p.archived && !confirm(t("confirmArchive", lang))) return;
    setBusyId(p.id);
    try {
      await toggleArchive(p.id, !p.archived);
      startTransition(() => router.refresh());
    } catch { toast("Error", true); }
    setBusyId(null);
  }
  async function onApprove(p: Product) {
    setBusyId(p.id);
    try {
      await approveProduct(p.id);
      startTransition(() => router.refresh());
    } catch { toast("Error", true); }
    setBusyId(null);
  }
  async function onReject(p: Product) {
    setBusyId(p.id);
    try {
      await rejectProduct(p.id);
      startTransition(() => router.refresh());
    } catch { toast("Error", true); }
    setBusyId(null);
  }

  return (
    <>
      <div className="stat">
        <div><b>{live.length}</b><span>{t("liveProducts", lang)}</span></div>
        <div><b>{outCount}</b><span>{t("outOfStock", lang)}</span></div>
        <div><b>{clicks}</b><span>{t("waClicks", lang)}</span></div>
        <div><b>{live.reduce((a, p) => a + (p.views || 0), 0)}</b><span>{t("views", lang)}</span></div>
      </div>

      <div className="bar">
        <input type="text" placeholder={t("search", lang)} value={q}
          onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 130 }} />
        <select value={catId} onChange={(e) => setCatId(e.target.value)}>
          <option value="">{t("categories", lang)}</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{pathName(c, cats)}</option>)}
        </select>
        <select value={stock} onChange={(e) => setStock(e.target.value)}>
          <option value="">{t("all", lang)}</option>
          {(["in", "low", "out"] as StockStatus[]).map((s) => (
            <option key={s} value={s}>{t(STOCK_KEY[s], lang)}</option>
          ))}
        </select>
        <label className="toggle">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />{" "}
          {t("archived", lang)}
        </label>
        <Link className="btn btn-sm btn-amber" href="/admin/p/new">+ {t("newProduct", lang)}</Link>
      </div>

      {list.length ? (
        <div className="list">
          {list.map((p) => {
            const cat = cats.find((c) => c.id === p.category_id);
            return (
              <div className="item" key={p.id} style={{ opacity: busyId === p.id ? 0.5 : 1 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="th" src={p.images?.[0] || placeholder(p.name)} alt="" loading="lazy" />
                <div className="g">
                  <b>{p.name}</b>
                  {/* Split so CSS alone decides how much of the meta line a
                      screen gets. On a phone only the reference survives (see
                      .meta-extra in globals.css) -- price, category and view
                      count are all one tap away on the edit screen, and they
                      were what stretched every row into a paragraph. */}
                  <span>
                    {p.ref}
                    <span className="meta-extra">
                      {" · "}{money(p.price)} · {cat ? pathName(cat, cats) : "—"} · {p.views || 0} {t("views", lang)}
                    </span>
                  </span>
                </div>
                <div className="acts">
                  {p.status !== "approved" && (
                    <span className={"pill " + (p.status === "pending" ? "warn" : "bad")}>
                      {t("productStatus_" + p.status, lang)}
                    </span>
                  )}
                  {p.status === "pending" && (
                    <>
                      <button className="btn btn-sm" disabled={busyId === p.id} onClick={() => onApprove(p)}>
                        {t("approve", lang)}
                      </button>
                      <button className="btn btn-sm btn-danger" disabled={busyId === p.id} onClick={() => onReject(p)}>
                        {t("reject", lang)}
                      </button>
                    </>
                  )}
                  <button className={"stock-btn s-" + p.stock_status} type="button"
                    disabled={busyId === p.id} onClick={() => onCycle(p)}>
                    {t(STOCK_KEY[p.stock_status], lang)}
                  </button>
                  <Link className="btn btn-sm btn-ghost" href={`/admin/p/${p.id}`}>{t("edit", lang)}</Link>
                  <button className="btn btn-sm btn-ghost" type="button"
                    disabled={busyId === p.id} onClick={() => onDuplicate(p)}>{t("duplicate", lang)}</button>
                  <button className="btn btn-sm btn-ghost" type="button"
                    disabled={busyId === p.id} onClick={() => onArchive(p)}>
                    {p.archived ? t("restore", lang) : t("archive", lang)}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty">
          <p>{t("noResults", lang)}</p>
          <Link className="btn" href="/admin/p/new">+ {t("newProduct", lang)}</Link>
        </div>
      )}
    </>
  );
}
