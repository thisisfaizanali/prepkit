import { CheckIcon, CrossIcon } from "@/components/icons";
import { formatDuration } from "@/lib/format";
import type { Step, StepStatus } from "@/lib/steps";

const STATUS_TEXT: Record<StepStatus, string> = {
  pending: "Waiting",
  running: "In progress",
  done: "Done",
  skipped: "Skipped",
  failed: "Failed",
};

function Marker({ status, animate }: { status: StepStatus; animate: boolean }) {
  // Fixed-size box so rows never shift when a marker changes.
  const box = "mt-1 flex size-4 shrink-0 items-center justify-center";
  if (status === "done") return <CheckIcon className={`${box} ${animate ? "check-draw" : ""}`} />;
  if (status === "failed") return <CrossIcon className={`${box} text-alert`} />;
  if (status === "running") return <span aria-hidden className={box}><span className="size-2 rounded-full bg-graphite" /></span>;
  if (status === "skipped") return <span aria-hidden className={box}><span className="h-0.5 w-2.5 bg-pencil" /></span>;
  return <span aria-hidden className={box}><span className="size-2 rounded-full border border-pencil" /></span>;
}

/** `fresh`: keys of steps that finished while this page was open (only those get the drawn check). */
export function StepList({ steps, fresh = new Set<string>() }: { steps: Step[]; fresh?: Set<string> }) {
  return (
    <ol className="space-y-3">
      {steps.map((s) => (
        <li key={s.key} className={`flex gap-3 ${s.status === "pending" ? "text-pencil" : ""}`}>
          <Marker status={s.status} animate={fresh.has(s.key)} />
          <div className="min-w-0">
            <p className={s.status === "running" ? "font-semibold" : ""}>
              {s.label}
              <span className="sr-only">: {STATUS_TEXT[s.status]}</span>
              {s.ms !== undefined && s.status !== "running" && <span className="ml-2 text-sm text-pencil">{formatDuration(s.ms)}</span>}
            </p>
            {s.detail && <p className="break-words text-sm text-pencil">{s.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
