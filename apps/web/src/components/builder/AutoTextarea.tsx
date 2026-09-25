"use client";

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

/** A textarea that grows with its content. Ctrl/Cmd+Enter → onSubmit, Escape → onCancel. */
export function AutoTextarea({
  onSubmit, onCancel, value, ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; onSubmit?: () => void; onCancel?: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref} rows={1} value={value} {...rest}
      className={`field resize-none overflow-hidden ${rest.className ?? ""}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && onSubmit) {
          e.preventDefault();
          onSubmit();
        } else if (e.key === "Escape" && onCancel) {
          e.preventDefault();
          onCancel();
        }
        rest.onKeyDown?.(e);
      }}
    />
  );
}
