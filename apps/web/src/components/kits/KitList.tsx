"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorState } from "@/components/ErrorState";
import { KitRow } from "@/components/kits/KitRow";
import { takeNotice } from "@/lib/notice";
import { useKits } from "@/lib/queries";

export function KitList() {
  const kits = useKits();
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => setNotice(takeNotice()), []);

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-h1">Your kits</h1>
        <Link href="/kits/new" className="btn">
          New kit
        </Link>
      </div>
      {notice && (
        <p role="status" className="notice mt-6">
          {notice}
        </p>
      )}
      <div className="mt-6">
        {kits.isPending ? (
          <ul aria-label="Loading kits" aria-busy className="space-y-4">
            {[0, 1, 2].map((i) => (
              <li key={i} className="border-b border-line pb-4">
                <div className="skeleton h-5 w-2/3" />
                <div className="skeleton mt-2 h-4 w-1/3" />
                <div className="skeleton mt-2 h-4 w-1/2" />
              </li>
            ))}
          </ul>
        ) : kits.isError ? (
          <ErrorState what="your kits" error={kits.error} onRetry={() => kits.refetch()} />
        ) : kits.data.length === 0 ? (
          <p className="text-pencil">
            No kits yet.{" "}
            <Link href="/kits/new" className="link text-graphite">
              Paste a job description to build your first one.
            </Link>
          </p>
        ) : (
          <ul className="border-t border-line">
            {kits.data.map((k) => (
              <KitRow key={k.id} kit={k} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
