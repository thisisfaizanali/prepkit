"use client";

import { RegenProgress, regenKey, useRegen, type RegenRequest } from "@/components/builder/Regeneration";

type Props = {
  request: RegenRequest;
  /** Button text, e.g. "Regenerate technical questions". */
  label: string;
  /** Shown while running: "Regenerating technical questions…". */
  runningLabel: string;
  helper?: string;
  /** Known in advance that the server would refuse (e.g. company unknown). */
  unavailable?: string;
  /** Replaces the plain click (e.g. to confirm first). */
  onClick?: () => void;
};

export function RegenerateControl({ request, label, runningLabel, helper, unavailable, onClick }: Props) {
  const regen = useRegen();
  const key = regenKey(request);
  const running = regen.runningKey === key;
  const error = regen.errors[key];
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button" className="btn btn-quiet py-1 text-sm" disabled={!!regen.runningKey || !!unavailable}
          onClick={onClick ?? (() => regen.start(request))} aria-describedby={helper || unavailable ? `${key}-help` : undefined}
        >
          {label}
        </button>
        {(unavailable || helper) && (
          <span id={`${key}-help`} className="text-sm text-pencil">
            {unavailable ?? helper}
          </span>
        )}
      </div>
      {running && <RegenProgress label={runningLabel} />}
      {error && !running && (
        <p role="alert" className="mt-2 text-sm text-alert">
          {error}{" "}
          <button type="button" className="link" onClick={onClick ?? (() => regen.start(request))}>
            Try again
          </button>
        </p>
      )}
    </div>
  );
}
