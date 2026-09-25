import type { KitRequirementView } from "@prepkit/shared";
import { useId } from "react";

/** Requirement id chip; its text shows on hover or keyboard focus. */
export function RequirementChip({ id, req }: { id: string; req?: KitRequirementView }) {
  const tipId = useId();
  return (
    <span tabIndex={0} aria-describedby={req ? tipId : undefined} className="group relative inline-block rounded border border-line px-1.5 text-sm text-pencil">
      {id}
      {req && (
        <span
          role="tooltip" id={tipId}
          className="invisible absolute bottom-full left-0 z-10 mb-1 w-64 max-w-[80vw] rounded border border-line bg-sheet p-2 text-graphite group-hover:visible group-focus:visible"
        >
          {req.text}
        </span>
      )}
    </span>
  );
}
