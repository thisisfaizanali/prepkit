"use client";

import { checkCoverage } from "@prepkit/shared";
import { useBuilder } from "@/components/builder/BuilderContext";
import { RegenProgress, useRegen } from "@/components/builder/Regeneration";
import { PriorityMarker } from "@/components/kit/PriorityMarker";

/** Coverage computed live from the local kit, with "Fill gaps" when something is uncovered. */
export function CoveragePanel({ compact = false }: { compact?: boolean }) {
  const { kit } = useBuilder();
  const regen = useRegen();
  const reqs = kit.role.requirements;
  const { uncovered_requirement_ids: uncovered } = checkCoverage(reqs, kit.questions);
  const running = regen.runningKey === "gaps";
  const error = regen.errors.gaps;

  return (
    <div className={compact ? "" : "mt-6"}>
      <p className={compact ? "text-sm" : ""}>
        {reqs.length - uncovered.length} of {reqs.length} requirements covered
      </p>
      {uncovered.length > 0 && (
        <div className="mt-2">
          <p className="text-sm text-pencil">Not covered by any question:</p>
          <ul className="mt-1 space-y-1">
            {uncovered.map((id) => {
              const r = reqs.find((x) => x.id === id);
              return (
                <li key={id} className="flex flex-wrap items-center gap-2">
                  {r?.text ?? id} {r && <PriorityMarker priority={r.priority} />}
                </li>
              );
            })}
          </ul>
          <button type="button" className="btn btn-quiet mt-3 py-1" disabled={!!regen.runningKey} onClick={() => regen.start({ section: "gaps" })}>
            Fill gaps
          </button>
        </div>
      )}
      {running && <RegenProgress label="Filling coverage gaps…" />}
      {error && !running && (
        <p role="alert" className="mt-2 text-sm text-alert">
          {error}{" "}
          <button type="button" className="link" onClick={() => regen.start({ section: "gaps" })}>
            Try again
          </button>
        </p>
      )}
      {regen.lastTrace && !running && <p className="mt-2 text-sm text-pencil">{regen.lastTrace}</p>}
    </div>
  );
}
