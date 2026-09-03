/* Every electronic way a shopper can pay, what each one needs, and whether
 * this shop has it.
 *
 * The point of this file is to answer "why is PayPal not on my checkout?"
 * on a screen, rather than by reading code. Each entry says what is
 * missing, so turning a method on is a list of things to obtain rather
 * than a guess.
 *
 * ONE CORRECTION WORTH READING, because it changes what there is to build.
 *
 * Apple Pay and Google Pay are NOT gateways. They are wallets: a way for a
 * shopper to hand over a card they have already saved on their phone,
 * without typing it. The money still moves through whatever card acquirer
 * this shop already uses, on the same merchant account, at the same rate,
 * and lands in the same place. So they are not integrations to build
 * against Apple or Google -- they are switches to turn on with the
 * acquirer, plus (for Apple) a file served from this domain so Apple can
 * verify the shop owns it.
 *
 * That is why they are listed here as depending on the card provider. A
 * shop with no card acquirer cannot have them, and no amount of code here
 * changes that.
 *
 * PayPal and MB WAY are genuinely separate: PayPal is its own account and
 * its own redirect, and MB WAY is a Portuguese scheme reached through SIBS
 * or through a PSP that offers it. Each needs its own credentials.
 *
 * Pure and env-injected, so the readiness of every method can be tested
 * without a live deployment.
 */

export type PaymentMethodId = "card" | "applepay" | "googlepay" | "paypal" | "mbway";

export interface MethodSpec {
  id: PaymentMethodId;
  /** i18n key for the name shown to a shopper and to the owner. */
  labelKey: string;
  /** Environment variables that must all be set for this to work. */
  requires: readonly string[];
  /** Another method that must itself be ready first. The wallets ride on
   * the card acquirer; without one they cannot exist. */
  dependsOn?: PaymentMethodId;
  /** Something that is not a credential and cannot be checked from here --
   * a file to host, a domain to register. i18n key, or absent. */
  manualStepKey?: string;
}

export const PAYMENT_METHODS: readonly MethodSpec[] = [
  {
    id: "card",
    labelKey: "payCard",
    // The existing acquirer. lib/payments/registry.ts decides which
    // provider is in play; these are what the default one needs.
    requires: ["PAYMENT_PROVIDER", "MPGS_MERCHANT_ID", "MPGS_API_PASSWORD"],
  },
  {
    id: "applepay",
    labelKey: "payApplePay",
    dependsOn: "card",
    requires: ["APPLE_PAY_MERCHANT_ID"],
    // The file at /.well-known/apple-developer-merchantid-domain-association
    // that Apple fetches to confirm the shop owns this domain. No
    // environment variable can stand in for it.
    manualStepKey: "payApplePayDomain",
  },
  {
    id: "googlepay",
    labelKey: "payGooglePay",
    dependsOn: "card",
    requires: ["GOOGLE_PAY_MERCHANT_ID"],
  },
  {
    id: "paypal",
    labelKey: "payPaypal",
    requires: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"],
  },
  {
    id: "mbway",
    labelKey: "payMbway",
    // Through SIBS directly, or through a PSP that offers MB WAY. Either
    // way it is its own credentials, not the card acquirer's.
    requires: ["MBWAY_CLIENT_ID", "MBWAY_API_KEY"],
  },
];

export interface MethodStatus {
  id: PaymentMethodId;
  labelKey: string;
  /** True only when everything it needs is present, including whatever it
   * depends on. */
  ready: boolean;
  /** The environment variables still to be set. */
  missing: string[];
  /** Set when the method is held up by the one it rides on rather than by
   * anything of its own -- so the screen can say "set up cards first"
   * instead of listing variables that would not help yet. */
  blockedBy?: PaymentMethodId;
  manualStepKey?: string;
}

/** Is a value present and not an empty string? An unset variable and one
 * set to "" mean the same thing here. */
function present(env: Record<string, string | undefined>, key: string): boolean {
  return typeof env[key] === "string" && env[key]!.trim() !== "";
}

/** What each method needs and whether it has it.
 *
 * Order follows PAYMENT_METHODS, so a dependency is always resolved before
 * anything that depends on it. */
export function paymentMethodStatus(
  env: Record<string, string | undefined>
): MethodStatus[] {
  const ready = new Map<PaymentMethodId, boolean>();
  const out: MethodStatus[] = [];

  for (const spec of PAYMENT_METHODS) {
    const missing = spec.requires.filter((k) => !present(env, k));
    const dependencyReady = spec.dependsOn ? ready.get(spec.dependsOn) === true : true;
    const isReady = missing.length === 0 && dependencyReady;

    ready.set(spec.id, isReady);
    out.push({
      id: spec.id,
      labelKey: spec.labelKey,
      ready: isReady,
      missing,
      // Only when the dependency is what is holding it up. If its own
      // credentials are missing too, those are the useful thing to say.
      ...(!dependencyReady ? { blockedBy: spec.dependsOn } : {}),
      ...(spec.manualStepKey ? { manualStepKey: spec.manualStepKey } : {}),
    });
  }
  return out;
}

/** The ones a shopper should actually be offered. */
export function readyMethods(env: Record<string, string | undefined>): PaymentMethodId[] {
  return paymentMethodStatus(env).filter((m) => m.ready).map((m) => m.id);
}
