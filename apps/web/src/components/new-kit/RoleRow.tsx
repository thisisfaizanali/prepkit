"use client";

import { FieldError } from "@/components/FieldError";
import type { Draft } from "@/lib/importFile";

export type RowErrors = Partial<Record<keyof Draft, string>>;
const JD_MAX = 50_000;

type Props = {
  index: number;
  draft: Draft;
  errors: RowErrors;
  multiple: boolean;
  onChange: (d: Draft) => void;
  onRemove: () => void;
};

export function RoleRow({ index, draft, errors, multiple, onChange, onRemove }: Props) {
  const id = (f: string) => `row${index}-${f}`;
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => onChange({ ...draft, [k]: e.target.value });
  const described = (f: keyof Draft, extra?: string) => [errors[f] ? id(`${f}-error`) : null, extra].filter(Boolean).join(" ") || undefined;

  return (
    <fieldset className="relative border-t border-line pt-6">
      <legend className="float-left text-h3 font-semibold">{multiple ? `Role ${index + 1}` : "Role"}</legend>
      {multiple && (
        <button type="button" className="btn btn-quiet absolute right-0 top-5 py-1 text-sm" onClick={onRemove}>
          Remove role {index + 1}
        </button>
      )}
      <div className="clear-both space-y-4 pt-4">
        <div>
          <label htmlFor={id("jd")} className="block font-semibold">
            Job description
          </label>
          <textarea
            id={id("jd")} rows={10} className="field mt-1 resize-y" value={draft.jd} onChange={set("jd")}
            maxLength={JD_MAX} aria-invalid={!!errors.jd} aria-describedby={described("jd", id("jd-count"))}
          />
          <p id={id("jd-count")} className="mt-1 text-sm text-pencil">
            {draft.jd.length.toLocaleString()} of {JD_MAX.toLocaleString()} characters
          </p>
          <FieldError id={id("jd-error")} message={errors.jd} />
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <div>
            <label htmlFor={id("url")} className="block font-semibold">
              Company website
            </label>
            <input
              id={id("url")} type="text" inputMode="url" autoComplete="url" placeholder="acme.com" className="field mt-1"
              value={draft.company_url} onChange={set("company_url")}
              aria-invalid={!!errors.company_url} aria-describedby={described("company_url")}
            />
            <FieldError id={id("company_url-error")} message={errors.company_url} />
          </div>
          <div>
            <label htmlFor={id("days")} className="block font-semibold">
              Days until interview
            </label>
            <input
              id={id("days")} type="number" min={1} max={90} step={1} className="field mt-1"
              value={draft.days} onChange={set("days")} aria-invalid={!!errors.days} aria-describedby={described("days")}
            />
            <FieldError id={id("days-error")} message={errors.days} />
          </div>
        </div>
      </div>
    </fieldset>
  );
}
