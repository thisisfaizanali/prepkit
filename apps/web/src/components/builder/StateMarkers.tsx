import type { Meta } from "@prepkit/shared";

/** "Yours", "Edited", "Pinned": why regeneration will keep this item. */
export function StateMarkers({ meta }: { meta?: Meta }) {
  const marks = [meta?.origin === "user" && "Yours", meta?.edited && meta.origin !== "user" && "Edited", meta?.pinned && "Pinned"].filter(Boolean);
  if (!marks.length) return null;
  return <span className="text-sm text-pencil">{marks.join(", ")}</span>;
}
