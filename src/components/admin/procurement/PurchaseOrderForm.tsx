"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { savePurchaseOrder, setPurchaseOrderStatus, deletePurchaseOrder } from "@/lib/actions/procurement";
import { exportPurchaseOrderExcel } from "@/lib/actions/export";
import { downloadBase64 } from "@/lib/downloadFile";
import { PO_CURRENCIES, countryFlag, countryName } from "@/lib/countries";
import { money } from "@/lib/utils";
import {
  PO_STATUSES, deliveryState, parseSizes, poDelayDays, poLeadTime, poQty, poTotal,
  todayIso,
} from "@/lib/procurement";
import { AUDIENCES, AUDIENCE_KEY } from "@/lib/audience";
import { t } from "@/lib/i18n";
import TaxonomyPicker, { type TaxonomySelection } from "../TaxonomyPicker";
import { matrixSize, variantValueSets } from "@/lib/taxonomy/variantMatrix";
import type { FormAttribute } from "@/lib/taxonomy/types";
import WriteOnly, { useCanWrite } from "../Access";
import type {
  Category, Lang, PoCategory, PoPaymentStatus, PoStatus, Product, PurchaseOrder, Supplier,
} from "@/lib/types";

/* Goods bought to sell on come first, and are the default: for a shop, that
 * is most purchases. It is also the only category that reaches stock and the
 * catalog -- the others are real spending that never belonged in the shop. */
const CATEGORIES: PoCategory[] = [
  "goods_for_resale",
  "raw_materials", "components", "packaging", "office", "equipment", "services", "other",
];
const PAYMENT_STATUSES: PoPaymentStatus[] = ["unpaid", "partial", "paid", "overdue"];

interface LineDraft {
  /** A stable identity for React and for the per-line attribute cache.
   *
   * The list used to be keyed by index, which is fine for a list nobody
   * edits and wrong for this one: deleting the middle of three lines makes
   * React reconcile line 3 onto line 2's DOM, so the picker below it keeps
   * the deleted line's loaded attributes and the boxes keep the deleted
   * line's values. Generating twelve variants out of one line made that
   * visible immediately. */
  key: string;
  productName: string;
  category: PoCategory;
  qty: string;
  unitPrice: string;
  /** An existing catalog product, or "" to create one on receipt. */
  productId: string;
  /** Where a newly created product should sit in the shop. */
  catalogCategoryId: string;
  /** Its shelf price, for THIS combination. Unrelated to what it cost, so
   * it is asked for -- and asked for per line, which is the whole point of
   * a line being one SKU: a 45 costs more to buy and sells for more than a
   * 38 of the same shoe, and one price for the lot could not say so. */
  sellPrice: string;
  /** Who the goods are for, copied onto the product at receipt. "" is "not
   * said", which is a real state and not the same as unisex. */
  audience: string;
  description: string;
  /** WHAT KIND OF THING THIS LINE BUYS, and what it answers.
   *
   * The same cascade the product form uses, asked here because here is
   * where the buyer knows. Without it a receipt created a name, a price
   * and a category, and somebody afterwards opened the new product and
   * filled in eighteen fields from memory. */
  taxonomy: TaxonomySelection;
}

/* THE COUNTER IS PER FORM, NOT PER MODULE, and that is not tidiness.
 *
 * A module-level counter keeps climbing for as long as the server process
 * lives, so the server rendered a line keyed l7 while the browser, loading
 * the module fresh, rendered the same line keyed l1. The keys themselves
 * are React's business -- but they are also the prefix on every id this
 * line draws, so the two documents disagreed about id="l7-attr-…" versus
 * id="l1-attr-…" and React threw a hydration mismatch over it.
 *
 * Found in a browser, on the console, within a minute of the ids being
 * built from the key. A useRef starting at zero gives the server and the
 * browser the same sequence, because each of them makes one form and
 * counts from the beginning. */
const blankLine = (): LineDraft => ({
  key: "",
  productName: "", category: "goods_for_resale", qty: "1", unitPrice: "0",
  productId: "", catalogCategoryId: "", sellPrice: "",
  audience: "", description: "",
  taxonomy: { productTypeId: "", values: {} },
});

/** The root a category id sits under -- itself when it is a root.
 *
 * Shop category and subcategory are two dropdowns over ONE field, exactly
 * as they are on the product form: picking a root files the goods there,
 * picking a child files them in the child. There is no second column, and
 * catalog_category_id is always the leaf. */
function rootIdOf(id: string, cats: Category[]): string {
  return cats.find((x) => x.id === id)?.parent_id || id;
}

/* ONE LINE IS ONE SKU.
 *
 * It used to be one line per PRODUCT, with a "S, M, L, XL" box and a grid
 * of quantities under it. That shape could say how many of each size were
 * bought and could not say what each one cost, because the line had a
 * single unit price and a single selling price for the lot. Shoes are the
 * obvious case -- a 45 costs more to buy than a 38 and sells for more --
 * but it is true of any product sold in a size or a colour that the
 * supplier prices separately.
 *
 * So the breakdown is gone and the line is the breakdown: one size, one
 * colour, its own quantity, its own cost, its own price. The size is not a
 * new field -- it is the product type's own Size attribute, answered on
 * this row, which is why nothing here knows what a size is. Bulk generate
 * (below) is what stops that being twelve times the typing.
 */

/** The reorder plan's suggestion, turned into lines. Quantities come from
 * the plan; the unit price is left at zero because the plan does not know
 * what the supplier will charge this time -- the last landed cost includes
 * freight and tax apportioned from a different order, and filling it in
 * would be a guess wearing the clothes of a quote.
 *
 * A line naming a product that is no longer in the catalog is dropped
 * rather than carried as an empty row. */
function prefilledLines(
  prefill: { lines: Array<{ productId: string; qty: number }> } | undefined,
  products: Product[]
): LineDraft[] {
  if (!prefill?.lines?.length) return [blankLine()];
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = prefill.lines.flatMap(({ productId, qty }) => {
    const p = byId.get(productId);
    if (!p || qty <= 0) return [];
    return [{ ...blankLine(), productId: p.id, productName: p.name, qty: String(qty) }];
  });
  return lines.length ? lines : [blankLine()];
}

export default function PurchaseOrderForm({
  lang, suppliers, po, products, categories, prefill, lineSpecs = {},
}: {
  lang: Lang; suppliers: Supplier[]; po: PurchaseOrder | null;
  /** The live catalog, so a line can point at a product that already
   * exists rather than creating a duplicate of it on receipt. */
  products: Product[];
  categories: Category[];
  /** A draft handed over from the reorder plan: which supplier, and how
   * many of what. Only ever used for a NEW order -- an existing one has its
   * own lines and must not have them replaced by a link. */
  prefill?: { supplierId?: string; lines: Array<{ productId: string; qty: number }> };
  /** Each line's product type and answers, in words rather than as ids --
   * see lib/data/poSpecs.ts. The PDF is built in the browser and cannot
   * look them up for itself. */
  lineSpecs?: Record<string, { typeName: string; specs: { name: string; value: string }[] }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const canWrite = useCanWrite();
  const today = todayIso();

  const [f, setF] = useState({
    supplierId: po?.supplier_id || (!po && prefill?.supplierId) || suppliers[0]?.id || "",
    buyer: po?.buyer || "",
    orderDate: po?.order_date || today,
    expectedArrival: po?.expected_arrival || "",
    actualArrival: po?.actual_arrival || "",
    currency: po?.currency || "USD",
    fxRate: String(po?.fx_rate ?? 1),
    tax: String(po?.tax ?? 0),
    shipping: String(po?.shipping ?? 0),
    discount: String(po?.discount ?? 0),
    status: (po?.status || "draft") as PoStatus,
    paymentStatus: (po?.payment_status || "unpaid") as PoPaymentStatus,
    paymentDate: po?.payment_date || "",
    notes: po?.notes || "",
  });
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));

  /* TWO SOURCES OF KEY, AND TWO PREFIXES SO THEY CANNOT MEET.
     The lines this form OPENS with are keyed by position -- i0, i1, i2 --
     which is the same on the server and in the browser and is what keeps
     the ids built from them (see idPrefix) identical in both documents.
     Lines added or generated afterwards only ever happen in the browser,
     so they come from a counter, and a counter may not be read during
     render at all (react-hooks/refs). Different prefixes mean the two
     schemes never collide, so the counter does not have to know how many
     lines the form started with. */
  const seq = useRef(0);
  const nextKey = () => `n${++seq.current}`;
  const newLine = (): LineDraft => ({ ...blankLine(), key: nextKey() });

  const [lines, setLines] = useState<LineDraft[]>(
    po?.items?.length
      ? po.items.map((i, n) => ({
          key: `i${n}`,
          productName: i.product_name, category: i.category,
          qty: String(i.qty), unitPrice: String(i.unit_price),
          productId: i.product_id || "",
          catalogCategoryId: i.catalog_category_id || "",
          sellPrice: i.sell_price == null ? "" : String(i.sell_price),
          audience: i.audience || "",
          description: i.description || "",
          taxonomy: {
            productTypeId: i.product_type_id || "",
            values: i.attribute_values || {},
          },
        }))
      : prefilledLines(prefill, products).map((l, n) => ({ ...l, key: `i${n}` }))
  );
  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  /* WHAT EACH LINE'S PRODUCT TYPE ASKS FOR, kept by line key rather than
     by index -- generating variants replaces one line with twelve, and an
     index-keyed cache would hand eleven of them the wrong questions.
     Handed up by the picker as it loads them, so bulk generate knows which
     attributes are the axes without a second round trip. */
  const [lineAttrs, setLineAttrs] = useState<Record<string, FormAttribute[]>>({});
  const axesOf = (l: LineDraft) => (lineAttrs[l.key] ?? []).filter((a) => a.is_variant);

  /* WHICH COMBINATION THIS LINE IS, in three words at the top of it.
     Generating six lines out of one produces six rows that say "Blue
     Shirt, 10, 4.00, 12.00" and nothing else -- identical to read, and the
     only thing telling them apart was a Size box buried in the attribute
     grid at the bottom of each. Measured in a browser: six rows, no way to
     find the 42 in black without opening all six.

     Joined with " / " because that is exactly how buildMatrix labels a
     combination and how product_variants stores it, so what the buyer
     reads here is the label the stock report will show them later. */
  const skuOf = (l: LineDraft) => axesOf(l)
    .map((a) => (l.taxonomy.values[a.id] ?? [])[0] ?? "")
    .filter(Boolean)
    .join(" / ");

  /* THE BOXES THE BULK PANEL IS HOLDING, per line and per axis:
     { "l3": { "<size attr id>": "S, M, L" } }. Open is simply "has an
     entry", so there is no second flag to keep in step with it. */
  const [bulk, setBulk] = useState<Record<string, Record<string, string>>>({});

  /* THE CATEGORY TREE, FROM THE ROWS THE PAGE ALREADY HAS.
     `categories` is every category in sort order, so both levels come out
     of it without a round trip -- the same thing the product form does. */
  const rootCats = categories.filter((c) => !c.parent_id);
  const subCatsOf = (leafId: string) => {
    const root = rootIdOf(leafId, categories);
    return root ? categories.filter((c) => c.parent_id === root) : [];
  };

  /* MOVING A LINE'S GOODS TO ANOTHER CATEGORY CLEARS ITS PRODUCT TYPE.
     Types hang off a node: "Sneakers" does not exist under Kosmétiku, and
     its questions are not the questions the new branch asks. Cleared here,
     where the move happens, so a save cannot carry a type from the old
     branch and a set of answers to questions nobody is asking. The server
     refuses them as well -- it reads the attributes from the type, never
     from the payload -- but it should not have to. */
  /* BULK GENERATE: one line becomes one line per combination.
   *
   * Twelve SKUs typed by hand is twelve chances to put the cost of the 41
   * on the 42, and nobody checks a purchase order line by line afterwards.
   * So the buyer fills one line in -- the product, the category, the type,
   * every answer that is the same across the lot -- then says "S, M, L"
   * once and gets three lines carrying all of it, differing in the size
   * alone. Quantity, cost and price are copied too, because they are
   * usually the same and correcting three is faster than typing thirty.
   *
   * THE AXES ARE THE PRODUCT TYPE'S OWN. Nothing here knows what a size
   * is: an axis is an attribute the catalogue marked is_variant, so a
   * product type whose axes are Capacity and Finish generates on those
   * instead, with no change to this file.
   *
   * buildMatrix is the same function the product form's variant editor
   * uses, cap and all -- see lib/taxonomy/variantMatrix.ts. Two hundred is
   * the ceiling; past it the shop almost certainly meant something
   * smaller, and finding that out after writing the rows is expensive. */
  function generateVariants(i: number) {
    const line = lines[i];
    const typed = bulk[line.key] ?? {};
    const axes = axesOf(line)
      .map((a) => ({
        attributeId: a.id,
        name: a.name,
        values: parseSizes(typed[a.id] ?? ""),
      }))
      .filter((a) => a.values.length > 0);

    let sets;
    try {
      sets = variantValueSets(line.taxonomy.values, axes);
    } catch (e) {
      // TooManyVariants carries its own sentence, which says the number.
      toast(String((e as Error).message), true);
      return;
    }
    if (!sets.length) { toast(t("bulkNothingToSplit", lang), true); return; }

    /* The generated lines are the same product type as the line they came
       from, so they ask the same questions. Handing them its answers now
       does two things: the combination shows in each row's heading at
       once rather than after six identical round trips, and the pickers
       below them have nothing left to fetch. */
    const made = sets.map((values) => ({ key: nextKey(), values }));
    setLineAttrs((m) => ({
      ...m,
      ...Object.fromEntries(made.map((v) => [v.key, m[line.key] ?? []])),
    }));

    setLines((ls) => [
      ...ls.slice(0, i),
      ...made.map(({ key, values }) => ({
        ...line,
        key,
        /* A GENERATED LINE IS A NEW LINE, never one already received:
           product_id points at a catalogue product and carrying it onto
           twelve rows would top that product up twelve times from one
           order. Only a line with no product_id can be split -- the panel
           is drawn inside the "new product" half of the line. */
        taxonomy: { ...line.taxonomy, values },
      })),
      ...ls.slice(i + 1),
    ]);
    // The panel has done its job; leaving it open over twelve new lines
    // invites a second press that would square them.
    setBulk((b) => { const { [line.key]: _gone, ...rest } = b; return rest; });
    toast(t("bulkGenerated", lang).replace("{n}", String(sets.length)));
  }

  /** Another line for the same product, with the axes blank.
   *
   * Everything that describes the goods is copied -- the name, the
   * category, the product type, the description, who they are for -- and
   * so are the quantity and the prices, because the second colour is
   * usually bought in the same numbers at the same cost and correcting one
   * is faster than typing four. What is NOT copied is the combination
   * itself: this line exists to be a different one.
   *
   * product_id goes too. A line pointing at a catalogue product is a
   * restock of exactly that product, and copying it would top the same one
   * up twice from one order. */
  function addLineLike(i: number) {
    const line = lines[i];
    const axes = new Set(axesOf(line).map((a) => a.id));
    const values = Object.fromEntries(
      Object.entries(line.taxonomy.values).filter(([id]) => !axes.has(id)));
    const key = nextKey();
    setLineAttrs((m) => ({ ...m, [key]: m[line.key] ?? [] }));
    setLines((ls) => [
      ...ls.slice(0, i + 1),
      { ...line, key, productId: "", taxonomy: { ...line.taxonomy, values } },
      ...ls.slice(i + 1),
    ]);
  }

  function refile(i: number, categoryId: string) {
    setLines((ls) => ls.map((l, n) => (n === i
      ? { ...l, catalogCategoryId: categoryId,
          taxonomy: categoryId === l.catalogCategoryId
            ? l.taxonomy : { productTypeId: "", values: {} } }
      : l)));
  }

  // Live totals in the ORDER's currency: the buyer is reading an invoice
  // denominated in it, so showing them a converted figure while they type
  // would mean checking the form against arithmetic they cannot see.
  // Units come from the size breakdown where there is one, so the money
  // agrees with the stock rather than with a quantity box nobody updated.
  const subtotal = lines.reduce(
    (a, l) => a + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
  const total = subtotal + (Number(f.tax) || 0) + (Number(f.shipping) || 0) - (Number(f.discount) || 0);
  const inBase = total * (Number(f.fxRate) || 1);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await savePurchaseOrder({
        id: po?.id,
        supplierId: f.supplierId,
        buyer: f.buyer,
        orderDate: f.orderDate,
        expectedArrival: f.expectedArrival || null,
        actualArrival: f.actualArrival || null,
        currency: f.currency,
        fxRate: Number(f.fxRate) || 1,
        tax: Number(f.tax) || 0,
        shipping: Number(f.shipping) || 0,
        discount: Number(f.discount) || 0,
        status: f.status,
        paymentStatus: f.paymentStatus,
        paymentDate: f.paymentDate || null,
        notes: f.notes,
        lines: lines.map((l) => {
          return {
            productName: l.productName, category: l.category,
            // The line's own number now, not a total of a grid: one line
            // is one combination.
            qty: Number(l.qty), unitPrice: Number(l.unitPrice),
            productId: l.productId || null,
            catalogCategoryId: l.catalogCategoryId || null,
            sellPrice: l.sellPrice === "" ? null : Number(l.sellPrice),
            audience: l.audience || null,
            description: l.description,
            /* Sent for every line; the server clears both on anything that
               is not goods for resale, because an office chair the shop
               sits on is a real purchase and never a product. */
            productTypeId: l.taxonomy.productTypeId || null,
            attributeValues: l.taxonomy.values,
          };
        }),
      });
      /* Green, and back to the list the buyer came from.
       *
       * It used to land on the order's own page, which is the page they
       * were already on -- so the only sign that anything had happened was
       * a toast in the same ink colour used for every other message. Saving
       * a purchase order finishes a job, and finishing a job means going
       * back to the book of them. */
      toast(f.status === "received" ? t("savedAndReceived", lang) : t("saved", lang), "good");
      router.push("/admin/procurement");
      router.refresh();
      // Left busy on the way out: the page is being replaced, and a button
      // that springs back to "Save" during the navigation invites a second
      // press that would file the order twice.
      return;
    } catch (err) {
      toast(String((err as Error).message), "bad");
    }
    setBusy(false);
  }

  /** Pulls jspdf down only when someone actually presses the button --
   * it is ~400 KB and nothing else on this page needs it. */
  async function downloadPdf() {
    if (!po) return;
    try {
      const mod = await import("@/lib/pdfPurchaseOrder");
      mod.downloadPurchaseOrderPdf(
        po, suppliers.find((s) => s.id === po.supplier_id), lineSpecs);
    } catch {
      toast(t("error", lang), true);
    }
  }

  /** The same order as a spreadsheet: what a shop works ON, as opposed to
   * what a supplier is sent. Built on the server, because that is where
   * the attribute names are and where exceljs already lives. */
  async function downloadExcel() {
    if (!po) return;
    setBusy(true);
    try {
      const { base64, filename } = await exportPurchaseOrderExcel(po.id);
      downloadBase64(base64, filename,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } catch (e) {
      toast(String((e as Error).message) || t("error", lang), true);
    }
    setBusy(false);
  }

  /* THE BUTTONS AND THE DROPDOWN ARE THE SAME FIELD.
   *
   * The button writes it now; the dropdown writes it on Save. What they must
   * never do is disagree -- and they did, because `f.status` is seeded from
   * the `po` prop once and useState does not re-read a prop. So pressing
   * Approved changed the database, left the dropdown saying Draft, and the
   * next Save wrote Draft straight back over it. The status appeared not to
   * stick anywhere: not in the form, and not in the table on
   * /admin/procurement either, because Save had undone it.
   *
   * Moving the local state here is the whole fix. The arrival date is
   * mirrored for the same reason: the server stamps today when an order
   * lands without one, and a form still holding the blank would have
   * cleared it again on the next Save. The rule is copied, not guessed --
   * see setPurchaseOrderStatusIn. */
  async function quickStatus(status: PoStatus) {
    if (!po) return;
    setBusy(true);
    try {
      await setPurchaseOrderStatus(po.id, status);
      const landed = status === "arrived" || status === "received";
      set({ status, ...(landed && !f.actualArrival ? { actualArrival: today } : {}) });
      toast(status === "received" ? t("savedAndReceived", lang) : t("po_" + status, lang), false);
      router.refresh();
    } catch (err) { toast(String((err as Error).message), true); }
    setBusy(false);
  }

  async function remove() {
    if (!po) return;
    if (!window.confirm(t("deletePoAsk", lang))) return;
    setBusy(true);
    try {
      await deletePurchaseOrder(po.id);
      // REPLACE: the page we are leaving is the deleted order's own, so
      // pressing Back would return to a URL that no longer resolves. The
      // same reason checkout replaces itself once the basket is emptied.
      router.replace("/admin/procurement");
    } catch (err) { toast(String((err as Error).message), true); setBusy(false); }
  }

  const supplier = suppliers.find((s) => s.id === f.supplierId);

  return (
    <>
      <p className="crumb">
        <Link href="/admin/procurement">{t("procurement", lang)}</Link>
        {" / "}{po ? po.po_number : t("newPurchaseOrder", lang)}
      </p>
      <div className="page-head">
        <h1>{po ? po.po_number : t("newPurchaseOrder", lang)}</h1>
        {/* Only for a saved order: there is nothing to print from a form
            that has not been written down yet. */}
        {po && (
          <>
            <button type="button" className="btn btn-sm btn-ghost" onClick={downloadPdf}>
              {t("downloadPdf", lang)}
            </button>
            <button type="button" className="btn btn-sm btn-ghost"
              disabled={busy} onClick={downloadExcel}>
              {t("exportExcel", lang)}
            </button>
          </>
        )}
      </div>

      {/* Derived delivery facts, for an order that already exists. Read-only:
          every one of them comes from the dates below, so they update when
          the dates do rather than being separately maintained. */}
      {po && (
        <div className="stat stat-fit">
          <div><b>{money(poTotal(po))}</b><span>{t("totalPurchaseValue", lang)}</span></div>
          <div><b>{poQty(po).toLocaleString("en-US")}</b><span>{t("quantity", lang)}</span></div>
          <div><b>{poLeadTime(po) == null ? "—" : poLeadTime(po) + "d"}</b>
            <span>{t("daysInTransit", lang)}</span></div>
          <div>
            <b style={{ color: poDelayDays(po, today) ? "var(--red)" : undefined }}>
              {poDelayDays(po, today) || 0}d</b>
            <span>{t("delayDays", lang)}</span>
          </div>
          <div><b>{t("state_" + deliveryState(po, today), lang)}</b><span>{t("deliveryStatus", lang)}</span></div>
        </div>
      )}

      {po && (
        <WriteOnly>
          {/* EVERY status, with the one the order is at marked -- not the
              other eight with the current one missing. A row of buttons
              that silently drops the answer to "where is this order" is a
              row of buttons you cannot read, and it also left no way to
              re-run a receipt that had half-failed: the only button that
              would do it was the one being hidden. Pressing the current
              status again is safe; receiving is idempotent. */}
          <div className="po-status">
            <span className="hint">{t("moveOrderOn", lang)}</span>
            <div className="po-status-row">
              {PO_STATUSES.map((s) => (
                <button key={s} type="button" disabled={busy}
                  className={"btn btn-sm " + (s === f.status ? "btn-amber" : "btn-ghost")}
                  aria-pressed={s === f.status}
                  onClick={() => quickStatus(s)}>{t("po_" + s, lang)}</button>
              ))}
            </div>
            <p className="hint">{t("quickStatusHint", lang)}</p>
          </div>
        </WriteOnly>
      )}

      <form onSubmit={submit}>
        <div className="panel">
          <h3>{t("purchaseInformation", lang)}</h3>
          <div className="two">
            <div className="field">
              <label htmlFor="sup">{t("supplier", lang)}</label>
              <select id="sup" value={f.supplierId} onChange={(e) => set({ supplierId: e.target.value })} required>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.country_code ? ` — ${countryName(s.country_code)}` : ""}
                  </option>
                ))}
              </select>
              {supplier?.country_code && (
                <p className="hint">{countryFlag(supplier.country_code)} {countryName(supplier.country_code)}
                  {supplier.lead_time_days != null && ` · ${t("leadTime", lang)} ${supplier.lead_time_days}d`}</p>
              )}
            </div>
            <div className="field">
              <label htmlFor="buyer">{t("buyer", lang)}</label>
              <input id="buyer" value={f.buyer} onChange={(e) => set({ buyer: e.target.value })} />
            </div>
          </div>
          <div className="two">
            <div className="field">
              <label htmlFor="od">{t("purchaseDate", lang)}</label>
              <input id="od" type="date" value={f.orderDate}
                onChange={(e) => set({ orderDate: e.target.value })} required />
            </div>
            <div className="field">
              <label htmlFor="ea">{t("expectedArrival", lang)}</label>
              <input id="ea" type="date" value={f.expectedArrival}
                onChange={(e) => set({ expectedArrival: e.target.value })} />
            </div>
          </div>
          <div className="two">
            <div className="field">
              <label htmlFor="aa">{t("actualArrival", lang)}</label>
              <input id="aa" type="date" value={f.actualArrival}
                onChange={(e) => set({ actualArrival: e.target.value })} />
              <p className="hint">{t("actualArrivalHint", lang)}</p>
            </div>
            <div className="field">
              <label htmlFor="st">{t("purchaseStatus", lang)}</label>
              <select id="st" value={f.status} onChange={(e) => set({ status: e.target.value as PoStatus })}>
                {PO_STATUSES.map((s) => <option key={s} value={s}>{t("po_" + s, lang)}</option>)}
              </select>
              <p className="hint">{t("purchaseStatusHint", lang)}</p>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>{t("lineItems", lang)}</h3>
            <WriteOnly>
              <button className="btn btn-sm btn-ghost" type="button"
                onClick={() => setLines((ls) => [...ls, newLine()])}>+ {t("addLine", lang)}</button>
            </WriteOnly>
          </div>
          {lines.map((l, i) => (
            <div key={l.key} className="po-line">
              {/* Full width and first, so six generated lines are six
                  headings rather than six identical rows. */}
              {skuOf(l) && (
                <div className="field po-line-sku">
                  <span className="pill">{skuOf(l)}</span>
                </div>
              )}
              <div className="field">
                <label htmlFor={`n${i}`}>{t("product", lang)}</label>
                {/* A datalist, not a select: the buyer types the supplier's
                    name for the goods, and picking a suggestion links the
                    line to that product. Typing something new is equally
                    valid -- it becomes a new product on receipt. */}
                <input id={`n${i}`} value={l.productName} list={`plist${i}`}
                  onChange={(e) => {
                    const name = e.target.value;
                    const hit = products.find((p) => p.name === name);
                    setLine(i, {
                      productName: name,
                      productId: hit ? hit.id : "",
                      catalogCategoryId: hit ? "" : l.catalogCategoryId,
                    });
                  }} required />
                <datalist id={`plist${i}`}>
                  {products.map((p) => <option key={p.id} value={p.name}>{p.ref}</option>)}
                </datalist>
              </div>
              <div className="field">
                <label htmlFor={`c${i}`}>{t("spendCategory", lang)}</label>
                <select id={`c${i}`} value={l.category}
                  onChange={(e) => setLine(i, { category: e.target.value as PoCategory })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{t("cat_" + c, lang)}</option>)}
                </select>
              </div>
              {/* QUANTITY, COST AND PRICE, ALL FOR THIS ONE COMBINATION.
                  The quantity used to be read-only whenever a size grid
                  existed, because the grid decided it. There is no grid:
                  the line is the grid row, so this is simply how many of
                  THIS size and colour are being bought, and it is typed.

                  NOTHING BELOW THESE INPUTS -- the fields on a line are
                  bottom-aligned, so a note under one lifts it above every
                  other box in the row. Notes go on .po-line-note. */}
              <div className="field">
                <label htmlFor={`q${i}`}>{t("quantity", lang)}</label>
                <input id={`q${i}`} type="number" min="0.001" step="any"
                  value={l.qty}
                  onChange={(e) => setLine(i, { qty: e.target.value })} required />
              </div>
              <div className="field">
                <label htmlFor={`u${i}`}>{t("costPrice", lang)}</label>
                <input id={`u${i}`} type="number" min="0" step="any" value={l.unitPrice}
                  onChange={(e) => setLine(i, { unitPrice: e.target.value })} required />
              </div>
              {/* Only a resale line reaches the shop, so only a resale line
                  is asked where it goes and what it sells for. Both are
                  hidden once the line points at an existing product, which
                  already has a category and a price of its own. */}
              {l.category === "goods_for_resale" && !l.productId && (
                <>
                  {/* SHOP CATEGORY, AS TWO DROPDOWNS OVER ONE FIELD.
                      It was a single flat list of every category and every
                      subcategory together, so "Sneakers" sat beside
                      "Kosmétiku" with nothing to say one was inside
                      "Sapatu" and the other was not. Same pair, same rule
                      and same code as the product form: the leaf is what
                      is stored, and it is what the product type hangs
                      off. */}
                  <div className="field">
                    <label htmlFor={`cc${i}`}>{t("shopCategory", lang)}</label>
                    <select id={`cc${i}`} value={rootIdOf(l.catalogCategoryId, categories)}
                      onChange={(e) => refile(i, e.target.value)}>
                      <option value="">{t("uncategorised", lang)}</option>
                      {rootCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  {subCatsOf(l.catalogCategoryId).length > 0 && (
                    <div className="field">
                      <label htmlFor={`sc${i}`}>{t("subcategory", lang)}</label>
                      <select id={`sc${i}`}
                        value={categories.find((c) => c.id === l.catalogCategoryId)?.parent_id
                          ? l.catalogCategoryId : ""}
                        onChange={(e) => refile(i,
                          e.target.value || rootIdOf(l.catalogCategoryId, categories))}>
                        <option value="">{t("none", lang)}</option>
                        {subCatsOf(l.catalogCategoryId).map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="field">
                    <label htmlFor={`sp${i}`}>{t("sellingPrice", lang)}</label>
                    <input id={`sp${i}`} type="number" min="0" step="0.01" value={l.sellPrice}
                      placeholder="0.00"
                      onChange={(e) => setLine(i, { sellPrice: e.target.value })} />
                  </div>
                  {/* WHO THE GOODS ARE FOR, asked once, here, where the
                      buyer already knows. It is copied onto the product at
                      receipt, so the shop never has to open Catalog and
                      answer a question it already answered. */}
                  <div className="field">
                    <label htmlFor={`au${i}`}>{t("whoIsItFor", lang)}</label>
                    <select id={`au${i}`} value={l.audience}
                      onChange={(e) => setLine(i, { audience: e.target.value })}>
                      {/* "" is not a blank to be filled in later -- it is
                          the answer for a fridge, which is not unisex, it
                          is simply not a question that applies. */}
                      <option value="">{t("audienceAnyone", lang)}</option>
                      {AUDIENCES.map((a) => (
                        <option key={a} value={a}>{t(AUDIENCE_KEY[a], lang)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field po-line-desc">
                    <label htmlFor={`ds${i}`}>{t("description", lang)}</label>
                    <textarea id={`ds${i}`} rows={2} value={l.description}
                      placeholder={t("descriptionPoHint", lang)}
                      onChange={(e) => setLine(i, { description: e.target.value })} />
                  </div>
                  {/* WHAT KIND OF THING IS BEING BOUGHT, AND WHAT IT IS.
                      The same picker the product form draws, over the same
                      taxonomy, hanging off the category chosen just above
                      -- so the buyer answers the listing's questions at the
                      moment they are holding the supplier's invoice and
                      know the answers. Receiving copies both onto the
                      product, and the product page, the card and the
                      attribute filters are complete without anybody
                      opening Catalog.

                      A line pointing at an EXISTING product never gets
                      here: that product already has a type and answers of
                      its own, and a restock must not argue with them.

                      idPrefix, because an order restocking two shirts of
                      one type draws every attribute twice and two boxes
                      with one id means both labels point at the first. */}
                  {/* ONLY THE AXES. The product type's other questions --
                      Brand, Fit, Pattern, Season, Neck Type, eleven of
                      them for a t-shirt -- describe the PRODUCT, and a
                      twelve-SKU order asked all fourteen twelve times and
                      got the same eleven answers every time. They are
                      asked once, on the product, which is where they are
                      true. The receipt still gives the product its type,
                      so that form opens with those questions ready.

                      Nothing at all while the split is being set up: the
                      generator below asks for a LIST of sizes, and its
                      boxes beside this line's single-size boxes are two
                      Size fields on one screen meaning different things --
                      which is what made this look duplicated. */}
                  <div className="field po-line-tax">
                    <TaxonomyPicker
                      idPrefix={`${l.key}-`}
                      node={l.catalogCategoryId}
                      value={l.taxonomy}
                      fields={bulk[l.key] ? "none" : "variant"}
                      onChange={(next) => setLine(i, { taxonomy: next })}
                      onAttributes={(attrs) =>
                        setLineAttrs((m) => (m[l.key] === attrs ? m : { ...m, [l.key]: attrs }))}
                      disabled={!canWrite || busy}
                    />
                  </div>

                  {/* ONE MORE OF THE SAME THING, IN ANOTHER COLOUR.
                      The buyer has just said what the product is, where it
                      goes and what type it is; buying it in red as well
                      should not mean saying all of that again. This copies
                      the line and clears the axes, so the only boxes left
                      to fill are the ones that differ -- the colour, the
                      quantity and the price.

                      Beside the split, not instead of it: this is for the
                      second colour and the third, and the generator is for
                      the twelve. */}
                  {l.taxonomy.productTypeId && (
                    <WriteOnly>
                      <div className="field po-line-more">
                        <button type="button" className="btn btn-sm btn-ghost"
                          onClick={() => addLineLike(i)}>+ {t("addLineLike", lang)}</button>
                      </div>
                    </WriteOnly>
                  )}

                  {/* BULK GENERATE, offered only when there is something to
                      split on: a product type with no variant axis has no
                      combinations, and a button that can only say "nothing
                      to split" is a button that should not be there. */}
                  {axesOf(l).length > 0 && (
                    <div className="field po-line-bulk">
                      {!bulk[l.key] ? (
                        <WriteOnly>
                          <button type="button" className="btn btn-sm btn-ghost"
                            onClick={() => setBulk((b) => ({
                              ...b,
                              /* Prefilled with what this line already
                                 answers, so "S" plus two more typed after
                                 it generates S, M and L rather than
                                 throwing the first away. */
                              [l.key]: Object.fromEntries(axesOf(l).map((a) => [
                                a.id, (l.taxonomy.values[a.id] ?? []).join(", "),
                              ])),
                            }))}>
                            {t("bulkGenerate", lang)}
                          </button>
                        </WriteOnly>
                      ) : (
                        <div className="po-bulk">
                          {axesOf(l).map((a) => (
                            <div className="field" key={a.id}>
                              <label htmlFor={`${l.key}-bulk-${a.id}`}>{a.name}</label>
                              <input id={`${l.key}-bulk-${a.id}`}
                                value={bulk[l.key][a.id] ?? ""}
                                placeholder="S, M, L"
                                onChange={(e) => setBulk((b) => ({
                                  ...b, [l.key]: { ...b[l.key], [a.id]: e.target.value },
                                }))} />
                            </div>
                          ))}
                          <div className="po-bulk-go">
                            <button type="button" className="btn btn-sm btn-amber"
                              onClick={() => generateVariants(i)}>
                              {t("bulkGenerateGo", lang)
                                .replace("{n}", String(matrixSize(axesOf(l).map((a) => ({
                                  attributeId: a.id, name: a.name,
                                  values: parseSizes(bulk[l.key][a.id] ?? ""),
                                })))))}
                            </button>
                            <button type="button" className="btn btn-sm btn-ghost"
                              onClick={() => setBulk((b) => {
                                const { [l.key]: _gone, ...rest } = b; return rest;
                              })}>
                              {t("cancel", lang)}
                            </button>
                          </div>
                          <p className="hint">{t("bulkGenerateHint", lang)}</p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
              {l.productId && (
                <>
                  <div className="field">
                    <label>{t("linkedProduct", lang)}</label>
                    <span className="pill ok">{t("existingProduct", lang)}</span>
                  </div>
                  {/* WHY THE REST OF THE LINE HAS GONE. A restock asks none
                      of the questions a new product does, because this
                      product has answered them -- and a buyer watching the
                      category, the price and the fields disappear as they
                      pick a name should be told why rather than left to
                      wonder.

                      ON A ROW OF ITS OWN, like every other note on a line.
                      Inside the field above it made that field taller, and
                      since the line is bottom-aligned it lifted the pill
                      36 pixels clear of every other box in the row --
                      measured, after doing exactly that. */}
                  <div className="field po-line-note">
                    <p className="hint">{t("restockHint", lang)}</p>
                  </div>
                </>
              )}
              <div className="po-line-total">
                <span className="hint">{t("lineTotal", lang)}</span>
                <b className="mono">
                  {((Number(l.qty) || 0) * (Number(l.unitPrice) || 0)).toFixed(2)}
                </b>
              </div>
              <WriteOnly>
                <button className="btn btn-sm btn-danger" type="button"
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}>×</button>
              </WriteOnly>
            </div>
          ))}
        </div>

        <div className="panel">
          <h3>{t("financialInformation", lang)}</h3>
          <div className="two">
            <div className="field">
              <label htmlFor="cur">{t("currency", lang)}</label>
              <select id="cur" value={f.currency}
                onChange={(e) => set({ currency: e.target.value, fxRate: e.target.value === "USD" ? "1" : f.fxRate })}>
                {PO_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="fx">{t("fxRate", lang)}</label>
              <input id="fx" type="number" min="0.000001" step="any" value={f.fxRate}
                disabled={f.currency === "USD"}
                onChange={(e) => set({ fxRate: e.target.value })} />
              <p className="hint">{t("fxRateHint", lang)}</p>
            </div>
          </div>
          <div className="two">
            <div className="field">
              <label htmlFor="tax">{t("taxes", lang)}</label>
              <input id="tax" type="number" min="0" step="any" value={f.tax}
                onChange={(e) => set({ tax: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ship">{t("shippingCost", lang)}</label>
              <input id="ship" type="number" min="0" step="any" value={f.shipping}
                onChange={(e) => set({ shipping: e.target.value })} />
            </div>
          </div>
          <div className="two">
            <div className="field">
              <label htmlFor="disc">{t("discounts", lang)}</label>
              <input id="disc" type="number" min="0" step="any" value={f.discount}
                onChange={(e) => set({ discount: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ps">{t("paymentStatus", lang)}</label>
              <select id="ps" value={f.paymentStatus}
                onChange={(e) => set({ paymentStatus: e.target.value as PoPaymentStatus })}>
                {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{t("pay_" + s, lang)}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="pd">{t("paymentDate", lang)}</label>
            <input id="pd" type="date" value={f.paymentDate}
              onChange={(e) => set({ paymentDate: e.target.value })} />
          </div>

          <div className="kv"><span>{t("subtotal", lang)}</span><b>{subtotal.toFixed(2)} {f.currency}</b></div>
          <div className="kv total"><span>{t("total", lang)}</span><b>{total.toFixed(2)} {f.currency}</b></div>
          {f.currency !== "USD" && (
            <div className="kv"><span>{t("inBaseCurrency", lang)}</span><b>{money(inBase)}</b></div>
          )}
        </div>

        <div className="field">
          <label htmlFor="notes">{t("notes", lang)}</label>
          <textarea id="notes" value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>

        <div className="btn-row">
          <WriteOnly>
            <button className="btn btn-amber" type="submit" disabled={busy}>
              {busy ? "…" : t("save", lang)}
            </button>
          </WriteOnly>
          <Link className="btn btn-ghost" href="/admin/procurement">
            {t(canWrite ? "cancel" : "back", lang)}
          </Link>
          <WriteOnly>
            {po && (
              <button className="btn btn-danger" type="button" disabled={busy} onClick={remove}>
                {t("delete", lang)}
              </button>
            )}
          </WriteOnly>
        </div>
      </form>
    </>
  );
}
