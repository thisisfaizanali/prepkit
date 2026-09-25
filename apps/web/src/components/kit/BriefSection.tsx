import type { KitView } from "@prepkit/shared";
import { BriefEditor } from "@/components/builder/BriefEditor";
import { ExternalLink } from "@/components/kit/ExternalLink";

const SIGNALS: Record<string, string> = {
  take_home: "Take-home assignment",
  system_design: "System design interview",
  pair_programming: "Pair programming",
  live_coding: "Live coding",
  behavioural: "Behavioural interview",
  culture_values: "Culture and values conversation",
};

export function BriefSection({ kit }: { kit: KitView }) {
  const brief = kit.company_brief;
  const hiring = kit.research?.hiring_process;
  const signals = Object.entries(hiring?.signals ?? {}).filter(([, on]) => on);
  return (
    <div className="max-w-[760px] space-y-8">
      <section>
        <BriefEditor />
        {brief.sources.length > 0 && (
          <>
            <h3 className="mt-6 text-h3">Sources</h3>
            <ul className="mt-2 space-y-1">
              {brief.sources.map((s) => (
                <li key={s}>{/^https?:\/\//.test(s) ? <ExternalLink href={s} /> : s}</li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section>
        <h2 className="text-h2">Hiring process</h2>
        {hiring && (hiring.stages.length > 0 || signals.length > 0) ? (
          <>
            {hiring.stages.length > 0 && (
              <ol className="mt-3 list-decimal space-y-2 pl-6">
                {hiring.stages.map((s, i) => (
                  <li key={i}>
                    <span className="font-semibold">{s.name}</span>
                    {s.description && <span className="block text-pencil">{s.description}</span>}
                  </li>
                ))}
              </ol>
            )}
            {signals.length > 0 && (
              <>
                <h3 className="mt-6 text-h3">What to expect</h3>
                <ul className="mt-2 list-disc space-y-1 pl-6">
                  {signals.map(([k]) => (
                    <li key={k}>{SIGNALS[k] ?? k.replace(/_/g, " ")}</li>
                  ))}
                </ul>
              </>
            )}
            {hiring.notes && <p className="mt-4 text-pencil">{hiring.notes}</p>}
          </>
        ) : (
          <p className="mt-3 text-pencil">This company doesn&apos;t publish its hiring process, and no public discussion was found.</p>
        )}
      </section>
    </div>
  );
}
