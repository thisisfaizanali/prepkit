"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorState } from "@/components/ErrorState";
import { FailurePanel } from "@/components/progress/FailurePanel";
import { GenerationProgress } from "@/components/progress/GenerationProgress";
import { ApiError } from "@/lib/api";
import { takeNotice } from "@/lib/notice";
import { useKit } from "@/lib/queries";

export function KitPage({ id }: { id: string }) {
  const kit = useKit(id);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => setNotice(takeNotice()), []);

  let body;
  if (kit.isPending) {
    body = (
      <div aria-busy aria-label="Loading kit" className="max-w-2xl space-y-3">
        <div className="skeleton h-9 w-2/3" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-5/6" />
      </div>
    );
  } else if (kit.isError) {
    body =
      kit.error instanceof ApiError && kit.error.status === 404 ? (
        <div>
          <h1 className="text-h2">Kit not found</h1>
          <p className="mt-2">
            This kit doesn&apos;t exist or was deleted.{" "}
            <Link href="/kits" className="link">
              Go to your kits
            </Link>
          </p>
        </div>
      ) : (
        <ErrorState what="this kit" error={kit.error} onRetry={() => kit.refetch()} />
      );
  } else if (kit.data.status === "failed") {
    body = <FailurePanel kit={kit.data} />;
  } else if (kit.data.status !== "done" || !kit.data.kit) {
    body = <GenerationProgress kit={kit.data} />;
  } else {
    body = <p>Kit ready.</p>;
  }

  return (
    <>
      {notice && (
        <p role="status" className="notice mb-6 max-w-3xl">
          {notice}
        </p>
      )}
      {body}
    </>
  );
}
