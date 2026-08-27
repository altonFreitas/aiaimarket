import type { NotifyStatus, Order } from "@/lib/types";

/* ---------------------------------------------------------------------------
 * The rule for when a message row is safe to discard, in one place.
 *
 * This used to be two hand-written copies of the same two arrays -- one in
 * the server action that actually deletes rows, one in the component
 * deciding whether to show the button. The same mistake orderFlow.ts already
 * fixed once for order-status transitions: two copies of a safety rule is a
 * promise to keep them in sync, and the next edit only finds one of them.
 * ------------------------------------------------------------------------ */

/** An order's status can never move again once it is here, which is what
 * makes its message history safe to discard -- see clearOrderNotifications()
 * for the rest of the reasoning. */
export const TERMINAL_ORDER_STATUSES: readonly Order["status"][] = ["completed", "cancelled"];

/** 'queued' means the buyer has not been told yet -- clearing it would
 * silently cancel work still owed. 'failed' is usually a real problem (a bad
 * number, a gateway outage) worth someone noticing, not paperwork to file
 * away; skipNotification() is the deliberate way to close one out, and only
 * after that is it eligible here. */
export const CLEARABLE_NOTIFICATION_STATUSES: readonly NotifyStatus[] = ["sent", "skipped"];

export function countClearableNotifications(statuses: readonly NotifyStatus[]): number {
  return statuses.filter((s) => (CLEARABLE_NOTIFICATION_STATUSES as readonly string[]).includes(s)).length;
}

/** Whether the "clear sent messages" action should even be offered. Both
 * conditions matter: a terminal order with nothing clearable yet (still
 * waiting on the last message to send) is exactly as ineligible as a
 * non-terminal order with plenty already sent. */
export function canClearOrderNotifications(
  orderStatus: Order["status"], statuses: readonly NotifyStatus[]
): boolean {
  return (TERMINAL_ORDER_STATUSES as readonly string[]).includes(orderStatus)
    && countClearableNotifications(statuses) > 0;
}
