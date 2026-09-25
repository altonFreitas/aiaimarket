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
  /** Whether a customer could open the link this message would carry.
   *
   * Absent means "assume not". A message about a product the public cannot
   * see is a message whose link 404s, which is worse than silence and costs
   * the same to send. */
  status?: string | null;
  archived?: boolean | null;
}

/** Why an announcement reached nobody.
 *
 * EVERY ONE OF THESE USED TO BE A SILENT `return 0`. A shop added a
 * product, no message went out, and nothing anywhere said why -- while
 * /admin/notifications reported "all messages sent", which was true of the
 * queue and false of the promise. The reasons are named so the screens can
 * say them out loud; see announceHealth() below, which reports the
 * configuration ones before a product is even saved. */
export type AnnounceBlock =
  /** The product is a draft or archived: its page is not public. */
  | "not_public"
  /** NEXT_PUBLIC_SITE_URL is unset, so the link would be a relative path
   *  and unclickable in a text message. */
  | "no_origin"
  /** supabase/customer-alerts.sql has not been run. */
  | "not_migrated"
  /** Nobody has asked to be told, or nobody who has left a phone number. */
  | "no_recipients"
  /** Everybody who wanted this already has it -- customer_alerts_once did
   *  its job. Zero queued and nothing wrong. */
  | "already_announced"
  /** The read or the write failed for some other reason, which has been
   *  reported. */
  | "unavailable";

export interface AnnounceResult {
  queued: number;
  /** Null when something was queued. */
  blocked: AnnounceBlock | null;
}

/** WHETHER AN ANNOUNCEMENT MADE NOW WOULD REACH ANYBODY.
 *
 * Read by the admin's message screen, so the two faults that switch this
 * feature off silently -- an unset NEXT_PUBLIC_SITE_URL and an unrun
 * migration -- are visible before somebody adds a product and wonders where
 * the messages went. Never throws: this is a diagnostic, and a diagnostic
 * that can take the page down with it is not one. */
export async function announceHealth(): Promise<AnnounceHealth> {
  const origin = !!(process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  const automatic = activeProvider() !== null;
  let migrated = false;
  let recipients = 0;
  try {
    const sb = supabaseAdmin();
    // head:true asks for the count and no rows: the question is "how many",
    // and the phone numbers themselves are none of this function's business.
    const [alerts, opted] = await Promise.all([
      sb.from("customer_alerts").select("id", { count: "exact", head: true }).limit(1),
      sb.from("customers").select("id", { count: "exact", head: true })
        .eq("notify_new_products", true).neq("phone", ""),
    ]);
    migrated = !alerts.error;
    recipients = opted.error ? 0 : (opted.count ?? 0);
  } catch {
    /* Leaves migrated false and recipients zero, which is what the screen
       should say when the database cannot be reached at all. */
  }
  return {
    ready: origin && migrated && recipients > 0,
    origin, migrated, recipients, automatic,
  };
}

export interface AnnounceHealth {
  /** True when an announcement made now would actually reach somebody. */
  ready: boolean;
  /** NEXT_PUBLIC_SITE_URL is set, so the message can carry a tappable link. */
  origin: boolean;
  /** supabase/customer-alerts.sql has been run. */
  migrated: boolean;
  /** Customers opted in with a number to reach. */
  recipients: number;
  /** A gateway is configured, so a queued message sends itself. */
  automatic: boolean;
}

/** Queues one announcement about `product` for every customer who asked for
 * them, and sends it when a gateway is configured.
 *
 * Never throws: a shop must be able to add a product when the message queue
 * is broken, missing, or has not had its migration run. Returns how many
 * were queued AND, when that is zero, why -- because every one of these
 * paths used to return a bare 0 and the shop had no way to tell "nobody
 * asked to be told" from "this feature is switched off".
 */
export async function queueProductAlerts(
  product: AnnounceableProduct, kind: AlertKind, storeName: string
): Promise<AnnounceResult> {
  try {
    /* A DRAFT IS NOT NEWS. Checked here rather than at each call site: the
       product form announces a new listing, the same form announces a price
       cut, and receiving makes products too -- three callers, each of which
       would have had to remember. A message linking to a page the public
       cannot open is the empty-shelf mistake the stock ordering below
       exists to avoid, one step further along. */
    if (product.status !== "approved" || product.archived) {
      return { queued: 0, blocked: "not_public" };
    }
    // Same rule the order queue applies: without an absolute origin the
    // link is a relative path, unclickable in a text message.
    const origin = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
    // Without an absolute origin the link is a relative path, which is
    // unclickable in a text message. A message nobody can act on is worse
    // than no message, and it still costs the same to send.
    if (!origin) return { queued: 0, blocked: "no_origin" };

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
    /* Told apart on purpose. "Nobody has asked" is the ordinary state of a
       new shop and nothing to fix; a failed read is a fault, and reporting
       it as "nobody asked" is how a fault stays hidden for a month. */
    if (error) {
      reportError(error, { scope: "queueProductAlerts.customers", kind });
      return { queued: 0, blocked: "unavailable" };
    }
    if (!customers.length) return { queued: 0, blocked: "no_recipients" };

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
      return { queued: 0, blocked: "not_migrated" };
    }

    const queued = inserted?.length ?? 0;
    /* Zero after a SUCCESSFUL upsert means customer_alerts_once swallowed
       every row: everybody who wanted this has already had it. Nothing is
       wrong, and saying so is what stops somebody hunting for a fault that
       is actually the brake working. */
    if (!queued) return { queued: 0, blocked: "already_announced" };
    // No gateway: they wait for the admin, exactly as an order message does.
    if (!provider) return { queued, blocked: null };

    /* Sent one at a time through the same path the order queue uses, so a
       retry, a failure and a cost estimate all behave identically. */
    for (const row of inserted!) {
      await dispatchNotification(
        row.id as string, String(row.to_phone), String(row.body), "customer_alerts");
    }
    return { queued, blocked: null };
  } catch (err) {
    reportError(err, { scope: "queueProductAlerts", kind, product: product.id });
    return { queued: 0, blocked: "unavailable" };
  }
}
