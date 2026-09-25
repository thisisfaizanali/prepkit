import type { KitRequirementView } from "@prepkit/shared";
import { useId } from "react";

/** "Hands-on experience running Kafka…": cut at a word boundary near `max` characters. */
export function shortLabel(text: string, max = 28): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1).replace(/\s+\S*$/, "");
  return `${(cut || text.slice(0, max)).replace(/[\s,.;:]+$/, "")}…`;
}

/** Requirement chip: a short label, the full text on hover (title) and to screen readers (aria-describedby). */
export function RequirementChip({ id, req }: { id: string; req?: KitRequirementView }) {
  const fullId = useId();
  if (!req) return <span className="inline-block rounded border border-line px-1.5 text-sm text-pencil">{id}</span>;
  return (
    <span
      tabIndex={0} title={req.text} aria-describedby={fullId}
      className="inline-block rounded border border-line px-1.5 text-sm text-pencil hover:bg-wash"
    >
      {shortLabel(req.text)}
      <span id={fullId} className="sr-only">
        {req.text}
      </span>
    </span>
  );
}
