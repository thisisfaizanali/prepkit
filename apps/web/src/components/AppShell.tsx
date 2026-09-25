"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/Wordmark";
import { useLogout, useMe } from "@/lib/queries";

const NAV = [
  { href: "/kits", label: "Your kits" },
  { href: "/kits/new", label: "New kit" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  const logout = useLogout();
  return (
    <>
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:bg-sheet focus:p-2">
        Skip to content
      </a>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Wordmark />
          <nav aria-label="Main" className="mr-auto flex gap-5">
            {NAV.map(({ href, label }) => (
              <Link
                key={href} href={href} aria-current={pathname === href ? "page" : undefined}
                className="font-semibold underline-offset-4 hover:underline aria-[current=page]:underline aria-[current=page]:decoration-2"
              >
                {label}
              </Link>
            ))}
          </nav>
          <span className="min-w-0 truncate text-sm text-pencil" title={me.data?.email}>
            {me.data?.email ?? " "}
          </span>
          <button
            type="button" className="btn btn-quiet py-1" disabled={logout.isPending}
            onClick={() => logout.mutate(undefined, { onSettled: () => router.replace("/login") })}
          >
            Log out
          </button>
        </div>
      </header>
      <main id="content" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 outline-none">
        {children}
      </main>
    </>
  );
}
