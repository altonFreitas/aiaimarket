"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";

/* WHAT COLOUR A MESSAGE IS.
 *
 * `true` still means red, because that is what every existing call site
 * says and rewriting sixty of them to prove a point is how a refactor
 * introduces a bug. "good" is the addition: a green toast for the end of a
 * job that went through, where the shop's ink colour said only that
 * something had been said.
 *
 * Neutral -- no second argument -- stays the default, and stays right for
 * the running commentary: "Sent", "Approved", "Copied". Those are not
 * successes, they are facts. Painting them green would leave the shop with
 * a wall of green and no way to tell the end of a job from a note. */
export type ToastTone = boolean | "good" | "bad";

interface ToastCtx {
  toast: (msg: string, tone?: ToastTone) => void;
}
const Ctx = createContext<ToastCtx>({ toast: () => {} });
export const useToast = () => useContext(Ctx);

/** "" for the neutral toast, so the class list is simply concatenated. */
function toneClass(tone: ToastTone | undefined): string {
  if (tone === true || tone === "bad") return " bad";
  if (tone === "good") return " good";
  return "";
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; tone?: ToastTone } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((text: string, tone?: ToastTone) => {
    setMsg({ text, tone });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2600);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      {msg && (
        <div className={"toast" + toneClass(msg.tone)}
          // A failure is not a status update. Assertive interrupts the
          // screen reader, which is the point: the save did not happen and
          // the next thing the person does depends on knowing that.
          role={msg.tone === true || msg.tone === "bad" ? "alert" : "status"}>
          {msg.text}
        </div>
      )}
    </Ctx.Provider>
  );
}
