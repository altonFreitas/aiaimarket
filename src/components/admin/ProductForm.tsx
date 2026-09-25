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
import { parseHighlights, highlightsText, highlightsWarning,
  MAX_HIGHLIGHTS, MAX_HIGHLIGHT_LEN } from "@/lib/highlights";
import { t } from "@/lib/i18n";
import WriteOnly, { useCanWrite } from "./Access";
import { pathOf } from "@/lib/categoryTree";
import type { Category, Lang, Product, Settings, StockStatus } from "@/lib/types";
import type { FormAttribute } from "@/lib/taxonomy/types";

/** Just enough of an approved store to fill the "sold by" select. The whole
 * Seller row is forty columns including its TOTP secret's neighbours, and
 * this is a client component. */
export interface SellerOption { id: string; store_name: string }

/* THE CHAIN OF SELECTS THAT FILES A PRODUCT.
 *
 * There were two boxes, Category and Subcategory, which was right while
 * the tree was two deep. It is three now -- Fitness & Wellness Lifestyle
 * -> Sports Nutrition -> Protein -- and a fixed pair of boxes cannot
 * reach the third level at all: a tub of protein could be filed under
 * Sports Nutrition and no closer.
 *
 * So the boxes are built from the tree rather than counted out in
 * advance. One per level of the path to what is currently chosen, plus
 * one more offering that level's children when it has any. A two-deep
 * tree still draws exactly two boxes, so nothing changes for a shop that
 * has not grown a third level.
 *
 * Each returns the ids to offer and the one selected; the caller renders
 * them and refiles on change. */
function categoryLevels(
  categoryId: string, cats: Category[]
): Array<{ options: Category[]; selected: string }> {
  const byOrder = (a: Category, b: Category) => a.sort_order - b.sort_order;
  const kidsOf = (id: string | null) =>
    cats.filter((c) => (c.parent_id ?? null) === id).sort(byOrder);

  /* The trail down to what is chosen. pathOf walks up from the category
     and reverses, so a product in Protein yields
     [Fitness & Wellness, Sports Nutrition, Protein]. */
  const trail = categoryId ? pathOf(cats, categoryId) : [];
  const levels: Array<{ options: Category[]; selected: string }> = [];

  let parent: string | null = null;
  for (const step of trail) {
    levels.push({ options: kidsOf(parent), selected: step.id });
    parent = step.id;
  }
  /* And one empty box for the level below, when there is one to offer.
     Optional -- a product may live on a category that has children, like
     a general pair of shoes under Shoes & Footwear. */
  const deeper = kidsOf(parent);
  if (deeper.length) levels.push({ options: deeper, selected: "" });

  // Nothing chosen yet: offer the roots.
  if (!levels.length) levels.push({ options: kidsOf(null), selected: "" });
  return levels;
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

  /* WHETHER SHOPPERS CAN SEE IT.
   *
   * A product created by a purchase order receipt lands as "pending" --
   * the stock is real and counted, but the listing is a supplier's name
   * and no photograph, and it used to go straight onto the homepage
   * looking like that. This is the box that ends that: finish the
   * listing, tick it, save.
   *
   * A product typed in here starts ticked, because somebody filling in
   * this form is making a listing on purpose.
   *
   * "rejected" reads as not on sale and ticking sets it to approved,
   * which is the honest mapping of a checkbox onto three states -- the
   * third only ever arrives through Reject on /admin/products. */
  const [onSale, setOnSale] = useState(
    product ? product.status === "approved" : true);

  /* THE PRODUCT THIS FORM HAS ALREADY CREATED.
   *
   * THE BUG THIS FIXES made two products out of one. Saving a NEW product
   * writes the product first and its answers second -- it has to, because
   * the answers need an id to hang off -- and if the answers are refused
   * the form stays put so the fields needing attention are still on
   * screen. The id that had just been created was a local const, thrown
   * away when the handler returned. So the second press saved with no id
   * again and INSERTED a second row: one product carrying the answers and
   * one carrying none, which is exactly what the catalogue then listed.
   *
   * Holding it means the second press updates the product the first one
   * made. Seeded from the prop for an edit, so the two paths are the same
   * path. */
  const [savedProductId, setSavedProductId] = useState(product?.id ?? "");

  const [f, setF] = useState({
    name: product?.name || "",
    price: product ? String(product.price) : "",
    qty: product ? String(product.qty) : "1",
    preorder_enabled: product?.preorder_enabled !== false,
    preorder_eta: product?.preorder_eta || "",
    description: product?.description || "",
    highlights: highlightsText(product?.highlights),
    category_id: product?.category_id || cats.find((c) => !c.parent_id)?.id || "",
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

  const levels = categoryLevels(f.category_id, cats);

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
        id: savedProductId || undefined,
        name: f.name.trim(),
        price: parseNum(f.price, 0),
        discount_price: discountPrice.trim() && parseNum(discountPrice, 0) > 0
          ? parseNum(discountPrice, 0) : null,
        qty: Math.max(0, Math.floor(parseNum(f.qty, 0))),
        preorder_enabled: f.preorder_enabled,
        preorder_eta: f.preorder_eta || null,
        description: f.description,
        highlights: parseHighlights(f.highlights),
        category_id: f.category_id,
        sizes: keptSizes,
        seller_id: f.seller_id || null,
        tags: keptTags,
        images,
        pay_cod: pay.cod, pay_cop: pay.cop, pay_bank: pay.bank,
        pay_wallet: pay.wallet, pay_fiar: pay.fiar,
        municipality: f.municipality, post: f.post, suku: f.suku, landmark: f.landmark,
        onSale,
      });
      // Before anything below can fail: whatever happens next, this form
      // is now editing a product that exists.
      setSavedProductId(savedId);
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
          {/* THE TICKED ONE-LINERS, one per line.
              A textarea rather than a repeater with an "add another"
              button: six words each, and a row of inputs to manage is
              more machinery than the thing deserves.
              The warning is shown rather than the text being silently
              cut -- the database refuses more than twelve or longer than
              120 (products_highlights_sane), and a save that fails a
              check constraint is a 500 and a lost form. */}
          <div className="field">
            <label htmlFor="highlights">{t("highlights", lang)}</label>
            <textarea id="highlights" value={f.highlights} rows={5}
              placeholder={t("highlightsPlaceholder", lang)}
              onChange={(e) => set("highlights", e.target.value)} />
            <p className="hint">{t("highlightsHint", lang)}</p>
            {highlightsWarning(f.highlights) === "many" && (
              <p className="hint bad">
                {t("highlightsTooMany", lang).replace("{n}", String(MAX_HIGHLIGHTS))}
              </p>
            )}
            {highlightsWarning(f.highlights) === "long" && (
              <p className="hint bad">
                {t("highlightsTooLong", lang).replace("{n}", String(MAX_HIGHLIGHT_LEN))}
              </p>
            )}
          </div>
        </div>

        {/* WHERE THIS PRODUCT IS FILED.
            There was a "Who is it for" box here -- Men / Women / Unisex /
            unset -- kept deliberately out of the category tree so that
            every clothing category would not have to be duplicated into a
            men's copy and a women's copy. The shop has since decided the
            other way round, and decided it in the tree itself: Clothing is
            the category, Men's clothing and Women's clothing are
            subcategories of it. One answer, given in one box, in the place
            a shopper will actually look for it. */}
        <div className="panel">
          <h3>{t("catPanelTitle", lang)}</h3>
          <p className="hint">{t("catPanelHint", lang)}</p>
          {levels.map((level, depth) => (
            <div key={depth}
              className={"field" + (depth === 0 && errors.category_id ? " err" : "")}>
              <label htmlFor={`category-l${depth}`}>
                {depth === 0 ? t("category", lang) : t("subcategory", lang)}
              </label>
              <select id={`category-l${depth}`} value={level.selected} disabled={!canWrite}
                onChange={(e) => refile(
                  /* Clearing a level files the product on the level ABOVE
                     it, which is the category still chosen in the box
                     before this one -- not nothing. Emptying "Protein"
                     leaves the tub under Sports Nutrition. */
                  e.target.value || levels[depth - 1]?.selected || "")}>
                {/* The first box has no blank: a product has to be filed
                    somewhere. Every box below it does, because filing on
                    the parent is a real answer. */}
                {depth > 0 && <option value="">{t("none", lang)}</option>}
                {level.options.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <p className="hint">
                {depth === 0 ? t("categoryHint", lang) : t("subcategoryHint", lang)}
              </p>
              {depth === 0 && <p className="msg">{errors.category_id}</p>}
            </div>
          ))}
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

        {/* IMMEDIATELY ABOVE SAVE, because it is part of the same
            decision. A delivery creates the listing but does not offer
            it; this is where somebody looks at what they have written,
            decides it is ready, and says so. Putting it in a panel
            further up would make publishing a thing you do somewhere
            else and then forget. */}
        <WriteOnly>
          <div className={"panel on-sale" + (onSale ? " is-on" : "")}>
            <label className="check" data-on={onSale}>
              <input type="checkbox" checked={onSale}
                onChange={(e) => setOnSale(e.target.checked)} />
              <span>
                <b>{t("onSale", lang)}</b>
                <em>{t("onSaleHint", lang)}</em>
              </span>
            </label>
          </div>
        </WriteOnly>

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
          {/* Only while it IS on sale. The storefront serves approved
              products only, so this link on an unpublished one is a
              button that opens a 404 -- which reads as a broken shop
              rather than as "you have not put it on sale yet". */}
          {product && onSale && (
            <Link className="btn btn-ghost" href={`/p/${product.slug}`} target="_blank">
              {t("catalog", lang)} ↗
            </Link>
          )}
        </div>
      </form>
    </>
  );
}
