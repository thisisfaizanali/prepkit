"use client";

import type { KitResponse } from "@prepkit/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { StepList } from "@/components/progress/StepList";
import { formatDuration } from "@/lib/format";
import { deriveSteps } from "@/lib/steps";

const SLOW_MS = 20_000;

export function GenerationProgress({ kit }: { kit: KitResponse }) {
  const steps = useMemo(() => deriveSteps(kit.progress), [kit.progress]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Client-side bookkeeping only: when each running step was first seen, and which steps finished while watching.
  const runningSince = useRef(new Map<string, number>());
  const seenDone = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState(new Set<string>());
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    for (const s of steps) if (s.status === "running" && !runningSince.current.has(s.key)) runningSince.current.set(s.key, Date.now());
    const done = steps.filter((s) => s.status === "done");
    if (!seenDone.current) {
      seenDone.current = new Set(done.map((s) => s.key)); // already done on arrival: no animation, no announcement
      return;
    }
    const newly = done.filter((s) => !seenDone.current!.has(s.key));
    if (!newly.length) return;
    for (const s of newly) seenDone.current.add(s.key);
    setFresh((f) => new Set([...f, ...newly.map((s) => s.key)]));
    setAnnouncement(`${newly.map((s) => s.label).join(", ")} done.`);
  }, [steps]);

  const started = kit.startedAt ?? kit.createdAt;
  const slow = steps.some((s) => s.status === "running" && now - (runningSince.current.get(s.key) ?? now) > SLOW_MS);

  return (
    <section aria-labelledby="progress-heading" className="max-w-2xl">
      <h1 id="progress-heading" className="text-h2">
        {kit.status === "queued" ? "Waiting to start" : "Building your kit"}
      </h1>
      <p className="mt-2 text-pencil">
        {kit.status === "queued"
          ? "Your kit is in the queue and will start shortly."
          : "This usually takes one to three minutes. You can leave this page and come back; it keeps going."}
      </p>
      {kit.status === "running" && (
        <p className="mt-2 text-sm">
          Elapsed <span className="tabular-nums">{formatDuration(now - new Date(started).getTime())}</span>
        </p>
      )}
      <div className="mt-6 min-h-[1.55rem] text-sm">{slow && <p>Free-tier model limits can slow this step down. Still working.</p>}</div>
      <div className="mt-2">
        <StepList steps={steps} fresh={fresh} />
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}
