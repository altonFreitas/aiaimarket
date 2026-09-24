"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import {
  saveSellerSupplier, saveSellerPurchaseOrder,
  setSellerPurchaseOrderStatus, deleteSellerPurchaseOrder,
} from "@/lib/actions/seller-procurement";
import {
  PO_STATUSES, poQty, poSubtotal, poTotal, isOpen, todayIso,
} from "@/lib/procurement";
import { money } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Lang, PoStatus, PurchaseOrder, Supplier } from "@/lib/types";

/* A store's own buying, on one screen.
 *
 * DELIBERATELY NOT THE OWNER'S PROCUREMENT SUITE. That is five screens --
 * a dashboard, supplier performance, a reorder plan, landed-cost analysis,
 * spend by country -- because the marketplace buys from a dozen countries
 * in four currencies. A store restocking its own shelves is asking three
 * questions: what have I ordered, has it come, and what did it cost. So it
 * is one page: the orders, a form to add one, and the suppliers behind
 * them.
 *
 * WHAT IT SHARES WITH THE OWNER'S is everything that matters -- the same
 * tables, the same validation, the same refusal to edit an order whose
 * goods have already landed, and the same receipt, which puts the units on
 * this store's shelf and creates this store's own listing for anything it
 * had never sold before (lib/purchasing.ts, lib/receiving.ts).
 */

/* `key` IS NOT DATA, it is which row this is.
   The list is keyed by it rather than by position because a row can now
   be removed from the middle. React matches old rows to new ones by key,
   so with the position as the key, deleting the first of three tells it
   row 2 became row 1 -- the same node, with different contents -- and
   anything the node itself owns rather than the state, the caret and the
   selection above all, stays where it was while the words under it change. */
interface Line { key: string; productName: string; qty: string; unitPrice: string; sellPrice: string }

const blankLine = (key: string): Line =>
  ({ key, productName: "", qty: "1", unitPrice: "", sellPrice: "" });

export default function SellerProcurement({
  lang, suppliers, orders,
}: { lang: Lang; suppliers: Supplier[]; orders: PurchaseOrder[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"orders" | "suppliers">("orders");

  const active = useMemo(() => suppliers.filter((s) => s.active), [suppliers]);

  // ---- the numbers at the top -------------------------------------------
  const open = orders.filter(isOpen);
  const onOrder = open.reduce((a, po) => a + poQty(po), 0);
  const spend = orders
    .filter((po) => po.status !== "cancelled")
    .reduce((a, po) => a + poTotal(po), 0);

  // ---- new order ---------------------------------------------------------
  const [supplierId, setSupplierId] = useState("");
  const [orderDate, setOrderDate] = useState(todayIso());
  const [expected, setExpected] = useState("");
  /* Counted in a ref, not derived from the length: two lines added and
     the first removed would otherwise hand the new line the key the
     removed one had. Read only in an event handler -- reading a ref while
     rendering is what react-hooks/refs forbids, and what would make the
     same row render under two different keys on the server and the client. */
  const seq = useRef(0);
  const [lines, setLines] = useState<Line[]>([blankLine("i0")]);
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  const draftTotal = lines.reduce(
    (a, l) => a + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);

  async function run(fn: () => Promise<unknown>, done?: () => void) {
    setBusy(true);
    try {
      await fn();
      done?.();
      router.refresh();
    } catch (e) { toast(String((e as Error).message), true); }
    setBusy(false);
  }

  function createOrder(e: React.FormEvent) {
    e.preventDefault();
    const filled = lines.filter((l) => l.productName.trim());
    if (!supplierId || !filled.length) return;
    run(() => saveSellerPurchaseOrder({
      supplierId,
      orderDate,
      expectedArrival: expected || null,
      status: "draft",
      paymentStatus: "unpaid",
      lines: filled.map((l) => ({
        productName: l.productName.trim(),
        // Everything a store orders through this screen is stock it means
        // to sell -- which is what makes the receipt put it on the shelf.
        // The owner's form offers the other seven categories because the
        // marketplace also buys office chairs; a seller restocking does not.
        category: "goods_for_resale" as const,
        qty: Number(l.qty) || 0,
        unitPrice: Number(l.unitPrice) || 0,
        sellPrice: l.sellPrice === "" ? null : Number(l.sellPrice),
      })),
    }), () => {
      setLines([blankLine("i0")]);
      setExpected("");
      toast(t("saved", lang));
    });
  }

  // ---- new supplier ------------------------------------------------------
  const [supName, setSupName] = useState("");
  const [supPhone, setSupPhone] = useState("");
  const [supCountry, setSupCountry] = useState("");

  function createSupplier(e: React.FormEvent) {
    e.preventDefault();
    if (!supName.trim()) return;
    run(() => saveSellerSupplier({
      name: supName, countryCode: supCountry, phone: supPhone,
    }), () => {
      setSupName(""); setSupPhone(""); setSupCountry("");
      toast(t("saved", lang));
    });
  }

  return (
    <>
      <h1>{t("sellerProcurement", lang)}</h1>
      <p className="sub">{t("sellerProcurementIntro", lang)}</p>

      <div className="stat stat-fit">
        <div><b>{open.length}</b><span>{t("poOpenOrders", lang)}</span></div>
        <div><b>{onOrder}</b><span>{t("poOnOrder", lang)}</span></div>
        <div><b>{money(spend)}</b><span>{t("poSpend", lang)}</span></div>
      </div>

      <div className="msheet-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "orders"}
          className={"msheet-tab" + (tab === "orders" ? " is-on" : "")}
          onClick={() => setTab("orders")}>{t("purchaseOrders", lang)}</button>
        <button type="button" role="tab" aria-selected={tab === "suppliers"}
          className={"msheet-tab" + (tab === "suppliers" ? " is-on" : "")}
          onClick={() => setTab("suppliers")}>{t("suppliers", lang)}</button>
      </div>

      {tab === "orders" && (
        <>
          {active.length === 0 ? (
            // Nothing to order FROM. Said plainly rather than showing a
            // form whose first field has no options in it.
            <div className="empty"><p>{t("poNoSuppliers", lang)}</p></div>
          ) : (
            <div className="panel">
              <h3>{t("poNewOrder", lang)}</h3>
              <form onSubmit={createOrder} noValidate>
                <div className="two">
                  <div className="field">
                    <label htmlFor="poSupplier">{t("supplier", lang)}</label>
                    <select id="poSupplier" value={supplierId} required
                      onChange={(e) => setSupplierId(e.target.value)}>
                      <option value="">—</option>
                      {active.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="poDate">{t("orderDate", lang)}</label>
                    <input id="poDate" type="date" value={orderDate}
                      onChange={(e) => setOrderDate(e.target.value)} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="poExpected">{t("expectedArrival", lang)}</label>
                  <input id="poExpected" type="date" value={expected}
                    onChange={(e) => setExpected(e.target.value)} />
                </div>

                <p className="crumb">{t("poLines", lang)}</p>
                {lines.map((l, i) => (
                  <div className="po-line-4" key={l.key}>
                    <input aria-label={t("product", lang)} placeholder={t("product", lang)}
                      value={l.productName}
                      onChange={(e) => setLine(i, { productName: e.target.value })} />
                    <input aria-label={t("qty", lang)} inputMode="numeric" placeholder={t("qty", lang)}
                      value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                    {/* THE SAME TWO WORDS THE OWNER'S FORM USES. They
                        were "Unit price" and "Sell price" here and "Cost
                        price" and "Selling price" there, for the identical
                        pair of columns -- so a store owner who uses both
                        screens had to work out that they meant the same
                        thing. */}
                    <input aria-label={t("costPrice", lang)} inputMode="decimal"
                      placeholder={t("costPrice", lang)}
                      value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} />
                    <input aria-label={t("sellingPrice", lang)} inputMode="decimal"
                      placeholder={t("sellingPrice", lang)}
                      value={l.sellPrice} onChange={(e) => setLine(i, { sellPrice: e.target.value })} />
                    {/* A WAY BACK OUT. There was an "add line" and nothing
                        to undo it, so a line typed by mistake could only be
                        got rid of by reloading the page and starting the
                        order again. Disabled on the last one: an order with
                        no lines is not an order. */}
                    <button type="button" className="btn btn-sm btn-danger"
                      aria-label={t("del", lang)} title={t("del", lang)}
                      disabled={lines.length === 1}
                      onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}>×</button>
                  </div>
                ))}
                {/* Not .btn-row: that stacks and stretches its buttons to
                    full width, which is right for a form's final actions
                    and wrong for "add another line" sitting beside a
                    running total. */}
                <div className="po-line-foot">
                  <button type="button" className="btn btn-ghost btn-sm"
                    onClick={() => setLines((ls) => [...ls, blankLine(`n${++seq.current}`)])}>
                    {t("poAddLine", lang)}
                  </button>
                  <span className="count">{money(draftTotal)}</span>
                </div>
                <button className="btn btn-amber btn-sm" type="submit"
                  disabled={busy || !supplierId || !lines.some((l) => l.productName.trim())}>
                  {busy ? "…" : t("save", lang)}
                </button>
              </form>
            </div>
          )}

          {orders.length === 0 ? (
            <div className="empty"><p>{t("poNoOrders", lang)}</p></div>
          ) : (
            <div className="panel">
              <h3>{t("purchaseOrders", lang)}</h3>
              <div className="list">
                {orders.map((po) => (
                  <div className="item" key={po.id}>
                    <div className="g">
                      <b>{po.po_number}</b>
                      <span className="hint">
                        {po.order_date} · {poQty(po)} · {money(poSubtotal(po))}
                        {po.expected_arrival ? ` · ${po.expected_arrival}` : ""}
                      </span>
                    </div>
                    <div className="acts">
                      <select value={po.status} disabled={busy}
                        aria-label={t("status", lang)}
                        onChange={(e) => run(() =>
                          setSellerPurchaseOrderStatus(po.id, e.target.value as PoStatus))}>
                        {PO_STATUSES.map((s) => (
                          <option key={s} value={s}>{t("po_" + s, lang)}</option>
                        ))}
                      </select>
                      {/* Moving to "received" is what puts the units on the
                          shelf, so it is also offered as a plain button --
                          a status dropdown does not read as an action. */}
                      {po.status !== "received" && po.status !== "cancelled" && (
                        <button type="button" className="btn btn-sm btn-amber" disabled={busy}
                          onClick={() => run(() => setSellerPurchaseOrderStatus(po.id, "received"))}>
                          {t("poReceiveToStock", lang)}
                        </button>
                      )}
                      {po.status === "draft" && (
                        <button type="button" className="btn btn-sm btn-ghost" disabled={busy}
                          onClick={() => run(() => deleteSellerPurchaseOrder(po.id))}>
                          {t("del", lang)}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {tab === "suppliers" && (
        <>
          <div className="panel">
            <h3>{t("poSupplierNew", lang)}</h3>
            <form onSubmit={createSupplier} noValidate>
              <div className="field">
                <label htmlFor="supName">{t("name", lang)}</label>
                <input id="supName" value={supName} required
                  onChange={(e) => setSupName(e.target.value)} />
              </div>
              <div className="two">
                <div className="field">
                  <label htmlFor="supPhone">{t("phone", lang)}</label>
                  <input id="supPhone" value={supPhone}
                    onChange={(e) => setSupPhone(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="supCountry">{t("country", lang)}</label>
                  <input id="supCountry" value={supCountry} maxLength={2} placeholder="ID, CN, PT"
                    onChange={(e) => setSupCountry(e.target.value.toUpperCase())} />
                </div>
              </div>
              <button className="btn btn-amber btn-sm" type="submit" disabled={busy || !supName.trim()}>
                {busy ? "…" : t("save", lang)}
              </button>
            </form>
          </div>

          {suppliers.length > 0 && (
            <div className="panel">
              <h3>{t("suppliers", lang)}</h3>
              <div className="list">
                {suppliers.map((s) => (
                  <div className="item" key={s.id}>
                    <div className="g">
                      <b>{s.name}</b>
                      <span className="hint">
                        {[s.country_code, s.phone].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
