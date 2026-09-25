import Link from "next/link";
import ProcurementDashboard from "@/components/admin/procurement/ProcurementDashboard";
import { adminProcurementData } from "@/lib/data/procurement";
import { getCategories } from "@/lib/data/public";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { requireSection } from "@/lib/actions/guard";

export default async function ProcurementPage() {
  await requireSection("procurement.orders");
  /* The shop's own categories, so Product analysis can say where the
     goods land as well as which budget paid for them. Cross-request
     cached (lib/data/public.ts), so this costs the page nothing. */
  const [lang, data, cats] = await Promise.all([
    getLang(), adminProcurementData(), getCategories(),
  ]);

  // A dashboard with no tables behind it should say so plainly rather than
  // render twelve zeroes that look like a business with no purchasing.
  if (!data.ready) {
    return (
      <div className="empty">
        <h1>{t("procurement", lang)}</h1>
        <p>{t("procurementNeedsMigration", lang)}</p>
      </div>
    );
  }

  if (!data.suppliers.length) {
    return (
      <>
        <h1>{t("procurement", lang)}</h1>
        <div className="empty">
          <p>{t("procurementNoSuppliers", lang)}</p>
          <Link className="btn btn-amber" href="/admin/procurement/suppliers">
            + {t("newSupplier", lang)}
          </Link>
        </div>
      </>
    );
  }

  return (
    <ProcurementDashboard
      lang={lang}
      suppliers={data.suppliers}
      purchaseOrders={data.purchaseOrders}
      categories={cats.map((c) => ({ id: c.id, name: c.name }))}
    />
  );
}
