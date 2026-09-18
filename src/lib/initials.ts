/** The two letters that stand in for somebody's face.
 *
 * From the LOCAL PART of the address only: everyone at one company would
 * otherwise share an avatar, and "gm" tells a person nothing about whether
 * they are signed in as themselves.
 *
 * Letters and digits only, because an address may begin with a dot or a
 * plus and a badge reading "." is not an identity. An address that yields
 * nothing usable -- "+++@x.com" -- gets an empty string, and the caller
 * falls back to the person icon rather than drawing an empty circle.
 */
export function emailInitials(email: string | null | undefined): string {
  const local = String(email ?? "").split("@")[0] ?? "";
  const letters = local.replace(/[^a-zA-Z0-9]/g, "");
  return letters.slice(0, 2).toUpperCase();
}
