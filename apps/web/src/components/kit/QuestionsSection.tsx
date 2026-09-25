"use client";

import { checkCoverage, newUserItemId, type Question } from "@prepkit/shared";
import {
  closestCorners, DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, useDroppable, useSensor, useSensors,
  type Announcements, type DragEndEvent, type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { noShift } from "@/components/builder/dnd";
import { useState } from "react";
import { useBuilder } from "@/components/builder/BuilderContext";
import { CoveragePanel } from "@/components/builder/CoveragePanel";
import { QuestionRow } from "@/components/builder/QuestionRow";
import { CATEGORY_LABEL, useRegen } from "@/components/builder/Regeneration";
import { RegenerateControl } from "@/components/builder/RegenerateControl";
import { useToast } from "@/components/builder/Toasts";
import { shortLabel } from "@/components/kit/RequirementChip";

export const CATEGORIES = (Object.keys(CATEGORY_LABEL) as Question["category"][]).map((id) => ({ id, label: CATEGORY_LABEL[id] }));
const COMPANY_UNKNOWN = "The company is unknown (the brief isn't based on any source), so company-fit questions would be guesses.";

const categoryOf = (id: UniqueIdentifier, questions: Question[]): Question["category"] | undefined =>
  String(id).startsWith("cat:") ? (String(id).slice(4) as Question["category"]) : questions.find((q) => q.id === id)?.category;

export function QuestionsSection() {
  const { kit, enqueue } = useBuilder();
  const regen = useRegen();
  const toast = useToast();
  const [adding, setAdding] = useState<Question | null>(null);
  const [dragging, setDragging] = useState<Question | null>(null);
  const qs = kit.questions;
  const reqs = kit.role.requirements;
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, scrollBehavior: "auto" }),
  );

  const inCategory = (c: Question["category"]) => qs.filter((q) => q.category === c);

  const remove = (q: Question) => {
    const i = qs.findIndex((x) => x.id === q.id);
    const beforeId = qs.slice(i + 1).find((x) => x.category === q.category)?.id ?? null;
    const was = new Set(checkCoverage(reqs, qs).uncovered_must_ids);
    const lost = checkCoverage(reqs, qs.filter((x) => x.id !== q.id)).uncovered_must_ids.filter((id) => !was.has(id));
    enqueue({ op: "question.delete", id: q.id });
    const warning = lost.map((id) => ` ${reqs.find((r) => r.id === id)?.text ?? id} is no longer covered.`).join("");
    toast({
      message: `Question deleted.${warning}`,
      action: {
        label: "Undo",
        run: () => {
          // Generated ids can't be re-added; a move of a missing id re-inserts its snapshot at the old position.
          if (q.id.startsWith("qu-")) enqueue({ op: "question.add", question: q });
          enqueue({ op: "question.move", id: q.id, category: q.category, beforeId, snapshot: q });
        },
      },
    });
  };

  const startAdding = (category: Question["category"]) =>
    setAdding({ id: newUserItemId("q"), category, prompt: "", answer_outline: "", difficulty: 2, requirement_ids: [], meta: { origin: "user", edited: false, pinned: false } });

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    const q = qs.find((x) => x.id === active.id);
    const target = over && categoryOf(over.id, qs);
    if (!q || !over || !target) return;
    let beforeId: string | null;
    if (target === q.category) {
      const ids = inCategory(target).map((x) => x.id);
      const from = ids.indexOf(q.id);
      const to = over.id === `cat:${target}` ? ids.length - 1 : ids.indexOf(String(over.id));
      if (from === to || to < 0) return;
      beforeId = arrayMove(ids, from, to)[to + 1] ?? null;
    } else {
      beforeId = over.id === `cat:${target}` ? null : String(over.id);
    }
    enqueue({ op: "question.move", id: q.id, category: target === q.category ? undefined : target, beforeId, snapshot: q });
  };

  const position = (activeId: UniqueIdentifier, overId: UniqueIdentifier) => {
    const c = categoryOf(overId, qs);
    if (!c) return "";
    const list = inCategory(c);
    const i = list.findIndex((x) => x.id === overId);
    const total = list.length + (categoryOf(activeId, qs) === c ? 0 : 1); // joining from another category
    return `Moved to position ${i < 0 ? total : i + 1} of ${total} in ${CATEGORY_LABEL[c]}.`;
  };
  const announcements: Announcements = {
    onDragStart: () => "Picked up question.",
    onDragOver: ({ active, over }) => (over ? position(active.id, over.id) : "Not over a list."),
    onDragEnd: ({ active, over }) => (over ? `Dropped. ${position(active.id, over.id)}` : "Dropped where it started."),
    onDragCancel: () => "Reordering cancelled. The question is back where it was.",
  };

  return (
    <div className="max-w-[760px]">
      <h2 className="text-h2">Questions</h2>
      <p className="mt-2 text-sm text-pencil">Regenerating a category keeps questions you wrote, edited, moved or pinned.</p>
      <div className="mt-3">
        <CoveragePanel compact />
      </div>
      <DndContext
        sensors={sensors} collisionDetection={closestCorners}
        onDragStart={({ active }) => setDragging(qs.find((q) => q.id === active.id) ?? null)}
        onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: "To reorder a question, press Space or Enter to pick it up, use the arrow keys to move it, then Space to drop it or Escape to cancel.",
          },
        }}
      >
        {CATEGORIES.map(({ id: c, label }) => {
          const list = inCategory(c);
          const lower = label.toLowerCase();
          return (
            <section key={c} aria-labelledby={`cat-${c}`} className="mt-10">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id={`cat-${c}`} className="text-h3">
                  {label} <span className="font-normal text-pencil">({list.length})</span>
                </h3>
                <button type="button" className="btn btn-quiet py-1 text-sm" onClick={() => startAdding(c)} disabled={!!adding}>
                  Add question<span className="sr-only"> to {label}</span>
                </button>
              </div>
              <RegenerateControl
                request={{ section: "questions", category: c }} label={`Regenerate ${lower} questions`} runningLabel={`Regenerating ${lower} questions…`}
                helper="Keeps questions you wrote, edited, moved or pinned."
                unavailable={c === "company-fit" && kit.company_brief.sources.length === 0 ? COMPANY_UNKNOWN : undefined}
              />
              <SortableContext id={c} items={list.map((q) => q.id)} strategy={noShift}>
                <CategoryList category={c} empty={!list.length && adding?.category !== c}>
                  {list.map((q) => (
                    <QuestionRow
                      key={q.id} question={q} number={qs.indexOf(q) + 1} requirements={reqs} fresh={regen.fresh.has(q.id)}
                      onSave={(d) => enqueue({ op: "question.update", id: q.id, patch: d, snapshot: { ...q, ...d } })}
                      onPin={(pinned) => enqueue({ op: "question.pin", id: q.id, pinned })}
                      onMove={(category) => enqueue({ op: "question.move", id: q.id, category, beforeId: null, snapshot: q })}
                      onDelete={() => remove(q)}
                    />
                  ))}
                  {adding?.category === c && (
                    <QuestionRow
                      isNew question={adding} number={qs.length + 1} requirements={reqs} fresh={false}
                      onSave={(d) => {
                        enqueue({ op: "question.add", question: { ...adding, ...d } });
                        setAdding(null);
                      }}
                      onCancelNew={() => setAdding(null)} onPin={() => {}} onMove={() => {}} onDelete={() => setAdding(null)}
                    />
                  )}
                </CategoryList>
              </SortableContext>
            </section>
          );
        })}
        <DragOverlay>
          {dragging && <div className="rounded border border-graphite bg-sheet px-4 py-3">{shortLabel(dragging.prompt, 80)}</div>}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

/** A category's list, also a drop target so questions can be dragged into an empty category. */
function CategoryList({ category, empty, children }: { category: Question["category"]; empty: boolean; children: React.ReactNode }) {
  // Only an empty category needs its own drop target; otherwise it would compete with its items as a collision.
  const { setNodeRef, isOver } = useDroppable({ id: `cat:${category}`, data: { category }, disabled: !empty });
  return (
    <ol ref={setNodeRef} className={`mt-3 min-h-10 border-t border-line ${isOver && empty ? "bg-wash" : ""}`}>
      {empty && <li className="py-3 text-sm text-pencil">No questions here yet. Add one, or drag a question into this category.</li>}
      {children}
    </ol>
  );
}
