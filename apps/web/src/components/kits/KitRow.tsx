"use client";

import type { KitSummary } from "@prepkit/shared";
import Link from "next/link";
import { useRef, useState } from "react";
import { StatusLabel } from "@/components/kits/StatusLabel";
import { formatDate, plural } from "@/lib/format";
import { useDeleteKit } from "@/lib/queries";

export function KitRow({ kit }: { kit: KitSummary }) {
  const [confirming, setConfirming] = useState(false);
  const del = useDeleteKit();
  const deleteBtn = useRef<HTMLButtonElement>(null);
  const title = kit.role ?? "Untitled role";
  const company = kit.company ?? kit.company_url;

  const cancel = () => {
    setConfirming(false);
    queueMicrotask(() => deleteBtn.current?.focus());
  };

  return (
    <li className="grid gap-x-6 gap-y-2 border-b border-line py-4 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <Link href={`/kits/${kit.id}`} className="font-semibold underline-offset-4 hover:underline">
          {title}
        </Link>
        <p className="truncate text-pencil">{company}</p>
        <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm text-pencil">
          <div>
            <dt className="sr-only">Status</dt>
            <dd className="text-graphite">
              <StatusLabel status={kit.status} />
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>Interview in</dt>
            <dd>{plural(kit.days, "day")}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Updated</dt>
            <dd>{formatDate(kit.updatedAt)}</dd>
          </div>
          {kit.counts && (
            <div>
              <dt className="sr-only">Contents</dt>
              <dd>
                {plural(kit.counts.requirements, "requirement")}, {plural(kit.counts.questions, "question")},{" "}
                {plural(kit.counts.flashcards, "flashcard")}
              </dd>
            </div>
          )}
        </dl>
      </div>
      <div className="flex items-start sm:justify-end">
        {confirming ? (
          <div role="group" aria-label={`Delete ${title}?`} className="flex flex-wrap items-center gap-2">
            <span className="text-sm">Delete this kit?</span>
            <button type="button" className="btn btn-danger py-1" disabled={del.isPending} autoFocus onClick={() => del.mutate(kit.id)}>
              Delete kit
            </button>
            <button type="button" className="btn btn-quiet py-1" onClick={cancel}>
              Keep it
            </button>
            {del.isError && (
              <p role="alert" className="w-full text-sm text-alert">
                Couldn&apos;t delete the kit. Try again.
              </p>
            )}
          </div>
        ) : (
          <button ref={deleteBtn} type="button" className="btn btn-quiet py-1" onClick={() => setConfirming(true)}>
            Delete<span className="sr-only"> {title}</span>
          </button>
        )}
      </div>
    </li>
  );
}
