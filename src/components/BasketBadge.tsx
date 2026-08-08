"use client";
import { useBasket } from "@/lib/useBasket";

export default function BasketBadge({ as }: { as: "cnt" | "bump" }) {
  const { count } = useBasket();
  if (!count) return as === "cnt" ? null : <span className="bump hide" />;
  return <span className={as}>{count}</span>;
}
