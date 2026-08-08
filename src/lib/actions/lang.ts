"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { Lang } from "@/lib/types";

export async function setLangAction(lang: Lang) {
  const jar = await cookies();
  jar.set("lang", lang, { maxAge: 60 * 60 * 24 * 365, path: "/" });
  revalidatePath("/", "layout");
}
