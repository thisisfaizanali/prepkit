"use client";

import type { KitRequirementView, KitView } from "@prepkit/shared";
import { useMemo, useState } from "react";
import { KindChip, PriorityMarker } from "@/components/kit/PriorityMarker";
import { findSpan, indexJd, segmentJd } from "@/lib/evidence";
import { plural } from "@/lib/format";

type Active = { id: string; from: "jd" | "list" } | null;

const scrollTo = (selector: string) => document.querySelector(selector)?.scrollIntoView({ block: "nearest" });

export function RoleSection({ kit, jd }: { kit: KitView; jd: string }) {
  const reqs = kit.role.requirements;
  const [active, setActive] = useState<Active>(null);

  const { segments, located } = useMemo(() => {
    const index = indexJd(jd);
    const spans = reqs.flatMap((r) => {
      const span = r.evidence ? findSpan(index, jd, r.evidence) : null;
      return span ? [{ id: r.id, span }] : [];
    });
    return { segments: segmentJd(jd, spans), located: new Set(spans.map((s) => s.id)) };
  }, [jd, reqs]);
  const priority = useMemo(() => new Map(reqs.map((r) => [r.id, r.priority])), [reqs]);

  // Linking both sides: activating one outlines its counterpart and brings it into view.
  const activate = (id: string, from: "jd" | "list") => {
    setActive({ id, from });
    scrollTo(from === "jd" ? `#req-${CSS.escape(id)}` : `mark[data-req~="${CSS.escape(id)}"]`);
  };
  const clear = () => setActive(null);

  const { uncovered_requirement_ids: uncovered, passes } = kit.coverage;
  const covered = reqs.length - uncovered.length;

  return (
    <div className="space-y-8">
      <section className="max-w-[760px]">
        <h2 className="sr-only">Role</h2>
        <dl className="flex flex-wrap gap-x-6 gap-y-1">
          {kit.role.seniority && (
            <div className="flex gap-1.5">
              <dt className="text-pencil">Seniority</dt>
              <dd>{kit.role.seniority}</dd>
            </div>
          )}
          {kit.source.location && (
            <div className="flex gap-1.5">
              <dt className="text-pencil">Location</dt>
              <dd>{kit.source.location}</dd>
            </div>
          )}
        </dl>
        {kit.role.responsibilities.length > 0 && (
          <>
            <h3 className="mt-6 text-h3">Responsibilities</h3>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              {kit.role.responsibilities.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="req-heading" className="grid gap-8 lg:grid-cols-2">
        {/* Sticky column: heading + panel stay in view while the requirement list scrolls; the panel scrolls itself. */}
        <div className="hidden self-start lg:sticky lg:top-6 lg:flex lg:max-h-[calc(100dvh-3rem)] lg:flex-col">
          <h3 className="text-h3">Job description</h3>
          <p className="mt-1 text-sm text-pencil">Marked text is where each requirement came from.</p>
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded border border-line bg-sheet p-4 whitespace-pre-wrap break-words">
            {segments.map((s) => {
              if (!s.ids.length) return <span key={s.start}>{s.text}</span>;
              const must = s.ids.some((id) => priority.get(id) === "must");
              const isActive = !!active && s.ids.includes(active.id);
              const dimmed = !!active && !isActive;
              return (
                <mark
                  key={s.start} data-req={s.ids.join(" ")} tabIndex={0}
                  aria-describedby={s.ids.map((id) => `req-text-${id}`).join(" ")}
                  onMouseEnter={() => activate(s.ids[0], "jd")} onMouseLeave={clear}
                  onFocus={() => activate(s.ids[0], "jd")} onBlur={clear}
                  className={`motion-safe:transition-opacity ${must ? "bg-highlight text-on-highlight" : "bg-transparent text-graphite underline decoration-highlight decoration-[3px] underline-offset-2"} ${
                    isActive ? "outline-2 outline-graphite" : ""
                  } ${dimmed ? "opacity-35" : ""}`}
                >
                  {s.text}
                </mark>
              );
            })}
          </div>
        </div>

        <div>
          <h3 id="req-heading" className="text-h3">
            Requirements
          </h3>
          <ul className="mt-3 space-y-2">
            {reqs.map((r) => (
              <RequirementItem
                key={r.id} req={r} located={located.has(r.id)} active={active?.id === r.id}
                onActivate={() => located.has(r.id) && activate(r.id, "list")} onClear={clear}
              />
            ))}
          </ul>
          <p className="mt-6">
            {covered} of {plural(reqs.length, "requirement")} covered in {plural(passes, "pass", "passes")}
          </p>
          {uncovered.length > 0 && (
            <>
              <p className="mt-2 text-pencil">Not yet covered by a question:</p>
              <ul className="mt-1 list-disc pl-6">
                {uncovered.map((id) => (
                  <li key={id}>{reqs.find((r) => r.id === id)?.text ?? id}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

type ItemProps = { req: KitRequirementView; located: boolean; active: boolean; onActivate: () => void; onClear: () => void };

function RequirementItem({ req, located, active, onActivate, onClear }: ItemProps) {
  return (
    <li
      id={`req-${req.id}`} tabIndex={located ? 0 : undefined}
      onMouseEnter={onActivate} onMouseLeave={onClear} onFocus={onActivate} onBlur={onClear}
      className={`rounded border border-transparent p-2 ${active ? "outline-2 outline-graphite" : ""}`}
    >
      <p id={`req-text-${req.id}`}>{req.text}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <PriorityMarker priority={req.priority} />
        <KindChip kind={req.kind} />
      </div>
      {req.evidence && (
        <details className="mt-2 lg:hidden">
          <summary className="text-sm text-pencil">Where this came from</summary>
          <blockquote className="mt-2 border-l-2 border-line pl-3">
            <span className={req.priority === "must" ? "bg-highlight text-on-highlight" : "underline decoration-highlight decoration-[3px] underline-offset-2"}>
              {req.evidence}
            </span>
          </blockquote>
        </details>
      )}
    </li>
  );
}
