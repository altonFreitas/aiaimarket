import type { jsPDF } from "jspdf";
import { money, nowIso } from "@/lib/utils";
import { taxWasIncluded } from "@/lib/tax";
import { taxRateAsPercent } from "@/lib/money";
import { convert } from "@/lib/fx";
import type { Order, Settings } from "@/lib/types";

/* ONE SHAPE FOR EVERY PIECE OF PAPER THIS SHOP ISSUES.
 *
 * The customer's invoice and the delivery note that travels with the parcel
 * were two different documents describing the same sale in two different
 * layouts, and neither showed the tax. A customer comparing them could not
 * tell they were the same order.
 *
 * The shape is the one a till receipt uses everywhere it has to stand up as
 * a tax document:
 *
 *     who sold it, and under what registration
 *     what the document is, its number, and when
 *     who bought it
 *     the lines, each with its rate
 *     subtotal, discount, delivery, tax, total
 *     what was paid, and how
 *     the tax summary: rate, base, tax, total
 *
 * THE TAX SUMMARY AT THE FOOT IS THE POINT OF THE EXERCISE. It states the
 * base the tax was charged on, separately from the tax, so the figures can
 * be checked by somebody who was not there -- an accountant, or an auditor.
 * A total with tax folded invisibly into it cannot be checked at all.
 *
 * WHAT THIS DOES NOT DO: claim a certification it does not have. A
 * Portuguese fatura carries a line naming the certified program that issued
 * it, and printing one here would be a false statement about software that
 * has been through no such process. The shop's own registration number is
 * printed because the shop supplied it; nothing else is asserted.
 */

const MUTED = 130;

export interface FiscalOptions {
  /** "INVOICE", "DELIVERY NOTE" -- what this piece of paper is. */
  title: string;
  /** A per-download reference printed on the document itself, distinct from
   * the order ref, so two prints of one order can be told apart. */
  docId: string;
}

/** What the tax summary states, worked out from the order's own figures.
 *
 * `base` is what the tax was charged ON. It is not the subtotal: the
 * delivery fee is taxed with the goods, and when prices are tax-inclusive
 * the base is what is left after the tax is taken back out.
 */
export function taxSummary(o: Order): {
  rate: number; base: number; tax: number; total: number; included: boolean;
} {
  const tax = Number(o.tax) || 0;
  const goods = (Number(o.subtotal) || 0) + (Number(o.fee) || 0);
  const included = taxWasIncluded(o);
  const base = Math.round((included ? goods - tax : goods) * 100) / 100;
  return {
    // The rate frozen on the order, not the shop's rate today: a shop that
    // changes its rate in March must not restate what it charged in
    // February. Derived from the figures when the column is absent.
    rate: o.tax_rate != null ? Number(o.tax_rate)
      : base > 0 ? Math.round((tax / base) * 1e4) / 1e4 : 0,
    base,
    tax: Math.round(tax * 100) / 100,
    total: Math.round((Number(o.total) || 0) * 100) / 100,
    included,
  };
}

/** The shop's own heading: who issued this, and under what registration. */
export function fiscalHeader(
  doc: jsPDF, o: Order, settings: Settings | undefined,
  x: number, right: number, startY: number, opts: FiscalOptions
): number {
  let y = startY;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  // READ FROM SETTINGS. This said "Loja AIAI" in the source, so a shop that
  // renamed itself went on issuing paper in the old name.
  doc.text(settings?.store_name || "", x, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  for (const line of [
    settings?.legal_address || "",
    settings?.legal_registration ? `Reg. no: ${settings.legal_registration}` : "",
    [settings?.suku, settings?.post, settings?.municipality].filter(Boolean).join(", "),
    settings?.wa_number || "",
  ].filter(Boolean)) {
    y += 12;
    doc.text(line, x, y);
  }
  doc.setTextColor(0);

  // What this document is, on the right, where a filing clerk looks.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(opts.title, right, startY, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text(o.ref, right, startY + 13, { align: "right" });
  doc.text(nowIso(o.created_at), right, startY + 25, { align: "right" });
  doc.text(`Doc ID: ${opts.docId}`, right, startY + 37, { align: "right" });
  doc.setTextColor(0);

  y = Math.max(y, startY + 37) + 14;
  doc.setDrawColor(210);
  doc.line(x, y, right, y);
  return y;
}

/** Who bought it. */
export function fiscalCustomer(
  doc: jsPDF, o: Order, x: number, right: number, startY: number
): number {
  let y = startY + 18;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(o.buyer_name || "", x, y);
  doc.setFont("helvetica", "normal");
  doc.text(o.buyer_phone || "", right, y, { align: "right" });
  y += 12;
  doc.setDrawColor(230);
  doc.line(x, y, right, y);
  return y;
}

/** The lines, each carrying the rate it was taxed at, then the totals and
 * the tax summary. Returns the y it finished at. */
export function fiscalBody(
  doc: jsPDF, o: Order, settings: Settings | undefined,
  x: number, right: number, startY: number
): number {
  const sum = taxSummary(o);
  /* THE RATE THIS ORDER WAS QUOTED AT, not today's.
     The figures stored on the order are dollars; fx_rate is what one of
     them was worth in the display currency at the moment it was placed. An
     invoice reprinted next year has to show the euros the customer agreed
     to, not the euros a dollar buys that afternoon. */
  const code = o.currency || settings?.display_currency || undefined;
  const rate = Number(o.fx_rate) > 0 ? Number(o.fx_rate) : 1;
  const cash = (n: number | string) =>
    money(convert(Number(n) || 0, rate), code ?? undefined);
  const taxLabel = (settings?.tax_label || "").trim() || "Tax";
  const pct = taxRateAsPercent(sum.rate);

  /* FIVE COLUMNS: what it is, how many, at what price, the rate, the money.
     Qty and Price were one column reading "1 x $45.00", which is how a
     phone receipt saves width -- on A4 it just makes both figures harder to
     scan down, and neither column can be added up by eye. */
  const colQty = right - 300;
  const colPrice = right - 230;
  const colRate = right - 120;
  let y = startY + 22;

  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  doc.text("PRODUCT", x, y);
  doc.text("QTY", colQty, y, { align: "right" });
  doc.text("PRICE", colPrice, y, { align: "right" });
  doc.text(`% ${taxLabel.toUpperCase()}`, colRate, y, { align: "right" });
  doc.text("TOTAL", right, y, { align: "right" });
  doc.setTextColor(0);

  y += 6;
  doc.setDrawColor(210);
  doc.line(x, y, right, y);

  doc.setFontSize(10);
  for (const item of o.items || []) {
    y += 18;
    if (y > 740) { doc.addPage(); y = 54; }
    const label = item.name + (item.size ? ` (${item.size})` : "");
    doc.text(label, x, y, { maxWidth: colQty - x - 16 });
    doc.text(String(item.qty), colQty, y, { align: "right" });
    doc.text(cash(item.price), colPrice, y, { align: "right" });
    // Every line carries the same rate -- the shop's -- and it is printed
    // per line anyway, because that is what makes the summary at the foot
    // checkable against the lines above it.
    doc.text(pct ? String(pct) : "0", colRate, y, { align: "right" });
    doc.text(cash(item.price * item.qty), right, y, { align: "right" });
  }

  y += 12;
  doc.line(x, y, right, y);

  /** One right-aligned figure with its label, for the totals block. */
  const row = (label: string, value: string, bold = false, size = 10) => {
    y += bold ? 20 : 16;
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.text(label, colRate, y, { align: "right" });
    doc.text(value, right, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
  };

  row("Subtotal", cash(o.subtotal));
  // Only when there is one. A "Discount 0.00" line invites the reader to
  // look for something that is not there.
  const discount = Number((o as { discount?: number | null }).discount) || 0;
  if (discount > 0) row("Discount", `-${cash(discount)}`);
  if (Number(o.fee) > 0 || o.quote_requested) {
    row("Delivery", o.quote_requested ? "On request" : cash(Number(o.fee)));
  }
  if (sum.tax > 0) {
    row(`${taxLabel}${pct ? ` (${pct}%)` : ""}${sum.included ? " — included" : ""}`,
      cash(sum.tax));
  }
  row("TOTAL", cash(o.total), true, 12);

  // How it was paid, in the shop's words rather than a status code.
  y += 6;
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text(
    `${o.pay_method.toUpperCase()} — ${o.pay_status === "paid" ? "PAID" : "UNPAID"}`,
    right, y + 12, { align: "right" });
  doc.setTextColor(0);
  y += 12;

  /* THE TAX SUMMARY. Rate, the base it was charged on, the tax, the total.
     Printed even at a rate of zero, because "no tax was charged" is itself
     a statement a tax document should make rather than leave to inference
     from an absence. */
  y += 24;
  doc.setDrawColor(210);
  doc.line(x, y, right, y);
  y += 14;
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  const c2 = x + 120, c3 = x + 260, c4 = x + 400;
  doc.text(`% ${taxLabel.toUpperCase()}`, x, y);
  doc.text("BASE", c2, y);
  doc.text(taxLabel.toUpperCase(), c3, y);
  doc.text("TOTAL", c4, y);
  doc.setTextColor(0);
  y += 14;
  doc.setFontSize(10);
  doc.text(pct ? `${pct}` : "0", x, y);
  doc.text(cash(sum.base), c2, y);
  doc.text(cash(sum.tax), c3, y);
  doc.text(cash(sum.total), c4, y);

  return y;
}
