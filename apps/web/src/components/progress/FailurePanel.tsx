"use client";

import type { KitResponse } from "@prepkit/shared";
import { StepList } from "@/components/progress/StepList";
import { deriveSteps } from "@/lib/steps";
import { useRetryKit } from "@/lib/queries";

const REASONS: Record<string, string> = {
  LLM_RATE_LIMITED: "The language model's free-tier rate limit was reached. Wait a minute, then retry.",
  LLM_UNAVAILABLE: "The language model service couldn't be reached. Retry in a few minutes.",
  LLM_INVALID_OUTPUT: "The language model returned something that couldn't be used, even after a repair attempt. Retrying usually works.",
  TIMEOUT: "Generation took longer than the time limit. Retrying usually works, especially when the model is less busy.",
  INTERRUPTED: "The server restarted while this kit was being built. Retry to start it again.",
  INVALID_INPUT: "The job description or company website couldn't be used. Create a new kit with corrected details.",
  INVALID_KIT: "The finished kit didn't pass its consistency checks, so it wasn't saved. Retrying usually works.",
  INTERNAL: "Something unexpected went wrong on the server. Retry, and if it keeps failing, try again later.",
};

export function FailurePanel({ kit }: { kit: KitResponse }) {
  const retry = useRetryKit();
  const code = kit.error?.code ?? "INTERNAL";
  const completed = deriveSteps(kit.progress).filter((s) => s.status !== "pending");
  return (
    <section aria-labelledby="failed-heading" className="max-w-2xl">
      <h1 id="failed-heading" className="text-h2">
        This kit couldn&apos;t be built
      </h1>
      <div className="mt-4 border-l-4 border-alert py-1 pl-4">
        <p>{REASONS[code] ?? REASONS.INTERNAL}</p>
        {kit.error?.message && <p className="mt-1 break-words text-sm text-pencil">Details: {kit.error.message}</p>}
      </div>
      <button type="button" className="btn mt-6" disabled={retry.isPending} onClick={() => retry.mutate(kit.id)}>
        {retry.isPending ? "Retrying generation" : "Retry generation"}
      </button>
      <div aria-live="polite">{retry.isError && <p className="mt-2 text-alert">The retry couldn&apos;t be started. Try again.</p>}</div>
      {completed.length > 0 && (
        <>
          <h2 className="mt-10 text-h3">What ran before it stopped</h2>
          <div className="mt-4">
            <StepList steps={completed} />
          </div>
        </>
      )}
    </section>
  );
}
