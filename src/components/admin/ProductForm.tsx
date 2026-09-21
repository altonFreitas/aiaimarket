"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { saveProduct, uploadProductImage } from "@/lib/actions/products";
import { saveProductAttributes } from "@/lib/actions/product-attributes";
import TaxonomyPicker, { type TaxonomySelection } from "./TaxonomyPicker";
import VariantEditor, { type VariantRow } from "./VariantEditor";
import { compressImage } from "@/lib/compressImage";
import { discountPercent } from "@/lib/utils";
import { statusForQty } from "@/lib/stockReport";
import { parseNum } from "@/lib/numberInput";
import { t } from "@/lib/i18n";
import WriteOnly, { useCanWrite } from "./Access";
import { AUDIENCES, AUDIENCE_KEY, normalizeAudience } from "@/lib/audience";
import type { Category, Lang, Product, Settings, StockStatus } from "@/lib/types";
import type { FormAttribute } from "@/lib/taxonomy/types";

/** Just enough of an approved store to fill the "sold by" select. The whole
 * Seller row is forty columns including its TOTP secret's neighbours, and
 * this is a client component. */
export interface SellerOption { id: string; store_name: string }

function rootIdOf(id: string, cats: Category[]): string {
  const c = cats.find((x) => x.id === id);
  return c?.parent_id || id;
}

const STOCK_LABEL: Record<StockStatus, string> = {
  in: "stockIn", low: "stockLow", out: "stockOut",
};
const STOCK_PILL: Record<StockStatus, string> = {
  in: "ok", low: "warn", out: "bad",
};

export default function ProductForm({
  lang, cats, product, settings, sellers = [],
  initialTaxonomy, currentType = null, variants = [],
}: {
  lang: Lang; cats: Category[]; product: Product | null; settings: Settings;
  /** Approved stores the owner may file this product under. Anything else
   * the column holds -- settings.seller_id, or an id belonging to no store
   * -- is the marketplace's own catalogue, which is what the storefront
   * shows for it too. */
  sellers?: SellerOption[];
  /** What this product already answers, for the edit form. */
  initialTaxonomy?: TaxonomySelection;
  /** Its product type, by name as well as id -- see TaxonomyPicker's
   * `currentType`, which needs the name to keep offering a type that
   * hangs off a different category than the product is filed under. */
  currentType?: { id: string; name: string } | null;
  /** The combinations this product is already sold in. */
  variants?: VariantRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const canWrite = useCanWrite();
  const [errors, setErrors] = useState<Record<string, string>>({});
  /* The taxonomy choice and its answers. Held here rather than inside the
     picker so the save handler can read it -- the picker draws, this
     component submits. */
  const [tax, setTax] = useState<TaxonomySelection>(
    initialTaxonomy ?? { productTypeId: "", values: {} });
  /* Errors the SERVER raised against individual attributes, shown against
     the field that caused them. The browser checks too, but the server is
     the one that decides. */
  const [attrErrors, setAttrErrors] = useState<Record<string, string>>({});
  /* The product type's attributes, handed up by the picker as they load --
     the variant editor needs them to know which axes exist, and fetching
     the same rows twice would be a second round trip for no reason. */
  const [typeAttrs, setTypeAttrs] = useState<FormAttribute[]>([]);
  const [images, setImages] = useState<string[]>(product?.images || []);

  const [f, setF] = useState({
    name: product?.name || "",
    price: product ? String(product.price) : "",
    qty: product ? String(product.qty) : "1",
    preorder_enabled: product?.preorder_enabled !== false,
    preorder_eta: product?.preorder_eta || "",
    description: product?.description || "",
    category_id: product?.category_id || cats.find((c) => !c.parent_id)?.id || "",
    audience: normalizeAudience(product?.audience) ?? "",
    // Empty means the marketplace's own catalogue. A product already filed
    // under a store that is no longer approved reads as the shop's own
    // too, which is exactly what the storefront shows for it.
    seller_id: sellers.some((x) => x.id === product?.seller_id) ? product!.seller_id : "",
    municipality: product?.municipality || settings?.municipality || "",
    post: product?.post || settings?.post || "",
    suku: product?.suku || settings?.suku || "",
    landmark: product?.landmark || settings?.landmark || "",
  });

  /* CARRIED, NOT EDITED.
     The "Sizes / variants" and "What it's for (tags)" boxes are gone: a
     size is a variant now (VariantEditor, below) and a tag was a second,
     freehand way to say what the product type already says properly. The
     COLUMNS stay, and every save still writes them -- so it has to write
     back what is in them. Dropping the two keys instead would blank a
     product's sizes the first time anybody edited its price, which would
     take the size picker off the storefront and the size breakdown off
     every restock of it. */
  const keptSizes = product?.sizes || [];
  const keptTags = product?.tags || [];

  // Derived here exactly as the database derives it on save.
  const derivedStatus = statusForQty(Number(f.qty) || 0);
  const [pay, setPay] = useState({
    cod: product?.pay_cod ?? true,
    cop: product?.pay_cop ?? true,
    bank: product?.pay_bank ?? false,
    wallet: product?.pay_wallet ?? false,
    fiar: product?.pay_fiar ?? false,
  });
  // Values are not all strings any more: the pre-order toggle is a
  // boolean, and coercing it to a string here would store "false",
  // which is truthy everywhere it is later read.
  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

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
    const price = parseNum(v, 0);
    const dp = parseNum(discountPrice, 0);
    const pct = discountPercent(price, discountPrice.trim() && dp > 0 ? dp : null);
    setDiscountPctStr(pct != null ? String(pct) : "");
  }
  function onDiscountPriceChange(v: string) {
    setDiscountPriceStr(v);
    const price = parseNum(f.price, 0);
    const dp = parseNum(v, 0);
    const pct = discountPercent(price, v.trim() && dp > 0 ? dp : null);
    setDiscountPctStr(pct != null ? String(pct) : "");
  }
  function onDiscountPctChange(v: string) {
    setDiscountPctStr(v);
    const price = parseNum(f.price, 0);
    const pct = parseNum(v, 0);
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

  /* MOVING THE PRODUCT, AND WHAT MOVES WITH IT.
     Category/Subcategory are two cascading dropdowns over the same
     category_id field: selecting a root category resets the subcategory
     to "none" (product filed directly under the root); selecting a
     subcategory files the product there instead. Both still ultimately
     just set f.category_id -- there's no separate subcategory column.

     THE PRODUCT TYPE GOES WITH THEM. Types hang off a node, so a product
     moved to another one is no longer the type it was: "Sneakers" does not
     exist under Kosmétiku. Clearing it here, where the move happens, is
     what stops a save writing a type from the old branch and a set of
     answers to questions the new one never asked. The picker refuses them
     too -- the attributes are read from the type on the server, never from
     the payload -- but it should not have to. */
  function refile(categoryId: string) {
    set("category_id", categoryId);
    if (categoryId !== f.category_id) setTax({ productTypeId: "", values: {} });
  }

  const selectedRootId = rootIdOf(f.category_id, cats) || cats.find((c) => !c.parent_id)?.id || "";
  const rootCats = cats.filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order);
  const subCats = cats.filter((c) => c.parent_id === selectedRootId).sort((a, b) => a.sort_order - b.sort_order);
  const selectedSubId = cats.find((c) => c.id === f.category_id)?.parent_id ? f.category_id : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!f.name.trim()) errs.name = t("required", lang);
    /* parseNum, not Number: a number input steps and formats in the
       BROWSER's locale, so a Portuguese keyboard produces "12,50" -- which
       Number() reads as NaN and this form then reported as "required" over
       a box that plainly had something in it. */
    if (!(parseNum(f.price, 0) > 0)) errs.price = t("required", lang);
    if (discountPrice.trim()
        && !(parseNum(discountPrice, 0) > 0
             && parseNum(discountPrice, 0) < parseNum(f.price, 0))) {
      errs.price = t("discountMustBeLower", lang);
    }
    if (!f.category_id) errs.category_id = t("required", lang);
    setErrors(errs);
    if (Object.keys(errs).length) { toast(t("required", lang), true); return; }

    setBusy(true);
    try {
      const savedId = await saveProduct({
        id: product?.id,
        name: f.name.trim(),
        price: parseNum(f.price, 0),
        discount_price: discountPrice.trim() && parseNum(discountPrice, 0) > 0
          ? parseNum(discountPrice, 0) : null,
        qty: Math.max(0, Math.floor(parseNum(f.qty, 0))),
        preorder_enabled: f.preorder_enabled,
        preorder_eta: f.preorder_eta || null,
        description: f.description,
        category_id: f.category_id,
        sizes: keptSizes,
        audience: f.audience || null,
        seller_id: f.seller_id || null,
        tags: keptTags,
        images,
        pay_cod: pay.cod, pay_cop: pay.cop, pay_bank: pay.bank,
        pay_wallet: pay.wallet, pay_fiar: pay.fiar,
        municipality: f.municipality, post: f.post, suku: f.suku, landmark: f.landmark,
      });
      /* THE DYNAMIC ATTRIBUTES, AFTER THE PRODUCT ITSELF.
         In this order because a new product has no id until saveProduct
         has run, and the values have to be written against one. The
         universal fields are already safe at this point, so a refusal
         here leaves a real, sellable product and an explained problem --
         not a lost save. */
      const attrRes = await saveProductAttributes({
        productId: savedId,
        productTypeId: tax.productTypeId,
        values: tax.values,
      });
      if (!attrRes.ok) {
        setAttrErrors(attrRes.errors);
        toast(attrRes.errors._ ?? t("required", lang), true);
        setBusy(false);
        return;   // Stay on the form: the fields needing attention are here.
      }

      toast(t("saved", lang));
      router.push("/admin/products");
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
        <Link href="/admin/products">{t("products", lang)}</Link> / {product ? product.ref : t("newProduct", lang)}
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
          {/* Read out, not chosen. The quantity decides the status, and
              two controls for one fact is how a product ends up advertised
              as in stock with nothing behind it. */}
          <div className="field">
            <label>{t("qStock", lang)}</label>
            <p className="stock-derived">
              <span className={"pill " + STOCK_PILL[derivedStatus]}>
                {t(STOCK_LABEL[derivedStatus], lang)}
              </span>
              <span className="hint">{t("stockDerivedHint", lang)}</span>
            </p>
          </div>

          {/* Only shown when the product is actually out of stock: a
              pre-order setting on something sitting on the shelf is a
              control with nothing to control, and it would sit in the form
              collecting confused edits. */}
          {derivedStatus === "out" && (
            <>
              <div className="field">
                <label className="toggle" htmlFor="preorder_enabled">
                  <input id="preorder_enabled" type="checkbox" checked={f.preorder_enabled}
                    onChange={(e) => set("preorder_enabled", e.target.checked)} />{" "}
                  {t("preorderAllow", lang)}
                </label>
                <p className="hint">{t("preorderAllowHint", lang)}</p>
              </div>
              {f.preorder_enabled && (
                <div className="field">
                  <label htmlFor="preorder_eta">{t("preorderEta", lang)}</label>
                  <input id="preorder_eta" type="date" value={f.preorder_eta}
                    onChange={(e) => set("preorder_eta", e.target.value)} />
                  <p className="hint">{t("preorderEtaHint", lang)}</p>
                </div>
              )}
            </>
          )}
          <div className="field">
            <label htmlFor="description">{t("description", lang)}</label>
            <textarea id="description" value={f.description}
              onChange={(e) => set("description", e.target.value)} />
          </div>
        </div>

        {/* WHAT IT IS, AND WHO IT IS FOR, IN ONE PLACE.
            These two used to sit in different panels, and the form gave no
            hint that they were related -- so the obvious reading was that
            "Category" was where you chose Man or Woman. It is not, and it
            must not become that: a category tree split by gender means
            every clothing category duplicated into a men's and a women's
            copy, and then an argument about which one a unisex t-shirt goes
            in. The shop menu builds Women and Men from `audience` instead,
            over the SAME categories. See src/lib/audience.ts and
            src/lib/nav.ts. */}
        <div className="panel">
          <h3>{t("catPanelTitle", lang)}</h3>
          <p className="hint">{t("catPanelHint", lang)}</p>
          <div className={"field" + (errors.category_id ? " err" : "")}>
            <label htmlFor="category_id">{t("category", lang)}</label>
            <select id="category_id" value={selectedRootId} disabled={!canWrite}
              onChange={(e) => refile(e.target.value)}>
              {rootCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <p className="hint">{t("categoryHint", lang)}</p>
            <p className="msg">{errors.category_id}</p>
          </div>
          {subCats.length > 0 && (
            <div className="field">
              <label htmlFor="subcategory_id">{t("subcategory", lang)}</label>
              <select id="subcategory_id" value={selectedSubId} disabled={!canWrite}
                onChange={(e) => refile(e.target.value || selectedRootId)}>
                <option value="">{t("none", lang)}</option>
                {subCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <p className="hint">{t("subcategoryHint", lang)}</p>
            </div>
          )}
          <div className="field">
            <label htmlFor="audience">{t("audienceLabel", lang)}</label>
            <select id="audience" value={f.audience} disabled={!canWrite}
              onChange={(e) => setF({ ...f, audience: e.target.value })}>
              {/* Empty is a real answer, not a missing one: it means the
                  question does not apply to this product. A saucepan is not
                  unisex. */}
              <option value="">{t("audienceAny", lang)}</option>
              {AUDIENCES.map((a) => (
                <option key={a} value={a}>{t(AUDIENCE_KEY[a], lang)}</option>
              ))}
            </select>
            <p className="hint">{t("audienceHint", lang)}</p>
          </div>

          {/* THE PRODUCT TYPE, AND THE FIELDS THAT COME WITH IT.
              The category above -> product type -> that type's own
              attributes, all read from the database. There is no branch
              here on any particular category and there is no per-category
              form: a sofa draws eighteen fields and a t-shirt fourteen
              because that is what their rows say, and a product type added
              next year draws correctly without this file changing. See
              TaxonomyPicker and lib/taxonomy/.

              ONE CATEGORY QUESTION, ASKED ONCE. This used to be a second
              Category and Subcategory pair, drawn by the picker itself
              directly under the pair above -- the same rows of the same
              table, offered twice. Answering them differently filed the
              product in one place and typed it from another, and there was
              nothing on the screen to say which of the two the shop menu
              would use. The pair above is now the only one, and `node` is
              its answer.

              The heading and the picker draw themselves whatever the
              database holds: a shop that has not pasted the taxonomy SQL
              has no product types under any node, so the select simply
              does not appear. */}
          <div className="field">
            <TaxonomyPicker
              title={<>
                <h3 style={{ margin: "18px 0 4px" }}>{t("productType", lang)}</h3>
                <p className="hint" style={{ marginTop: 0 }}>
                  {t("productTypeHint", lang)}
                </p>
              </>}
              node={f.category_id}
              value={tax}
              onChange={setTax}
              currentType={currentType}
              errors={attrErrors}
              onAttributes={setTypeAttrs}
              disabled={!canWrite || busy}
            />
          </div>

          {/* THE COMBINATIONS IT IS SOLD IN.
              Only once the product exists: a variant hangs off a product
              id, and a product being created for the first time has none
              yet. Saving once and coming back is a smaller surprise than
              a matrix that silently vanishes when the save fails. */}
          {product?.id && typeAttrs.some((a) => a.is_variant) && (
            <div className="field">
              <h3 style={{ margin: "18px 0 4px" }}>{t("variantsTitle", lang)}</h3>
              <p className="hint" style={{ marginTop: 0 }}>
                {t("variantsHint", lang)}
              </p>
              <VariantEditor
                productId={product.id}
                attributes={typeAttrs}
                variants={variants}
              />
            </div>
          )}

          {/* WHO SELLS IT.
              The owner lists products for resellers who have no interest
              in logging in to do it themselves -- they send photographs
              and a price, and this is where that product becomes theirs.
              It decides the "Sold by X" line on every card and product
              page, and it is what the seller's own sales, orders and
              earnings are counted from, so it is not cosmetic.

              Only approved stores are offered. A pending or suspended one
              would take the product off the shop's own books and give the
              storefront no name to print in its place. */}
          {sellers.length > 0 && (
            <div className="field">
              <label htmlFor="seller_id">{t("soldBy", lang)}</label>
              <select id="seller_id" value={f.seller_id} disabled={!canWrite}
                onChange={(e) => set("seller_id", e.target.value)}>
                <option value="">{t("storesOwn", lang)}</option>
                {sellers.map((sl) => (
                  <option key={sl.id} value={sl.id}>{sl.store_name}</option>
                ))}
              </select>
              <p className="hint">{t("productSellerHint", lang)}</p>
            </div>
          )}
          {/* NO "CREATE CATEGORY" BOXES. They made a category from one
              typed word, with no slug to check, no sort order, no parent
              beyond the one implied, and no way to see what already
              existed -- which is how a shop ends up with Sapatu, sapatu
              and Sapatus. Catalog -> Categories is the screen for that,
              and it is one click away. */}
        </div>

        <div className="panel">
          <h3>{t("images", lang)}</h3>
          <div className="thumbs">
            {images.map((src, i) => (
              <WriteOnly key={i} otherwise={
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={src} alt="" />
              }>
                <button type="button" title={t("del", lang)}
                  onClick={() => setImages((cur) => cur.filter((_, ix) => ix !== i))}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" />
                </button>
              </WriteOnly>
            ))}
            {images.length < 5 && (
              <label className="btn btn-sm btn-ghost" style={{ height: 52 }}>
                +
                <input type="file" accept="image/*,.heic,.heif" multiple hidden
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
          <WriteOnly>
            <button className="btn btn-amber" type="submit" disabled={busy}>
              {busy ? "…" : t("save", lang)}
            </button>
          </WriteOnly>
          {/* Stays for everyone: with no Save above it this is simply the
              way back to the list. */}
          <Link className="btn btn-ghost" href="/admin/products">
            {t(canWrite ? "cancel" : "back", lang)}
          </Link>
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
