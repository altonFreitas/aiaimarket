import CheckoutForm from "@/components/CheckoutForm";
import { getSettings } from "@/lib/data/public";
import { getLang } from "@/lib/lang";
import { cardPaymentAvailable } from "@/lib/payments/registry";

export default async function CheckoutPage() {
  const [lang, settings] = await Promise.all([getLang(), getSettings()]);
  // Resolved on the server: the card option is only offered when a gateway
  // is actually configured. Showing a payment method that throws the moment
  // it is chosen is worse than not showing it -- by then the buyer has
  // already committed to the order.
  return <CheckoutForm lang={lang} settings={settings} cardAvailable={cardPaymentAvailable()} />;
}
