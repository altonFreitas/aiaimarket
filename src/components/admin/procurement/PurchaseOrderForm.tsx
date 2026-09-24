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
  PO_STATUSES, deliveryState, poDelayDays, poLeadTime, poQty, poTotal,
  todayIso,
} from "@/lib/procurement";
import { AUDIENCES, AUDIENCE_KEY } from "@/lib/audience";
import { t } from "@/lib/i18n";
import TaxonomyPicker from "../TaxonomyPicker";
import AttributeField from "../AttributeField";
import type { FormAttribute } from "@/lib/taxonomy/types";
import WriteOnly, { useCanWrite } from "../Access";
import type {
  Category, Lang, PoCategory, PoPaymentStatus, PoStatus, Product, PurchaseOrder,
  PurchaseOrderItem, Supplier,
} from "@/lib/types";

/* Goods bought to sell on come first, and are the default: for a shop, that
 * is most purchases. It is also the only category that reaches stock and the
 * catalog -- the others are real spending that never belonged in the shop. */
const CATEGORIES: PoCategory[] = [
  "goods_for_resale",
  "raw_materials", "components", "packaging", "office", "equipment", "services", "other",
];
const PAYMENT_STATUSES: PoPaymentStatus[] = ["unpaid", "partial", "paid", "overdue"];

/* ONE LINE IS ONE PRODUCT; ITS ROWS ARE THE THINGS ACTUALLY BOUGHT.
 *
 * It was one line per SKU, which made the money right -- a 45 costs more
 * to buy than a 38 and sells for more -- and made the screen repeat
 * itself: twelve rows each carrying the product's name, its category, its
 * description and its type, identical every time, with one size box
 * telling them apart.
 *
 * So the line is split. The HEADER says what the goods are, once. Each ROW
 * says which one and what it cost, and each row becomes one
 * purchase_order_items row on save, so nothing downstream changes: the
 * ledger, the receipt and the variants all still see one row per SKU.
 */
interface VariantRow {
  /** Stable for React and for the ids this row draws -- see the note on
   * the key counter below. */
  key: string;
  /** The answers to the product type's variant axes: {attrId: ["41,5"]}.
   * What makes this row the SKU it is. */
  values: Record<string, string[]>;
  qty: string;
  /** What the supplier charges for THIS one. */
  unitPrice: string;
  /** What the shop will sell THIS one for. */
  sellPrice: string;
  /** Who the goods are for. "" is "not said", which is a real state and
   * not the same as unisex. */
  audience: string;
}

interface LineDraft {
  key: string;
  /* ---- the header: true of every row under it ---- */
  productName: string;
  category: PoCategory;
  /** An existing catalog product, or "" to create one on receipt. */
  productId: string;
  /** Where a newly created product should sit in the shop. */
  catalogCategoryId: string;
  description: string;
  /** What kind of thing this line buys. Asked once: every row under it
   * buys the same kind, which is what makes them one line. */
  productTypeId: string;
  /** What the header amounted to when this line was read back from a saved
   * order, so consecutive rows could be grouped under it. Absent on a line
   * the buyer is typing now -- it is only ever used at that one moment. */
  headerKey?: string;
  /* ---- the body ---- */
  rows: VariantRow[];
}

const blankRow = (): VariantRow => ({
  key: "", values: {}, qty: "1", unitPrice: "0", sellPrice: "", audience: "",
});

const blankLine = (): LineDraft => ({
  key: "",
  productName: "", category: "goods_for_resale",
  productId: "", catalogCategoryId: "", description: "",
  productTypeId: "",
  rows: [blankRow()],
});

/** What a whole line comes to: every row's own quantity at its own cost. */
function lineTotal(l: LineDraft): number {
  return l.rows.reduce(
    (a, r) => a + (Number(r.qty) || 0) * (Number(r.unitPrice) || 0), 0);
}

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
    const line = blankLine();
    return [{ ...line, productId: p.id, productName: p.name,
              rows: [{ ...line.rows[0], qty: String(qty) }] }];
  });
  return lines.length ? lines : [blankLine()];
}

/* AN ORDER READ BACK, REGROUPED.
 *
 * purchase_order_items is flat: one row per SKU, which is what the ledger
 * and the receipt want. The form is not -- it shows one header and its
 * rows -- so opening a saved order has to put the rows back under the
 * headers they came from.
 *
 * Grouped on what the header holds: the product name, the shop category,
 * the product type and the description. Two lines that agree on all four
 * ARE one line, because there is nothing left for them to disagree about;
 * two that differ on any of them are two products and stay apart. Only
 * CONSECUTIVE rows are joined, because the order they were written in is
 * the order the buyer typed them in, and reordering somebody's purchase
 * order to tidy it is not this function's business.
 */
function groupItems(items: PurchaseOrderItem[]): LineDraft[] {
  const out: LineDraft[] = [];
  let n = 0;
  const headerOf = (i: PurchaseOrderItem) => [
    i.product_name, i.category, i.product_id ?? "",
    i.catalog_category_id ?? "", i.product_type_id ?? "", i.description ?? "",
  ].join("\u0000");

  for (const i of items) {
    const row: VariantRow = {
      key: `i${n++}`,
      values: i.attribute_values ?? {},
      qty: String(i.qty),
      unitPrice: String(i.unit_price),
      sellPrice: i.sell_price == null ? "" : String(i.sell_price),
      audience: i.audience || "",
    };
    const last = out.at(-1);
    if (last && last.headerKey === headerOf(i)) { last.rows.push(row); continue; }
    out.push({
      key: `i${n++}`,
      headerKey: headerOf(i),
      productName: i.product_name,
      category: i.category,
      productId: i.product_id || "",
      catalogCategoryId: i.catalog_category_id || "",
      description: i.description || "",
      productTypeId: i.product_type_id || "",
      rows: [row],
    });
  }
  return out.length ? out : [blankLine()];
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
  const newLine = (): LineDraft => {
    const l = blankLine();
    // Its row needs one too, or every id that row draws is a bare suffix.
    return { ...l, key: nextKey(), rows: l.rows.map((r) => ({ ...r, key: nextKey() })) };
  };

  /* KEYED BY POSITION, NOT BY A COUNTER, for the lines this form OPENS
     with: the same walk happens on the server and in the browser, so the
     ids built from these keys match in both documents. Lines and rows
     added afterwards only ever happen in the browser and come from the
     counter, under a prefix that cannot collide. */
  const [lines, setLines] = useState<LineDraft[]>(() =>
    (po?.items?.length ? groupItems(po.items) : prefilledLines(prefill, products))
      .map((l, n) => ({
        ...l,
        key: l.key || `i${n}`,
        rows: l.rows.map((r, m) => ({ ...r, key: r.key || `i${n}r${m}` })),
      })));

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  const setRow = (i: number, ri: number, patch: Partial<VariantRow>) =>
    setLines((ls) => ls.map((l, n) => (n === i
      ? { ...l, rows: l.rows.map((r, m) => (m === ri ? { ...r, ...patch } : r)) }
      : l)));

  /** One more of the same product, in another colour.
   *
   * The row is copied rather than blanked: the second colour is usually
   * bought in the same numbers at the same cost, and correcting three
   * boxes is faster than typing six. What is cleared is the combination
   * itself -- this row exists to be a different one.
   *
   * The header is not touched at all, which is the point of the split. */
  function addRow(i: number) {
    const from = lines[i].rows.at(-1) ?? blankRow();
    setLines((ls) => ls.map((l, n) => (n === i
      ? { ...l, rows: [...l.rows, { ...from, key: nextKey(), values: {} }] }
      : l)));
  }

  function removeRow(i: number, ri: number) {
    setLines((ls) => ls.map((l, n) => (n === i
      ? { ...l, rows: l.rows.filter((_, m) => m !== ri) }
      : l)));
  }

  /* WHAT EACH LINE'S PRODUCT TYPE ASKS FOR, kept by line key rather than
     by index -- generating variants replaces one line with twelve, and an
     index-keyed cache would hand eleven of them the wrong questions.
     Handed up by the picker as it loads them, so bulk generate knows which
     attributes are the axes without a second round trip. */
  const [lineAttrs, setLineAttrs] = useState<Record<string, FormAttribute[]>>({});
  const axesOf = (l: LineDraft) => (lineAttrs[l.key] ?? []).filter((a) => a.is_variant);

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
  function refile(i: number, categoryId: string) {
    setLines((ls) => ls.map((l, n) => (n === i
      ? {
          ...l, catalogCategoryId: categoryId,
          ...(categoryId === l.catalogCategoryId ? {} : {
            productTypeId: "",
            // The answers went with the type: they answered questions the
            // new branch never asks.
            rows: l.rows.map((r) => ({ ...r, values: {} })),
          }),
        }
      : l)));
  }

  // Live totals in the ORDER's currency: the buyer is reading an invoice
  // denominated in it, so showing them a converted figure while they type
  // would mean checking the form against arithmetic they cannot see.
  // Units come from the size breakdown where there is one, so the money
  // agrees with the stock rather than with a quantity box nobody updated.
  const subtotal = lines.reduce((a, l) => a + lineTotal(l), 0);
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
        /* FLATTENED BACK OUT. The form shows one header and its rows;
           purchase_order_items is one row per SKU, which is what the
           ledger, the receipt and the variants all read. The header is
           repeated onto each row on the way out and regrouped under it on
           the way back in -- see groupItems. */
        lines: lines.flatMap((l) => l.rows.map((r) => ({
          productName: l.productName, category: l.category,
          qty: Number(r.qty), unitPrice: Number(r.unitPrice),
          productId: l.productId || null,
          catalogCategoryId: l.catalogCategoryId || null,
          sellPrice: r.sellPrice === "" ? null : Number(r.sellPrice),
          audience: r.audience || null,
          description: l.description,
          /* Sent for every row; the server clears both on anything that is
             not goods for resale, because an office chair the shop sits on
             is a real purchase and never a product. */
          productTypeId: l.productTypeId || null,
          attributeValues: r.values,
        }))),
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
              {/* ---- THE HEADER: what the goods ARE ---- */}
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

              {/* Only a resale line reaches the shop, so only a resale line
                  is asked where it goes. Hidden once the line points at an
                  existing product, which has a category of its own. */}
              {l.category === "goods_for_resale" && !l.productId && (
                <>
                  {/* SHOP CATEGORY, AS TWO DROPDOWNS OVER ONE FIELD -- the
                      same pair, the same rule and the same code as the
                      product form. The leaf is what is stored, and it is
                      what the product type hangs off. */}
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
                  <div className="field po-line-desc">
                    <label htmlFor={`ds${i}`}>{t("description", lang)}</label>
                    <textarea id={`ds${i}`} rows={2} value={l.description}
                      placeholder={t("descriptionPoHint", lang)}
                      onChange={(e) => setLine(i, { description: e.target.value })} />
                  </div>

                  {/* THE PRODUCT TYPE, WHICH IS ALSO THE HEADER'S.
                      Every row below buys the same kind of thing -- that is
                      what makes them one line -- so it is asked once, and
                      this is where the row's questions are loaded from. */}
                  <div className="field po-line-tax">
                    <TaxonomyPicker
                      idPrefix={`${l.key}-`}
                      node={l.catalogCategoryId}
                      value={{ productTypeId: l.productTypeId, values: {} }}
                      fields="none"
                      onChange={(next) => setLine(i, { productTypeId: next.productTypeId })}
                      onAttributes={(attrs) =>
                        setLineAttrs((m) => (m[l.key] === attrs ? m : { ...m, [l.key]: attrs }))}
                      disabled={!canWrite || busy}
                    />
                  </div>
                </>
              )}
              {l.productId && (
                <>
                  <div className="field">
                    <label>{t("linkedProduct", lang)}</label>
                    <span className="pill ok">{t("existingProduct", lang)}</span>
                  </div>
                  {/* ON A ROW OF ITS OWN, like every other note on a line:
                      inside the field above it made that field taller, and
                      since the line is bottom-aligned it lifted the pill 36
                      pixels clear of every other box -- measured. */}
                  <div className="field po-line-note">
                    <p className="hint">{t("restockHint", lang)}</p>
                  </div>
                </>
              )}

              {/* ---- THE BODY: one row per thing actually bought ----
                  Size, colour and material say WHICH one; the quantity,
                  the cost and the price say what was bought of it and for
                  how much. All six repeat, because all six differ between
                  a 38 and a 45 of the same shoe -- which is the whole
                  reason a line is not a product any more.

                  Above them, in the header, is everything that does not
                  differ. "+ Add line (same product)" copies a row and not
                  the header, so buying the same shoe in red is one row
                  rather than a second line saying everything twice. */}
              <div className="field po-rows">
                {l.rows.map((r, ri) => (
                  <div key={r.key} className="po-row">
                    {axesOf(l).map((a) => (
                      <AttributeField
                        key={a.id}
                        idPrefix={`${r.key}-`}
                        attr={a}
                        value={r.values[a.id] ?? []}
                        onChange={(next: string[]) => setRow(i, ri, {
                          values: { ...r.values, [a.id]: next },
                        })}
                        disabled={!canWrite || busy}
                      />
                    ))}
                    <div className="field">
                      <label htmlFor={`${r.key}-q`}>{t("quantity", lang)}</label>
                      <input id={`${r.key}-q`} type="number" min="0.001" step="any"
                        value={r.qty}
                        onChange={(e) => setRow(i, ri, { qty: e.target.value })} required />
                    </div>
                    <div className="field">
                      <label htmlFor={`${r.key}-u`}>{t("costPrice", lang)}</label>
                      <input id={`${r.key}-u`} type="number" min="0" step="any"
                        value={r.unitPrice}
                        onChange={(e) => setRow(i, ri, { unitPrice: e.target.value })} required />
                    </div>
                    {l.category === "goods_for_resale" && !l.productId && (
                      <div className="field">
                        <label htmlFor={`${r.key}-sp`}>{t("sellingPrice", lang)}</label>
                        <input id={`${r.key}-sp`} type="number" min="0" step="0.01"
                          value={r.sellPrice} placeholder="0.00"
                          onChange={(e) => setRow(i, ri, { sellPrice: e.target.value })} />
                      </div>
                    )}
                    {l.category === "goods_for_resale" && !l.productId && (
                      <div className="field">
                        <label htmlFor={`${r.key}-au`}>{t("whoIsItFor", lang)}</label>
                        <select id={`${r.key}-au`} value={r.audience}
                          onChange={(e) => setRow(i, ri, { audience: e.target.value })}>
                          {/* "" is not a blank to be filled in later -- it
                              is the answer for a fridge, which is not
                              unisex, it is simply not a question that
                              applies. */}
                          <option value="">{t("audienceAnyone", lang)}</option>
                          {AUDIENCES.map((a) => (
                            <option key={a} value={a}>{t(AUDIENCE_KEY[a], lang)}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="po-row-total">
                      <span className="hint">{t("lineTotal", lang)}</span>
                      <b className="mono">
                        {((Number(r.qty) || 0) * (Number(r.unitPrice) || 0)).toFixed(2)}
                      </b>
                    </div>
                    <WriteOnly>
                      <button className="btn btn-sm btn-danger" type="button"
                        disabled={l.rows.length === 1}
                        onClick={() => removeRow(i, ri)}>×</button>
                    </WriteOnly>
                  </div>
                ))}
              </div>

              {l.category === "goods_for_resale" && !l.productId && l.productTypeId && (
                <WriteOnly>
                  <div className="field po-line-more">
                    <button type="button" className="btn btn-sm btn-ghost"
                      onClick={() => addRow(i)}>+ {t("addLineLike", lang)}</button>
                  </div>
                </WriteOnly>
              )}

              <div className="po-line-total">
                <span className="hint">{t("subtotal", lang)}</span>
                <b className="mono">{lineTotal(l).toFixed(2)}</b>
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
