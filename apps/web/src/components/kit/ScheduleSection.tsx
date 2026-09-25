import type { KitView } from "@prepkit/shared";
import { plural } from "@/lib/format";

export function ScheduleSection({ kit }: { kit: KitView }) {
  const { days } = kit.schedule;
  const prompts = new Map(kit.questions.map((q) => [q.id, q.prompt]));
  const longest = Math.max(1, ...days.map((d) => d.minutes));
  return (
    <div className="max-w-[760px]">
      <h2 className="text-h2">Schedule</h2>
      {kit.schedule_stale && <p className="notice mt-4">Questions changed since this schedule was built.</p>}
      <ol className="mt-6 border-l-2 border-line">
        {days.map((d) => (
          <li key={d.day} className="relative pb-8 pl-6">
            <span aria-hidden className="absolute -left-[5px] top-2 size-2 rounded-full bg-graphite" />
            <h3 className="text-h3">Day {d.day}</h3>
            <p className="mt-1">{d.focus}</p>
            <p className="mt-1 text-sm text-pencil">{d.minutes} minutes</p>
            <div aria-hidden className="mt-2 h-1 bg-graphite" style={{ width: `${(d.minutes / longest) * 100}%` }} />
            {d.question_ids.length > 0 && (
              <details className="mt-3">
                <summary className="text-sm text-pencil">{plural(d.question_ids.length, "question")}</summary>
                <ul className="mt-2 list-disc space-y-1 pl-6">
                  {d.question_ids.map((id) => (
                    <li key={id}>{prompts.get(id) ?? id}</li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
        <li className="relative pl-6">
          <span aria-hidden className="absolute -left-[7px] top-1.5 size-3 rounded-full border-2 border-graphite bg-paper" />
          <h3 className="text-h3">Interview</h3>
        </li>
      </ol>
    </div>
  );
}
