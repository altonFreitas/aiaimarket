/* ---------------------------------------------------------------------------
 * SMS length and cost.
 *
 * Unlike WhatsApp, every SMS is metered, and the meter counts SEGMENTS, not
 * messages. Which alphabet the text fits into decides how many characters go
 * in a segment:
 *
 *   GSM-7  160 chars in one segment (153 each once a message splits)
 *   UCS-2   70 chars in one segment  (67 each once a message splits)
 *
 * That matters here more than in most stores. Tetun and Portuguese are full
 * of characters GSM-7 does not have -- ó, í, ã, õ, â, ê are all absent, even
 * though é and à are present -- so a single "ó" more than halves the capacity
 * of the message and can double its price. A store sending a few hundred
 * order updates a month notices.
 *
 * Everything here is pure, so the admin UI can show a segment count and the
 * templates can be checked by tests rather than by sending real messages.
 * ------------------------------------------------------------------------ */

/** The GSM 03.38 basic alphabet. */
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

/** Characters that exist in GSM-7 but cost two septets each (the escape
 * table). A message of nothing but euro signs holds 80, not 160. */
const GSM7_EXTENDED = "^{}\\[~]|€";

const GSM7_SET = new Set([...GSM7_BASIC, ...GSM7_EXTENDED]);

export type SmsEncoding = "GSM-7" | "UCS-2";

export interface SmsCost {
  encoding: SmsEncoding;
  /** Billable units: septets for GSM-7 (escapes count double), UTF-16 code
   * units for UCS-2 (so an emoji counts as two, which is what carriers bill). */
  units: number;
  segments: number;
  /** Units still free inside the current segment count. Negative is not
   * possible; zero means the next character adds a segment. */
  remaining: number;
}

export function smsEncoding(text: string): SmsEncoding {
  for (const ch of text) {
    if (!GSM7_SET.has(ch)) return "UCS-2";
  }
  return "GSM-7";
}

export function smsCost(text: string): SmsCost {
  const encoding = smsEncoding(text);

  let units: number;
  if (encoding === "GSM-7") {
    units = 0;
    for (const ch of text) units += GSM7_EXTENDED.includes(ch) ? 2 : 1;
  } else {
    // .length, not [...text].length: carriers bill UCS-2 in 16-bit units, so
    // a character outside the BMP is genuinely two.
    units = text.length;
  }

  const single = encoding === "GSM-7" ? 160 : 70;
  // Concatenated messages spend part of each segment on a header saying how
  // the pieces fit together, which is why the per-segment capacity drops once
  // a message no longer fits in one.
  const multi = encoding === "GSM-7" ? 153 : 67;

  const segments = units === 0 ? 1 : units <= single ? 1 : Math.ceil(units / multi);
  const capacity = segments === 1 ? single : segments * multi;

  return { encoding, units, segments, remaining: Math.max(0, capacity - units) };
}

/** Rewrites the characters Tetun and Portuguese use that GSM-7 lacks, so a
 * message stays in the 160-character alphabet instead of dropping to 70.
 *
 * Deliberately NOT applied automatically. Stripping the accent from a
 * customer's own name, or from words where it carries meaning, is a decision
 * about the store's voice -- worth offering, not worth taking silently. The
 * templates in notify/templates.ts are written to survive it; enable it with
 * SMS_FORCE_GSM7=true when the saving matters more than the accents.
 *
 * Characters GSM-7 already has (é, à, ì, ò, ù, ä, ö, ñ, ü, ç, £, §) are left
 * exactly as they are -- there is nothing to gain by flattening them. */
export function toGsm7(text: string): string {
  return text
    // Decompose, drop the combining marks, recompose. This handles á í ó ú
    // â ê ô ã õ and their capitals in one pass, without a lookup table that
    // would inevitably miss one.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, (mark, offset, str) => {
      const base = str[offset - 1];
      // Keep the marks that survive the round trip into GSM-7.
      const composed = (base + mark).normalize("NFC");
      return GSM7_SET.has(composed) ? mark : "";
    })
    .normalize("NFC")
    // Typographic punctuation a CMS or a phone keyboard inserts silently.
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ");
}

export function forceGsm7Enabled(): boolean {
  return process.env.SMS_FORCE_GSM7 === "true";
}
