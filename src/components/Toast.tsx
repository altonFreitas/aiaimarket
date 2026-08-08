"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";

interface ToastCtx {
  toast: (msg: string, bad?: boolean) => void;
}
const Ctx = createContext<ToastCtx>({ toast: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((text: string, bad?: boolean) => {
    setMsg({ text, bad });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2600);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      {msg && (
        <div className={"toast" + (msg.bad ? " bad" : "")} role="status">
          {msg.text}
        </div>
      )}
    </Ctx.Provider>
  );
}
