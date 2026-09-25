"use client";

import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useBuilder } from "@/components/builder/BuilderContext";
import { useToast } from "@/components/builder/Toasts";
import { api } from "@/lib/api";
import type { Saved } from "@/lib/builder/store";

/** Synchronous rebuild from the current questions, for any number of days. */
export function ScheduleRebuild() {
  const { doc, kit, flush, adopt } = useBuilder();
  const toast = useToast();
  const id = useId();
  const [days, setDays] = useState(String(kit.schedule.days_available));
  const n = Number(days);
  const valid = Number.isInteger(n) && n >= 1 && n <= 90;
  const rebuild = useMutation({
    mutationFn: async () => {
      await flush(); // the schedule is built from the saved questions
      return api<Saved>(`/kits/${encodeURIComponent(doc.id)}/regenerate`, { method: "POST", body: { section: "schedule", days: n } });
    },
    onSuccess: (saved) => {
      adopt(saved);
      toast({ message: `Schedule rebuilt for ${n} ${n === 1 ? "day" : "days"}.` });
    },
  });

  return (
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor={id} className="block text-sm font-semibold">
          Days until interview
        </label>
        <input
          id={id} type="number" min={1} max={90} className="field mt-1 w-24" value={days} onChange={(e) => setDays(e.target.value)}
          aria-invalid={!valid} aria-describedby={!valid ? `${id}-err` : undefined}
        />
      </div>
      <button type="button" className="btn btn-quiet" disabled={!valid || rebuild.isPending} onClick={() => rebuild.mutate()}>
        {rebuild.isPending ? "Rebuilding schedule" : "Rebuild schedule"}
      </button>
      <div aria-live="polite" className="w-full text-sm">
        {!valid && (
          <p id={`${id}-err`} className="text-alert">
            Enter a whole number of days from 1 to 90.
          </p>
        )}
        {rebuild.isError && <p className="text-alert">Couldn&apos;t rebuild the schedule: {rebuild.error.message}</p>}
      </div>
    </div>
  );
}
