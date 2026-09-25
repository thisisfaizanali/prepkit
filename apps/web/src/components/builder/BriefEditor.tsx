"use client";

import { isProtected } from "@prepkit/shared";
import { useState } from "react";
import { useBuilder } from "@/components/builder/BuilderContext";
import { EditableText } from "@/components/builder/EditableText";
import { RegenerateControl } from "@/components/builder/RegenerateControl";
import { useRegen } from "@/components/builder/Regeneration";
import { StateMarkers } from "@/components/builder/StateMarkers";

export function BriefEditor() {
  const { kit, enqueue } = useBuilder();
  const regen = useRegen();
  const [confirming, setConfirming] = useState(false);
  const brief = kit.company_brief;
  const pinned = !!brief.meta?.pinned;

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h2">Company brief</h2>
        <div className="flex items-center gap-3">
          <StateMarkers meta={brief.meta} />
          <button type="button" className="btn btn-quiet py-1 text-sm" aria-pressed={pinned} aria-label="Pin company brief" onClick={() => enqueue({ op: "brief.pin", pinned: !pinned })}>
            {pinned ? "Pinned" : "Pin"}
          </button>
        </div>
      </div>
      <RegenerateControl
        request={{ section: "brief", force: true }} label="Regenerate brief" runningLabel="Regenerating the company brief…"
        onClick={isProtected(brief) ? () => setConfirming(true) : () => regen.start({ section: "brief" })}
      />
      {confirming && (
        <div role="group" aria-label="Confirm replacing your brief" className="notice mt-3">
          <p>This replaces your edited brief.</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button" className="btn py-1" autoFocus
              onClick={() => {
                setConfirming(false);
                regen.start({ section: "brief", force: true });
              }}
            >
              Replace it
            </button>
            <button type="button" className="btn btn-quiet py-1" onClick={() => setConfirming(false)}>
              Keep my version
            </button>
          </div>
        </div>
      )}
      <div className="mt-4">
        <EditableText label="summary" value={brief.summary} onCommit={(summary) => enqueue({ op: "brief.update", patch: { summary } })} />
      </div>
      <h3 className="mt-6 text-h3">What they do</h3>
      <div className="mt-2">
        <EditableText label="what they do" value={brief.what_they_do} onCommit={(what_they_do) => enqueue({ op: "brief.update", patch: { what_they_do } })} />
      </div>
    </>
  );
}
