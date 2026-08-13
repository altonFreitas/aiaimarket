"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { cycleSellerStock, toggleSellerProductArchive } from "@/lib/actions/seller-products";
import { placeholder } from "@/lib/placeholder";
import { money } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Category, Lang, Product } from "@/lib/types";

const STOCK_KEY = { in: "stockIn", low: "stockLow", out: "stockOut" } as const;
const STATUS_PILL = { pending: "warn", approved: "ok", rejected: "bad" } as const;

function pathName(c: Category, cats: Category[]) {
  const p = c.parent_id ? cats.find((x) => x.id === c.parent_id) : null;
  return (p ? p.name + " › " : "") + c.name;
}

export default function SellerProductList({
  lang, products, cats,
}: { lang: Lang; products: Product[]; cats: Category[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "pending" | "rejected" | "out">("");
  const [showArchived, setShowArchived] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const list = useMemo(() => {
    let a = products.filter((p) => (showArchived ? p.archived : !p.archived));
    if (q) {
      const s = q.toLowerCase();
      a = a.filter((p) => (p.name + " " + p.ref).toLowerCase().includes(s));
    }
    if (statusFilter === "out") a = a.filter((p) => p.stock_status === "out");
    else if (statusFilter) a = a.filter((p) => p.status === statusFilter);
    return a;
  }, [products, q, statusFilter, showArchived]);

  async function onCycle(p: Product) {
    setBusyId(p.id);
    try {
      await cycleSellerStock(p.id, p.stock_status);
      startTransition(() => router.refresh());
    } catch (e) { toast(String((e as Error).message), true); }
    setBusyId(null);
  }
  async function onArchive(p: Product) {
    if (!p.archived && !confirm(t("confirmArchive", lang))) return;
    setBusyId(p.id);
    try {
      await toggleSellerProductArchive(p.id, !p.archived);
      startTransition(() => router.refresh());
    } catch (e) { toast(String((e as Error).message), true); }
    setBusyId(null);
  }

  return (
    <>
      <h1>{t("sellerProducts", lang)}</h1>

      <div className="bar">
        <input type="text" placeholder={t("search", lang)} value={q}
          onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 130 }} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
          <option value="">{t("all", lang)}</option>
          <option value="pending">{t("productStatus_pending", lang)}</option>
          <option value="rejected">{t("productStatus_rejected", lang)}</option>
          <option value="out">{t("stockOut", lang)}</option>
        </select>
        <label className="toggle">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />{" "}
          {t("archived", lang)}
        </label>
        <Link className="btn btn-sm btn-amber" href="/seller/products/new">+ {t("newProduct", lang)}</Link>
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
                  <span>{p.ref} · {money(p.price)} · {cat ? pathName(cat, cats) : "—"}</span>
                </div>
                <div className="acts">
                  <span className={"pill " + STATUS_PILL[p.status]}>{t("productStatus_" + p.status, lang)}</span>
                  <button className={"stock-btn s-" + p.stock_status} type="button"
                    disabled={busyId === p.id} onClick={() => onCycle(p)}>
                    {t(STOCK_KEY[p.stock_status], lang)}
                  </button>
                  <Link className="btn btn-sm btn-ghost" href={`/seller/products/${p.id}`}>{t("edit", lang)}</Link>
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
          <p>{t("sellerNoProducts", lang)}</p>
          <Link className="btn" href="/seller/products/new">+ {t("newProduct", lang)}</Link>
        </div>
      )}
    </>
  );
}
