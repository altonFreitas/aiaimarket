"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { saveProduct, uploadProductImage } from "@/lib/actions/products";
import { createCategory } from "@/lib/actions/categories";
import { compressImage } from "@/lib/compressImage";
import { discountPercent } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Category, Lang, Product, Settings, StockStatus } from "@/lib/types";

function rootIdOf(id: string, cats: Category[]): string {
  const c = cats.find((x) => x.id === id);
  return c?.parent_id || id;
}

export default function ProductForm({
  lang, cats: initialCats, product, settings,
}: { lang: Lang; cats: Category[]; product: Product | null; settings: Settings }) {
  const router = useRouter();
  const { toast } = useToast();
  const [cats, setCats] = useState(initialCats);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [newCat, setNewCat] = useState("");
  const [newSubCat, setNewSubCat] = useState("");
  const [images, setImages] = useState<string[]>(product?.images || []);

  const [f, setF] = useState({
    name: product?.name || "",
    price: product ? String(product.price) : "",
    qty: product ? String(product.qty) : "1",
    stock_status: (product?.stock_status || "in") as StockStatus,
    description: product?.description || "",
    category_id: product?.category_id || cats[0]?.id || "",
    sizes: (product?.sizes || []).join(", "),
    tags: (product?.tags || []).join(", "),
    municipality: product?.municipality || settings?.municipality || "",
    post: product?.post || settings?.post || "",
    suku: product?.suku || settings?.suku || "",
    landmark: product?.landmark || settings?.landmark || "",
  });
  const [pay, setPay] = useState({
    cod: product?.pay_cod ?? true,
    cop: product?.pay_cop ?? true,
    bank: product?.pay_bank ?? false,
    wallet: product?.pay_wallet ?? false,
    fiar: product?.pay_fiar ?? false,
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  // Discount price and discount % are two ways to enter the same thing
  // -- only discount_price is ever persisted (see ProductFormInput);
  // the % field is just a convenience that computes it. Editing either
  // one recalculates the other from the current regular price. Editing
  // the regular price afterwards keeps the dollar discount fixed and
  // just refreshes the displayed %, since a sale price is normally a
  // deliberate absolute decision.
  const [discountPrice, setDiscountPriceStr] = useState(
    product?.discount_price != null ? String(product.discount_price) : ""
  );
  const [discountPct, setDiscountPctStr] = useState(() => {
    const pct = discountPercent(product?.price || 0, product?.discount_price ?? null);
    return pct != null ? String(pct) : "";
  });

  function onPriceChange(v: string) {
    set("price", v);
    const price = Number(v) || 0;
    const dp = Number(discountPrice);
    const pct = discountPercent(price, discountPrice.trim() && dp > 0 ? dp : null);
    setDiscountPctStr(pct != null ? String(pct) : "");
  }
  function onDiscountPriceChange(v: string) {
    setDiscountPriceStr(v);
    const price = Number(f.price) || 0;
    const dp = Number(v);
    const pct = discountPercent(price, v.trim() && dp > 0 ? dp : null);
    setDiscountPctStr(pct != null ? String(pct) : "");
  }
  function onDiscountPctChange(v: string) {
    setDiscountPctStr(v);
    const price = Number(f.price) || 0;
    const pct = Number(v);
    if (!v.trim() || !price || !(pct > 0) || pct >= 100) {
      setDiscountPriceStr("");
    } else {
      setDiscountPriceStr((price * (1 - pct / 100)).toFixed(2));
    }
  }

  async function addImages(files: FileList | null) {
    if (!files?.length) return;
    const room = 5 - images.length;
    const chosen = Array.from(files).slice(0, room);
    setBusy(true);
    for (const file of chosen) {
      try {
        const r = await compressImage(file, 1200, 200);        // B6: client-side, ≤200KB
        const url = await uploadProductImage(r.data, file.name); // → Supabase Storage
        setImages((cur) => [...cur, url]);
        toast(`${file.name} → ${r.kb} KB`);
      } catch (e) {
        console.error(e);
        toast("✕ " + file.name, true);
      }
    }
    setBusy(false);
  }

  async function onCreateCategory() {
    const name = newCat.trim();
    if (!name) return;
    setBusy(true);
    try {
      const c = await createCategory(name, null);            // C1 inline creation
      setCats((cur) => (cur.some((x) => x.id === c.id) ? cur : [...cur, c]));
      set("category_id", c.id);
      setNewCat("");
      toast(t("newCategory", lang) + ": " + c.name);
    } catch { toast("Error", true); }
    setBusy(false);
  }

  // Category/Subcategory are two cascading dropdowns over the same
  // category_id field: selecting a root category resets the subcategory
  // to "none" (product filed directly under the root); selecting a
  // subcategory files the product there instead. Both still ultimately
  // just set f.category_id -- there's no separate subcategory column.
  const selectedRootId = rootIdOf(f.category_id, cats) || cats.find((c) => !c.parent_id)?.id || "";
  const rootCats = cats.filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order);
  const subCats = cats.filter((c) => c.parent_id === selectedRootId).sort((a, b) => a.sort_order - b.sort_order);
  const selectedSubId = cats.find((c) => c.id === f.category_id)?.parent_id ? f.category_id : "";

  async function onCreateSubCategory() {
    const name = newSubCat.trim();
    if (!name || !selectedRootId) return;
    setBusy(true);
    try {
      const c = await createCategory(name, selectedRootId);
      setCats((cur) => (cur.some((x) => x.id === c.id) ? cur : [...cur, c]));
      set("category_id", c.id);
      setNewSubCat("");
      toast(t("newCategory", lang) + ": " + c.name);
    } catch { toast("Error", true); }
    setBusy(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!f.name.trim()) errs.name = t("required", lang);
    if (!(Number(f.price) > 0)) errs.price = t("required", lang);
    if (discountPrice.trim() && !(Number(discountPrice) > 0 && Number(discountPrice) < Number(f.price))) {
      errs.price = t("discountMustBeLower", lang);
    }
    if (!f.category_id) errs.category_id = t("required", lang);
    setErrors(errs);
    if (Object.keys(errs).length) { toast(t("required", lang), true); return; }

    setBusy(true);
    try {
      await saveProduct({
        id: product?.id,
        name: f.name.trim(),
        price: Number(f.price),
        discount_price: discountPrice.trim() && Number(discountPrice) > 0 ? Number(discountPrice) : null,
        qty: Number(f.qty) || 0,
        stock_status: f.stock_status,
        description: f.description,
        category_id: f.category_id,
        sizes: f.sizes.split(",").map((s) => s.trim()).filter(Boolean),
        tags: f.tags.split(",").map((s) => s.trim()).filter(Boolean),
        images,
        pay_cod: pay.cod, pay_cop: pay.cop, pay_bank: pay.bank,
        pay_wallet: pay.wallet, pay_fiar: pay.fiar,
        municipality: f.municipality, post: f.post, suku: f.suku, landmark: f.landmark,
      });
      toast(t("saved", lang));
      router.push("/admin");
      router.refresh();
    } catch (err) {
      console.error(err);
      toast(String((err as Error).message), true);
      setBusy(false);
    }
  }

  const field = (key: keyof typeof f, label: string, type = "text", hint?: string) => (
    <div className={"field" + (errors[key] ? " err" : "")}>
      <label htmlFor={key}>{label}</label>
      <input id={key} type={type} value={f[key] as string} onChange={(e) => set(key, e.target.value)} />
      {hint && <p className="hint">{hint}</p>}
      <p className="msg">{errors[key]}</p>
    </div>
  );

  return (
    <>
      <p className="crumb">
        <Link href="/admin">{t("products", lang)}</Link> / {product ? product.ref : t("newProduct", lang)}
      </p>
      <h1>{product ? product.name || t("edit", lang) : t("newProduct", lang)}</h1>

      <form onSubmit={submit} noValidate>
        <div className="panel">
          {field("name", t("name", lang))}
          <div className="two">
            <div className={"field" + (errors.price ? " err" : "")}>
              <label htmlFor="price">{t("qPrice", lang)} (USD)</label>
              <input id="price" type="number" value={f.price} onChange={(e) => onPriceChange(e.target.value)} />
              <p className="msg">{errors.price}</p>
            </div>
            {field("qty", t("qty", lang), "number")}
          </div>
          <div className="two">
            <div className="field">
              <label htmlFor="discount_price">{t("discountPrice", lang)}</label>
              <input id="discount_price" type="number" min={0} step={0.01} value={discountPrice}
                onChange={(e) => onDiscountPriceChange(e.target.value)} placeholder={t("noDiscount", lang)} />
            </div>
            <div className="field">
              <label htmlFor="discount_pct">{t("discountPercent", lang)}</label>
              <input id="discount_pct" type="number" min={0} max={99} step={1} value={discountPct}
                onChange={(e) => onDiscountPctChange(e.target.value)} placeholder="%" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="stock_status">{t("qStock", lang)}</label>
            <select id="stock_status" value={f.stock_status}
              onChange={(e) => set("stock_status", e.target.value)}>
              <option value="in">{t("stockIn", lang)}</option>
              <option value="low">{t("stockLow", lang)}</option>
              <option value="out">{t("stockOut", lang)}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="description">{t("description", lang)}</label>
            <textarea id="description" value={f.description}
              onChange={(e) => set("description", e.target.value)} />
          </div>
        </div>

        <div className="panel">
          <h3>{t("category", lang)}</h3>
          <div className={"field" + (errors.category_id ? " err" : "")}>
            <label htmlFor="category_id">{t("category", lang)}</label>
            <select id="category_id" value={selectedRootId}
              onChange={(e) => set("category_id", e.target.value)}>
              {rootCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <p className="msg">{errors.category_id}</p>
          </div>
          {subCats.length > 0 && (
            <div className="field">
              <label htmlFor="subcategory_id">{t("subcategory", lang)}</label>
              <select id="subcategory_id" value={selectedSubId}
                onChange={(e) => set("category_id", e.target.value || selectedRootId)}>
                <option value="">{t("none", lang)}</option>
                {subCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="newcat">{t("newCategory", lang)}</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input id="newcat" value={newCat} onChange={(e) => setNewCat(e.target.value)}
                placeholder="Sapatu, Kosmétiku…" />
              <button type="button" className="btn btn-sm" disabled={busy} onClick={onCreateCategory}>
                {t("add", lang)}
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="newsubcat">{t("newSubcategory", lang)}</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input id="newsubcat" value={newSubCat} onChange={(e) => setNewSubCat(e.target.value)}
                placeholder="Sapatu Feto, Sapatu Mane…" />
              <button type="button" className="btn btn-sm" disabled={busy || !selectedRootId}
                onClick={onCreateSubCategory}>
                {t("add", lang)}
              </button>
            </div>
          </div>
        </div>

        <div className="panel">
          {field("sizes", t("sizesLabel", lang), "text", t("sizesHint", lang))}
          {field("tags", t("utility", lang), "text", t("utilityHint", lang))}
        </div>

        <div className="panel">
          <h3>{t("images", lang)}</h3>
          <div className="thumbs">
            {images.map((src, i) => (
              <button key={i} type="button" title={t("del", lang)}
                onClick={() => setImages((cur) => cur.filter((_, ix) => ix !== i))}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" />
              </button>
            ))}
            {images.length < 5 && (
              <label className="btn btn-sm btn-ghost" style={{ height: 52 }}>
                +
                <input type="file" accept="image/*" multiple hidden
                  onChange={(e) => addImages(e.target.files)} />
              </label>
            )}
          </div>
          <p className="hint">{t("imageHint", lang)}</p>
        </div>

        <div className="panel">
          <h3>{t("paymentMethods", lang)}</h3>
          <div className="checks">
            {(["cod", "cop", "bank", "wallet"] as const).map((m) => (
              <label className="check" key={m} data-on={pay[m]}>
                <input type="checkbox" checked={pay[m]}
                  onChange={(e) => setPay((s) => ({ ...s, [m]: e.target.checked }))} />
                <span>
                  <b>{t("pm_" + m, lang)}</b>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="panel">
          <h3>{t("pickupLoc", lang)}</h3>
          <div className="two">
            {field("municipality", t("municipality", lang))}
            {field("post", t("post", lang))}
          </div>
          <div className="two">
            {field("suku", t("suku", lang))}
            {field("landmark", t("landmark", lang))}
          </div>
        </div>

        <div className="btn-row">
          <button className="btn btn-amber" type="submit" disabled={busy}>
            {busy ? "…" : t("save", lang)}
          </button>
          <Link className="btn btn-ghost" href="/admin">{t("cancel", lang)}</Link>
          {product && (
            <Link className="btn btn-ghost" href={`/p/${product.slug}`} target="_blank">
              {t("catalog", lang)} ↗
            </Link>
          )}
        </div>
      </form>
    </>
  );
}
