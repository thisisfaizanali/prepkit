import type { KitStatus } from "@prepkit/shared";
import { CheckIcon, CrossIcon } from "@/components/icons";

// Status is always text plus a shape, never colour alone.
export function StatusLabel({ status }: { status: KitStatus }) {
  if (status === "done")
    return (
      <span className="inline-flex items-center gap-1.5 text-ink-green">
        <CheckIcon /> Ready
      </span>
    );
  if (status === "failed")
    return (
      <span className="inline-flex items-center gap-1.5 text-alert">
        <CrossIcon /> Failed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="inline-block size-2 rounded-full bg-graphite" />
      {status === "queued" ? "Queued" : "Generating"}
    </span>
  );
}
