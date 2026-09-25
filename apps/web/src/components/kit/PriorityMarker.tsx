// Must = filled highlight pill, nice = outlined pill with a highlight underline. Always labelled in text.
export function PriorityMarker({ priority }: { priority: "must" | "nice" }) {
  return priority === "must" ? (
    <span className="inline-block rounded-pill bg-highlight px-2 text-sm font-semibold text-on-highlight">Must have</span>
  ) : (
    <span className="inline-block rounded-pill border border-line px-2 text-sm">
      <span className="underline decoration-highlight decoration-[3px] underline-offset-2">Nice to have</span>
    </span>
  );
}

export function KindChip({ kind }: { kind: string }) {
  return <span className="inline-block rounded border border-line px-1.5 text-sm text-pencil">{kind}</span>;
}
