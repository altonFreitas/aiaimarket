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

export type KpiKey =
  | "sales" | "grossProfit" | "orders"
  | "catalog" | "procurement" | "finance";

export interface Kpi {
  key: KpiKey;
  /** i18n key for the label above the figure. */
  labelKey: string;
  /** Already formatted -- money, a count, or "—" when unknowable. */
  value: string;
  /** The smaller line under the figure: a comparison, a count, a share. */
  note: string | null;
  /** How `note` should read: better, worse, or merely informative. */
  tone: "good" | "bad" | "flat";
  /** WHAT PERIOD THIS FIGURE COVERS, as an i18n key.
   *
   * Every card carries one, and that is not decoration. The first version
   * of this row put a 30-day revenue beside an all-time net profit with
   * nothing to say so, and the page read as though the shop had earned
   * more than it took: $138.23 in, $259.43 kept. A figure whose basis is
   * unstated is not a small documentation gap, it is a wrong number. */
  basisKey: string;
  /** Where this figure is explained in full. Every card is a link; a
   * dashboard tile you cannot open is a poster. */
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
  /** Revenue less the cost of the goods, over the same window. Separate
   * from `finance` below because it is windowed and that one is not.
   *
   * `value` is null when NO line in the window had a unit cost recorded --
   * which is not the same as no profit, and must not be rendered as one. */
  grossProfit: { value: number | null; pct: number | null; margin: number | null } | null;
  /** Orders placed in the window -- the count, not the money. */
  orders: { value: number; pct: number | null } | null;
  catalog: { value: number; units: number; live: number; priced: number } | null;
  procurement: { value: number; pct: number | null } | null;
  /** Net profit after every expense the books carry. ALL TIME: the books
   * are not windowed, and the card says so rather than pretending. */
  finance: { value: number; margin: number | null } | null;
}

/** The i18n key naming what a range covers, for the line under each
 * windowed figure. Its own map rather than reusing the chip labels: a chip
 * says "1M" because it is a button in a row of eight, and a tile has to
 * say "Last 30 days" because it is the only thing telling the reader what
 * the number above it means. */
export function basisKeyFor(range: string): string {
  return `kpiBasis_${range}`;
}

/** The row, in the fixed order above, skipping what this account cannot
 * see. */
/** The few words a note needs spelled out, in the reader's language.
 *
 * Passed in rather than looked up here so this file stays a pure
 * calculation with no view layer in it -- and so "31 units in 8 products"
 * is a sentence in Tetun and Portuguese too, rather than an English one
 * with the numbers swapped. */
export interface KpiWords {
  units: string;
  products: string;
  priced: string;
}

export function buildKpis(
  input: KpiInput, words?: KpiWords, periodKey = "kpiBasisPeriod",
): Kpi[] {
  const out: Kpi[] = [];
  /* WHAT THE WINDOWED FIGURES COVER, chosen by the range picker at the top
     of the page and passed in rather than assumed here. Four of the six
     tiles follow it; the other two say "right now" and "all time" because
     that is what they are, and a filter cannot honestly change them. */
  const period = periodKey;

  if (input.sales) {
    out.push({
      key: "sales", labelKey: "kpiRevenue", href: "/admin/sales",
      value: money(input.sales.value), basisKey: period,
      note: deltaText(input.sales.pct), tone: toneOf(input.sales.pct),
    });
  }

  if (input.grossProfit) {
    const { value, pct, margin } = input.grossProfit;
    out.push({
      key: "grossProfit", labelKey: "kpiGrossProfit", href: "/admin/sales",
      /* NOT "$0.00" WHEN NOTHING WAS COSTED. Gross profit is revenue less
         what the goods cost, over the lines that HAVE a cost -- so a shop
         that has recorded unit costs for two products out of eight has
         not answered the question for the other six, and the honest
         answer is a dash. Printing zero told such a shop it had made
         nothing on a month it took $138 in, which is the same mistake the
         stock tile makes if it reports an unpriced catalogue as empty. */
      value: value == null ? "—" : money(value), basisKey: period,
      /* The MARGIN, not the change: a profit figure moving with revenue
         says nothing on its own, and the share of each dollar kept is what
         tells the shop whether it is selling better or just selling more.
         The change is still there when there is no margin to quote. */
      note: margin == null ? deltaText(pct) : `${(margin * 100).toFixed(1)}%`,
      tone: value == null ? "flat" : value > 0 ? "good" : value < 0 ? "bad" : "flat",
    });
  }

  if (input.orders) {
    out.push({
      key: "orders", labelKey: "kpiOrders", href: "/admin/orders",
      value: String(input.orders.value), basisKey: period,
      note: deltaText(input.orders.pct), tone: toneOf(input.orders.pct),
    });
  }

  if (input.catalog) {
    const { value, units, live, priced } = input.catalog;
    out.push({
      key: "catalog", labelKey: "kpiStockValue", href: "/admin/stock",
      // A shop that has filled in no unit costs cannot be told what its
      // shelves are worth, and must not be told "$0.00" -- which reads as
      // an empty shop rather than as an unanswered question.
      value: priced ? money(value) : "—",
      // NOT A PERIOD AT ALL, and the odd one out on this row: stock is a
      // count of what is on the shelves at this moment, not something that
      // happened over a month. Saying so is the difference between a
      // figure somebody trusts and one they have to go and check.
      basisKey: "kpiBasisNow",
      /* WHERE THE NUMBER COMES FROM, which is exactly what was asked of
         the first version of this card: "I don't know where $66 is coming
         from". It is the unit cost of everything on the shelves, so the
         note says how many units and across how many products -- and,
         when some of those products have no cost recorded, that the total
         only covers the ones that do. An unexplained total on a dashboard
         is a number somebody has to go and verify, which is the same as
         not having it. */
      note: !priced || !words ? null
        : priced < live
          ? `${units} ${words.units} · ${priced}/${live} ${words.priced}`
          : `${units} ${words.units} · ${live} ${words.products}`,
      tone: "flat",
    });
  }

  if (input.procurement) {
    out.push({
      key: "procurement", labelKey: "kpiPurchases", href: "/admin/procurement",
      value: money(input.procurement.value), basisKey: period,
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
      /* ALL TIME, said out loud. The books carry every expense the shop
         has ever entered and are not filtered by date, so windowing this
         to 30 days would report a number the Finance screen does not
         show. Two screens disagreeing about profit is worse than a card
         that covers a different span and says which. */
      basisKey: "kpiBasisAllTime",
      note: margin == null ? null : `${(margin * 100).toFixed(1)}%`,
      // Here the verdict is on the figure itself, not on a change: a loss
      // is a loss whether or not last month was worse.
      tone: value > 0 ? "good" : value < 0 ? "bad" : "flat",
    });
  }

  return out;
}
