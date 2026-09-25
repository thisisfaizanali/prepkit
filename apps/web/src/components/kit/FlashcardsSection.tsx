"use client";

import { newUserItemId, type Flashcard } from "@prepkit/shared";
import { closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type Announcements, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { noShift } from "@/components/builder/dnd";
import { useState } from "react";
import { useBuilder } from "@/components/builder/BuilderContext";
import { FlashcardRow } from "@/components/builder/FlashcardRow";
import { useToast } from "@/components/builder/Toasts";

export function FlashcardsSection() {
  const { kit, enqueue } = useBuilder();
  const toast = useToast();
  const [adding, setAdding] = useState<Flashcard | null>(null);
  const cards = kit.flashcards;
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, scrollBehavior: "auto" }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const ids = cards.map((c) => c.id);
    const from = ids.indexOf(String(active.id));
    const to = over ? ids.indexOf(String(over.id)) : -1;
    if (from < 0 || to < 0 || from === to) return;
    const card = cards[from];
    enqueue({ op: "flashcard.move", id: card.id, beforeId: arrayMove(ids, from, to)[to + 1] ?? null, snapshot: card });
  };
  const position = (id: string | number) => `Moved to position ${cards.findIndex((c) => c.id === id) + 1} of ${cards.length}.`;
  const announcements: Announcements = {
    onDragStart: () => "Picked up flashcard.",
    onDragOver: ({ over }) => (over ? position(over.id) : ""),
    onDragEnd: ({ over }) => (over ? `Dropped. ${position(over.id)}` : "Dropped where it started."),
    onDragCancel: () => "Reordering cancelled. The flashcard is back where it was.",
  };

  const remove = (card: Flashcard) => {
    const i = cards.findIndex((c) => c.id === card.id);
    const beforeId = cards[i + 1]?.id ?? null;
    enqueue({ op: "flashcard.delete", id: card.id });
    toast({
      message: "Flashcard deleted.",
      action: {
        label: "Undo",
        run: () => {
          if (card.id.startsWith("fu-")) enqueue({ op: "flashcard.add", flashcard: card });
          enqueue({ op: "flashcard.move", id: card.id, beforeId, snapshot: card });
        },
      },
    });
  };

  return (
    <div className="max-w-[760px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h2">Flashcards</h2>
        <button
          type="button" className="btn btn-quiet py-1 text-sm" disabled={!!adding}
          onClick={() => setAdding({ id: newUserItemId("f"), front: "", back: "", requirement_ids: [], meta: { origin: "user", edited: false, pinned: false } })}
        >
          Add flashcard
        </button>
      </div>
      <DndContext
        sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: "To reorder a flashcard, press Space or Enter to pick it up, use the arrow keys to move it, then Space to drop it or Escape to cancel.",
          },
        }}
      >
        <SortableContext items={cards.map((c) => c.id)} strategy={noShift}>
          <ol className="mt-4 border-t border-line">
            {cards.length === 0 && !adding && <li className="py-3 text-pencil">This kit has no flashcards. Add one to start.</li>}
            {cards.map((c, i) => (
              <FlashcardRow
                key={c.id} card={c} number={i + 1}
                onSave={(d) => enqueue({ op: "flashcard.update", id: c.id, patch: d, snapshot: { ...c, ...d } })}
                onPin={(pinned) => enqueue({ op: "flashcard.pin", id: c.id, pinned })}
                onDelete={() => remove(c)}
              />
            ))}
            {adding && (
              <FlashcardRow
                isNew card={adding} number={cards.length + 1}
                onSave={(d) => {
                  enqueue({ op: "flashcard.add", flashcard: { ...adding, ...d } });
                  setAdding(null);
                }}
                onCancelNew={() => setAdding(null)} onPin={() => {}} onDelete={() => setAdding(null)}
              />
            )}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}
