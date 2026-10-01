/**
 * Octo Web Application Entry Point
 *
 * Mounts the Dashboard and connects live state to the Octo platform server.
 */

import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Dashboard } from './ui/Dashboard';
import { Principal, WorkspaceRole, WorkspaceSummary } from './types/auth';
import { WorkspaceContext } from './auth/workspace-service';
import { FileRecord } from './storage/file-service';
import { ApiKey } from './api/keys';

const API_BASE = ''; // Uses Vite proxy to http://localhost:3001

export const App: React.FC = () => {
  const [principal, setPrincipal] = useState<Principal | null>(() => {
    const saved = localStorage.getItem('octo_principal');
    return saved ? JSON.parse(saved) : null;
  });
  const [sessionToken, setSessionToken] = useState<string | null>(() => {
    return localStorage.getItem('octo_token');
  });

  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeContext, setActiveContext] = useState<WorkspaceContext | null>(null);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load workspaces when authenticated
  useEffect(() => {
    if (!sessionToken || !principal) return;

    async function loadData() {
      try {
        setIsLoading(true);
        const res = await fetch(`${API_BASE}/api/workspaces`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (res.ok) {
          const wsList = await res.json();
          setWorkspaces(wsList);
          if (wsList.length > 0) {
            handleSelectWorkspace(wsList[0].id, wsList[0].role);
          }
        }
      } catch (e) {
        console.error('Failed to load workspaces:', e);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [sessionToken]);

  // Load files and keys for active workspace
  const handleSelectWorkspace = async (workspaceId: string, roleHint?: string) => {
    if (!sessionToken || !principal) return;

    try {
      // Find workspace metadata
      const ws = workspaces.find((w) => w.id === workspaceId);
      const role = (roleHint ?? ws?.role ?? 'member') as WorkspaceRole;

      if (ws) {
        setActiveContext({
          workspace: {
            id: ws.id,
            slug: ws.slug,
            name: ws.name,
            description: ws.description,
            createdBy: principal.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          role,
          principal,
          capabilities: {
            canManageMembers: role === 'owner' || role === 'admin',
            canUploadFiles: role === 'owner' || role === 'admin' || role === 'operator',
            canDeleteWorkspace: role === 'owner',
            canManageSettings: role === 'owner' || role === 'admin',
          },
        });
      }

      // Fetch files
      const fRes = await fetch(`${API_BASE}/api/files?workspaceId=${workspaceId}`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (fRes.ok) {
        setFiles(await fRes.json());
      }

      // Fetch API keys
      const kRes = await fetch(`${API_BASE}/api/keys`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (kRes.ok) {
        setApiKeys(await kRes.json());
      }
    } catch (e) {
      console.error('Failed to load workspace details:', e);
    }
  };

  const handleSignInWithGoogle = () => {
    // In production, redirects to Supabase Google OAuth callback
    window.location.href = '/api/auth/google';
  };

  const handleSignInAsGuest = async () => {
    try {
      setIsLoading(true);
      const res = await fetch(`${API_BASE}/api/auth/guest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Guest User' }),
      });

      if (!res.ok) {
        throw new Error(`Guest login failed: ${res.statusText}`);
      }

      const data = await res.json();
      setPrincipal(data.principal);
      setSessionToken(data.sessionToken);

      localStorage.setItem('octo_principal', JSON.stringify(data.principal));
      localStorage.setItem('octo_token', data.sessionToken);

      const wsSummary: WorkspaceSummary = {
        id: data.workspace.id,
        slug: data.workspace.slug,
        name: data.workspace.name,
        description: data.workspace.description ?? null,
        role: 'owner',
        isOwner: true,
      };

      setWorkspaces([wsSummary]);
      handleSelectWorkspace(wsSummary.id, 'owner');
    } catch (err) {
      console.error('Guest login error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = () => {
    localStorage.removeItem('octo_principal');
    localStorage.removeItem('octo_token');
    setPrincipal(null);
    setSessionToken(null);
    setWorkspaces([]);
    setActiveContext(null);
    setFiles([]);
    setApiKeys([]);
  };

  const handleUploadFile = async (name: string, mimeType: string, content: string) => {
    if (!sessionToken || !activeContext) return;
    const res = await fetch(`${API_BASE}/api/files/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        workspaceId: activeContext.workspace.id,
        name,
        mimeType,
        data: content,
      }),
    });

    if (res.ok) {
      const newFile = await res.json();
      setFiles((prev) => [newFile, ...prev]);
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    if (!sessionToken || !activeContext) return;
    const res = await fetch(`${API_BASE}/api/files/${fileId}?workspaceId=${activeContext.workspace.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${sessionToken}` },
    });

    if (res.ok) {
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    }
  };

  const handleCreateApiKey = async (name: string, isAccountWide: boolean) => {
    if (!sessionToken) throw new Error('Unauthenticated');
    const res = await fetch(`${API_BASE}/api/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        name,
        workspaceId: isAccountWide ? null : activeContext?.workspace.id,
      }),
    });

    if (!res.ok) throw new Error('Failed to create API key');
    const data = await res.json();
    setApiKeys((prev) => [data.apiKey, ...prev]);
    return { rawSecret: data.rawSecret };
  };

  return (
    <Dashboard
      principal={principal}
      workspaces={workspaces}
      activeContext={activeContext}
      files={files}
      apiKeys={apiKeys}
      onSignInWithGoogle={handleSignInWithGoogle}
      onSignInAsGuest={handleSignInAsGuest}
      onSignOut={handleSignOut}
      onSelectWorkspace={handleSelectWorkspace}
      onUploadFile={handleUploadFile}
      onDeleteFile={handleDeleteFile}
      onCreateApiKey={handleCreateApiKey}
      isLoading={isLoading}
    />
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<App />);
}
