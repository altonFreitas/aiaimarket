import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { fiscalHeader, fiscalCustomer, fiscalBody } from "@/lib/pdfFiscal";
import type { Order, Settings } from "@/lib/types";

// Same hex value as --red in globals.css, so the PDF's "Cancelled" line
// reads as the same red used everywhere else.
const RED: [number, number, number] = [0xc4, 0x3d, 0x2c];

const STATUS_LABELS: Record<Order["status"], string> = {
  new: "New",
  confirmed: "Confirmed",
  preparing: "Preparing",
  out: "Out for delivery",
  arrived: "Arrived — calling you",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** The buyer's invoice for one order, built entirely in the browser -- no
 * server round trip and nothing stored.
 *
 * The layout is lib/pdfFiscal.ts, shared with the delivery note, so the two
 * pieces of paper describing one sale describe it the same way. What is
 * particular to this one is below: the order's status, the delivery
 * address, and the QR that leads back to the live page.
 */
export async function downloadOrderInvoice(o: Order, settings?: Settings) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 44;
  const colRight = pageW - marginX;

  // A per-download reference, not stored anywhere: two prints of one order
  // can be told apart, which is what somebody filing them needs.
  const docId = Math.random().toString(36).slice(2, 10).toUpperCase();

  let y = fiscalHeader(doc, o, settings, marginX, colRight, 54,
    { title: "INVOICE", docId });
  y = fiscalCustomer(doc, o, marginX, colRight, y);

  // The status, and only when it is worth saying. An invoice for a
  // cancelled order that does not say so is a bill for goods nobody sent.
  y += 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  if (o.status === "cancelled") doc.setTextColor(...RED);
  doc.text(STATUS_LABELS[o.status] || o.status, marginX, y);
  doc.setTextColor(0);
  doc.setFont("helvetica", "normal");

  y = fiscalBody(doc, o, settings, marginX, colRight, y);

  y += 28;
  doc.setFontSize(9);
  const addr = o.mode === "pickup"
    ? "Pickup" + (settings ? ` — ${settings.suku}, ${settings.municipality}` : "")
    : [o.address_line, o.landmark, o.suku, o.post, o.municipality].filter(Boolean).join(", ");
  doc.text(addr, marginX, y, { maxWidth: colRight - marginX });

  y += 24;
  doc.setTextColor(140);
  doc.text(`Thank you for shopping with ${settings?.store_name || "us"}.`, marginX, y);
  doc.setTextColor(0);

  // QR back to this order's live tracking page. This is the actual way to
  // verify a PDF came from the site: scan it, and compare what is on screen
  // -- name, items, total, status -- against what is printed here.
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
