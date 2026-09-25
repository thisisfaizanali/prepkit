"use client";

import type { KitRequirementView } from "@prepkit/shared";
import { PriorityMarker } from "@/components/kit/PriorityMarker";

export function RequirementPicker({ requirements, value, onChange }: { requirements: KitRequirementView[]; value: string[]; onChange: (ids: string[]) => void }) {
  const toggle = (id: string, on: boolean) => onChange(on ? requirements.filter((r) => r.id === id || value.includes(r.id)).map((r) => r.id) : value.filter((v) => v !== id));
  return (
    <details>
      <summary className="text-sm font-semibold">Linked requirements ({value.length})</summary>
      <fieldset className="mt-2 max-h-64 space-y-1 overflow-y-auto">
        <legend className="sr-only">Requirements this covers</legend>
        {requirements.map((r) => (
          <label key={r.id} className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-wash">
            <input type="checkbox" className="mt-1.5" checked={value.includes(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} />
            <span className="flex-1">
              {r.text} <PriorityMarker priority={r.priority} />
            </span>
          </label>
        ))}
      </fieldset>
    </details>
  );
}
