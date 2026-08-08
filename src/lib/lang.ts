import { cookies } from "next/headers";
import type { Lang } from "./types";

export async function getLang(): Promise<Lang> {
  const jar = await cookies();
  const v = jar.get("lang")?.value;
  return v === "pt" || v === "en" ? v : "tet";
}
