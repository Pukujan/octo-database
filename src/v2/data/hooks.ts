import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StorageSnapshot } from "@v2/types/octo";
import type { CreateApiKeyInput, UploadFileInput } from "./adapter";
import { useOctoData } from "./provider";

export const queryKeys = {
  me: ["me"] as const,
  workspaces: ["workspaces"] as const,
  files: (workspaceId: string) => ["files", workspaceId] as const,
  gallery: (workspaceId: string) => ["gallery", workspaceId] as const,
  jobs: (workspaceId: string) => ["jobs", workspaceId] as const,
  activity: (workspaceId: string) => ["activity", workspaceId] as const,
  keys: ["keys"] as const,
  shares: (workspaceId: string) => ["shares", workspaceId] as const,
  capabilities: (workspaceId: string) => ["capabilities", workspaceId] as const,
  health: ["health"] as const,
  fleet: ["fleet"] as const,
};

export function useMe() {
  const { api } = useOctoData();
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.getMe(),
    retry: false,
    staleTime: 30_000,
  });
}

export function useWorkspaces() {
  const { api } = useOctoData();
  return useQuery({ queryKey: queryKeys.workspaces, queryFn: () => api.listWorkspaces() });
}

export function useFiles(workspaceId: string | null) {
  const { api } = useOctoData();
  return useQuery({
    queryKey: queryKeys.files(workspaceId ?? "none"),
    queryFn: () => api.listFiles(workspaceId!),
    enabled: Boolean(workspaceId),
  });
}

export function useGallery(workspaceId: string | null) {
  const { api } = useOctoData();
  return useQuery({
    queryKey: queryKeys.gallery(workspaceId ?? "none"),
    queryFn: () => api.listGallery(workspaceId!),
    enabled: Boolean(workspaceId),
  });
}

export function useJobs(workspaceId: string | null) {
  const { api } = useOctoData();
  return useQuery({
    queryKey: queryKeys.jobs(workspaceId ?? "none"),
    queryFn: () => api.listJobs(workspaceId!),
    enabled: Boolean(workspaceId),
  });
}

export function useActivity(workspaceId: string | null) {
  const { api } = useOctoData();
  return useQuery({
    queryKey: queryKeys.activity(workspaceId ?? "none"),
    queryFn: () => api.listActivity(workspaceId!),
    enabled: Boolean(workspaceId),
  });
}

export function useKeys() {
  const { api } = useOctoData();
  return useQuery({ queryKey: queryKeys.keys, queryFn: () => api.listKeys() });
}

export function useShares(workspaceId: string | null) {
  const { api } = useOctoData();
  return useQuery({
    queryKey: queryKeys.shares(workspaceId ?? "none"),
    queryFn: () => api.listShares(workspaceId!),
    enabled: Boolean(workspaceId),
  });
}

export function useCapabilities(workspaceId: string | null) {
  const { api } = useOctoData();
  return useQuery({
    queryKey: queryKeys.capabilities(workspaceId ?? "none"),
    queryFn: () => api.listCapabilities(workspaceId!),
    enabled: Boolean(workspaceId),
  });
}

export function useHealth() {
  const { api } = useOctoData();
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => api.getHealth(),
    // A point-in-time connectivity check, not a polled metric: no interval, so
    // an offline backend cannot produce a steady stream of failed requests.
    retry: false,
    staleTime: 60_000,
  });
}

export function useFleetSnapshot() {
  const { api } = useOctoData();
  return useQuery({ queryKey: queryKeys.fleet, queryFn: () => api.getFleetSnapshot() });
}

/**
 * Derives recorded catalog usage from the file list.
 *
 * This is metadata accounting, never physical bucket usage or remaining
 * provider capacity.
 */
export function useStorageSnapshot(workspaceId: string | null): {
  snapshot: StorageSnapshot | null;
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useFiles(workspaceId);
  if (!data || !workspaceId) return { snapshot: null, isLoading, isError };

  let usedBytes = 0;
  let activeR2Bytes = 0;
  let archivedDriveBytes = 0;
  let transitioningBytes = 0;

  for (const file of data) {
    usedBytes += file.sizeBytes;
    if (file.archiveState === "archived_drive") archivedDriveBytes += file.sizeBytes;
    else if (file.archiveState === "archiving" || file.archiveState === "restoring")
      transitioningBytes += file.sizeBytes;
    else activeR2Bytes += file.sizeBytes;
  }

  return {
    snapshot: {
      workspaceId,
      observedAt: new Date().toISOString(),
      usedBytes,
      fileCount: data.length,
      activeR2Bytes,
      archivedDriveBytes,
      transitioningBytes,
    },
    isLoading,
    isError,
  };
}

function useInvalidateWorkspace(workspaceId: string | null) {
  const client = useQueryClient();
  return () => {
    if (!workspaceId) return;
    void client.invalidateQueries({ queryKey: queryKeys.files(workspaceId) });
    void client.invalidateQueries({ queryKey: queryKeys.gallery(workspaceId) });
    void client.invalidateQueries({ queryKey: queryKeys.jobs(workspaceId) });
    void client.invalidateQueries({ queryKey: queryKeys.activity(workspaceId) });
    void client.invalidateQueries({ queryKey: queryKeys.fleet });
  };
}

export function useUploadFile(workspaceId: string | null) {
  const { api } = useOctoData();
  const invalidate = useInvalidateWorkspace(workspaceId);
  return useMutation({
    mutationFn: (input: UploadFileInput) => api.uploadFile(input),
    onSuccess: invalidate,
  });
}

export function useDeleteFile(workspaceId: string | null) {
  const { api } = useOctoData();
  const invalidate = useInvalidateWorkspace(workspaceId);
  return useMutation({
    mutationFn: (fileId: string) => api.deleteFile(workspaceId!, fileId),
    onSuccess: invalidate,
  });
}

export function useArchiveFile(workspaceId: string | null) {
  const { api } = useOctoData();
  const invalidate = useInvalidateWorkspace(workspaceId);
  return useMutation({
    mutationFn: (fileId: string) => api.archiveFile(workspaceId!, fileId),
    onSuccess: invalidate,
  });
}

export function useRestoreFile(workspaceId: string | null) {
  const { api } = useOctoData();
  const invalidate = useInvalidateWorkspace(workspaceId);
  return useMutation({
    mutationFn: (fileId: string) => api.restoreFile(workspaceId!, fileId),
    onSuccess: invalidate,
  });
}

export function useRetryJob(workspaceId: string | null) {
  const { api } = useOctoData();
  const invalidate = useInvalidateWorkspace(workspaceId);
  return useMutation({
    mutationFn: (jobId: string) => api.retryJob(workspaceId!, jobId),
    onSuccess: invalidate,
  });
}

export function useRunWorker(workspaceId: string | null) {
  const { api } = useOctoData();
  const invalidate = useInvalidateWorkspace(workspaceId);
  return useMutation({
    mutationFn: () => api.runWorker(workspaceId!),
    onSuccess: invalidate,
  });
}

export function useCreateApiKey() {
  const { api } = useOctoData();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApiKeyInput) => api.createApiKey(input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.keys });
      void client.invalidateQueries({ queryKey: queryKeys.activity("") });
    },
  });
}

export function useRevokeApiKey() {
  const { api } = useOctoData();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (keyId: string) => api.revokeApiKey(keyId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.keys });
    },
  });
}

export function useRevokeShare(workspaceId: string | null) {
  const { api } = useOctoData();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) => api.revokeShare(workspaceId!, shareId),
    onSuccess: () => {
      if (workspaceId) void client.invalidateQueries({ queryKey: queryKeys.shares(workspaceId) });
    },
  });
}
