import type { Lang } from "@/lib/types";

/* ---------------------------------------------------------------------------
 * What the buyer actually reads.
 *
 * Kept apart from the sending machinery on purpose: these strings are the
 * store's voice, they need review by someone who speaks Tetun (the README
 * already flags that the UI strings are a solid first draft, not verified
 * copy), and that review should not require reading an API client.
 *
 * Every message ends with the tracking link and nothing after it. A link with
 * text trailing behind it gets fewer taps, and the tap is the entire point.
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
  name: string;
  ref: string;
  storeName: string;
  total: string;
  url: string;
}

type Trio = [tet: string, pt: string, en: string];

/** `{name}`, `{ref}`, `{store}`, `{total}` and `{url}` are substituted. */
const MESSAGES: Record<NotifyEvent, Trio> = {
  placed: [
    "Botardi {name}! {store} simu ona ita-nia enkomenda {ref} — {total}.\nHaree estadu enkomenda iha ne'e:\n{url}",
    "Olá {name}! A {store} recebeu a sua encomenda {ref} — {total}.\nAcompanhe aqui:\n{url}",
    "Hi {name}! {store} has received your order {ref} — {total}.\nTrack it here:\n{url}",
  ],
  confirmed: [
    "{name}, ita-nia enkomenda {ref} konfirmadu ona. Ami prepara hela.\nHaree estadu iha ne'e:\n{url}",
    "{name}, a sua encomenda {ref} está confirmada. Estamos a prepará-la.\nAcompanhe aqui:\n{url}",
    "{name}, your order {ref} is confirmed. We're getting it ready.\nTrack it here:\n{url}",
  ],
  out: [
    "{name}, ita-nia enkomenda {ref} iha dalan ona ba ita.\nHaree iha ne'e:\n{url}",
    "{name}, a sua encomenda {ref} saiu para entrega.\nVeja aqui:\n{url}",
    "{name}, your order {ref} is on its way to you.\nSee it here:\n{url}",
  ],
  arrived: [
    "{name}, ami to'o ona ho ita-nia enkomenda {ref}. Ami bolu ita agora.\n{url}",
    "{name}, chegámos com a sua encomenda {ref}. Estamos a ligar-lhe.\n{url}",
    "{name}, we've arrived with your order {ref}. We're calling you now.\n{url}",
  ],
  completed: [
    "Obrigadu barak {name}! Enkomenda {ref} kompletu ona.\nFó ita-nia avaliasaun iha ne'e:\n{url}",
    "Muito obrigado {name}! A encomenda {ref} está concluída.\nDeixe a sua avaliação aqui:\n{url}",
    "Thank you {name}! Order {ref} is complete.\nLeave your review here:\n{url}",
  ],
  cancelled: [
    "{name}, ita-nia enkomenda {ref} kansela ona. Kontaktu ami se iha pergunta.\n{url}",
    "{name}, a sua encomenda {ref} foi cancelada. Contacte-nos se tiver dúvidas.\n{url}",
    "{name}, your order {ref} has been cancelled. Contact us if you have questions.\n{url}",
  ],
};

const LANG_INDEX: Record<Lang, 0 | 1 | 2> = { tet: 0, pt: 1, en: 2 };

export function renderNotification(event: NotifyEvent, lang: Lang, vars: TemplateVars): string {
  const trio = MESSAGES[event];
  // Falls back to Tetun rather than throwing: an unknown language stored on
  // an old order must not be the reason a buyer hears nothing.
  const template = trio[LANG_INDEX[lang] ?? 0] ?? trio[0];
  return template
    .replace(/\{name\}/g, vars.name)
    .replace(/\{ref\}/g, vars.ref)
    .replace(/\{store\}/g, vars.storeName)
    .replace(/\{total\}/g, vars.total)
    .replace(/\{url\}/g, vars.url);
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
