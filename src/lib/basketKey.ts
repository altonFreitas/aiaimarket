/** How a basket line is named when the two sides talk about its stock.
 *
 * Its own module, with no "use client" and no "server-only", because both
 * sides need it: the browser builds the key when it asks what is left, and
 * the server action builds the same key when it answers. A copy on either
 * side would be a pair of strings that have to stay identical by luck.
 *
 * A NUL rather than a dash or a colon, because a size is free text the shop
 * types -- "38-40" and "M:L" are perfectly reasonable labels, and either
 * would collide with a printable separator. */
export function stockKey(id: string, size: string): string {
  return id + "\u0000" + size;
}
