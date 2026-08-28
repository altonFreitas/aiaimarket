import Link from "next/link";
import ProcurementDashboard from "@/components/admin/procurement/ProcurementDashboard";
import { adminProcurementData } from "@/lib/data/procurement";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";

export default async function ProcurementPage() {
  const [lang, data] = await Promise.all([getLang(), adminProcurementData()]);

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
    />
  );
}
