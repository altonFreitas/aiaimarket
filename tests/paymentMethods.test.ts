import { describe, it, expect } from "vitest";
import {
  PAYMENT_METHODS, paymentMethodStatus, readyMethods,
} from "@/lib/payments/methods";

const CARD = {
  MPGS_HOST: "https://gateway.example",
  MPGS_MERCHANT_ID: "m1",
  MPGS_API_PASSWORD: "secret",
};

const statusOf = (env: Record<string, string | undefined>, id: string) =>
  paymentMethodStatus(env).find((m) => m.id === id)!;

describe("paymentMethodStatus", () => {
  it("reports nothing ready on an unconfigured shop", () => {
    const all = paymentMethodStatus({});
    expect(all.every((m) => !m.ready)).toBe(true);
    expect(readyMethods({})).toEqual([]);
  });

  it("asks for exactly what the gateway itself checks", () => {
    // The panel and lib/payments/providers/mpgs.ts must agree. A panel that
    // is more lenient calls a broken shop ready and the failure lands on a
    // buyer at checkout; one that is stricter sends the owner hunting for a
    // variable they do not need.
    expect(statusOf({}, "card").missing)
      .toEqual(["MPGS_HOST", "MPGS_MERCHANT_ID", "MPGS_API_PASSWORD"]);
  });

  it("does not demand PAYMENT_PROVIDER, which has a working default", () => {
    // registry.ts falls back to the card provider when it is unset.
    expect(statusOf(CARD, "card").ready).toBe(true);
    expect(statusOf(CARD, "card").missing).toEqual([]);
  });

  it("is not fooled by a merchant id and password with no host", () => {
    const half = { MPGS_MERCHANT_ID: "m1", MPGS_API_PASSWORD: "secret" };
    expect(statusOf(half, "card").ready).toBe(false);
    expect(statusOf(half, "card").missing).toEqual(["MPGS_HOST"]);
  });

  it("names exactly what is missing", () => {
    expect(statusOf({}, "paypal").missing)
      .toEqual(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]);
    expect(statusOf({ PAYPAL_CLIENT_ID: "x" }, "paypal").missing)
      .toEqual(["PAYPAL_CLIENT_SECRET"]);
  });

  it("treats an empty string as unset", () => {
    // A variable set to "" in a deploy config is the commonest way to
    // think something is configured when it is not.
    expect(statusOf({ ...CARD, MPGS_API_PASSWORD: "" }, "card").ready).toBe(false);
    expect(statusOf({ ...CARD, MPGS_API_PASSWORD: "   " }, "card").ready).toBe(false);
  });

  it("turns cards on when the acquirer is configured", () => {
    expect(statusOf(CARD, "card").ready).toBe(true);
    expect(readyMethods(CARD)).toEqual(["card"]);
  });
});

describe("the wallets ride on the card acquirer", () => {
  it("keeps Apple Pay and Google Pay off while there is no card gateway", () => {
    // The correction this file exists to encode: they are not separate
    // gateways, so their own credentials cannot make them work alone.
    const env = { APPLE_PAY_MERCHANT_ID: "a", GOOGLE_PAY_MERCHANT_ID: "g" };
    expect(statusOf(env, "applepay").ready).toBe(false);
    expect(statusOf(env, "googlepay").ready).toBe(false);
  });

  it("says the card gateway is what is holding them up", () => {
    const env = { APPLE_PAY_MERCHANT_ID: "a" };
    const apple = statusOf(env, "applepay");
    expect(apple.blockedBy).toBe("card");
    // And not by anything of its own, which is already set.
    expect(apple.missing).toEqual([]);
  });

  it("does not blame the dependency when its own credentials are missing too", () => {
    // Both are wrong; the actionable one is still worth listing.
    const apple = statusOf({}, "applepay");
    expect(apple.missing).toEqual(["APPLE_PAY_MERCHANT_ID"]);
    expect(apple.blockedBy).toBe("card");
  });

  it("turns them on once the acquirer and their own ids are present", () => {
    const env = { ...CARD, APPLE_PAY_MERCHANT_ID: "a", GOOGLE_PAY_MERCHANT_ID: "g" };
    expect(statusOf(env, "applepay").ready).toBe(true);
    expect(statusOf(env, "googlepay").ready).toBe(true);
    expect(readyMethods(env)).toEqual(["card", "applepay", "googlepay"]);
  });

  it("still names the file Apple needs served from the domain", () => {
    // Not a credential, so nothing here can check it. It has to be said.
    const env = { ...CARD, APPLE_PAY_MERCHANT_ID: "a" };
    expect(statusOf(env, "applepay").manualStepKey).toBe("payApplePayDomain");
    expect(statusOf(env, "googlepay").manualStepKey).toBeUndefined();
  });
});

describe("the genuinely separate ones", () => {
  it("lets PayPal work with no card acquirer at all", () => {
    const env = { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "sh" };
    expect(statusOf(env, "paypal").ready).toBe(true);
    expect(statusOf(env, "card").ready).toBe(false);
    expect(readyMethods(env)).toEqual(["paypal"]);
  });

  it("lets MB WAY work on its own credentials", () => {
    const env = { MBWAY_CLIENT_ID: "c", MBWAY_API_KEY: "k" };
    expect(statusOf(env, "mbway").ready).toBe(true);
    expect(readyMethods(env)).toEqual(["mbway"]);
  });
});

describe("the catalogue itself", () => {
  it("has no duplicate ids", () => {
    const ids = PAYMENT_METHODS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lists every dependency before whatever depends on it", () => {
    // paymentMethodStatus resolves in order and would silently read a
    // missing entry as "not ready" if this were ever untrue.
    const seen = new Set<string>();
    for (const m of PAYMENT_METHODS) {
      if (m.dependsOn) expect([m.id, seen.has(m.dependsOn)]).toEqual([m.id, true]);
      seen.add(m.id);
    }
  });

  it("asks for at least one credential for each", () => {
    for (const m of PAYMENT_METHODS) expect([m.id, m.requires.length > 0]).toEqual([m.id, true]);
  });
});
