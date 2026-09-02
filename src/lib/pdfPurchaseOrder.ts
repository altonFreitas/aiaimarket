import { jsPDF } from "jspdf";
import { money } from "@/lib/utils";
import { landedCosts, poQty, poSubtotal, poTotal } from "@/lib/procurement";
import type { PurchaseOrder, Supplier } from "@/lib/types";

/* A printable purchase order, generated entirely client-side -- no server
 * round trip and no stored file, matching pdfInvoice.ts. jspdf is imported
 * dynamically by the caller so it never reaches the first-load bundle.
 *
 * This is the document that gets emailed to a supplier or filed, so it
 * carries everything needed to act on it and to check the goods on arrival:
 * who it is for, what was ordered including sizes, what it costs broken out,
 * and where it is being delivered. */

const STATUS_LABELS: Record<PurchaseOrder["status"], string> = {
  draft: "Draft", approved: "Approved", sent: "Sent to supplier",
  confirmed: "Confirmed by supplier", in_production: "In production",
  in_transit: "In transit", arrived: "Arrived", received: "Received",
  cancelled: "Cancelled",
};

const CATEGORY_LABELS: Record<string, string> = {
  goods_for_resale: "Goods for resale", raw_materials: "Raw materials",
  components: "Components", packaging: "Packaging", office: "Office supplies",
  equipment: "Equipment", services: "Services", other: "Other",
};

const RED: [number, number, number] = [0xc4, 0x3d, 0x2c];

export function downloadPurchaseOrderPdf(po: PurchaseOrder, supplier?: Supplier) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 44;
  const right = pageW - marginX;
  let y = 54;

  /* Every amount ON a purchase order is stored in the ORDER's currency,
   * while every helper in lib/procurement returns USD -- it multiplies by
   * fx_rate so the dashboards can add orders together. This document is the
   * one the supplier reads, so it shows the supplier's own currency all the
   * way down, and states the USD equivalent once at the bottom.
   *
   * Dividing the USD helpers back out by the same rate, rather than
   * re-deriving the sums here, keeps the document agreeing with the screen
   * it was printed from. */
  const fx = Number(po.fx_rate) || 1;
  /* Bare grouped numbers, with the currency named once in the header block
   * and again on the total. Repeating "IDR" in every cell costs four
   * characters a column, and an order in dong then runs a twelve-digit
   * total into the column beside it. money() puts the sign inside the
   * symbol ("$-12.00"), so dropping the symbol keeps "-12.00". */
  const amt = (n: number) => money(n).slice(1);

  /* Right edges of the numeric columns. Sized for a twelve-digit amount:
   * an order in rupiah has line totals in the millions and one in dong in
   * the billions, where columns sized for dollars ran them together. */
  const colQty = right - 258;
  const colUnit = right - 174;
  const colLanded = right - 89;
  const colTotal = right - 4;

  const line = (label: string, value: string, yy: number) => {
    doc.setTextColor(120);
    doc.text(label, marginX, yy);
    doc.setTextColor(0);
    doc.text(value || "—", marginX + 110, yy);
  };

  /* ---- header ---- */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Loja AIAI", marginX, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("PURCHASE ORDER", right, y, { align: "right" });

  y += 16;
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text(po.po_number, marginX, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  // Cancelled is the one status that changes what the reader should do with
  // the page, so it is the one that gets colour.
  if (po.status === "cancelled") doc.setTextColor(...RED);
  doc.text(STATUS_LABELS[po.status] || po.status, right, y, { align: "right" });
  doc.setTextColor(0);

  y += 12;
  doc.setDrawColor(210);
  doc.line(marginX, y, right, y);

  /* ---- who and when ---- */
  y += 20;
  doc.setFontSize(9);
  line("Supplier", supplier?.name || "—", y);
  y += 14; line("Contact", [supplier?.contact_name, supplier?.email, supplier?.phone].filter(Boolean).join(" · "), y);
  y += 14; line("Buyer", po.buyer, y);
  y += 14; line("Currency", po.currency, y);
  y += 14; line("Order date", po.order_date, y);
  y += 14; line("Expected arrival", po.expected_arrival || "Not given", y);
  if (po.actual_arrival) { y += 14; line("Actual arrival", po.actual_arrival, y); }
  y += 14; line("Payment", po.payment_status + (po.payment_date ? ` · ${po.payment_date}` : ""), y);

  /* ---- lines ---- */
  // Repeated at the top of every page: a second page of bare numbers with
  // no headings cannot be checked against the goods.
  const tableHead = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setFillColor(240, 242, 246);
    doc.rect(marginX, y - 10, right - marginX, 16, "F");
    doc.text("ITEM", marginX + 4, y);
    doc.text("QTY", colQty, y, { align: "right" });
    doc.text("UNIT", colUnit, y, { align: "right" });
    doc.text("LANDED UNIT", colLanded, y, { align: "right" });
    doc.text("TOTAL", colTotal, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    y += 8;
  };
  y += 26;
  tableHead();

  const landed = new Map(landedCosts(po).map((l) => [l.itemId, l]));

  for (const item of po.items || []) {
    // A new page before a row rather than after, so a line and its sizes
    // are never split across the break.
    if (y > pageH - 120) { doc.addPage(); y = 64; tableHead(); }

    y += 14;
    doc.setFontSize(9);
    doc.setTextColor(0);
    doc.text(String(item.product_name).slice(0, 40), marginX + 4, y);

    const qty = Number(item.qty) || 0;
    const unit = Number(item.unit_price) || 0;
    doc.text(String(qty), colQty, y, { align: "right" });
    doc.text(amt(unit), colUnit, y, { align: "right" });
    const l = landed.get(item.id);
    doc.text(l ? amt(l.landedUnitCost / fx) : "—", colLanded, y, { align: "right" });
    doc.text(amt(qty * unit), colTotal, y, { align: "right" });

    // Sizes and category under the name: this is the row a warehouse reads
    // when checking a delivery against the order.
    const sub = [
      CATEGORY_LABELS[item.category] || item.category,
      item.sizes ? `Sizes: ${item.sizes}` : "",
    ].filter(Boolean).join("  ·  ");
    if (sub) {
      y += 10;
      doc.setFontSize(7.5);
      doc.setTextColor(130);
      doc.text(sub, marginX + 8, y);
    }
    if (item.description) {
      y += 9;
      doc.setFontSize(7.5);
      doc.setTextColor(150);
      for (const ln of doc.splitTextToSize(String(item.description), colQty - marginX - 20).slice(0, 2)) {
        doc.text(ln, marginX + 8, y);
        y += 9;
      }
      y -= 9;
    }
    doc.setTextColor(0);
  }

  /* ---- money ---- */
  y += 18;
  doc.setDrawColor(210);
  doc.line(right - 220, y, right, y);
  const total = (label: string, value: string, bold = false) => {
    y += 14;
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 10 : 9);
    doc.text(label, right - 150, y, { align: "right" });
    doc.text(value, right - 4, y, { align: "right" });
    doc.setFont("helvetica", "normal");
  };
  total("Subtotal", amt(poSubtotal(po) / fx));
  if (Number(po.discount)) total("Discount", "-" + amt(po.discount));
  if (Number(po.tax)) total("Tax", amt(po.tax));
  if (Number(po.shipping)) total("Shipping", amt(po.shipping));
  total(`Total (${po.currency})`, amt(poTotal(po) / fx), true);

  // Only worth printing when it actually differs from the total above.
  if (po.currency !== "USD" && fx !== 1) {
    y += 12;
    doc.setFontSize(8);
    doc.setTextColor(130);
    // poTotal() is already USD -- multiplying by the rate again here turned
    // a $905 order into $0.06.
    doc.text(
      `${money(poTotal(po))} USD · 1 ${po.currency} = ${po.fx_rate} USD — rate captured on the order date`,
      right - 4, y, { align: "right" }
    );
    doc.setTextColor(0);
  }

  y += 20;
  doc.setFontSize(8);
  doc.setTextColor(130);
  doc.text(`${poQty(po)} units across ${(po.items || []).length} lines`, marginX, y);
  doc.setTextColor(0);

  if (po.notes) {
    y += 22;
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text("NOTES", marginX, y);
    doc.setTextColor(0);
    y += 12;
    doc.setFontSize(9);
    for (const ln of doc.splitTextToSize(po.notes, right - marginX).slice(0, 8)) {
      doc.text(ln, marginX, y);
      y += 11;
    }
  }

  doc.save(`${po.po_number}.pdf`);
}
