import TargetsAdmin from "@/components/admin/sales/TargetsAdmin";
import CoverageNotice from "@/components/admin/CoverageNotice";
import { adminSalesData, costMap, returnedUnits } from "@/lib/data/sales";
import { buildSalesLines, totals, type SalesTarget } from "@/lib/sales";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

export default async function TargetsPage() {
  await requireSection("settings");
  const [lang, data, returns] = await Promise.all([
    getLang(), adminSalesData(), returnedUnits(),
  ]);

  const lines = buildSalesLines(data.orders, {
    products: data.products,
    categories: data.categories,
    sellers: data.sellers,
    costs: costMap(data.costs),
    // Netted here too, or a target would be measured against revenue the
    // dashboard has already written off.
    returns,
  });

  // Actual revenue for exactly the periods that have a target, so each row
  // shows progress. Computed against the same recognition rule as the
  // dashboard (lib/sales.ts) rather than a second definition here.
  const actualByPeriod: Record<string, number> = {};
  for (const target of data.targets) {
    const period = target.period;
    const inPeriod = lines.filter((l) => {
      if (period.length === 4) return l.date.startsWith(period);
      if (period.includes("Q")) {
        const year = period.slice(0, 4);
        const q = Number(period.slice(6));
        if (!l.date.startsWith(year)) return false;
        const m = Number(l.date.slice(5, 7));
        return m >= (q - 1) * 3 + 1 && m <= q * 3;
      }
      return l.date.startsWith(period);
    });
    actualByPeriod[period] = totals(inPeriod).revenue;
  }

  return (
    <>
      {/* Progress against a target is only as honest as the revenue behind
          it, and that revenue stops at the same cap. */}
      <CoverageNotice lang={lang} coverage={data.coverage} />
      <TargetsAdmin
        lang={lang}
        targets={data.targets as SalesTarget[]}
        actualByPeriod={actualByPeriod}
        ready={data.ready}
      />
    </>
  );
}
