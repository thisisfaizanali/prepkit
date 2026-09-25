import type { ReactNode } from "react";

/** Visible action buttons; on phones they collapse into a "More" disclosure. */
export function RowActions({ narrow, name, children }: { narrow: boolean; name: string; children: ReactNode }) {
  if (!narrow) return <div className="mt-2 flex flex-wrap items-center gap-2">{children}</div>;
  return (
    <details className="mt-2">
      <summary className="text-sm">
        More<span className="sr-only"> actions for {name}</span>
      </summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">{children}</div>
    </details>
  );
}
