/* WHICH FACE SETS THE HEADINGS.
 *
 * THE LIST IS THE CONTRACT. A value here has to name a font that
 * layout.tsx has actually loaded, or the page falls silently back to the
 * system stack with nothing to say it failed. So: one list, a check
 * constraint in supabase/site-chrome.sql that mirrors it, a class on
 * <html>, and a test holding the three together.
 *
 * FOUR, NOT FORTY. Every extra face is another file the shop's visitors
 * in Timor-Leste may end up downloading, and a picker with forty options
 * is a picker that gets left on whatever was first.
 */
export const HEADING_FONTS = ["jakarta", "inter", "grotesk", "system"] as const;
export type HeadingFont = (typeof HEADING_FONTS)[number];

export const DEFAULT_HEADING_FONT: HeadingFont = "jakarta";

/** Tolerates whatever the settings row holds -- a database that has not
 *  run site-chrome.sql has no column at all, and an older row could hold
 *  a name this build no longer loads. Either way the default is a face
 *  that is definitely there. */
export function headingFontOf(value: unknown): HeadingFont {
  return HEADING_FONTS.includes(value as HeadingFont)
    ? (value as HeadingFont) : DEFAULT_HEADING_FONT;
}

/** What goes on <html>. The stylesheet reads it rather than a class per
 *  font, so adding a face is one line in layout.tsx and one rule here. */
export function headingFontAttr(value: unknown): HeadingFont {
  return headingFontOf(value);
}
