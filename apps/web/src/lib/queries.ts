"use client";

import type { BatchSubmitResponse, KitInputRequest, KitResponse, KitSummary, PublicUser, SubmitResponse } from "@prepkit/shared";
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
