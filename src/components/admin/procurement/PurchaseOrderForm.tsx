"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { savePurchaseOrder, setPurchaseOrderStatus, deletePurchaseOrder } from "@/lib/actions/procurement";
import { PO_CURRENCIES, countryFlag, countryName } from "@/lib/countries";
import { money } from "@/lib/utils";
import {
  PO_STATUSES, deliveryState, poDelayDays, poLeadTime, poQty, poTotal, todayIso,
} from "@/lib/procurement";
import { t } from "@/lib/i18n";
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
}

const blankLine = (): LineDraft => ({
  productName: "", category: "goods_for_resale", qty: "1", unitPrice: "0",
  productId: "", catalogCategoryId: "", sellPrice: "",
});

export default function PurchaseOrderForm({
  lang, suppliers, po, products, categories,
}: {
  lang: Lang; suppliers: Supplier[]; po: PurchaseOrder | null;
  /** The live catalog, so a line can point at a product that already
   * exists rather than creating a duplicate of it on receipt. */
  products: Product[];
  categories: Category[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const today = todayIso();

  const [f, setF] = useState({
    supplierId: po?.supplier_id || suppliers[0]?.id || "",
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
        }))
      : [blankLine()]
  );
  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  // Live totals in the ORDER's currency: the buyer is reading an invoice
  // denominated in it, so showing them a converted figure while they type
  // would mean checking the form against arithmetic they cannot see.
  const subtotal = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
  const total = subtotal + (Number(f.tax) || 0) + (Number(f.shipping) || 0) - (Number(f.discount) || 0);
  const inBase = total * (Number(f.fxRate) || 1);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const id = await savePurchaseOrder({
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
        lines: lines.map((l) => ({
          productName: l.productName, category: l.category,
          qty: Number(l.qty), unitPrice: Number(l.unitPrice),
          productId: l.productId || null,
          catalogCategoryId: l.catalogCategoryId || null,
          sellPrice: l.sellPrice === "" ? null : Number(l.sellPrice),
        })),
      });
      toast(t("saved", lang));
      router.push(`/admin/procurement/po/${id}`);
      router.refresh();
    } catch (err) {
      toast(String((err as Error).message), true);
    }
    setBusy(false);
  }

  async function quickStatus(status: PoStatus) {
    if (!po) return;
    setBusy(true);
    try {
      await setPurchaseOrderStatus(po.id, status);
      toast(t("po_" + status, lang));
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
      router.push("/admin/procurement");
    } catch (err) { toast(String((err as Error).message), true); setBusy(false); }
  }

  const supplier = suppliers.find((s) => s.id === f.supplierId);

  return (
    <>
      <p className="crumb">
        <Link href="/admin/procurement">{t("procurement", lang)}</Link>
        {" / "}{po ? po.po_number : t("newPurchaseOrder", lang)}
      </p>
      <h1>{po ? po.po_number : t("newPurchaseOrder", lang)}</h1>

      {/* Derived delivery facts, for an order that already exists. Read-only:
          every one of them comes from the dates below, so they update when
          the dates do rather than being separately maintained. */}
      {po && (
        <div className="stat stat-fit">
          <div><b>{money(poTotal(po))}</b><span>{t("totalPurchaseValue", lang)}</span></div>
          <div><b>{poQty(po).toLocaleString()}</b><span>{t("quantity", lang)}</span></div>
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
        <div className="btn-row" style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {PO_STATUSES.filter((s) => s !== po.status).map((s) => (
            <button key={s} type="button" className="btn btn-sm btn-ghost" disabled={busy}
              onClick={() => quickStatus(s)}>{t("po_" + s, lang)}</button>
          ))}
        </div>
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
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>{t("lineItems", lang)}</h3>
            <button className="btn btn-sm btn-ghost" type="button"
              onClick={() => setLines((ls) => [...ls, blankLine()])}>+ {t("addLine", lang)}</button>
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
                <input id={`q${i}`} type="number" min="0.001" step="any" value={l.qty}
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
                </>
              )}
              {l.productId && (
                <div className="field">
                  <label>{t("linkedProduct", lang)}</label>
                  <span className="pill ok">{t("existingProduct", lang)}</span>
                </div>
              )}
              <div className="po-line-total">
                <span className="hint">{t("lineTotal", lang)}</span>
                <b className="mono">{((Number(l.qty) || 0) * (Number(l.unitPrice) || 0)).toFixed(2)}</b>
              </div>
              <button className="btn btn-sm btn-danger" type="button"
                disabled={lines.length === 1}
                onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}>×</button>
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
          <button className="btn btn-amber" type="submit" disabled={busy}>
            {busy ? "…" : t("save", lang)}
          </button>
          <Link className="btn btn-ghost" href="/admin/procurement">{t("cancel", lang)}</Link>
          {po && (
            <button className="btn btn-danger" type="button" disabled={busy} onClick={remove}>
              {t("delete", lang)}
            </button>
          )}
        </div>
      </form>
    </>
  );
}
