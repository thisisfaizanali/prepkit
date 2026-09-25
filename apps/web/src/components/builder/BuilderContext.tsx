"use client";

import type { KitResponse, KitView, Op } from "@prepkit/shared";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { api } from "@/lib/api";
import { localKit } from "@/lib/builder/queue";
import { BuilderStore, type Saved, type Snapshot } from "@/lib/builder/store";

type Builder = {
  doc: KitResponse & { kit: KitView };
  /** Server kit + unsaved ops: what every section renders. */
  kit: KitView;
  enqueue: (op: Op) => void;
  save: Snapshot;
  dismissError: () => void;
  flush: () => Promise<void>;
  /** Store a kit returned by the API (ops, schedule rebuild) in the query cache. */
  adopt: (saved: Saved) => void;
};

const Ctx = createContext<Builder | null>(null);
export function useBuilder(): Builder {
  const b = useContext(Ctx);
  if (!b) throw new Error("useBuilder outside BuilderProvider");
  return b;
}

export function BuilderProvider({ doc, children }: { doc: KitResponse & { kit: KitView }; children: ReactNode }) {
  const qc = useQueryClient();
  const id = doc.id;
  const [{ store, adopt }] = useState(() => {
    const adopt = ({ kit, version }: Saved) =>
      qc.setQueryData<KitResponse>(["kit", id], (d) => (d && version >= d.version ? { ...d, kit: kit as KitView, version } : d));
    const send = (ops: Op[]) =>
      // Built through the mutation cache, so a 401 reaches the one global session handler.
      qc.getMutationCache().build(qc, { mutationFn: () => api<Saved>(`/kits/${encodeURIComponent(id)}/ops`, { method: "PATCH", body: { ops } }) }).execute(undefined);
    const store = new BuilderStore({
      send,
      sendOnExit: (ops) => void api(`/kits/${encodeURIComponent(id)}/ops`, { method: "PATCH", body: { ops }, keepalive: true }).catch(() => {}),
      onSaved: adopt,
      onRejected: () => void qc.invalidateQueries({ queryKey: ["kit", id] }),
    });
    return { store, adopt };
  });
  const save = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => {
    const onHidden = () => document.visibilityState === "hidden" && void store.flush();
    const onOnline = () => void store.flush();
    const onOffline = () => void store.flush(); // marks "offline" when there's something unsaved
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", store.flushOnExit);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", store.flushOnExit);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      store.flushOnExit();
      store.dispose();
    };
  }, [store]);

  const kit = useMemo(() => localKit(doc.kit as never, save.queue) as KitView, [doc.kit, save.queue]);
  const value: Builder = {
    doc,
    kit,
    enqueue: store.enqueue,
    save,
    dismissError: store.dismissError,
    flush: store.flush,
    adopt,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
