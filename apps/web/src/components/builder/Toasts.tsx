"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type Toast = { id: number; message: string; action?: { label: string; run: () => void }; ms?: number };
type Push = (t: Omit<Toast, "id">) => void;

const ToastContext = createContext<Push>(() => {});
export const useToast = () => useContext(ToastContext);

/** Toasts sit bottom-left in an aria-live region; each can be dismissed and its action reached by keyboard. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback<Push>((t) => setToasts((ts) => [...ts.slice(-2), { ...t, id: next.current++ }]), []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 left-4 right-4 z-20 flex flex-col items-start gap-2 sm:right-auto sm:max-w-md">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(onDismiss, toast.ms ?? 6000);
    return () => clearTimeout(t);
  }, [paused, onDismiss, toast.ms]);

  return (
    <div
      role="status" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      className="flex w-full items-start gap-3 rounded border border-graphite bg-sheet px-4 py-3"
    >
      <p className="flex-1">{toast.message}</p>
      {toast.action && (
        <button
          type="button" className="link font-semibold"
          onClick={() => {
            toast.action!.run();
            onDismiss();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="text-pencil hover:text-graphite" onClick={onDismiss} aria-label="Dismiss">
        Dismiss
      </button>
    </div>
  );
}
