import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { money, nowIso } from "@/lib/utils";
import { taxWasIncluded } from "@/lib/tax";
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
export async function downloadOrderInvoice(o: Order, settings?: Settings) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 44;
  const colQty = pageW - 214;
  const colPrice = pageW - 160;
  const colRight = pageW - marginX;
  let y = 54;

  /* IN THE CURRENCY THE ORDER WAS PLACED IN, not the one the shop quotes
     today. Every figure on this invoice went through money() with no
     argument, so a shop trading in euros issued invoices in dollars --
     on the one document a customer files and may hand to an accountant.
     Falls back to the shop's current code, then to USD, for orders placed
     before the column existed. */
  const code = o.currency || settings?.display_currency || undefined;
  const cash = (n: number | string) => money(n, code ?? undefined);
  /* The shop's own word for its tax. "Tax" is not what it is called
     everywhere, and the invoice is exactly where the right word matters. */
  const taxLabel = (settings?.tax_label || "").trim() || "Tax";

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
    doc.text(cash(item.price), colPrice, y, { align: "right" });
    doc.text(cash(item.price * item.qty), colRight, y, { align: "right" });
  }

  y += 14;
  doc.line(marginX, y, colRight, y);

  y += 20;
  doc.text("Subtotal", colPrice, y, { align: "right" });
  doc.text(cash(o.subtotal), colRight, y, { align: "right" });

  y += 18;
  doc.text("Delivery fee", colPrice, y, { align: "right" });
  doc.text(o.quote_requested ? "On request" : cash(o.fee), colRight, y, { align: "right" });

  /* THE TAX LINE THIS DOCUMENT WAS MISSING.
   *
   * An invoice is the one place where the figures have to add up, and this
   * one printed goods and delivery and then a total that was larger by
   * exactly the tax, with nothing accounting for the difference. It is also
   * the document a customer keeps, files, or hands to their own accountant.
   *
   * The label is the shop's own word -- VAT, IVA, GST -- because that is
   * what makes the document usable where the shop trades. */
  if (Number(o.tax) > 0) {
    y += 18;
    // "of which" when it was already inside the prices, so the reader does
    // not add it to a total that already contains it.
    const label = taxWasIncluded(o) ? `${taxLabel} (of which)` : taxLabel;
    doc.text(label, colPrice, y, { align: "right" });
    doc.text(cash(Number(o.tax)), colRight, y, { align: "right" });
  }

  y += 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Total", colPrice, y, { align: "right" });
  doc.text(cash(o.total), colRight, y, { align: "right" });

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

  // QR code back to this order's live tracking page. This is the actual
  // way to verify a PDF came from the site: scan it, and compare what's
  // on screen (name, items, total, status) against what's printed here.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const trackingUrl = `${origin}/o/${o.ref}`;
  const qrDataUrl = await QRCode.toDataURL(trackingUrl, { width: 200, margin: 1 });
  const qrSize = 64;
  y += 16;
  if (y + qrSize > 780) { doc.addPage(); y = 54; }
  doc.addImage(qrDataUrl, "PNG", marginX, y, qrSize, qrSize);
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text("Scan to verify & track this order", marginX + qrSize + 12, y + qrSize / 2 - 5);
  doc.text(trackingUrl, marginX + qrSize + 12, y + qrSize / 2 + 9, {
    maxWidth: colRight - marginX - qrSize - 12,
  });

  doc.save(`${o.ref}.pdf`);
}
