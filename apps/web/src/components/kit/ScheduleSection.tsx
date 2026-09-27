"use client";

import { todayDay, type KitView } from "@prepkit/shared";
import { useBuilder } from "@/components/builder/BuilderContext";
import { ScheduleRebuild } from "@/components/builder/ScheduleRebuild";
import { CheckIcon } from "@/components/icons";
import { plural } from "@/lib/format";
import { useScheduleDay } from "@/lib/queries";

export function ScheduleSection({ kit }: { kit: KitView }) {
  const { doc } = useBuilder();
  const setDay = useScheduleDay(doc.id);
  const done = doc.schedule_progress ?? {};
  const { days } = kit.schedule;
  const today = todayDay(days, done);
  const prompts = new Map(kit.questions.map((q) => [q.id, q.prompt]));
  const longest = Math.max(1, ...days.map((d) => d.minutes));
  return (
    <div className="max-w-[760px]">
      <h2 className="text-h2">Schedule</h2>
      {kit.schedule_stale && <p className="notice mt-4">Questions changed since this schedule was built.</p>}
      <ScheduleRebuild />
      <ol className="mt-6 border-l-2 border-line">
        {days.map((d) => {
          const isDone = !!done[d.day];
          return (
            <li key={d.day} className="relative pb-8 pl-6" aria-current={d.day === today ? "step" : undefined}>
              {isDone ? (
                <CheckIcon className="absolute -left-[9px] top-1.5 rounded-full bg-paper text-ink-green" />
              ) : (
                <span aria-hidden className="absolute -left-[5px] top-2 size-2 rounded-full bg-graphite" />
              )}
              <h3 className={`text-h3 ${isDone ? "text-pencil" : ""}`}>
                Day {d.day}
                {isDone && <span className="sr-only"> (done)</span>}
                {d.day === today && <span className="ml-2 rounded-sm bg-highlight px-1.5 text-sm font-semibold text-on-highlight">Today</span>}
              </h3>
              <div className={isDone ? "text-pencil" : ""}>
                <p className="mt-1">{d.focus}</p>
                <p className="mt-1 text-sm text-pencil">{d.minutes} minutes</p>
                <div aria-hidden className={`mt-2 h-1 ${isDone ? "bg-line" : "bg-graphite"}`} style={{ width: `${(d.minutes / longest) * 100}%` }} />
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
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <label className="flex items-center gap-2 py-1">
                  <input type="checkbox" checked={isDone} onChange={(e) => setDay.mutate({ day: d.day, done: e.target.checked })} />
                  Mark day {d.day} done
                </label>
                {d.question_ids.length > 0 && (
                  <a className="link" href={`#practice:${d.day}`}>
                    Practise this day&apos;s cards
                  </a>
                )}
              </div>
            </li>
          );
        })}
        <li className="relative pl-6">
          <span aria-hidden className="absolute -left-[7px] top-1.5 size-3 rounded-full border-2 border-graphite bg-paper" />
          <h3 className="text-h3">Interview</h3>
        </li>
      </ol>
    </div>
  );
}
