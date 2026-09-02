import type { SalesLine } from "./sales";
import type { OrderStatus } from "./types";

/* How the order book crosses the wire.
 *
 * The sales dashboard filters, groups and ranks in the browser, which is
 * what makes changing a filter feel instant. The price is that every line
 * has to get there, and a SalesLine as written is about 675 bytes of JSON:
 * twenty-five fields, most of them strings, most of those repeated on every
 * line of the same order, the same customer, the same product.
 *
 * At two thousand orders that is 2.1 MB in the page payload. On a phone on
 * mobile data in Timor-Leste that is the difference between a dashboard and
 * a wait.
 *
 * So the same lines go over as a dictionary plus rows of integers. Nothing
 * about the dashboard's behaviour changes -- it unpacks once and works on
 * exactly the objects it always did.
 *
 * This moves the wall out; it does not remove it. Growth is still linear.
 * See the note at the foot of this file for when windowing becomes the
 * answer instead. */

/** Fields whose values repeat across lines, stored once in the dictionary
 * and referenced by index. Order matters: it IS the wire format. */
const STR_FIELDS = [
  "orderId", "ref", "date", "createdAt",
  "customerPhone", "customerName", "municipality",
  "sellerId", "sellerName",
  "productId", "productName", "categoryId", "categoryName",
  "status", "payStatus", "payMethod",
  "expectedDelivery", "deliveredAt", "invoicedAt",
] as const;

/** Numbers that are genuinely independent. Everything else on the line --
 * discount, cost, grossProfit, margin -- is arithmetic over these four plus
 * unitCost, so it is recomputed on arrival rather than sent. */
const NUM_FIELDS = ["qty", "unitPrice", "listPrice", "netSales", "unitCost"] as const;

/** -1 means null. A missing seller and a seller called "" are different
 * facts, and the dashboard distinguishes them. */
const NULL_REF = -1;

export interface PackedSalesLines {
  /** Distinct strings, referenced by index from every row. */
  dict: string[];
  /** One row per line: STR_FIELDS as dictionary indices, then NUM_FIELDS. */
  rows: number[][];
}

export function packSalesLines(lines: SalesLine[]): PackedSalesLines {
  const dict: string[] = [];
  const index = new Map<string, number>();
  const ref = (v: string | null): number => {
    if (v == null) return NULL_REF;
    const seen = index.get(v);
    if (seen !== undefined) return seen;
    const at = dict.length;
    dict.push(v);
    index.set(v, at);
    return at;
  };

  const rows = lines.map((l) => {
    const row: number[] = [];
    for (const f of STR_FIELDS) row.push(ref(l[f] as string | null));
    for (const f of NUM_FIELDS) {
      const v = l[f] as number | null;
      // NaN is not representable in JSON and comes back as null, which the
      // dashboard would read as "cost unknown". Nothing should produce one,
      // but a silent change of meaning is not worth the risk.
      row.push(v == null || !Number.isFinite(v) ? NULL_REF : v);
    }
    return row;
  });

  return { dict, rows };
}

export function unpackSalesLines(packed: PackedSalesLines | SalesLine[]): SalesLine[] {
  // Tolerates being handed plain lines, so a caller that has not been
  // converted yet still works rather than rendering an empty dashboard.
  if (Array.isArray(packed)) return packed;

  const { dict, rows } = packed;
  // Written out field by field rather than looped: this is the half that
  // has to produce a SalesLine the compiler recognises, and a loop over
  // field names would need a cast that hides exactly the mistake -- a
  // field in the wrong position -- that the round-trip test exists to catch.
  const s = (i: number): string => (i === NULL_REF ? "" : dict[i] ?? "");
  const sn = (i: number): string | null => (i === NULL_REF ? null : dict[i] ?? null);
  const n = (v: number): number => (v === NULL_REF ? 0 : v);
  const nn = (v: number): number | null => (v === NULL_REF ? null : v);

  return rows.map((r) => {
    const qty = n(r[19]);
    const unitPrice = n(r[20]);
    const listPrice = n(r[21]);
    const netSales = n(r[22]);
    const unitCost = nn(r[23]);

    // Recomputed exactly as buildSalesLines computes them, from the same
    // inputs, so the dashboard cannot tell the difference.
    const cost = unitCost == null ? null : unitCost * qty;
    const grossProfit = cost == null ? null : netSales - cost;

    return {
      orderId: s(r[0]),
      ref: s(r[1]),
      date: s(r[2]),
      createdAt: s(r[3]),
      customerPhone: s(r[4]),
      customerName: s(r[5]),
      municipality: s(r[6]),
      sellerId: sn(r[7]),
      sellerName: s(r[8]),
      productId: s(r[9]),
      productName: s(r[10]),
      categoryId: sn(r[11]),
      categoryName: s(r[12]),
      // Field order follows buildSalesLines exactly. It changes nothing the
      // dashboard can see -- it reads by name -- but it makes the two
      // functions readable side by side, and means a line that went through
      // here serialises identically to one that did not.
      qty,
      unitPrice,
      listPrice,
      discount: (listPrice - unitPrice) * qty,
      netSales,
      unitCost,
      cost,
      grossProfit,
      margin: grossProfit == null || netSales === 0 ? null : grossProfit / netSales,
      status: s(r[13]) as OrderStatus,
      payStatus: s(r[14]),
      payMethod: s(r[15]),
      expectedDelivery: sn(r[16]),
      deliveredAt: sn(r[17]),
      invoicedAt: sn(r[18]),
    };
  });
}

/* When packing stops being enough.
 *
 * This cuts the payload by roughly five times, which moves the wall out
 * rather than removing it: the cost is still one row per order line. Past
 * something like fifteen thousand orders the honest answer is to stop
 * sending the whole book at all -- ship aggregates for the multi-year
 * panels, which are a handful of rows, and raw lines only for the window
 * the filters can currently reach. That is a real change to how the
 * dashboard is built, and it is not worth making before the numbers ask
 * for it. */
