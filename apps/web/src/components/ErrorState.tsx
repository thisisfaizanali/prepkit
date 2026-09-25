import { ApiError } from "@/lib/api";

export function ErrorState({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  const detail = error instanceof ApiError && error.code === "NETWORK" ? error.message : "The server returned an error.";
  return (
    <div role="alert" className="border-l-4 border-alert py-2 pl-4">
      <p>
        Couldn&apos;t load {what}. {detail}
      </p>
      <button type="button" className="btn btn-quiet mt-3" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
