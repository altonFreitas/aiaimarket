import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { activeProvider } from "./registry";
import { dispatchNotification } from "./service";
import { forceGsm7Enabled, toGsm7 } from "@/lib/sms";
import { money } from "@/lib/utils";
import { reportError } from "@/lib/observability";
import type { Lang } from "@/lib/types";

/* TELLING CUSTOMERS WHAT IS NEW.
 *
 * customers.notify_new_products has existed since the account page did, and
 * nothing read it. A customer ticking "tell me about new products" was told
 * nothing, ever -- a promise the shop was making and not keeping.
 *
 * WHAT THIS COSTS, said out loud: one message per opted-in customer, per
 * product. A shop with four hundred customers adding ten products in a
 * morning has queued four thousand messages. That is why:
 *
 *   - nothing is sent unless a gateway is configured. With none, the
 *     messages queue and the admin sends them, exactly as order
 *     notifications already behave -- so the feature cannot start spending
 *     money by itself.
 *   - a unique index makes a second blast impossible. Editing a product
 *     five times on the morning it goes live announces it once.
 *   - a hard ceiling per announcement, below, is the difference between a
 *     mistake and an invoice.
 */

/** The most people one announcement will reach.
 *
 * Not a business rule -- a blast radius. If a shop ever has more customers
 * than this, somebody should decide deliberately how to reach them all
 * rather than discovering the number on a phone bill. */
const MAX_RECIPIENTS = 500;

export type AlertKind = "new_product" | "discount";

/* The messages, in the shop's three languages. Short on purpose: an SMS is
   billed per 160 characters, and a link that survives is worth more than an
   adjective that does not. */
const BODY: Record<AlertKind, [string, string, string]> = {
  new_product: [
    "{store}: sasan foun — {name}, {price}. Haree: {url}",
    "{store}: novidade — {name}, {price}. Ver: {url}",
    "{store}: new in — {name}, {price}. See it: {url}",
  ],
  discount: [
    "{store}: folin tun — {name} agora {price} (antes {was}). {url}",
    "{store}: desconto — {name} agora {price} (antes {was}). {url}",
    "{store}: price drop — {name} now {price} (was {was}). {url}",
  ],
};

const LANG_INDEX: Record<Lang, number> = { tet: 0, pt: 1, en: 2 };

function render(
  kind: AlertKind, lang: Lang,
  vars: { store: string; name: string; price: string; was: string; url: string }
): string {
  const trio = BODY[kind];
  const out = (trio[LANG_INDEX[lang] ?? 0] ?? trio[0])
    .replace(/\{store\}/g, vars.store)
    .replace(/\{name\}/g, vars.name)
    .replace(/\{price\}/g, vars.price)
    .replace(/\{was\}/g, vars.was)
    .replace(/\{url\}/g, vars.url);
  return forceGsm7Enabled() ? toGsm7(out) : out;
}

export interface AnnounceableProduct {
  id: string;
  name: string;
  slug: string;
  price: number;
  discount_price?: number | null;
}

/** Queues one announcement about `product` for every customer who asked for
 * them, and sends it when a gateway is configured.
 *
 * Never throws: a shop must be able to add a product when the message queue
 * is broken, missing, or has not had its migration run. Returns how many
 * were queued, for the caller that wants to say so.
 */
export async function queueProductAlerts(
  product: AnnounceableProduct, kind: AlertKind, storeName: string
): Promise<number> {
  try {
    // Same rule the order queue applies: without an absolute origin the
    // link is a relative path, unclickable in a text message.
    const origin = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
    // Without an absolute origin the link is a relative path, which is
    // unclickable in a text message. A message nobody can act on is worse
    // than no message, and it still costs the same to send.
    if (!origin) return 0;

    const sb = supabaseAdmin();

    /* WHO ASKED. Opted in, and with a number to reach: a customer who
       signed up without a phone cannot be sent an SMS, and queueing an
       empty recipient would give the admin a row they can only delete. */
    const { data: customers, error } = await sb
      .from("customers")
      .select("id, phone, notify_new_products")
      .eq("notify_new_products", true)
      .neq("phone", "")
      .limit(MAX_RECIPIENTS);
    if (error || !customers?.length) return 0;

    const provider = activeProvider();
    const url = `${origin}/p/${product.slug}`;
    const price = money(product.discount_price ?? product.price);
    const was = money(product.price);

    /* One language for everybody, because a customer row does not record
       one. Tetun is the shop's own default and the language most of its
       customers read; the alternative -- guessing from a phone prefix -- is
       a worse answer wearing a better disguise. */
    const lang: Lang = "tet";
    const body = render(kind, lang, { store: storeName, name: product.name, price, was, url });

    const rows = customers.map((c) => ({
      customer_id: c.id as string,
      product_id: product.id,
      kind,
      to_phone: String(c.phone),
      lang,
      body,
      channel: provider ? provider.channel : "manual",
      provider: provider?.id || "",
      status: "queued",
    }));

    /* IGNORE WHAT IS ALREADY THERE. customer_alerts_once means a product
       edited five times on the morning it goes live is announced once, and
       this is the line that relies on it rather than checking first and
       racing another save. */
    const { data: inserted, error: insErr } = await sb
      .from("customer_alerts")
      .upsert(rows, { onConflict: "customer_id,product_id,kind", ignoreDuplicates: true })
      .select("id, to_phone, body");
    if (insErr) {
      // Most likely supabase/customer-alerts.sql has not been run. Warn; do
      // not fail the save that triggered this.
      console.warn("Could not queue product alerts:", insErr.message);
      return 0;
    }

    const queued = inserted?.length ?? 0;
    // No gateway: they wait for the admin, exactly as an order message does.
    if (!provider || !queued) return queued;

    /* Sent one at a time through the same path the order queue uses, so a
       retry, a failure and a cost estimate all behave identically. */
    for (const row of inserted!) {
      await dispatchNotification(
        row.id as string, String(row.to_phone), String(row.body), "customer_alerts");
    }
    return queued;
  } catch (err) {
    reportError(err, { scope: "queueProductAlerts", kind, product: product.id });
    return 0;
  }
}
