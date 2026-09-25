"use client";

import { useId, useRef, useState } from "react";
import { AutoTextarea } from "@/components/builder/AutoTextarea";

type Props = {
  value: string;
  /** What's being edited, for labels: "summary" → "Edit summary". */
  label: string;
  onCommit: (value: string) => void;
  required?: boolean;
  className?: string;
};

/**
 * Text with an Edit button (or double-click) that turns into a textarea. Commits once, on blur or Ctrl/Cmd+Enter;
 * Escape restores. Focus returns to the Edit button afterwards.
 */
export function EditableText({ value, label, onCommit, required, className = "" }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editBtn = useRef<HTMLButtonElement>(null);
  const id = useId();

  const close = () => {
    setDraft(null);
    setError(null);
    requestAnimationFrame(() => editBtn.current?.focus());
  };
  const commit = () => {
    if (draft === null) return;
    if (required && !draft.trim()) return setError(`The ${label} can't be empty.`);
    if (draft !== value) onCommit(draft);
    close();
  };

  if (draft !== null)
    return (
      <div>
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <AutoTextarea
          id={id} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onSubmit={commit} onCancel={close}
          aria-invalid={!!error} aria-describedby={error ? `${id}-err` : `${id}-hint`}
        />
        <p id={`${id}-hint`} className="mt-1 text-sm text-pencil">
          Saves when you click away or press Ctrl+Enter. Escape cancels.
        </p>
        {error && (
          <p id={`${id}-err`} className="text-sm text-alert">
            {error}
          </p>
        )}
      </div>
    );

  return (
    <div className="group flex items-start gap-3">
      <p className={`flex-1 whitespace-pre-line ${className}`} onDoubleClick={() => setDraft(value)}>
        {value || <span className="text-pencil">Empty</span>}
      </p>
      <button ref={editBtn} type="button" className="btn btn-quiet shrink-0 px-2 py-0.5 text-sm" onClick={() => setDraft(value)}>
        Edit<span className="sr-only"> {label}</span>
      </button>
    </div>
  );
}
