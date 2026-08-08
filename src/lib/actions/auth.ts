"use server";
import { login as doLogin, logout as doLogout } from "@/lib/session";
import { redirect } from "next/navigation";

export async function loginAction(_prevState: { error?: string } | undefined, formData: FormData) {
  const identifier = String(formData.get("identifier") || "");
  const password = String(formData.get("password") || "");
  const ok = await doLogin(identifier, password);
  if (!ok) return { error: "wrong" };
  redirect("/admin");
}

export async function logoutAction() {
  await doLogout();
  redirect("/admin/login");
}
