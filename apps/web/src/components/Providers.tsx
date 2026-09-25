"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { isUnauthenticated } from "@/lib/api";
import { setNotice } from "@/lib/notice";

export const SESSION_EXPIRED = "Your session expired. Log in again to continue.";

/** The single place 401s are handled: any query or mutation that gets one sends the user to log in. */
export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [client] = useState(() => {
    const onError = (e: unknown) => {
      // Login/register failures are 401s too, but they belong to the form, not to an expired session.
      if (!isUnauthenticated(e) || location.pathname === "/login" || location.pathname === "/register") return;
      client.clear();
      setNotice(SESSION_EXPIRED);
      router.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
    };
    const client: QueryClient = new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
      defaultOptions: {
        queries: { retry: (n, e) => !isUnauthenticated(e) && n < 2, refetchOnWindowFocus: false },
      },
    });
    return client;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
