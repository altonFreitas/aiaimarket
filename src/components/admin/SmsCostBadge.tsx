"use client";
import { smsCost } from "@/lib/sms";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/** What this message will actually cost to send.
 *
 * Shown because SMS is billed per segment and the number is not guessable
 * from looking at the text: one accented character drops capacity from 160
 * characters to 70, so two messages that look the same length can differ in
 * price by 2x. Surfacing it here is what lets someone notice that a template
 * edit just doubled the store's messaging bill.
 *
 * Amber past one segment -- not red. Two segments is a normal, sometimes
 * unavoidable cost, not an error. */
export default function SmsCostBadge({ body, lang }: { body: string; lang: Lang }) {
  const cost = smsCost(body);
  return (
    <span
      className={"sms-cost" + (cost.segments > 1 ? " is-multi" : "")}
      title={`${cost.units} ${cost.encoding} · ${cost.remaining} ${t("smsRemaining", lang)}`}
    >
      {cost.segments} {t(cost.segments === 1 ? "smsSegment" : "smsSegments", lang)}
      <span className="sms-cost-enc">{cost.encoding}</span>
    </span>
  );
}
