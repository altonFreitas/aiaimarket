import { money } from "@/lib/utils";
import type { Product } from "@/lib/types";

/* ONE NUMBER FROM EACH AREA, FOR THE FRONT PAGE.
 *
 * The admin has five places a figure could come from -- Sales, Catalog,
 * Procurement, Sellers, Settings -- and Home used to show six figures from
 * two of them and nothing from the rest. So the page said a great deal
 * about trade and nothing about whether the shelves were stocked or whether
 * any of it was profit, and it took two screens of scrolling to say that
 * much.
 *
 * ONE EACH, AND EACH THE ONE THAT MATTERS:
 *
 *   Sales        what came in
 *   Catalog      what is sitting on the shelves, at what it cost
 *   Procurement  what went out on stock
 *   Finance      what was left afterwards
 *
 * Read left to right they are a sentence about the business: money in,
 * money parked, money out, money kept. That is why the order is fixed here
 * rather than left to the component.
 *
 * EVERY ONE IS OPTIONAL, because an admin account holds only the sections
 * it was granted and a figure from a section somebody cannot open is a
 * leak -- the same rule the to-do cards and the overview already follow. A
 * KPI whose source is missing is simply not built.
 */

export type KpiKey = "sales" | "catalog" | "procurement" | "finance";

export interface Kpi {
  key: KpiKey;
  /** i18n key for the label under the figure. */
  labelKey: string;
  /** Already formatted -- money, a count, or "—" when unknowable. */
  value: string;
  /** The smaller line under the label: a comparison, a count, a share. */
  note: string | null;
  /** How `note` should read: better, worse, or merely informative. */
  tone: "good" | "bad" | "flat";
  /** Where this figure is explained in full. */
  href: string;
}

/** A percentage against the period before, as text.
 *
 * Null in means no basis for comparison -- a first month, or a previous
 * period with nothing in it -- and that is printed as a dash rather than
 * as +100%, which would describe a shop's first sale as infinite growth. */
export function deltaText(pct: number | null): string | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${(pct * 100).toFixed(1)}%`;
}

/** Which way a change reads for a figure where up is good. */
export function toneOf(pct: number | null, upIsGood = true): "good" | "bad" | "flat" {
  if (pct == null || !Number.isFinite(pct) || pct === 0) return "flat";
  const up = pct > 0;
  return up === upIsGood ? "good" : "bad";
}

/** What the shelves are worth, at what the shop paid.
 *
 * At COST, not at the price it hopes to sell for: this is money already
 * spent and still tied up, which is the question a shop owner is actually
 * asking when they look at stock. Retail value would be a forecast.
 *
 * Products with no recorded unit cost contribute nothing and are counted
 * separately, so the figure can say how much of the catalogue it covers
 * rather than quietly understating the total. A shop that has never filled
 * in a cost gets coverage 0 and a value of 0, which the caller renders as
 * "not known yet" rather than as "nothing on the shelves".
 */
export function stockOnHand(
  products: readonly Product[], costs: ReadonlyMap<string, number>
): { value: number; units: number; live: number; priced: number } {
  let value = 0, units = 0, live = 0, priced = 0;
  for (const p of products) {
    if (p.archived || p.status !== "approved") continue;
    live++;
    const qty = Math.max(0, Number(p.qty) || 0);
    units += qty;
    const unit = costs.get(p.id);
    if (unit != null && Number.isFinite(unit)) {
      priced++;
      value += qty * unit;
    }
  }
  return { value: Math.round(value * 100) / 100, units, live, priced };
}

export interface KpiInput {
  /** Revenue in the window, and its change against the window before. */
  sales: { value: number; pct: number | null } | null;
  catalog: { value: number; live: number; priced: number } | null;
  procurement: { value: number; pct: number | null } | null;
  /** Net profit after expenses, and the margin as a 0..1 share. */
  finance: { value: number; margin: number | null } | null;
}

/** The row, in the fixed order above, skipping what this account cannot
 * see. */
export function buildKpis(input: KpiInput): Kpi[] {
  const out: Kpi[] = [];

  if (input.sales) {
    out.push({
      key: "sales", labelKey: "kpiRevenue", href: "/admin/sales",
      value: money(input.sales.value),
      note: deltaText(input.sales.pct), tone: toneOf(input.sales.pct),
    });
  }

  if (input.catalog) {
    const { value, live, priced } = input.catalog;
    out.push({
      key: "catalog", labelKey: "kpiStockValue", href: "/admin/stock",
      // A shop that has filled in no unit costs cannot be told what its
      // shelves are worth, and must not be told "$0.00" -- which reads as
      // an empty shop rather than as an unanswered question.
      value: priced ? money(value) : "—",
      note: priced
        ? `${live} ${live === 1 ? "product" : "products"}`
        : null,
      tone: "flat",
    });
  }

  if (input.procurement) {
    out.push({
      key: "procurement", labelKey: "kpiPurchases", href: "/admin/procurement",
      value: money(input.procurement.value),
      // Spending more is not bad on its own -- a growing shop buys more --
      // so this reports the change without passing judgement on it.
      note: deltaText(input.procurement.pct), tone: "flat",
    });
  }

  if (input.finance) {
    const { value, margin } = input.finance;
    out.push({
      key: "finance", labelKey: "kpiNetProfit", href: "/admin/finance",
      value: money(value),
      note: margin == null ? null : `${(margin * 100).toFixed(1)}%`,
      // Here the verdict is on the figure itself, not on a change: a loss
      // is a loss whether or not last month was worse.
      tone: value > 0 ? "good" : value < 0 ? "bad" : "flat",
    });
  }

  return out;
}
