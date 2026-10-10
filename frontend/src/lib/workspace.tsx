import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiGet } from './api';
import { useSession } from './session';
import type {
  ActivityRow,
  ApiKeyRow,
  FileRecord,
  GalleryItem,
  JobRow,
  OpsSummary,
  ShareRow,
  Workspace,
} from './types';

// The sections a workspace load fetches, named as the user would see them: a
// failed request and an empty workspace look identical, so the name of the one
// that failed is surfaced instead of being coerced to an empty list.
const LOAD_LABELS = [
  'files',
  'gallery',
  'jobs',
  'activity',
  'shares',
  'API keys',
  'failure classifications',
] as const;

interface WorkspaceContextValue {
  workspaces: Workspace[];
  workspace: Workspace | null;
  files: FileRecord[];
  gallery: GalleryItem[];
  jobs: JobRow[];
  activity: ActivityRow[];
  shares: ShareRow[];
  keys: ApiKeyRow[];
  opsSummary: OpsSummary | null;
  loading: boolean;
  loadError: string;
  selectWorkspace: (id: string) => Promise<void>;
  adoptWorkspaces: (workspaces: Workspace[], active?: Workspace) => Promise<void>;
  clearWorkspace: () => void;
  reload: () => Promise<void>;
  refreshKeys: () => Promise<void>;
  refreshShares: () => Promise<void>;
  setKeys: (keys: ApiKeyRow[]) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { principal, ready } = useSession();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [opsSummary, setOpsSummary] = useState<OpsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const startedFor = useRef<string | null>(null);

  const applyWorkspace = useCallback(async (selected: Workspace) => {
    setWorkspace(selected);
    setLoading(true);
    const query = `?workspaceId=${encodeURIComponent(selected.id)}`;
    const results = await Promise.allSettled([
      apiGet<FileRecord[]>(`/api/files${query}`),
      apiGet<GalleryItem[]>(`/api/gallery${query}`),
      apiGet<JobRow[]>(`/api/jobs${query}`),
      apiGet<ActivityRow[]>(`/api/activity${query}`),
      apiGet<ShareRow[]>(`/api/workspaces/shares${query}`),
      apiGet<ApiKeyRow[]>(`/api/keys${query}`),
      apiGet<OpsSummary>(`/api/ops/summary${query}`),
    ]);
    const failed = results
      .map((result, index) => (result.status === 'rejected' ? LOAD_LABELS[index] : null))
      .filter((label): label is (typeof LOAD_LABELS)[number] => label !== null);
    setLoadError(failed.length ? `Could not load ${failed.join(', ')} for this workspace.` : '');
    const [fileResult, galleryResult, jobResult, activityResult, shareResult, keyResult, opsResult] =
      results;
    setFiles(fileResult.status === 'fulfilled' ? fileResult.value : []);
    setGallery(galleryResult.status === 'fulfilled' ? galleryResult.value : []);
    setJobs(jobResult.status === 'fulfilled' ? jobResult.value : []);
    setActivity(activityResult.status === 'fulfilled' ? activityResult.value : []);
    setShares(shareResult.status === 'fulfilled' ? shareResult.value : []);
    setKeys(keyResult.status === 'fulfilled' ? keyResult.value : []);
    setOpsSummary(opsResult.status === 'fulfilled' ? opsResult.value : null);
    setLoading(false);
  }, []);

  const selectWorkspace = useCallback(
    async (id: string) => {
      const selected = workspaces.find((candidate) => candidate.id === id);
      if (selected) await applyWorkspace(selected);
    },
    [applyWorkspace, workspaces]
  );

  const reload = useCallback(async () => {
    if (workspace) await applyWorkspace(workspace);
  }, [applyWorkspace, workspace]);

  const refreshKeys = useCallback(async () => {
    if (!workspace) return;
    setKeys(await apiGet<ApiKeyRow[]>(`/api/keys?workspaceId=${encodeURIComponent(workspace.id)}`));
  }, [workspace]);

  const refreshShares = useCallback(async () => {
    if (!workspace) return;
    setShares(
      await apiGet<ShareRow[]>(`/api/workspaces/shares?workspaceId=${encodeURIComponent(workspace.id)}`)
    );
  }, [workspace]);

  const adoptWorkspaces = useCallback(
    async (list: Workspace[], active?: Workspace) => {
      setWorkspaces(list);
      if (active) {
        await applyWorkspace(active);
        return;
      }
      if (list.length) await applyWorkspace(list[0]!);
      else setWorkspace(null);
    },
    [applyWorkspace]
  );

  const clearWorkspace = useCallback(() => setWorkspace(null), []);

  // Resolve the session's workspaces once it exists; a fresh principal starts over.
  useEffect(() => {
    if (!ready || !principal) return;
    if (startedFor.current === principal.id) return;
    startedFor.current = principal.id;
    apiGet<Workspace[]>('/api/workspaces')
      .then((list) => adoptWorkspaces(list))
      .catch(() => undefined);
  }, [adoptWorkspaces, principal, ready]);

  const value: WorkspaceContextValue = {
    workspaces,
    workspace,
    files,
    gallery,
    jobs,
    activity,
    shares,
    keys,
    opsSummary,
    loading,
    loadError,
    selectWorkspace,
    adoptWorkspaces,
    clearWorkspace,
    reload,
    refreshKeys,
    refreshShares,
    setKeys,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return context;
}
