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
import { GalleryItem } from './media/gallery-service';
import { ShareSummary } from './media/share-service';
import { OperationsActivity, OperationsJob } from './ui/OperationsPage';
import { PublicShareView } from './ui/PublicShareView';

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
  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([]);
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [jobs, setJobs] = useState<OperationsJob[]>([]);
  const [activity, setActivity] = useState<OperationsActivity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [googleAuthEnabled, setGoogleAuthEnabled] = useState(false);

  // Probe server capabilities so unimplemented controls are not shown as live.
  useEffect(() => {
    async function loadCapabilities() {
      try {
        const res = await fetch(`${API_BASE}/health`);
        if (res.ok) {
          const data = await res.json();
          setGoogleAuthEnabled(Boolean(data.googleAuthEnabled));
        }
      } catch {
        setGoogleAuthEnabled(false);
      }
    }
    loadCapabilities();
  }, []);

  // Pickup OAuth token or error passed via URL fragment (#token=... or #auth_error=...)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#')) {
      const params = new URLSearchParams(hash.slice(1));
      const token = params.get('token');
      const authError = params.get('auth_error');

      if (token) {
        setSessionToken(token);
        localStorage.setItem('octo_token', token);
        fetch(`${API_BASE}/api/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.principal) {
              setPrincipal(data.principal);
              localStorage.setItem('octo_principal', JSON.stringify(data.principal));
            }
          })
          .catch((err) => console.error('Failed to resolve principal from token:', err));
        history.replaceState(null, '', window.location.pathname + window.location.search);
      } else if (authError) {
        console.error('Authentication error from OAuth:', authError);
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
  }, []);

  // Restore principal if token exists in storage but principal is missing
  useEffect(() => {
    if (sessionToken && !principal) {
      fetch(`${API_BASE}/api/me`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.principal) {
            setPrincipal(data.principal);
            localStorage.setItem('octo_principal', JSON.stringify(data.principal));
          }
        })
        .catch((err) => console.error('Failed to restore principal:', err));
    }
  }, [sessionToken, principal]);

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
  /** Reloads gallery media for a workspace. */
  const refreshGallery = async (workspaceId: string) => {
    if (!sessionToken) return;
    const res = await fetch(`${API_BASE}/api/gallery?workspaceId=${workspaceId}`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (res.ok) setGalleryItems(await res.json());
  };

  /** Reloads job and activity state for a workspace. */
  const refreshOperations = async (workspaceId: string) => {
    if (!sessionToken) return;
    const headers = { Authorization: `Bearer ${sessionToken}` };
    const [jobsRes, activityRes] = await Promise.all([
      fetch(`${API_BASE}/api/jobs?workspaceId=${workspaceId}`, { headers }),
      fetch(`${API_BASE}/api/activity?workspaceId=${workspaceId}`, { headers }),
    ]);
    if (jobsRes.ok) setJobs(await jobsRes.json());
    if (activityRes.ok) setActivity(await activityRes.json());
  };

  const handleRetryJob = async (jobId: string) => {
    if (!sessionToken || !activeContext) return;
    const res = await fetch(
      `${API_BASE}/api/jobs/${jobId}/retry?workspaceId=${activeContext.workspace.id}`,
      { method: 'POST', headers: { Authorization: `Bearer ${sessionToken}` } }
    );
    if (res.ok) await refreshOperations(activeContext.workspace.id);
  };

  const handleRunWorker = async () => {
    if (!sessionToken || !activeContext) return;
    const res = await fetch(
      `${API_BASE}/api/jobs/run?workspaceId=${activeContext.workspace.id}`,
      { method: 'POST', headers: { Authorization: `Bearer ${sessionToken}` } }
    );
    if (res.ok) await refreshOperations(activeContext.workspace.id);
  };

  /** Reloads scoped share links for a workspace. */
  const refreshShares = async (workspaceId: string) => {
    if (!sessionToken) return;
    const res = await fetch(`${API_BASE}/api/workspaces/shares?workspaceId=${workspaceId}`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (res.ok) {
      const rows: ShareSummary[] = await res.json();
      const now = Date.now();
      setShares(
        rows.map((r) => ({
          ...r,
          active: !r.revokedAt && (!r.validUntil || new Date(r.validUntil).getTime() > now),
        }))
      );
    }
  };

  const handleCreateShare = async (expiresInHours: number | null) => {
    if (!sessionToken || !activeContext) throw new Error('Unauthenticated');
    const res = await fetch(`${API_BASE}/api/workspaces/shares`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        workspaceId: activeContext.workspace.id,
        resourceType: 'gallery',
        permission: 'read',
        expiresInHours,
      }),
    });
    if (!res.ok) throw new Error('Failed to create share link');
    const data = await res.json();
    await refreshShares(activeContext.workspace.id);
    return { rawToken: data.rawToken as string };
  };

  const handleRevokeShare = async (shareId: string) => {
    if (!sessionToken || !activeContext) return;
    const res = await fetch(
      `${API_BASE}/api/shares/${shareId}?workspaceId=${activeContext.workspace.id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${sessionToken}` } }
    );
    if (res.ok) await refreshShares(activeContext.workspace.id);
  };

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

      // Fetch gallery items
      const gRes = await fetch(`${API_BASE}/api/gallery?workspaceId=${workspaceId}`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (gRes.ok) {
        setGalleryItems(await gRes.json());
      }

      await refreshShares(workspaceId);
      await refreshOperations(workspaceId);
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
    setFiles([]);
    setGalleryItems([]);
    setShares([]);
    setJobs([]);
    setActivity([]);
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
        dataEncoding: 'utf8',
      }),
    });

    if (res.ok) {
      const newFile = await res.json();
      setFiles((prev) => [newFile, ...prev]);
    }
  };

  /** Uploads a real binary file (image/video) as base64 with its true MIME type. */
  const handleUploadBinaryFile = async (file: File) => {
    if (!sessionToken || !activeContext) return;
    const buffer = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]!);
    }
    const base64 = btoa(binary);

    const res = await fetch(`${API_BASE}/api/files/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        workspaceId: activeContext.workspace.id,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        data: base64,
        dataEncoding: 'base64',
      }),
    });

    if (res.ok) {
      const newFile = await res.json();
      setFiles((prev) => [newFile, ...prev]);
      await refreshGallery(activeContext.workspace.id);
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

  const refreshFiles = async (workspaceId: string) => {
    if (!sessionToken) return;
    const res = await fetch(`${API_BASE}/api/files?workspaceId=${workspaceId}`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (res.ok) {
      setFiles(await res.json());
    }
  };

  const handleArchiveFile = async (fileId: string) => {
    if (!sessionToken || !activeContext) return;
    const res = await fetch(`${API_BASE}/api/files/${fileId}/archive?workspaceId=${activeContext.workspace.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (res.ok) {
      await refreshFiles(activeContext.workspace.id);
    }
  };

  const handleRestoreFile = async (fileId: string) => {
    if (!sessionToken || !activeContext) return;
    const res = await fetch(`${API_BASE}/api/files/${fileId}/restore?workspaceId=${activeContext.workspace.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (res.ok) {
      await refreshFiles(activeContext.workspace.id);
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
      galleryItems={galleryItems}
      apiKeys={apiKeys}
      googleAuthEnabled={googleAuthEnabled}
      onSignInWithGoogle={handleSignInWithGoogle}
      onSignInAsGuest={handleSignInAsGuest}
      onSignOut={handleSignOut}
      onSelectWorkspace={handleSelectWorkspace}
      onUploadFile={handleUploadFile}
      onUploadBinaryFile={handleUploadBinaryFile}
      onDeleteFile={handleDeleteFile}
      onArchiveFile={handleArchiveFile}
      onRestoreFile={handleRestoreFile}
      onCreateApiKey={handleCreateApiKey}
      shares={shares}
      onCreateShare={handleCreateShare}
      onRevokeShare={handleRevokeShare}
      jobs={jobs}
      activity={activity}
      onRetryJob={handleRetryJob}
      onRunWorker={handleRunWorker}
      isLoading={isLoading}
    />
  );
};

const rootEl = document.getElementById('root');

/**
 * A `/share/<token>` path renders the standalone public viewer, which has no
 * session, no workspace switcher, and no admin surface. Every other path renders
 * the authenticated application.
 */
function Root() {
  const shareMatch = window.location.pathname.match(/^\/share\/(.+)$/);
  if (shareMatch && shareMatch[1]) {
    return <PublicShareView token={decodeURIComponent(shareMatch[1])} />;
  }
  return <App />;
}

if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<Root />);
}
