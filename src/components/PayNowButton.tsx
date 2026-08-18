"use client";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { startCardPayment } from "@/lib/actions/payments";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/** The buyer-facing entry point into the card payment flow.
 *
 * Everything this does is: ask the server for a gateway session, then send
 * the browser there. It deliberately holds no payment state and reads no
 * outcome -- the order's real pay_status arrives from the gateway's webhook
 * (see app/api/payments/[provider]/webhook), never from anything that
 * happens in this component.
 *
 * `busy` is never reset on success: the redirect is already underway, and
 * re-enabling the button would only invite a second click that opens a
 * second checkout session.
 */
export default function PayNowButton({
  orderRef, phone, lang, disabled,
}: { orderRef: string; phone: string; lang: Lang; disabled?: boolean }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function pay() {
    setBusy(true);
    try {
      const { redirectUrl } = await startCardPayment(orderRef, phone);
      toast(t("payRedirecting", lang));
      // Full navigation, not router.push: the destination is the bank's
      // own domain, so this leaves the app entirely.
      window.location.assign(redirectUrl);
    } catch (err) {
      toast(String((err as Error).message || t("payFailed", lang)), true);
      setBusy(false);
    }
  }

  return (
    <button
      className="btn btn-amber btn-sm"
      type="button"
      onClick={pay}
      disabled={busy || disabled}
      style={{ marginTop: 8 }}
    >
      {busy ? t("payRedirecting", lang) : t("payNow", lang)}
    </button>
  );
}
