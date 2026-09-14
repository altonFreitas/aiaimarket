import { jsPDF } from "jspdf";
import { money } from "@/lib/utils";
import type { ProfitAndLoss } from "@/lib/finance";

/* THE PROFIT AND LOSS, AS A DOCUMENT.
 *
 * The screen is for looking at; this is for sending to an accountant, a
 * bank or a partner, and for keeping. Generated entirely client-side like
 * every other PDF here -- no server round trip and no stored file -- and
 * jspdf is imported dynamically by the caller so it never reaches the
 * first-load bundle.
 *
 * IT PRINTS THE SAME NUMBERS THE SCREEN SHOWS, from the same object. A
 * document that recomputed anything would eventually disagree with the
 * page it was downloaded from, and the disagreement would be discovered by
 * whoever was trusting the document.
 *
 * The cost breakdown is included in full. On screen it is behind a
 * disclosure because the summary is usually enough; on paper there is
 * nothing to click, and a statement that says "Software and licences $276"
 * with no way to ask what that was is a statement that prompts an email.
 */

// The same hex values as --red and --green in globals.css, so the document
// reads as the same palette as the screen it came from.
const RED: [number, number, number] = [0xbb, 0x3a, 0x2a];
const GREEN: [number, number, number] = [0x0d, 0x74, 0x49];
const MUTED = 120;

export interface ProfitLossPdfInput {
  pl: ProfitAndLoss;
  /** Account id -> the label shown on screen, already translated. Passed in
   * rather than resolved here: this module has no business knowing which
   * language the person reading it was using. */
  accountLabel: (account: string) => string;
  /** Heading labels, likewise already translated. */
  labels: {
    title: string;
    income: string;
    ownSales: string;
    costOfGoods: string;
    ownGross: string;
    commission: string;
    deliveryFees: string;
    refunds: string;
    totalIncome: string;
    costs: string;
    runningCosts: string;
    netProfit: string;
    netLoss: string;
    noVendor: string;
  };
  /** Shop name for the letterhead. */
  shopName?: string;
}

export function downloadProfitLossPdf(input: ProfitLossPdfInput) {
  const { pl, accountLabel, labels } = input;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 44;
  const right = pageW - marginX;
  let y = 54;

  /** A new page before anything would run off the bottom. Without this a
   * shop with thirty vendors silently loses the net profit line, which is
   * the one figure the document exists for. */
  const room = (needed = 18) => {
    if (y + needed > pageH - 54) { doc.addPage(); y = 54; }
  };

  const line = (
    label: string, amount: string,
    opts: { bold?: boolean; indent?: number; color?: [number, number, number];
            rule?: "none" | "thin" | "thick"; size?: number } = {}
  ) => {
    room();
    doc.setFontSize(opts.size ?? 10);
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    if (opts.color) doc.setTextColor(...opts.color); else doc.setTextColor(0);
    doc.text(label, marginX + (opts.indent ?? 0), y);
    doc.text(amount, right, y, { align: "right" });
    doc.setTextColor(0);
    y += (opts.size ?? 10) + 7;
    if (opts.rule && opts.rule !== "none") {
      doc.setDrawColor(opts.rule === "thick" ? 60 : 205);
      doc.setLineWidth(opts.rule === "thick" ? 1 : 0.5);
      doc.line(marginX, y - 12, right, y - 12);
    }
  };

  const group = (text: string) => {
    room(26);
    y += 8;
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(MUTED);
    doc.text(text.toUpperCase(), marginX, y);
    doc.setTextColor(0);
    y += 14;
  };

  /* ---- letterhead ---- */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(input.shopName || "Loja AIAI", marginX, y);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(labels.title.toUpperCase(), right, y, { align: "right" });

  y += 14;
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  // The day it was produced. A P&L with no date on it is a P&L that gets
  // filed next to last year's and confused with it.
  doc.text(new Date().toISOString().slice(0, 10), right, y, { align: "right" });
  doc.setTextColor(0);

  y += 12;
  doc.setDrawColor(205);
  doc.setLineWidth(0.5);
  doc.line(marginX, y, right, y);
  y += 24;

  /* ---- income ---- */
  group(labels.income);
  line(labels.ownSales, money(pl.ownSales));
  line(labels.costOfGoods, `-${money(pl.ownCost)}`, { indent: 14, color: RED });
  line(labels.ownGross, money(pl.ownGrossProfit), { bold: true, rule: "thin" });
  line(labels.commission, money(pl.commission));
  line(labels.deliveryFees, money(pl.deliveryFees));
  if (pl.refunds > 0) line(labels.refunds, `-${money(pl.refunds)}`, { color: RED });
  line(labels.totalIncome, money(pl.totalIncome), { bold: true, rule: "thick" });

  /* ---- costs, with who each one was paid to ---- */
  group(labels.costs);
  for (const a of pl.byAccount) {
    line(accountLabel(a.account), `-${money(a.total)}`, { color: RED });
    // Only when it says something the line above did not. One vendor
    // holding the whole account repeats the figure to no purpose.
    if (a.vendors.length > 1) {
      for (const v of a.vendors) {
        line(v.vendor || labels.noVendor, `-${money(v.total)}`,
          { indent: 16, color: RED, size: 9 });
      }
    }
  }
  if (!pl.byAccount.length) line("-", money(0), { color: RED });
  line(labels.runningCosts, `-${money(pl.expensesTotal)}`,
    { bold: true, color: RED, rule: "thick" });

  /* ---- the answer ---- */
  const profitable = pl.netProfit >= 0;
  y += 6;
  /* "-$586.30", never money()'s "$-586.30" -- it puts the sign inside the
   * currency, which on the one line the whole document exists for reads as
   * a typo. ASCII hyphen rather than the screen's U+2212: jsPDF's built-in
   * Helvetica has no glyph for the real minus sign and would drop it. */
  line(profitable ? labels.netProfit : labels.netLoss,
    profitable ? money(pl.netProfit) : `-${money(Math.abs(pl.netProfit))}`,
    { bold: true, size: 13, color: profitable ? GREEN : RED });

  doc.save(`profit-and-loss-${new Date().toISOString().slice(0, 10)}.pdf`);
}
