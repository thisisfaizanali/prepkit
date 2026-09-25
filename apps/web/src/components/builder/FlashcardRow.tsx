"use client";

import type { Flashcard } from "@prepkit/shared";
import { useSortable } from "@dnd-kit/sortable";
import { useId, useRef, useState } from "react";
import { AutoTextarea } from "@/components/builder/AutoTextarea";
import { RowActions } from "@/components/builder/RowActions";
import { StateMarkers } from "@/components/builder/StateMarkers";
import { dropLine } from "@/components/builder/dnd";
import { GripIcon } from "@/components/icons";
import { shortLabel } from "@/components/kit/RequirementChip";
import { useNarrow } from "@/lib/useNarrow";

type Draft = Pick<Flashcard, "front" | "back">;
type Props = {
  card: Flashcard;
  number: number;
  isNew?: boolean;
  onSave: (d: Draft) => void;
  onCancelNew?: () => void;
  onPin: (pinned: boolean) => void;
  onDelete: () => void;
};

export function FlashcardRow({ card, number, isNew, onSave, onCancelNew, onPin, onDelete }: Props) {
  const [draft, setDraft] = useState<Draft | null>(isNew ? { front: card.front, back: card.back } : null);
  const [error, setError] = useState<string | null>(null);
  const editBtn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const narrow = useNarrow();
  const short = shortLabel(card.front || "new flashcard", 40);
  const name = `flashcard ${number}: ${short}`;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging, isOver, active, index, activeIndex } = useSortable({ id: card.id, disabled: !!draft });

  const close = () => {
    setDraft(null);
    setError(null);
    requestAnimationFrame(() => editBtn.current?.focus());
  };
  const save = () => {
    if (!draft) return;
    if (!draft.front.trim() || !draft.back.trim()) return setError("Both sides need some text.");
    onSave({ front: draft.front.trim(), back: draft.back.trim() });
    close();
  };
  const cancel = () => (isNew ? onCancelNew?.() : close());

  return (
    <li ref={setNodeRef} className={`border-b border-line py-4 ${isDragging ? "opacity-40" : ""} ${isOver && active?.id !== card.id ? dropLine(index, activeIndex) : ""}`}>
      {draft ? (
        <div className="space-y-3" onKeyDown={(e) => e.key === "Escape" && (e.preventDefault(), cancel())}>
          <div>
            <label htmlFor={`${id}-front`} className="text-sm font-semibold">
              Front
            </label>
            <AutoTextarea id={`${id}-front`} autoFocus className="mt-1" value={draft.front} onSubmit={save} onChange={(e) => setDraft({ ...draft, front: e.target.value })} />
          </div>
          <div>
            <label htmlFor={`${id}-back`} className="text-sm font-semibold">
              Back
            </label>
            <AutoTextarea id={`${id}-back`} className="mt-1" value={draft.back} onSubmit={save} onChange={(e) => setDraft({ ...draft, back: e.target.value })} />
          </div>
          {error && <p className="text-sm text-alert">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn py-1" onClick={save}>
              Save flashcard
            </button>
            <button type="button" className="btn btn-quiet py-1" onClick={cancel}>
              Cancel
            </button>
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
          <div className="min-w-0 flex-1">
            <p className="font-semibold" onDoubleClick={() => setDraft({ front: card.front, back: card.back })}>
              {card.front}
            </p>
            <details className="mt-2">
              <summary className="text-sm text-pencil">Show answer</summary>
              <p className="mt-2 whitespace-pre-line">{card.back}</p>
            </details>
            <StateMarkers meta={card.meta} />
            <RowActions narrow={narrow} name={name}>
              <button ref={editBtn} type="button" className="btn btn-quiet px-2 py-0.5 text-sm" aria-label={`Edit ${name}`} onClick={() => setDraft({ front: card.front, back: card.back })}>
                Edit
              </button>
              <button type="button" className="btn btn-quiet px-2 py-0.5 text-sm" aria-pressed={!!card.meta?.pinned} aria-label={`Pin ${name}`} onClick={() => onPin(!card.meta?.pinned)}>
                {card.meta?.pinned ? "Pinned" : "Pin"}
              </button>
              <button type="button" className="btn btn-quiet px-2 py-0.5 text-sm text-alert" aria-label={`Delete ${name}`} onClick={onDelete}>
                Delete
              </button>
            </RowActions>
          </div>
        </div>
      )}
    </li>
  );
}
