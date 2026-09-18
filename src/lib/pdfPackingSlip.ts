import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { money } from "@/lib/utils";
import { fiscalHeader, fiscalBody } from "@/lib/pdfFiscal";
import type { Order, Settings } from "@/lib/types";

/* The paper that travels with the parcel.
 *
 * NOT THE INVOICE, AND THE DIFFERENCE IS THE WHOLE POINT.
 *
 * lib/pdfInvoice.ts is the buyer's record of what they were charged. This
 * is the driver's instructions and the recipient's receipt: where the
 * parcel is going, who to call, what should be inside it, and a line for a
 * signature on the doorstep.
 *
 * SO IT LEADS WITH THE ADDRESS, NOT THE MONEY. On an invoice the delivery
 * address is a footnote after the total; here it is the largest thing on
 * the page, because the person holding it is standing in a street trying
 * to find a house.
 *
 * PRICES ARE PRINTED ONLY WHEN SOMEBODY HAS TO COLLECT THEM. A packing
 * slip that lists what everything cost travels through several hands
 * before it reaches the buyer, and none of them need it. The exception is
 * cash on delivery, where the amount to collect IS the driver's
 * instruction -- printing it large is the difference between the right
 * money and an argument at the door. An order already paid shows PAID and
 * no figures at all.
 *
 * Client-side, like the invoice: no server round trip, nothing stored.
 */

const INK: [number, number, number] = [0x15, 0x23, 0x41];
const MUTED = 130;

/** Cash still to hand over on the doorstep, or null when there is none. */
export function amountToCollect(o: Order): number | null {
  const unpaid = o.pay_status !== "paid";
  const onDelivery = o.pay_method === "cod" || o.pay_method === "cop";
  if (!unpaid || !onDelivery) return null;
  return Number(o.total) || 0;
}

/** The delivery address as one readable block, longest-lived detail first.
 *
 * Returned as lines rather than a joined string: a driver reads an address
 * down a page, and a comma-separated run is how a landmark ends up in the
 * middle of a sentence nobody finishes. */
export function addressLines(o: Order, settings?: Settings): string[] {
  if (o.mode === "pickup") {
    return [
      "COLLECTION FROM THE SHOP",
      settings ? [settings.suku, settings.municipality].filter(Boolean).join(", ") : "",
    ].filter(Boolean);
  }
  return [
    o.address_line || "",
    o.landmark ? `Landmark: ${o.landmark}` : "",
    [o.aldeia, o.suku].filter(Boolean).join(", "),
    [o.post, o.municipality].filter(Boolean).join(", "),
  ].filter(Boolean);
}

export async function downloadPackingSlip(o: Order, settings?: Settings) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 44;
  const colRight = pageW - marginX;
  const collect = amountToCollect(o);
  const docId = Math.random().toString(36).slice(2, 10).toUpperCase();

  /* THE SAME LAYOUT AS THE INVOICE, at the shop's request.
   *
   * This document used to hide prices on purpose -- a packing slip passes
   * through several hands before it reaches the buyer, and none of them
   * need to know what everything cost. The shop asked for the delivery note
   * and the invoice to carry the same figures, which is how a delivery note
   * is used here: it is handed over WITH the goods and serves as the
   * customer's copy. That is the shop's call to make, and it is recorded
   * here so the earlier reasoning is not mistaken for an oversight.
   *
   * What this document keeps that the invoice does not: the address in
   * large type, the amount to collect in a box, and a line to sign. */
  let y = fiscalHeader(doc, o, settings, marginX, colRight, 54,
    { title: "DELIVERY NOTE", docId });

  // ---- Where it goes. Still the largest block on the page: the person
  // holding this is standing in a street trying to find a house. ----
  y += 22;
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text(o.mode === "pickup" ? "COLLECTION" : "DELIVER TO", marginX, y);
  doc.setTextColor(0);

  y += 17;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(o.buyer_name, marginX, y);

  y += 17;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.text(o.buyer_phone, marginX, y);

  doc.setFontSize(11);
  for (const line of addressLines(o, settings)) {
    y += 16;
    if (y > 740) { doc.addPage(); y = 54; }
    doc.text(line, marginX, y, { maxWidth: colRight - marginX });
  }

  // ---- What is in the parcel, and what it came to ----
  y = fiscalBody(doc, o, settings, marginX, colRight, y + 8);

  // ---- What the driver has to come back with ----
  y += 30;
  if (collect != null) {
    if (y > 700) { doc.addPage(); y = 120; }
    doc.setFillColor(250, 235, 232);
    doc.setDrawColor(...INK);
    doc.rect(marginX, y - 16, colRight - marginX, 40, "FD");
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text("COLLECT ON DELIVERY", marginX + 12, y + 2);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text(money(collect), colRight - 12, y + 4, { align: "right" });
    y += 44;
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("PAID — nothing to collect", marginX, y);
    y += 22;
  }

  // ---- Signature on receipt ----
  y += 26;
  if (y > 700) { doc.addPage(); y = 120; }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text("RECEIVED BY", marginX, y);
  doc.setTextColor(0);

  y += 34;
  doc.setDrawColor(160);
  const half = (colRight - marginX) / 2 - 12;
  doc.line(marginX, y, marginX + half, y);
  doc.line(colRight - half, y, colRight, y);
  y += 12;
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text("Signature", marginX, y);
  doc.text("Name and date", colRight - half, y);
  doc.setTextColor(0);

  // ---- The same QR the invoice carries, for the same reason ----
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const trackingUrl = `${origin}/o/${o.ref}`;
  const qrDataUrl = await QRCode.toDataURL(trackingUrl, { width: 200, margin: 1 });
  const qrSize = 60;
  y += 26;
  if (y + qrSize > 780) { doc.addPage(); y = 54; }
  doc.addImage(qrDataUrl, "PNG", marginX, y, qrSize, qrSize);
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  doc.text("Scan to see this order", marginX + qrSize + 12, y + qrSize / 2 - 4);
  doc.text(trackingUrl, marginX + qrSize + 12, y + qrSize / 2 + 9, {
    maxWidth: colRight - marginX - qrSize - 12,
  });

  doc.save(`${o.ref}-delivery-note.pdf`);
}
