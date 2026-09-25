"use client";

import type { KitRequirementView, Question } from "@prepkit/shared";
import { useSortable } from "@dnd-kit/sortable";
import { useId, useRef, useState } from "react";
import { AutoTextarea } from "@/components/builder/AutoTextarea";
import { DifficultyPicker } from "@/components/builder/DifficultyPicker";
import { CATEGORY_LABEL } from "@/components/builder/Regeneration";
import { RequirementPicker } from "@/components/builder/RequirementPicker";
import { StateMarkers } from "@/components/builder/StateMarkers";
import { dropLine } from "@/components/builder/dnd";
import { GripIcon } from "@/components/icons";
import { Difficulty } from "@/components/kit/Difficulty";
import { RequirementChip, shortLabel } from "@/components/kit/RequirementChip";
import { RowActions } from "@/components/builder/RowActions";
import { useNarrow } from "@/lib/useNarrow";

type Draft = Pick<Question, "prompt" | "answer_outline" | "difficulty" | "requirement_ids">;

type Props = {
  question: Question;
  /** 1-based position in the whole list, for labels ("Edit question 3"). */
  number: number;
  requirements: KitRequirementView[];
  fresh: boolean;
  /** Start in edit mode (a question just added by hand). */
  isNew?: boolean;
  onSave: (draft: Draft) => void;
  /** Leaving edit mode without saving; for a new question, discards it. */
  onCancelNew?: () => void;
  onPin: (pinned: boolean) => void;
  onMove: (category: Question["category"]) => void;
  onDelete: () => void;
};

export function QuestionRow({ question: q, number, requirements, fresh, isNew, onSave, onCancelNew, onPin, onMove, onDelete }: Props) {
  const [draft, setDraft] = useState<Draft | null>(isNew ? pick(q) : null);
  const [error, setError] = useState<string | null>(null);
  const editBtn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const narrow = useNarrow();
  const reqs = new Map(requirements.map((r) => [r.id, r]));
  const short = shortLabel(q.prompt || "new question", 40);
  const name = `question ${number}: ${short}`;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging, isOver, active, index, activeIndex } = useSortable({
    id: q.id,
    data: { category: q.category },
    disabled: !!draft,
  });

  const close = () => {
    setDraft(null);
    setError(null);
    requestAnimationFrame(() => editBtn.current?.focus());
  };
  const save = () => {
    if (!draft) return;
    if (!draft.prompt.trim()) return setError("The question can't be empty.");
    onSave({ ...draft, prompt: draft.prompt.trim() });
    close();
  };
  const cancel = () => (isNew ? onCancelNew?.() : close());

  const actions = (
    <>
      <button ref={editBtn} type="button" className="btn btn-quiet px-2 py-0.5 text-sm" onClick={() => setDraft(pick(q))} aria-label={`Edit ${name}`}>
        Edit
      </button>
      <button
        type="button" className="btn btn-quiet px-2 py-0.5 text-sm" aria-pressed={!!q.meta?.pinned}
        aria-label={`Pin ${name}`} onClick={() => onPin(!q.meta?.pinned)}
      >
        {q.meta?.pinned ? "Pinned" : "Pin"}
      </button>
      <label className="sr-only" htmlFor={`${id}-move`}>
        Move {name} to category
      </label>
      <select
        id={`${id}-move`} className="field w-auto px-2 py-0.5 text-sm" value=""
        onChange={(e) => e.target.value && onMove(e.target.value as Question["category"])}
      >
        <option value="">Move to…</option>
        {Object.entries(CATEGORY_LABEL)
          .filter(([c]) => c !== q.category)
          .map(([c, label]) => (
            <option key={c} value={c}>
              {label}
            </option>
          ))}
      </select>
      <button type="button" className="btn btn-quiet px-2 py-0.5 text-sm text-alert" onClick={onDelete} aria-label={`Delete ${name}`}>
        Delete
      </button>
    </>
  );

  return (
    <li
      ref={setNodeRef}
      className={`border-b border-line py-4 ${isDragging ? "opacity-40" : ""} ${isOver && active?.id !== q.id ? dropLine(index, activeIndex) : ""} ${fresh ? "fresh-edge pl-2" : ""}`}
    >
      {draft ? (
        <div className="space-y-3" onKeyDown={(e) => e.key === "Escape" && (e.preventDefault(), cancel())}>
          <div>
            <label htmlFor={`${id}-prompt`} className="text-sm font-semibold">
              Question
            </label>
            <AutoTextarea
              id={`${id}-prompt`} autoFocus value={draft.prompt} onSubmit={save} className="mt-1"
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined}
            />
            {error && (
              <p id={`${id}-err`} className="mt-1 text-sm text-alert">
                {error}
              </p>
            )}
          </div>
          <div>
            <label htmlFor={`${id}-outline`} className="text-sm font-semibold">
              Answer outline
            </label>
            <AutoTextarea
              id={`${id}-outline`} value={draft.answer_outline} onSubmit={save} className="mt-1"
              onChange={(e) => setDraft({ ...draft, answer_outline: e.target.value })}
            />
          </div>
          <DifficultyPicker value={draft.difficulty} onChange={(difficulty) => setDraft({ ...draft, difficulty })} />
          <RequirementPicker requirements={requirements} value={draft.requirement_ids} onChange={(requirement_ids) => setDraft({ ...draft, requirement_ids })} />
          <div className="flex gap-2">
            <button type="button" className="btn py-1" onClick={save}>
              Save question
            </button>
            <button type="button" className="btn btn-quiet py-1" onClick={cancel}>
              Cancel
            </button>
            <p className="self-center text-sm text-pencil">Ctrl+Enter saves, Escape cancels.</p>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} aria-label={`Reorder ${short}`}
            className="mt-0.5 h-7 w-6 shrink-0 cursor-grab touch-none rounded text-pencil hover:bg-wash hover:text-graphite"
          >
            <GripIcon className="mx-auto" />
          </button>
          <Difficulty level={q.difficulty} />
          <div className="min-w-0 flex-1">
            <p onDoubleClick={() => setDraft(pick(q))}>{q.prompt}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {q.requirement_ids.length > 0 && <span className="sr-only">Covers requirements:</span>}
              {q.requirement_ids.map((r) => (
                <RequirementChip key={r} id={r} req={reqs.get(r)} />
              ))}
              <StateMarkers meta={q.meta} />
            </div>
            {q.answer_outline && (
              <details className="mt-2">
                <summary className="text-sm text-pencil">Answer outline</summary>
                <p className="mt-2 whitespace-pre-line">{q.answer_outline}</p>
              </details>
            )}
            <RowActions narrow={narrow} name={name}>
              {actions}
            </RowActions>
          </div>
        </div>
      )}
    </li>
  );
}

const pick = (q: Question): Draft => ({ prompt: q.prompt, answer_outline: q.answer_outline, difficulty: q.difficulty, requirement_ids: [...q.requirement_ids] });
