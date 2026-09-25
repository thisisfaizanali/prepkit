"use client";

import { KitInputSchema, MAX_BATCH, type KitInputRequest, type SubmitResponse } from "@prepkit/shared";
import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { RoleRow, type RowErrors } from "@/components/new-kit/RoleRow";
import { ApiError } from "@/lib/api";
import { plural } from "@/lib/format";
import { emptyDraft, parseImport, type Draft } from "@/lib/importFile";
import { setNotice } from "@/lib/notice";
import { useCreateBatch, useCreateKit } from "@/lib/queries";

type Row = { key: number; draft: Draft; errors: RowErrors };

const FIELD_MESSAGES: Record<keyof Draft, string> = {
  jd: "Paste the job description (up to 50,000 characters).",
  company_url: "Enter the company's website, like acme.com.",
  days: "Enter a whole number of days from 1 to 90.",
};

function validateRow(d: Draft): { input?: KitInputRequest; errors: RowErrors } {
  const days = d.days.trim() === "" ? NaN : Number(d.days);
  const r = KitInputSchema.safeParse({ jd: d.jd, company_url: d.company_url, days });
  if (r.success) return { input: r.data, errors: {} };
  const errors: RowErrors = {};
  for (const i of r.error.issues) errors[i.path[0] as keyof Draft] = FIELD_MESSAGES[i.path[0] as keyof Draft];
  return { errors };
}

function batchNotice(results: SubmitResponse[]): string {
  const created = results.filter((r) => !r.duplicate).length;
  const dup = results.length - created;
  const parts = [created ? `${plural(created, "kit")} started.` : ""];
  if (dup) parts.push(`${plural(dup, "role")} ${dup === 1 ? "was" : "were"} already in your list, so ${dup === 1 ? "it was" : "they were"} not generated again.`);
  return parts.filter(Boolean).join(" ");
}

export function NewKitForm() {
  const router = useRouter();
  const nextKey = useRef(1);
  const [rows, setRows] = useState<Row[]>([{ key: 0, draft: emptyDraft(), errors: {} }]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileStatus, setFileStatus] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const createKit = useCreateKit();
  const createBatch = useCreateBatch();
  const pending = createKit.isPending || createBatch.isPending;

  const makeRows = (drafts: Draft[]) => drafts.map((draft) => ({ key: nextKey.current++, draft, errors: {} }));
  const update = (key: number, draft: Draft) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, draft } : r)));
  const remove = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileError(null);
    setFileStatus(null);
    try {
      const drafts = parseImport(file.name, await file.text());
      // Show per-row problems right away, so they can be fixed before submitting.
      setRows(makeRows(drafts).map((r) => ({ ...r, errors: validateRow(r.draft).errors })));
      setFileStatus(`Loaded ${plural(drafts.length, "role")} from ${file.name}. Review them below, then create.`);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "This file couldn't be read.");
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const checked = rows.map((r) => ({ ...r, ...validateRow(r.draft) }));
    setRows(checked.map(({ key, draft, errors }) => ({ key, draft, errors })));
    const bad = checked.findIndex((r) => !r.input);
    if (bad >= 0) {
      const field = Object.keys(checked[bad].errors)[0];
      document.getElementById(`row${bad}-${field === "company_url" ? "url" : field}`)?.focus();
      return;
    }
    const inputs = checked.map((r) => r.input!);
    const onError = (err: unknown) =>
      setFormError(err instanceof ApiError && err.code !== "INTERNAL" ? `Couldn't create the kit: ${err.message}` : "Couldn't create the kit. Try again.");

    if (inputs.length === 1) {
      createKit.mutate(inputs[0], {
        onError,
        onSuccess: (r) => {
          if (r.retried) setNotice("You already had a kit for this posting that failed, so it is being generated again.");
          else if (r.duplicate) setNotice("You already have a kit for this posting, so it was opened instead of generated again.");
          router.push(`/kits/${r.id}`);
        },
      });
    } else {
      createBatch.mutate(inputs, {
        onError,
        onSuccess: (r) => {
          setNotice(batchNotice(r.results));
          router.push("/kits");
        },
      });
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 space-y-8">
      <div className="space-y-2">
        <label htmlFor="file" className="block font-semibold">
          Upload a file
        </label>
        <p id="file-hint" className="text-sm text-pencil">
          Optional. A .json array of {"{ jd, company_url, days }"}, or a .csv with a jd,company_url,days header. Up to {MAX_BATCH} roles.
        </p>
        <input
          id="file" type="file" accept=".json,.csv" onChange={onFile} aria-describedby="file-hint"
          className="block text-sm file:mr-3 file:rounded file:border file:border-line file:bg-sheet file:px-3 file:py-1.5 file:font-semibold"
        />
        <div aria-live="polite">
          {fileError && <p className="text-sm text-alert">{fileError}</p>}
          {fileStatus && <p className="text-sm">{fileStatus}</p>}
        </div>
      </div>

      {rows.map((r, i) => (
        <RoleRow
          key={r.key} index={i} draft={r.draft} errors={r.errors} multiple={rows.length > 1}
          onChange={(d) => update(r.key, d)} onRemove={() => remove(r.key)}
        />
      ))}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Creating" : rows.length > 1 ? `Create ${rows.length} kits` : "Create kit"}
        </button>
        <button
          type="button" className="btn btn-quiet" disabled={rows.length >= MAX_BATCH}
          onClick={() => setRows((rs) => [...rs, ...makeRows([emptyDraft()])])}
        >
          Add another role
        </button>
        {rows.length >= MAX_BATCH && <p className="text-sm text-pencil">{MAX_BATCH} roles is the limit for one batch.</p>}
      </div>
      <div aria-live="polite">{formError && <p className="text-alert">{formError}</p>}</div>
    </form>
  );
}
