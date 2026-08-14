import RegisterForm from "@/components/seller/RegisterForm";
import { getLang } from "@/lib/lang";
import { getSettings } from "@/lib/data/public";
import { t } from "@/lib/i18n";

export default async function SellerRegisterPage() {
  const [lang, settings] = await Promise.all([getLang(), getSettings()]);

  if (!settings.seller_registration_enabled) {
    return (
      <div className="wrap" style={{ maxWidth: 560 }}>
        <div className="panel">
          <h1>{t("sellerRegisterTitle", lang)}</h1>
          <p className="sub">{t("sellerRegistrationClosed", lang)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap" style={{ maxWidth: 560 }}>
      <RegisterForm lang={lang} />
    </div>
  );
}
