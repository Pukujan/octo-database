import * as React from "react";
import type { WorkspaceSummary } from "@v2/types/octo";
import { useWorkspaces } from "./hooks";

const ACTIVE_KEY = "octo.activeWorkspace";

interface ActiveWorkspaceContextValue {
  workspaces: WorkspaceSummary[];
  activeWorkspace: WorkspaceSummary | null;
  setActiveWorkspaceId: (id: string) => void;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

const ActiveWorkspaceContext = React.createContext<ActiveWorkspaceContextValue | null>(null);

function readStoredId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

/**
 * Holds the selected workspace.
 *
 * Selection is convenience only — never authorization. The list itself comes
 * from the API for the authenticated identity, and a stale selection falls back
 * to the first authorized workspace rather than being trusted.
 */
export function ActiveWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading, isError, error, refetch } = useWorkspaces();
  const [selectedId, setSelectedId] = React.useState<string | null>(readStoredId);

  const workspaces = React.useMemo(() => data ?? [], [data]);

  const activeWorkspace = React.useMemo(() => {
    if (workspaces.length === 0) return null;
    return workspaces.find((workspace) => workspace.id === selectedId) ?? workspaces[0]!;
  }, [workspaces, selectedId]);

  React.useEffect(() => {
    if (!activeWorkspace) return;
    if (selectedId !== activeWorkspace.id) setSelectedId(activeWorkspace.id);
  }, [activeWorkspace, selectedId]);

  const setActiveWorkspaceId = React.useCallback((id: string) => {
    setSelectedId(id);
    try {
      window.localStorage.setItem(ACTIVE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const value = React.useMemo<ActiveWorkspaceContextValue>(
    () => ({
      workspaces,
      activeWorkspace,
      setActiveWorkspaceId,
      isLoading,
      isError,
      error: (error as Error | null) ?? null,
      refetch,
    }),
    [workspaces, activeWorkspace, setActiveWorkspaceId, isLoading, isError, error, refetch],
  );

  return (
    <ActiveWorkspaceContext.Provider value={value}>{children}</ActiveWorkspaceContext.Provider>
  );
}

export function useActiveWorkspace(): ActiveWorkspaceContextValue {
  const context = React.useContext(ActiveWorkspaceContext);
  if (!context) {
    throw new Error("useActiveWorkspace must be used inside <ActiveWorkspaceProvider>");
  }
  return context;
}
