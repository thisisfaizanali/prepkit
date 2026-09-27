"use client";

import type { Confidence, BatchSubmitResponse, KitInputRequest, KitResponse, KitSummary, PublicUser, SubmitResponse } from "@prepkit/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

type Credentials = { email: string; password: string };

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<{ user: PublicUser }>("/auth/me").then((r) => r.user) });

export const useKits = () => useQuery({ queryKey: ["kits"], queryFn: () => api<{ kits: KitSummary[] }>("/kits").then((r) => r.kits) });

const isBusy = (k: KitResponse | undefined) =>
  !!k && (k.status === "queued" || k.status === "running" || k.regeneration?.status === "running");

export const useKit = (id: string) =>
  useQuery({
    queryKey: ["kit", id],
    queryFn: () => api<KitResponse>(`/kits/${encodeURIComponent(id)}`),
    refetchInterval: (q) => (isBusy(q.state.data) ? 2000 : false),
    // Keep polling in a background tab while work is in progress (the interval is off otherwise anyway).
    refetchIntervalInBackground: true,
    // A poll that started before a save finished can answer with an older kit: never step back a version.
    structuralSharing: (old, next) => {
      const [a, b] = [old as KitResponse | undefined, next as KitResponse];
      return a && b && a.status === "done" && b.status === "done" && b.version < a.version ? a : b;
    },
  });

export function useCreateKit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: KitInputRequest) => api<SubmitResponse>("/kits", { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kits"] }),
  });
}

export function useCreateBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cases: KitInputRequest[]) => api<BatchSubmitResponse>("/kits/batch", { method: "POST", body: { cases } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kits"] }),
  });
}

export function useDeleteKit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/kits/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: (_r, id) => {
      qc.setQueryData<KitSummary[]>(["kits"], (list) => list?.filter((k) => k.id !== id));
      qc.removeQueries({ queryKey: ["kit", id] });
    },
  });
}

export function useRetryKit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ id: string }>(`/kits/${encodeURIComponent(id)}/retry`, { method: "POST" }),
    onSuccess: (_r, id) => qc.invalidateQueries({ queryKey: ["kit", id] }),
  });
}

const patchKit = (qc: ReturnType<typeof useQueryClient>, id: string, fn: (d: KitResponse) => Partial<KitResponse>) =>
  qc.setQueryData<KitResponse>(["kit", id], (d) => d && { ...d, ...fn(d) });

/** Save a practice rating: shown at once, retried quietly (practice must never block on the network). */
export function useRatePractice(id: string) {
  const qc = useQueryClient();
  return (flashcardId: string, confidence: Confidence) => {
    patchKit(qc, id, (d) => {
      const reviews = (d.practice?.[flashcardId]?.reviews ?? 0) + 1;
      return { practice: { ...d.practice, [flashcardId]: { confidence, reviews, lastReviewedAt: new Date().toISOString() } } };
    });
    const send = (attempt: number): void =>
      void api(`/kits/${encodeURIComponent(id)}/practice`, { method: "POST", body: { flashcardId, confidence } }).catch(() => {
        // ponytail: fixed backoff, gives up after 5 tries (the rating then lives only until reload)
        if (attempt < 5) setTimeout(() => send(attempt + 1), 2000 * attempt);
      });
    send(1);
  };
}

export function useScheduleDay(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ day, done }: { day: number; done: boolean }) =>
      api<{ schedule_progress: Record<string, string> }>(`/kits/${encodeURIComponent(id)}/schedule-progress`, { method: "POST", body: { day, done } }),
    onMutate: ({ day, done }) =>
      patchKit(qc, id, (d) => {
        const { [day]: _old, ...rest } = d.schedule_progress ?? {};
        return { schedule_progress: done ? { ...rest, [day]: new Date().toISOString() } : rest };
      }),
    onSuccess: (r) => patchKit(qc, id, () => r),
    onError: () => qc.invalidateQueries({ queryKey: ["kit", id] }),
  });
}

function useAuthMutation(path: "/auth/login" | "/auth/register") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (c: Credentials) => api<{ user: PublicUser }>(path, { method: "POST", body: c }).then((r) => r.user),
    onSuccess: (user) => {
      qc.clear();
      qc.setQueryData(["me"], user);
    },
  });
}
export const useLogin = () => useAuthMutation("/auth/login");
export const useRegister = () => useAuthMutation("/auth/register");

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/auth/logout", { method: "POST" }),
    onSettled: () => qc.clear(),
  });
}
