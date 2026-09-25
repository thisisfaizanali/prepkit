import type { KitView, Question } from "@prepkit/shared";
import { Difficulty } from "@/components/kit/Difficulty";
import { RequirementChip } from "@/components/kit/RequirementChip";

export const CATEGORIES: { id: Question["category"]; label: string }[] = [
  { id: "technical", label: "Technical" },
  { id: "system-design", label: "System design" },
  { id: "behavioural", label: "Behavioural" },
  { id: "company-fit", label: "Company fit" },
];

export function QuestionsSection({ kit }: { kit: KitView }) {
  const reqs = new Map(kit.role.requirements.map((r) => [r.id, r]));
  return (
    <div className="max-w-[760px] space-y-10">
      <h2 className="text-h2">Questions</h2>
      {CATEGORIES.map(({ id, label }) => {
        const qs = kit.questions.filter((q) => q.category === id);
        if (!qs.length) return null;
        return (
          <section key={id} aria-labelledby={`cat-${id}`}>
            <h3 id={`cat-${id}`} className="text-h3">
              {label} <span className="font-normal text-pencil">({qs.length})</span>
            </h3>
            <ol className="mt-3 border-t border-line">
              {qs.map((q) => (
                <li key={q.id} className="border-b border-line py-4">
                  <div className="flex gap-3">
                    <Difficulty level={q.difficulty} />
                    <div className="min-w-0 flex-1">
                      <p>{q.prompt}</p>
                      {q.requirement_ids.length > 0 && (
                        <p className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="sr-only">Covers requirements:</span>
                          {q.requirement_ids.map((r) => (
                            <RequirementChip key={r} id={r} req={reqs.get(r)} />
                          ))}
                        </p>
                      )}
                      <details className="mt-2">
                        <summary className="text-sm text-pencil">Answer outline</summary>
                        <p className="mt-2 whitespace-pre-line">{q.answer_outline}</p>
                      </details>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
