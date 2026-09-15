"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { savePurchaseOrder, setPurchaseOrderStatus, deletePurchaseOrder } from "@/lib/actions/procurement";
import { PO_CURRENCIES, countryFlag, countryName } from "@/lib/countries";
import { money } from "@/lib/utils";
import {
  PO_STATUSES, deliveryState, parseSizes, poDelayDays, poLeadTime, poQty, poTotal,
  todayIso,
} from "@/lib/procurement";
import { AUDIENCES, AUDIENCE_KEY } from "@/lib/audience";
import { t } from "@/lib/i18n";
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
  productName: string;
  category: PoCategory;
  qty: string;
  unitPrice: string;
  /** An existing catalog product, or "" to create one on receipt. */
  productId: string;
  /** Where a newly created product should sit in the shop. */
  catalogCategoryId: string;
  /** Its shelf price. Unrelated to what it cost, so it is asked for. */
  sellPrice: string;
  /** "S, M, L, XL" as the supplier writes it. */
  sizes: string;
  /** How many of each size, keyed by label. Strings because they are what
   * a text input holds; a half-typed "1" must not become a number and snap
   * back under the cursor. */
  sizeQty: Record<string, string>;
  /** Who the goods are for, copied onto the product at receipt. "" is "not
   * said", which is a real state and not the same as unisex. */
  audience: string;
  description: string;
}

const blankLine = (): LineDraft => ({
  productName: "", category: "goods_for_resale", qty: "1", unitPrice: "0",
  productId: "", catalogCategoryId: "", sellPrice: "", sizes: "",
  sizeQty: {}, audience: "", description: "",
});

/** The sizes a line can be broken down by.
 *
 * Two sources, and which one applies is decided by whether the line points
 * at something that already exists: a NEW product's sizes are whatever the
 * buyer is typing into the sizes box on this very line, and an EXISTING
 * one's are its own -- restocking a t-shirt the shop already sells must
 * offer that shirt's sizes, not invite somebody to invent a second list. */
function sizesForLine(l: LineDraft, products: Product[]): string[] {
  if (l.productId) {
    const p = products.find((x) => x.id === l.productId);
    return (p?.sizes || []).filter(Boolean);
  }
  return parseSizes(l.sizes);
}

/** What the line's quantity becomes once it has a size breakdown.
 *
 * THE BREAKDOWN DECIDES, and the quantity box goes read-only. Two fields
 * that must agree are two fields that will not, and this one sets both the
 * stock and the money. */
function lineUnits(l: LineDraft, sizes: string[]): number {
  if (!sizes.length) return Number(l.qty) || 0;
  return sizes.reduce((n, s) => n + (Math.floor(Number(l.sizeQty[s])) || 0), 0);
}

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
  lang, suppliers, po, products, categories, prefill,
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

  const [lines, setLines] = useState<LineDraft[]>(
    po?.items?.length
      ? po.items.map((i) => ({
          productName: i.product_name, category: i.category,
          qty: String(i.qty), unitPrice: String(i.unit_price),
          productId: i.product_id || "",
          catalogCategoryId: i.catalog_category_id || "",
          sellPrice: i.sell_price == null ? "" : String(i.sell_price),
          sizes: i.sizes || "",
          // Back into strings for the inputs. A stored 0 is dropped rather
          // than shown: an explicit zero and an untouched box mean the
          // same thing here and only one of them looks like a decision.
          sizeQty: Object.fromEntries(
            Object.entries(i.size_qty || {})
              .filter(([, v]) => Number(v) > 0)
              .map(([k, v]) => [k, String(v)])),
          audience: i.audience || "",
          description: i.description || "",
        }))
      : prefilledLines(prefill, products)
  );
  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  // Live totals in the ORDER's currency: the buyer is reading an invoice
  // denominated in it, so showing them a converted figure while they type
  // would mean checking the form against arithmetic they cannot see.
  // Units come from the size breakdown where there is one, so the money
  // agrees with the stock rather than with a quantity box nobody updated.
  const subtotal = lines.reduce(
    (a, l) => a + lineUnits(l, sizesForLine(l, products)) * (Number(l.unitPrice) || 0), 0);
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
          const sizes = sizesForLine(l, products);
          const sizeQty: Record<string, number> = {};
          for (const sz of sizes) {
            const n = Math.floor(Number(l.sizeQty[sz]));
            if (Number.isFinite(n) && n > 0) sizeQty[sz] = n;
          }
          return {
            productName: l.productName, category: l.category,
            // From the breakdown when there is one. The two cannot
            // disagree because only one of them is ever typed.
            qty: lineUnits(l, sizes), unitPrice: Number(l.unitPrice),
            productId: l.productId || null,
            catalogCategoryId: l.catalogCategoryId || null,
            sellPrice: l.sellPrice === "" ? null : Number(l.sellPrice),
            sizes: l.sizes,
            sizeQty,
            audience: l.audience || null,
            description: l.description,
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
      mod.downloadPurchaseOrderPdf(po, suppliers.find((s) => s.id === po.supplier_id));
    } catch {
      toast(t("error", lang), true);
    }
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
          <button type="button" className="btn btn-sm btn-ghost" onClick={downloadPdf}>
            {t("downloadPdf", lang)}
          </button>
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
                onClick={() => setLines((ls) => [...ls, blankLine()])}>+ {t("addLine", lang)}</button>
            </WriteOnly>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="po-line">
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
              <div className="field">
                <label htmlFor={`q${i}`}>{t("quantity", lang)}</label>
                {/* Typed while the line has no size breakdown; READ-ONLY the
                    moment it has one, because then the sizes below decide
                    it. Shown rather than hidden: it is still the number the
                    line total is worked out from, and hiding it would make
                    the money appear from nowhere.

                    NOTHING BELOW THIS INPUT. The fields on a line are
                    bottom-aligned so that a label wrapping onto two lines
                    still leaves the boxes in a row; a note under this one
                    therefore lifted it above every other box on the line.
                    The note now sits under the size grid, which is where
                    the numbers it is talking about are typed. */}
                <input id={`q${i}`} type="number" min="0.001" step="any"
                  value={sizesForLine(l, products).length
                    ? String(lineUnits(l, sizesForLine(l, products)))
                    : l.qty}
                  readOnly={sizesForLine(l, products).length > 0}
                  onChange={(e) => setLine(i, { qty: e.target.value })} required />
              </div>
              <div className="field">
                <label htmlFor={`u${i}`}>{t("unitPrice", lang)}</label>
                <input id={`u${i}`} type="number" min="0" step="any" value={l.unitPrice}
                  onChange={(e) => setLine(i, { unitPrice: e.target.value })} required />
              </div>
              {/* Only a resale line reaches the shop, so only a resale line
                  is asked where it goes and what it sells for. Both are
                  hidden once the line points at an existing product, which
                  already has a category and a price of its own. */}
              {l.category === "goods_for_resale" && !l.productId && (
                <>
                  <div className="field">
                    <label htmlFor={`cc${i}`}>{t("shopCategory", lang)}</label>
                    <select id={`cc${i}`} value={l.catalogCategoryId}
                      onChange={(e) => setLine(i, { catalogCategoryId: e.target.value })}>
                      <option value="">{t("uncategorised", lang)}</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`sp${i}`}>{t("sellPrice", lang)}</label>
                    <input id={`sp${i}`} type="number" min="0" step="0.01" value={l.sellPrice}
                      placeholder="0.00"
                      onChange={(e) => setLine(i, { sellPrice: e.target.value })} />
                  </div>
                  {/* Captured here because this is the moment the buyer
                      knows them. Without it the product created on receipt
                      shows "SIZE —" and a blank description until someone
                      retypes what they just entered on this order. */}
                  <div className="field">
                    <label htmlFor={`sz${i}`}>{t("sizesVariants", lang)}</label>
                    <input id={`sz${i}`} value={l.sizes} placeholder="S, M, L, XL"
                      onChange={(e) => setLine(i, { sizes: e.target.value })} />
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
                </>
              )}
              {l.productId && (
                <div className="field">
                  <label>{t("linkedProduct", lang)}</label>
                  <span className="pill ok">{t("existingProduct", lang)}</span>
                </div>
              )}
              {/* HOW MANY OF EACH SIZE. Shown for any resale line whose
                  sizes are known -- typed above for a new product, or the
                  product's own when the line points at one. This is what
                  reaches the ledger: one movement per size at receipt, so
                  the shop can answer "how many Medium" afterwards. */}
              {l.category === "goods_for_resale"
                && sizesForLine(l, products).length > 0 && (
                <div className="field po-sizes">
                  <label>{t("qtyPerSize", lang)}</label>
                  <div className="po-size-grid">
                    {sizesForLine(l, products).map((sz) => (
                      <label key={sz} className="po-size">
                        <span>{sz}</span>
                        <input type="number" min="0" step="1" inputMode="numeric"
                          value={l.sizeQty[sz] ?? ""}
                          placeholder="0"
                          onChange={(e) => setLine(i, {
                            sizeQty: { ...l.sizeQty, [sz]: e.target.value },
                          })} />
                      </label>
                    ))}
                  </div>
                  <p className="hint">{t("qtyFromSizes", lang)}</p>
                </div>
              )}
              <div className="po-line-total">
                <span className="hint">{t("lineTotal", lang)}</span>
                <b className="mono">
                  {(lineUnits(l, sizesForLine(l, products))
                    * (Number(l.unitPrice) || 0)).toFixed(2)}
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
