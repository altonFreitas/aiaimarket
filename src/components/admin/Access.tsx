"use client";
import { createContext, useContext } from "react";
import type { Access } from "@/lib/adminSections";

/* Who is looking at the admin, made available to every client component
 * under it without threading a prop through twenty files.
 *
 * This is CONVENIENCE, not security. Everything here runs in the browser
 * and can be lied to. The locks are requireAdmin() and requireSection() on
 * the server; this exists so a read-only account is not shown buttons that
 * would only fail, and so a stale page can say so without a round trip.
 *
 * The default is the safest one: not the owner, no role, no sections. A
 * component rendered outside the provider by mistake hides its write
 * controls rather than showing them. */
const NOBODY: Access = { kind: "staff", role: "reader", sections: [] };

const AccessContext = createContext<Access>(NOBODY);

export function AccessProvider(
  { access, children }: { access: Access; children: React.ReactNode }
) {
  return <AccessContext.Provider value={access}>{children}</AccessContext.Provider>;
}

export function useAccess(): Access {
  return useContext(AccessContext);
}

/** Whether the person looking at this page may change anything. */
export function useCanWrite(): boolean {
  const a = useAccess();
  return a.kind === "owner" || a.role === "admin";
}

/** Renders its children only for someone who can actually save.
 *
 * Wrap the button, not the row: hiding a whole table row would hide the
 * information a reader is there to read. Wrap a toolbar when every control
 * in it writes.
 *
 * Use the `otherwise` slot when removing the control leaves something
 * confusing behind -- an empty actions column, a toolbar with nothing in
 * it -- and a word reads better than a gap. */
export default function WriteOnly(
  { children, otherwise = null }: { children: React.ReactNode; otherwise?: React.ReactNode }
) {
  return useCanWrite() ? <>{children}</> : <>{otherwise}</>;
}
