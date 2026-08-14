"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { customerLogout } from "@/lib/actions/customer-auth";
import { updateCustomerNotifyPreference } from "@/lib/actions/customer";
import { t } from "@/lib/i18n";
import type { Customer, Lang } from "@/lib/types";

export default function CustomerPanel({ lang, customer }: { lang: Lang; customer: Customer }) {
  const router = useRouter();
  const { toast } = useToast();
  const [notify, setNotify] = useState(customer.notify_new_products);
  const [busy, setBusy] = useState(false);

  async function toggleNotify(v: boolean) {
    setNotify(v);
    setBusy(true);
    try {
      await updateCustomerNotifyPreference(v);
    } catch (e) {
      toast(String((e as Error).message), true);
      setNotify(!v);
    }
    setBusy(false);
  }

  async function logout() {
    await customerLogout();
    router.push("/account");
    router.refresh();
  }

  return (
    <div className="panel">
      <h1>{t("myAccount", lang)}</h1>
      <p className="sub">{customer.email}</p>

      <label className="check" data-on={notify} style={{ marginTop: 12 }}>
        <input type="checkbox" checked={notify} disabled={busy} onChange={(e) => toggleNotify(e.target.checked)} />
        <span>{t("notifyNewProducts", lang)}</span>
      </label>

      <p className="hint" style={{ marginTop: 10 }}>{t("accountOptionalHint", lang)}</p>

      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="btn btn-ghost" type="button" onClick={logout}>{t("logOut", lang)}</button>
      </div>
    </div>
  );
}
