import { jsPDF } from "jspdf";
import { money, nowIso } from "@/lib/utils";
import type { Order, Settings } from "@/lib/types";

// Same hex values as --red and --amber-ink in globals.css, so the PDF's
// "Cancelled" status line reads as the same red used everywhere else.
const RED: [number, number, number] = [0xc4, 0x3d, 0x2c];

const STATUS_LABELS: Record<Order["status"], string> = {
  new: "New",
  confirmed: "Confirmed",
  preparing: "Preparing",
  out: "Out for delivery",
  arrived: "Arrived \u2014 calling you",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Buyer-facing bill/invoice PDF for a single order, generated entirely
 * client-side (no server round trip, no stored file). Called from the
 * "Download PDF" button on the order tracking page. */
export function downloadOrderInvoice(o: Order, settings?: Settings) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 44;
  const colQty = pageW - 214;
  const colPrice = pageW - 160;
  const colRight = pageW - marginX;
  let y = 54;

  // A random per-download document ID -- not stored anywhere, just a
  // reference printed on the PDF itself (distinct from the order ref).
  const docId = Math.random().toString(36).slice(2, 10).toUpperCase();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Loja AIAI", marginX, y);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("INVOICE", colRight, y, { align: "right" });

  y += 14;
  doc.setFontSize(8);
  doc.setTextColor(140);
  doc.text(`Doc ID: ${docId}`, colRight, y, { align: "right" });
  doc.setTextColor(0);

  y += 14;
  doc.setDrawColor(210);
  doc.line(marginX, y, colRight, y);

  y += 22;
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(o.ref, marginX, y);
  doc.setFont("helvetica", "normal");
  doc.text(nowIso(o.created_at), colRight, y, { align: "right" });

  y += 16;
  doc.text(o.buyer_name, marginX, y);
  y += 14;
  doc.text(o.buyer_phone, marginX, y);

  y += 20;
  doc.setFont("helvetica", "bold");
  if (o.status === "cancelled") doc.setTextColor(...RED);
  const statusLabel = o.status === "completed" && o.mode === "pickup"
    ? "Completed / Ready to pick up"
    : STATUS_LABELS[o.status];
  doc.text(`Status: ${statusLabel}`, marginX, y);
  doc.setTextColor(0);
  doc.setFont("helvetica", "normal");

  y += 24;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Item", marginX, y);
  doc.text("Qty", colQty, y, { align: "right" });
  doc.text("Price", colPrice, y, { align: "right" });
  doc.text("Total", colRight, y, { align: "right" });
  y += 6;
  doc.line(marginX, y, colRight, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  for (const item of o.items) {
    y += 20;
    if (y > 760) { doc.addPage(); y = 54; } // simple pagination for very long baskets
    const label = item.name + (item.size ? ` (${item.size})` : "");
    doc.text(label, marginX, y, { maxWidth: colQty - marginX - 10 });
    doc.text(String(item.qty), colQty, y, { align: "right" });
    doc.text(money(item.price), colPrice, y, { align: "right" });
    doc.text(money(item.price * item.qty), colRight, y, { align: "right" });
  }

  y += 14;
  doc.line(marginX, y, colRight, y);

  y += 20;
  doc.text("Subtotal", colPrice, y, { align: "right" });
  doc.text(money(o.subtotal), colRight, y, { align: "right" });

  y += 18;
  doc.text("Delivery fee", colPrice, y, { align: "right" });
  doc.text(o.quote_requested ? "On request" : money(o.fee), colRight, y, { align: "right" });

  y += 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Total", colPrice, y, { align: "right" });
  doc.text(money(o.total), colRight, y, { align: "right" });

  y += 34;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Payment: ${o.pay_method.toUpperCase()} \u2014 ${o.pay_status.toUpperCase()}`, marginX, y);

  y += 18;
  const addr = o.mode === "pickup"
    ? "Pickup" + (settings ? ` \u2014 ${settings.suku}, ${settings.municipality}` : "")
    : [o.address_line, o.landmark, o.suku, o.post, o.municipality].filter(Boolean).join(", ");
  doc.text(addr, marginX, y, { maxWidth: colRight - marginX });

  y += 40;
  doc.setFontSize(9);
  doc.setTextColor(140);
  doc.text("Thank you for shopping with Loja AIAI.", marginX, y);

  doc.save(`${o.ref}.pdf`);
}
