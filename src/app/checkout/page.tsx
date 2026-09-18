import CheckoutForm from "@/components/CheckoutForm";
import { getCategories, getSettings } from "@/lib/data/public";
import { getLang } from "@/lib/lang";
import { cardPaymentAvailable } from "@/lib/payments/registry";
import { categoryTaxRates } from "@/lib/tax";

export default async function CheckoutPage() {
  const [lang, settings, categories] = await Promise.all([
    getLang(), getSettings(), getCategories(),
  ]);
  // Resolved on the server: the card option is only offered when a gateway
  // is actually configured. Showing a payment method that throws the moment
  // it is chosen is worse than not showing it -- by then the buyer has
  // already committed to the order.
  return (
    <CheckoutForm
      lang={lang} settings={settings} cardAvailable={cardPaymentAvailable()}
      /* Read fresh on every render, not copied into the basket when a
         product was added: a basket can sit in a browser for a week, and a
         rate saved into it then would quote the shopper last week's tax. */
      taxRates={categoryTaxRates(categories)} />
  );
}
