import { describe, it, expect, afterEach, vi } from "vitest";
import crypto from "node:crypto";

/** The gateway adapter reads its config at module load, so each test group
 * sets env then imports fresh. */
const SECRET = "test-webhook-secret";

async function loadProvider(env: Record<string, string> = {}) {
  vi.resetModules();
  process.env.MPGS_HOST = "https://gw.example.com";
  process.env.MPGS_MERCHANT_ID = "MERCH1";
  process.env.MPGS_API_PASSWORD = "pw";
  process.env.MPGS_API_VERSION = "100";
  process.env.MPGS_WEBHOOK_SECRET = SECRET;
  process.env.MPGS_SIGNATURE_HEADER = "x-notification-signature";
  Object.assign(process.env, env);
  const mod = await import("@/lib/payments/providers/mpgs");
  return mod.mpgsProvider;
}

function sign(body: string, secret = SECRET) {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

const headersWith = (sig: string, name = "x-notification-signature") =>
  new Headers({ [name]: sig });

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("isConfigured", () => {
  it("is true only when host, merchant and password are all present", async () => {
    expect((await loadProvider()).isConfigured()).toBe(true);
    expect((await loadProvider({ MPGS_HOST: "" })).isConfigured()).toBe(false);
    expect((await loadProvider({ MPGS_MERCHANT_ID: "" })).isConfigured()).toBe(false);
    expect((await loadProvider({ MPGS_API_PASSWORD: "" })).isConfigured()).toBe(false);
  });
});

describe("verifyWebhook", () => {
  const body = JSON.stringify({ order: { id: "p1" } });

  it("accepts a correctly signed body", async () => {
    const p = await loadProvider();
    expect(p.verifyWebhook(body, headersWith(sign(body)))).toEqual({ ok: true });
  });

  it("rejects a tampered body", async () => {
    const p = await loadProvider();
    const sig = sign(body);
    const tampered = JSON.stringify({ order: { id: "p1" }, amount: "0.01" });
    expect(p.verifyWebhook(tampered, headersWith(sig)).ok).toBe(false);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const p = await loadProvider();
    expect(p.verifyWebhook(body, headersWith(sign(body, "attacker"))).ok).toBe(false);
  });

  it("rejects a missing signature header", async () => {
    const p = await loadProvider();
    const v = p.verifyWebhook(body, new Headers());
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/missing/);
  });

  it("FAILS CLOSED when no secret is configured", async () => {
    // The critical one: an unverifiable webhook endpoint that marks orders
    // paid is a "mark any order paid" endpoint for anyone who finds the URL.
    const p = await loadProvider({ MPGS_WEBHOOK_SECRET: "" });
    const v = p.verifyWebhook(body, headersWith(sign(body)));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/SECRET/);
  });

  it("does not throw on a wrong-length signature", async () => {
    // timingSafeEqual throws on length mismatch; a throw here would become
    // a 500 and make the gateway retry a request that can never succeed.
    const p = await loadProvider();
    expect(() => p.verifyWebhook(body, headersWith("abc"))).not.toThrow();
    expect(p.verifyWebhook(body, headersWith("abc")).ok).toBe(false);
  });

  it("honours a custom signature header name", async () => {
    const p = await loadProvider({ MPGS_SIGNATURE_HEADER: "x-bnctl-sig" });
    expect(p.verifyWebhook(body, headersWith(sign(body), "x-bnctl-sig"))).toEqual({ ok: true });
    expect(p.verifyWebhook(body, headersWith(sign(body))).ok).toBe(false);
  });
});

describe("parseEvent — status mapping", () => {
  const cases: Array<[string, string, string]> = [
    // [gateway result, gateway status, our status]
    ["SUCCESS", "CAPTURED", "captured"],
    ["SUCCESS", "PARTIALLY_CAPTURED", "captured"],
    ["SUCCESS", "AUTHORIZED", "authorized"],
    ["SUCCESS", "PENDING_CAPTURE", "authorized"],
    ["SUCCESS", "REFUNDED", "refunded"],
    ["FAILURE", "FAILED", "failed"],
    ["FAILURE", "DECLINED", "failed"],
    ["SUCCESS", "CANCELLED", "cancelled"],
    ["SUCCESS", "EXPIRED", "cancelled"],
  ];

  it.each(cases)("maps result=%s status=%s to %s", async (result, status, expected) => {
    const p = await loadProvider();
    const body = JSON.stringify({ result, order: { id: "pay-1", status, amount: "19.99", currency: "USD" } });
    expect(p.parseEvent(body).status).toBe(expected);
  });

  it("falls back to pending for an unrecognised status", async () => {
    const p = await loadProvider();
    const body = JSON.stringify({ order: { id: "pay-1", status: "SOMETHING_NEW" } });
    expect(p.parseEvent(body).status).toBe("pending");
  });

  it("treats a bare FAILURE result as failed even with no status", async () => {
    const p = await loadProvider();
    const body = JSON.stringify({ result: "FAILURE", order: { id: "pay-1" } });
    expect(p.parseEvent(body).status).toBe("failed");
  });
});

describe("parseEvent — payload extraction", () => {
  it("pulls the payment id, amount in minor units, and currency", async () => {
    const p = await loadProvider();
    const body = JSON.stringify({
      result: "SUCCESS",
      order: { id: "pay-abc", status: "CAPTURED", amount: "19.99", currency: "USD" },
      transaction: { id: "txn-1" },
    });
    const ev = p.parseEvent(body);
    expect(ev.paymentId).toBe("pay-abc");
    expect(ev.amountMinor).toBe(1999); // converted to cents, not left as 19.99
    expect(ev.currency).toBe("USD");
    expect(ev.eventId).toBe("txn-1");
  });

  it("throws when there is no order id to attach the event to", async () => {
    const p = await loadProvider();
    expect(() => p.parseEvent(JSON.stringify({ result: "SUCCESS" }))).toThrow(/no order id/);
  });

  it("derives a stable eventId when the gateway sends no transaction id", async () => {
    // Byte-identical redeliveries must still dedupe.
    const p = await loadProvider();
    const body = JSON.stringify({ result: "SUCCESS", order: { id: "pay-1", status: "CAPTURED" } });
    const a = p.parseEvent(body).eventId;
    const b = p.parseEvent(body).eventId;
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });

  it("returns null amount rather than a bogus one for unparseable input", async () => {
    const p = await loadProvider();
    const body = JSON.stringify({ order: { id: "pay-1", amount: "not-a-number" } });
    expect(p.parseEvent(body).amountMinor).toBeNull();
  });
});

describe("createCheckout", () => {
  it("sends the amount as a formatted decimal derived from minor units", async () => {
    const p = await loadProvider();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ session: { id: "SESS1" }, checkoutUrl: "https://gw.example.com/pay/SESS1" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const session = await p.createCheckout({
      paymentId: "pay-1", orderRef: "CD2026123", amountMinor: 1999,
      currency: "USD", description: "Order CD2026123", returnUrl: "https://shop.tl/return",
    });

    expect(session.redirectUrl).toBe("https://gw.example.com/pay/SESS1");
    expect(session.providerRef).toBe("pay-1");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/rest/version/100/merchant/MERCH1/session");
    const body = JSON.parse(String(init.body));
    // "19.99", never 19.99 as a float literal.
    expect(body.order.amount).toBe("19.99");
    expect(typeof body.order.amount).toBe("string");
    expect(body.order.id).toBe("pay-1");
    expect(body.interaction.returnUrl).toBe("https://shop.tl/return");
    expect(String((init.headers as Record<string, string>).Authorization)).toMatch(/^Basic /);
  });

  it("refuses to call the gateway when unconfigured", async () => {
    const p = await loadProvider({ MPGS_HOST: "" });
    await expect(p.createCheckout({
      paymentId: "p", orderRef: "R", amountMinor: 100, currency: "USD",
      description: "d", returnUrl: "u",
    })).rejects.toThrow(/not configured/);
  });

  it("surfaces a gateway rejection instead of pretending it worked", async () => {
    const p = await loadProvider();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 400 })));
    await expect(p.createCheckout({
      paymentId: "p", orderRef: "R", amountMinor: 100, currency: "USD",
      description: "d", returnUrl: "u",
    })).rejects.toThrow(/rejected the request/);
  });

  it("throws when the gateway returns no session id", async () => {
    const p = await loadProvider();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    await expect(p.createCheckout({
      paymentId: "p", orderRef: "R", amountMinor: 100, currency: "USD",
      description: "d", returnUrl: "u",
    })).rejects.toThrow(/did not return a checkout session/);
  });
});

describe("fetchStatus", () => {
  it("normalizes a status poll the same way a webhook is normalized", async () => {
    const p = await loadProvider();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ result: "SUCCESS", status: "CAPTURED", amount: "5.00", currency: "USD" }), { status: 200 })
    ));
    const ev = await p.fetchStatus("pay-1");
    expect(ev?.status).toBe("captured");
    expect(ev?.amountMinor).toBe(500);
    expect(ev?.paymentId).toBe("pay-1");
  });

  it("returns null on a gateway error rather than inventing a status", async () => {
    const p = await loadProvider();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
    expect(await p.fetchStatus("pay-1")).toBeNull();
  });

  it("returns null when unconfigured", async () => {
    const p = await loadProvider({ MPGS_HOST: "" });
    expect(await p.fetchStatus("pay-1")).toBeNull();
  });
});
