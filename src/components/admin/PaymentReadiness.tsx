import { paymentMethodStatus, type MethodStatus } from "@/lib/payments/methods";
import Fold from "./Fold";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/* Which ways of paying are switched on, and what each one still needs.
 *
 * A server component on purpose. It reads process.env, and the answer must
 * not be sent to a browser: the NAMES of the missing variables are
 * harmless, their values are not, and the surest way never to leak one is
 * for the values never to leave the server. Only the names and a yes/no
 * cross the boundary. */
export default function PaymentReadiness({ lang }: { lang: Lang }) {
  const rows = paymentMethodStatus(process.env as Record<string, string | undefined>);

  // The headline stays readable with the panel shut. "Payment methods" on
  // a closed drawer says nothing; "3 of 5 ready" is the reason to open it.
  const ready = rows.filter((r) => r.ready).length;
  const allReady = ready === rows.length;

  return (
    <Fold
      lang={lang}
      title={t("payGateways", lang)}
      status={`${ready}/${rows.length} ${t("payReadyCount", lang)}`}
      tone={allReady ? "ok" : "warn"}
    >
      <p className="hint" style={{ marginTop: 0 }}>{t("payGatewaysHint", lang)}</p>

      <div className="pay-ready">
        {rows.map((r) => <Row key={r.id} r={r} lang={lang} />)}
      </div>

      {/* The thing that saves the most time, said once. */}
      <p className="note info" style={{ marginTop: 12 }}>{t("payWalletNote", lang)}</p>
    </Fold>
  );
}

function Row({ r, lang }: { r: MethodStatus; lang: Lang }) {
  return (
    <div className={"pay-row" + (r.ready ? " on" : "")}>
      <span className="pay-name">{t(r.labelKey, lang)}</span>
      <span className={"pill " + (r.ready ? "ok" : "muted")}>
        {t(r.ready ? "payReady" : "payNotSetUp", lang)}
      </span>
      <span className="pay-todo">
        {r.ready ? null : (
          <>
            {r.blockedBy && (
              <span className="pay-blocked">
                {t("payNeedsCardFirst", lang)}
              </span>
            )}
            {r.missing.length > 0 && (
              <code className="pay-vars">{r.missing.join("  ")}</code>
            )}
          </>
        )}
        {r.manualStepKey && (
          <span className="pay-manual">{t(r.manualStepKey, lang)}</span>
        )}
      </span>
    </div>
  );
}
