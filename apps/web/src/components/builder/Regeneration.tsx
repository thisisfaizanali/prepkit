"use client";

import type { Question } from "@prepkit/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useBuilder } from "@/components/builder/BuilderContext";
import { useToast } from "@/components/builder/Toasts";
import { ApiError, api } from "@/lib/api";
import { plural } from "@/lib/format";

export type RegenRequest = { section: "brief" | "questions" | "gaps"; category?: Question["category"]; force?: boolean };
type Pass = { pass: number; uncovered: string[] };

export const CATEGORY_LABEL: Record<Question["category"], string> = {
  technical: "Technical",
  "system-design": "System design",
  behavioural: "Behavioural",
  "company-fit": "Company fit",
};

export const regenKey = (r: { section: string; category?: string }) => (r.section === "questions" ? `questions:${r.category}` : r.section);

/** "Pass 1 found 1 uncovered requirement. Pass 2 covered it." */
export function passTrace(passes: Pass[]): string {
  return passes
    .map((p, i) => {
      const prev = passes[i - 1]?.uncovered.length ?? 0;
      if (p.uncovered.length) return `Pass ${p.pass} found ${plural(p.uncovered.length, "uncovered requirement")}.`;
      if (i === 0) return `Pass ${p.pass} found every requirement covered.`;
      return `Pass ${p.pass} covered ${prev === 1 ? "it" : "them"}.`;
    })
    .join(" ");
}

type Regen = {
  /** Key of the regeneration running now (or just requested), e.g. "questions:technical". */
  runningKey: string | null;
  start: (r: RegenRequest) => void;
  /** Per-key failure or refusal message. */
  errors: Record<string, string>;
  /** Questions added by the regeneration that just finished (briefly highlighted). */
  fresh: Set<string>;
  lastTrace: string | null;
};

const Ctx = createContext<Regen | null>(null);
export function useRegen(): Regen {
  const r = useContext(Ctx);
  if (!r) throw new Error("useRegen outside RegenerationProvider");
  return r;
}

export function RegenerationProvider({ children }: { children: ReactNode }) {
  const { doc } = useBuilder();
  const qc = useQueryClient();
  const toast = useToast();
  const [requested, setRequested] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [lastTrace, setLastTrace] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (r: RegenRequest) => api(`/kits/${encodeURIComponent(doc.id)}/regenerate`, { method: "POST", body: r }),
    onMutate: (r) => {
      setRequested(regenKey(r));
      setErrors(({ [regenKey(r)]: _, ...rest }) => rest);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kit", doc.id] }),
    onError: (e, r) => {
      setRequested(null);
      setErrors((es) => ({ ...es, [regenKey(r)]: e instanceof ApiError ? e.message : "The regeneration couldn't be started. Try again." }));
    },
  });

  // Watch the server's regeneration record: running → done/failed is the moment to report.
  const reg = doc.regeneration;
  const seen = useRef<{ key: string; startedAt: string; before: Set<string> } | null>(null);
  useEffect(() => {
    if (!reg) return;
    const key = regenKey(reg);
    if (reg.status === "running") {
      if (seen.current?.startedAt !== reg.startedAt) seen.current = { key, startedAt: reg.startedAt, before: new Set(doc.kit.questions.map((q) => q.id)) };
      setRequested(null);
      return;
    }
    const watched = seen.current;
    if (!watched || watched.startedAt !== reg.startedAt) return; // finished before this page saw it run
    seen.current = null;
    if (reg.status === "failed") {
      setErrors((es) => ({ ...es, [key]: reg.error?.message ?? "The regeneration failed." }));
      return;
    }
    const added = doc.kit.questions.filter((q) => !watched.before.has(q.id)).map((q) => q.id);
    setFresh(new Set(added));
    setTimeout(() => setFresh(new Set()), 2500);
    const summary = (reg as { summary?: { kept?: number; passes?: Pass[] } }).summary ?? {};
    if (reg.section === "questions") {
      const label = CATEGORY_LABEL[reg.category as Question["category"]] ?? "The";
      toast({ message: `${label} questions regenerated.${summary.kept ? ` Kept ${summary.kept} of your questions.` : ""}` });
    } else if (reg.section === "gaps") {
      const trace = passTrace(summary.passes ?? []);
      setLastTrace(trace);
      toast({ message: `Coverage gaps filled. ${trace}` });
    } else {
      toast({ message: "Company brief regenerated." });
    }
  }, [reg, doc.kit.questions, toast]);

  const runningKey = reg?.status === "running" ? regenKey(reg) : requested;
  return (
    <Ctx.Provider value={{ runningKey, start: (r) => mutation.mutate(r), errors, fresh, lastTrace }}>{children}</Ctx.Provider>
  );
}

/** "Regenerating technical questions…" with a thin progress line, shown at the affected section's heading. */
export function RegenProgress({ label }: { label: string }) {
  return (
    <div role="status" className="mt-2">
      <p className="text-sm text-pencil">{label}</p>
      <div aria-hidden className="mt-1 h-0.5 w-full overflow-hidden bg-line">
        <div className="progress-line h-full w-1/3 bg-pencil" />
      </div>
    </div>
  );
}
