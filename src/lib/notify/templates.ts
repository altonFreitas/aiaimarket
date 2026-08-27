import { forceGsm7Enabled, toGsm7 } from "@/lib/sms";
import type { Lang } from "@/lib/types";

/* ---------------------------------------------------------------------------
 * What the buyer actually reads.
 *
 * Kept apart from the sending machinery on purpose: these strings are the
 * store's voice, they need review by someone who speaks Tetun (the README
 * already flags that the UI strings are a solid first draft, not verified
 * copy), and that review should not require reading an API client.
 *
 * Two rules shape every line below, and both are about SMS specifically:
 *
 *   1. Every message ends with the tracking link and nothing after it. A link
 *      with text trailing behind it gets fewer taps, and the tap is the point.
 *      It also keeps the link intact if a carrier truncates the tail.
 *
 *   2. Short, because SMS is billed per 160-character segment -- and per 70
 *      once a message contains a character GSM-7 lacks, which in Tetun and
 *      Portuguese means almost any accent (see lib/sms.ts). The tracking URL
 *      alone is ~60 characters, so the prose around it has very little room
 *      before the store is paying twice for the same update. Tests assert
 *      these stay inside one segment for a typical order.
 * ------------------------------------------------------------------------ */

export type NotifyEvent =
  | "placed" | "confirmed" | "out" | "arrived" | "completed" | "cancelled";

/** Which moments are worth a message.
 *
 * "preparing" is deliberately absent. A buyer who has just been told their
 * order is confirmed does not need a second message minutes later saying it
 * is being prepared -- that is the same news twice, and the fastest way to
 * train someone to ignore this channel. Every event below tells them
 * something they could not have predicted, or asks them to do something.
 */
export const NOTIFY_EVENTS: readonly NotifyEvent[] = [
  "placed", "confirmed", "out", "arrived", "completed", "cancelled",
];

export interface TemplateVars {
  ref: string;
  storeName: string;
  total: string;
  url: string;
}

type Trio = [tet: string, pt: string, en: string];

/** `{ref}`, `{store}`, `{total}` and `{url}` are substituted.
 *
 * The store name appears only in the first message. After that the buyer is
 * in a thread they recognise, and repeating it costs segments that say
 * nothing. The order reference carries the identification instead.
 *
 * The Tetun and Portuguese wording is chosen to stay inside GSM-7, which is
 * why it reads "Estamos a preparar" rather than "Estamos a prepará-la" and
 * "Avalie aqui" rather than "Deixe a sua avaliação". One á or ã drops the
 * whole message to 70 characters per segment, and with the tracking link
 * included that turns a one-segment message into three -- triple price, for a
 * diacritic. These are natural phrasings, not misspellings: the accents are
 * avoided by choosing different words, never by stripping marks from words
 * that need them. A test asserts every message still fits one segment, so an
 * edit that reintroduces one fails rather than quietly costing money. */
const MESSAGES: Record<NotifyEvent, Trio> = {
  placed: [
    "{store}: simu ona enkomenda {ref}, {total}. Haree:\n{url}",
    "{store}: recebemos a encomenda {ref}, {total}. Acompanhe:\n{url}",
    "{store}: order {ref} received, {total}. Track it:\n{url}",
  ],
  confirmed: [
    "Enkomenda {ref} konfirmadu ona. Ami prepara hela. Haree:\n{url}",
    "Encomenda {ref} confirmada. Estamos a preparar. Acompanhe:\n{url}",
    "Order {ref} confirmed. We're getting it ready. Track it:\n{url}",
  ],
  out: [
    "Enkomenda {ref} iha dalan ona ba ita. Haree:\n{url}",
    "Encomenda {ref} saiu para entrega. Acompanhe:\n{url}",
    "Order {ref} is on its way to you. Track it:\n{url}",
  ],
  arrived: [
    "Ami to'o ona ho enkomenda {ref}. Ami bolu ita agora.\n{url}",
    "Chegamos com a encomenda {ref}. Vamos ligar-lhe.\n{url}",
    "We've arrived with order {ref}. We're calling you now.\n{url}",
  ],
  completed: [
    "Obrigadu! Enkomenda {ref} kompletu ona. Avalia iha ne'e:\n{url}",
    "Obrigado! Encomenda {ref} entregue. Avalie aqui:\n{url}",
    "Thank you! Order {ref} is complete. Leave a review:\n{url}",
  ],
  cancelled: [
    "Enkomenda {ref} kansela ona. Kontaktu ami se presiza.\n{url}",
    "Encomenda {ref} cancelada. Contacte-nos se precisar.\n{url}",
    "Order {ref} has been cancelled. Contact us if you need to.\n{url}",
  ],
};

const LANG_INDEX: Record<Lang, 0 | 1 | 2> = { tet: 0, pt: 1, en: 2 };

export function renderNotification(event: NotifyEvent, lang: Lang, vars: TemplateVars): string {
  const trio = MESSAGES[event];
  // Falls back to Tetun rather than throwing: an unknown language stored on
  // an old order must not be the reason a buyer hears nothing.
  const template = trio[LANG_INDEX[lang] ?? 0] ?? trio[0];
  const rendered = template
    .replace(/\{ref\}/g, vars.ref)
    .replace(/\{store\}/g, vars.storeName)
    .replace(/\{total\}/g, vars.total)
    .replace(/\{url\}/g, vars.url);

  // Opt-in, because flattening accents is a decision about the store's voice
  // -- see toGsm7(). When it is on, it roughly halves the cost of every
  // message that contains one.
  return forceGsm7Enabled() ? toGsm7(rendered) : rendered;
}

/** Maps an order status to the event worth telling the buyer about, or null
 * when that status is not one of them. Keeping this here rather than at the
 * call sites means "which statuses notify" is one decision in one place. */
export function eventForStatus(status: string): NotifyEvent | null {
  switch (status) {
    case "confirmed": return "confirmed";
    case "out": return "out";
    case "arrived": return "arrived";
    case "completed": return "completed";
    case "cancelled": return "cancelled";
    default: return null; // 'new' is covered by 'placed'; 'preparing' is noise
  }
}
