"use client";

import { useBuilder } from "@/components/builder/BuilderContext";
import { unsaved } from "@/lib/builder/queue";

const TEXT = {
  saved: "All changes saved",
  saving: "Saving…",
  retrying: "Couldn't save, retrying",
  offline: "Offline. Changes will save when you're back online",
};

export function SaveStatus() {
  const { save, dismissError } = useBuilder();
  const status = save.status === "saved" && unsaved(save.queue) > 0 ? "saving" : save.status;
  return (
    <div className="text-sm">
      <p aria-live="polite" className={status === "retrying" || status === "offline" ? "text-alert" : "text-pencil"}>
        {TEXT[status]}
      </p>
      {save.error && (
        <p role="alert" className="mt-1 text-alert">
          {save.error}{" "}
          <button type="button" className="link" onClick={dismissError}>
            Dismiss
          </button>
        </p>
      )}
    </div>
  );
}
