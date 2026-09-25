"use client";

import { useId } from "react";

/** 1–3 as a radio group drawn as the difficulty squares. */
export function DifficultyPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const name = useId();
  return (
    <fieldset>
      <legend className="text-sm font-semibold">Difficulty</legend>
      <div className="mt-1 flex gap-3">
        {[1, 2, 3].map((n) => (
          <label key={n} className={`flex cursor-pointer items-center gap-1.5 rounded border px-1.5 py-0.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--c-focus)] ${value === n ? "border-graphite font-semibold" : "border-transparent"}`}>
            <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} className="sr-only" />
            <span aria-hidden className="flex gap-[2px]">
              {[1, 2, 3].map((k) => (
                <span key={k} className={`block h-[8px] w-[8px] border border-graphite ${k <= n ? "bg-graphite" : ""}`} />
              ))}
            </span>
            <span className="text-sm">{["Easy", "Medium", "Hard"][n - 1]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
