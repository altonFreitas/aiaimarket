"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { saveProduct, uploadProductImage } from "@/lib/actions/products";
import { createCategory } from "@/lib/actions/categories";
import { compressImage } from "@/lib/compressImage";
import { t } from "@/lib/i18n";
import type { Category, Lang, Product, Settings, StockStatus } from "@/lib/types";

function pathName(c: Category, cats: Category[]) {
  const p = c.parent_id ? cats.find((x) => x.id === c.parent_id) : null;
  return (p ? p.name + " › " : "") + c.name;
}

export default function ProductForm({
  lang, cats: initialCats, product, settings,
}: { lang: Lang; cats: Category[]; product: Product | null; settings: any }) {
  const router = useRouter();
  const { toast } = useToast();
  const [cats, setCats] = useState(initialCats);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [newCat, setNewCat] = useState("");
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!f.name.trim()) errs.name = t("required", lang);
    if (!(Number(f.price) > 0)) errs.price = t("required", lang);
    if (!f.category_id) errs.category_id = t("required", lang);
    setErrors(errs);
    if (Object.keys(errs).length) { toast(t("required", lang), true); return; }

    setBusy(true);
    try {
      await saveProduct({
        id: product?.id,
        name: f.name.trim(),
        price: Number(f.price),
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
            {field("price", t("qPrice", lang) + " (USD)", "number")}
            {field("qty", t("qty", lang), "number")}
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
            <select id="category_id" value={f.category_id}
              onChange={(e) => set("category_id", e.target.value)}>
              {cats.map((c) => <option key={c.id} value={c.id}>{pathName(c, cats)}</option>)}
            </select>
            <p className="msg">{errors.category_id}</p>
          </div>
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
            {(["cod", "cop", "bank", "wallet", "fiar"] as const).map((m) => (
              <label className="check" key={m} data-on={pay[m]}>
                <input type="checkbox" checked={pay[m]}
                  onChange={(e) => setPay((s) => ({ ...s, [m]: e.target.checked }))} />
                <span>
                  <b>{t("pm_" + m, lang)}</b>
                  {m === "fiar" && <small>{t("pm_fiar_note", lang)}</small>}
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
