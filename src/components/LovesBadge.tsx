"use client";
import { useLoves } from "@/lib/useLoves";

/** How many products this browser has saved.
 *
 * The same shape as BasketBadge next door, and local for the same reason:
 * which products are loved lives in this browser (see lib/useLoves), so
 * the server cannot render the number and a server-rendered zero would be
 * wrong for anybody who has saved something.
 *
 * Nothing at all until the local list has been read -- `ready` -- and
 * nothing when it is empty. A badge reading 0 is a badge saying "you have
 * none of these", which is what the absence of a badge already says. */
export default function LovesBadge() {
  const { ids, ready } = useLoves();
  if (!ready || ids.length === 0) return null;
  return <span className="cnt">{ids.length}</span>;
}
