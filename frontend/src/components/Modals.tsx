import { useState, type FormEvent, type ReactNode } from 'react';
import { apiGet, apiSend, formError } from '@/lib/api';
import { AllowanceFields, ConfirmCode, MfaCodeInput } from '@/components/fields';
import { useOcto } from '@/lib/octo';
import { useSession } from '@/lib/session';
import { useWorkspace } from '@/lib/workspace';
import type { ApiKeyRow, Workspace } from '@/lib/types';

// The dialogs. Each owns its submit and reports a rejected action as an inline
// `.form-error` inside the dialog, so the reason sits next to the field that
// caused it rather than flashing past in a toast.

function ModalShell({
  title,
  children,
  footer,
  error,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  error: string;
}) {
  const { closeModal } = useOcto();
  return (
    <>
      <dialog open className="modal" aria-labelledby="modal-title">
        <div className="modal-head">
          <div>
            <p className="eyebrow">OCTO WORKSPACE</p>
            <h2 id="modal-title">{title}</h2>
          </div>
          <button className="icon-button modal-close" type="button" onClick={closeModal} aria-label="Close dialog">
            ×
          </button>
        </div>
        <div className="modal-body">
          {children}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </dialog>
      <div className="modal-scrim" onClick={closeModal} />
    </>
  );
}

/**
 * One place for dialog submits: run the action, and on rejection put the reason
 * inline. A stamped form spends its confirmation code on the attempt, so a retry
 * needs a fresh one.
 */
function useModalSubmit() {
  const { modalError, setModalError, refreshConfirmCode } = useOcto();
  const [busy, setBusy] = useState(false);

  const submit = async (
    event: FormEvent<HTMLFormElement>,
    run: (data: FormData) => Promise<void>,
    stamped = false
  ) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await run(data);
    } catch (error) {
      setModalError(formError(error));
      if (stamped) {
        try {
          await refreshConfirmCode();
        } catch {
          /* keep the action error */
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return { modalError, submit, busy };
}

export function WorkspaceModal() {
  const { showOneTime, closeModal } = useOcto();
  const { me, refreshMe } = useSession();
  const { adoptWorkspaces } = useWorkspace();
  const { modalError, submit, busy } = useModalSubmit();

  const onSubmit = (event: FormEvent<HTMLFormElement>) =>
    submit(
      event,
      async (data) => {
        const result = await apiSend<{ workspace: Workspace; rawSecret: string }>('/api/workspaces', 'POST', {
          name: String(data.get('name') ?? '').trim(),
          description: String(data.get('description') ?? '').trim() || undefined,
          retentionDays: Number(data.get('retentionDays')) || null,
          confirmSecret: String(data.get('secret') ?? ''),
          mfaCode: String(data.get('mfaCode') ?? '') || undefined,
        });
        showOneTime({ secret: result.rawSecret, kind: 'workspace', label: result.workspace.name });
        closeModal();
        await adoptWorkspaces(await apiGet<Workspace[]>('/api/workspaces'), result.workspace);
        await refreshMe().catch(() => undefined);
      },
      true
    );

  return (
    <ModalShell title="New Workspace" error={modalError}>
      <form data-form="workspace" onSubmit={onSubmit}>
        <label>
          Workspace name
          <input name="name" required autoComplete="off" placeholder="e.g. Research" />
        </label>
        <label>
          Description <span className="optional">Optional</span>
          <textarea name="description" rows={3} placeholder="What belongs in this workspace?" />
        </label>
        <label>
          Archive after <span className="optional">Optional</span>
          <select name="retentionDays" defaultValue="0">
            <option value="0">Never</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
          </select>
        </label>
        {me?.mfaEnabled ? <MfaCodeInput /> : null}
        <ConfirmCode />
        <button className="button primary" type="submit" disabled={busy}>
          Create Workspace
        </button>
      </form>
    </ModalShell>
  );
}

export function TextFileModal() {
  const { closeModal } = useOcto();
  const { workspace, reload } = useWorkspace();
  const { modalError, submit, busy } = useModalSubmit();

  const onSubmit = (event: FormEvent<HTMLFormElement>) =>
    submit(event, async (data) => {
      await apiSend('/api/files/upload', 'POST', {
        workspaceId: workspace?.id ?? '',
        name: String(data.get('name') ?? '').trim(),
        mimeType: 'text/plain',
        data: String(data.get('content') ?? ''),
        dataEncoding: 'utf8',
      });
      closeModal();
      await reload();
    });

  return (
    <ModalShell title="New text file" error={modalError}>
      <form data-form="text-file" onSubmit={onSubmit}>
        <label>
          File name
          <input name="name" required placeholder="notes.txt" />
        </label>
        <label>
          Contents
          <textarea name="content" rows={8} placeholder="Write something useful…" />
        </label>
        <button className="button primary" type="submit" disabled={busy}>
          Save file
        </button>
      </form>
    </ModalShell>
  );
}

export function KeyModal() {
  const { showOneTime, closeModal, refreshConfirmCode } = useOcto();
  const { me } = useSession();
  const { workspace, refreshKeys } = useWorkspace();
  const { modalError, submit, busy } = useModalSubmit();

  const onSubmit = (event: FormEvent<HTMLFormElement>) =>
    submit(
      event,
      async (data) => {
        const result = await apiSend<{ apiKey: ApiKeyRow; rawSecret: string }>('/api/keys', 'POST', {
          name: String(data.get('name') ?? '').trim(),
          workspaceId: data.get('scope') === 'account' ? null : workspace?.id ?? null,
          scopes: data.getAll('allowance').map(String),
          expiresInDays: Number(data.get('expires')) || undefined,
          confirmSecret: String(data.get('secret') ?? ''),
          mfaCode: String(data.get('mfaCode') ?? '') || undefined,
        });
        await refreshKeys();
        showOneTime({ secret: result.rawSecret, kind: 'key' });
        closeModal();
        await refreshConfirmCode();
      },
      true
    );

  return (
    <ModalShell title="Generate API Key" error={modalError}>
      <form data-form="key" onSubmit={onSubmit}>
        <label>
          Key name
          <input name="name" required placeholder="e.g. Ingest Agent" />
        </label>
        <label>
          Scope
          <select name="scope" defaultValue="workspace">
            <option value="workspace">This workspace</option>
            <option value="account">Account-wide</option>
          </select>
        </label>
        <label>
          Expires in <span className="optional">Optional</span>
          <select name="expires" defaultValue="">
            <option value="">Never</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
          </select>
        </label>
        <AllowanceFields selected={['read', 'write', 'files']} />
        {me?.mfaEnabled ? <MfaCodeInput /> : null}
        <ConfirmCode />
        <button className="button primary" type="submit" disabled={busy}>
          Generate API Key
        </button>
      </form>
    </ModalShell>
  );
}

export function ShareModal() {
  const { setShareUrl, openModal } = useOcto();
  const { workspace, refreshShares } = useWorkspace();
  const { modalError, submit, busy } = useModalSubmit();

  const onSubmit = (event: FormEvent<HTMLFormElement>) =>
    submit(event, async (data) => {
      const result = await apiSend<{ rawToken: string }>('/api/workspaces/shares', 'POST', {
        workspaceId: workspace?.id ?? '',
        resourceType: 'gallery',
        permission: 'read',
        expiresInHours: Number(data.get('expires')) || null,
      });
      setShareUrl(`${window.location.origin}/share/${result.rawToken}`);
      await refreshShares();
      openModal('share-created');
    });

  return (
    <ModalShell title="Create share link" error={modalError}>
      <form data-form="share" onSubmit={onSubmit}>
        <p className="muted">Anyone with this link can view this workspace gallery.</p>
        <label>
          Expires in
          <select name="expires" defaultValue="0">
            <option value="0">No expiry</option>
            <option value="24">24 hours</option>
            <option value="168">7 days</option>
            <option value="720">30 days</option>
          </select>
        </label>
        <button className="button primary" type="submit" disabled={busy}>
          Create link
        </button>
      </form>
    </ModalShell>
  );
}

export function DeleteWorkspaceModal() {
  const { closeModal } = useOcto();
  const { me } = useSession();
  const { workspace, adoptWorkspaces } = useWorkspace();
  const { modalError, submit, busy } = useModalSubmit();

  const onSubmit = (event: FormEvent<HTMLFormElement>) =>
    submit(
      event,
      async (data) => {
        await apiSend(`/api/workspaces/${encodeURIComponent(workspace?.id ?? '')}`, 'DELETE', {
          confirmSecret: String(data.get('secret') ?? ''),
          confirmSlug: String(data.get('slug') ?? ''),
          mfaCode: String(data.get('mfaCode') ?? '') || undefined,
        });
        closeModal();
        await adoptWorkspaces(await apiGet<Workspace[]>('/api/workspaces'));
      },
      true
    );

  return (
    <ModalShell title={`Delete ${workspace?.name ?? ''}?`} error={modalError}>
      <p className="muted">This permanently removes the workspace and its catalog.</p>
      <form data-form="delete-workspace" onSubmit={onSubmit}>
        <label>
          Type {workspace?.slug} to confirm
          <input name="slug" required aria-label="Type workspace slug to confirm" />
        </label>
        {me?.mfaEnabled ? <MfaCodeInput /> : null}
        <ConfirmCode />
        <button className="button danger-button" type="submit" disabled={busy}>
          Delete workspace
        </button>
      </form>
    </ModalShell>
  );
}

export function KeyCreatedModal() {
  const { oneTimeSecret, clearOneTime } = useOcto();
  return (
    <ModalShell
      title="New API Key Minted"
      error=""
      footer={
        <button className="button primary" type="button" onClick={clearOneTime}>
          Done
        </button>
      }
    >
      <p className="muted">Copy this secret now. It is shown only once.</p>
      <div className="secret-box">
        <code>{oneTimeSecret}</code>
        <button className="text-button" type="button" onClick={() => navigator.clipboard.writeText(oneTimeSecret)}>
          Copy
        </button>
      </div>
    </ModalShell>
  );
}

export function ShareCreatedModal() {
  const { shareUrl, clearOneTime } = useOcto();
  return (
    <ModalShell
      title="Copy this link now"
      error=""
      footer={
        <button className="button primary" type="button" onClick={clearOneTime}>
          Done
        </button>
      }
    >
      <p className="muted">This read-only link is shown once. Anyone with it can view the shared gallery.</p>
      <div className="secret-box">
        <code>{shareUrl}</code>
        <button className="text-button" type="button" onClick={() => navigator.clipboard.writeText(shareUrl)}>
          Copy
        </button>
      </div>
    </ModalShell>
  );
}

export function MfaEnrollModal() {
  const { mfaSetupSecret, mfaSetupUri, setMfaRecoveryCodes, openModal } = useOcto();
  const { refreshMe } = useSession();
  const { modalError, submit, busy } = useModalSubmit();

  const onSubmit = (event: FormEvent<HTMLFormElement>) =>
    submit(event, async (data) => {
      const result = await apiSend<{ recoveryCodes: string[] }>('/api/me/mfa/confirm', 'POST', {
        code: String(data.get('code') ?? '').trim(),
      });
      setMfaRecoveryCodes(result.recoveryCodes);
      await refreshMe().catch(() => undefined);
      openModal('mfa-recovery');
    });

  return (
    <ModalShell title="Set up two-factor authentication" error={modalError}>
      <p className="muted">Add this secret to your authenticator app, then enter the 6-digit code it shows.</p>
      <div className="secret-box">
        <code>{mfaSetupSecret}</code>
      </div>
      <p className="muted">
        <small>Or open: {mfaSetupUri}</small>
      </p>
      <form data-form="mfa-enroll" onSubmit={onSubmit}>
        <label>
          Authenticator code
          <input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required />
        </label>
        <button className="button primary" type="submit" disabled={busy}>
          Confirm and enable
        </button>
      </form>
    </ModalShell>
  );
}

export function MfaRecoveryModal() {
  const { mfaRecoveryCodes, setMfaRecoveryCodes, closeModal } = useOcto();
  const joined = mfaRecoveryCodes.join('\n');
  return (
    <ModalShell
      title="Save your recovery codes"
      error=""
      footer={
        <button
          className="button primary"
          type="button"
          onClick={() => {
            setMfaRecoveryCodes([]);
            closeModal();
          }}
        >
          Done
        </button>
      }
    >
      <p className="muted">Each code works once if you lose your authenticator. They are shown only now.</p>
      <div className="secret-box">
        <code>{joined}</code>
        <button className="text-button" type="button" onClick={() => navigator.clipboard.writeText(joined)}>
          Copy
        </button>
      </div>
    </ModalShell>
  );
}

export function PreviewModal() {
  const { previewItem, closeModal } = useOcto();
  if (!previewItem) return null;
  return (
    <>
      <dialog open className="modal preview-modal" role="dialog">
        <button className="icon-button preview-close" onClick={closeModal} aria-label="Close dialog">
          ×
        </button>
        {previewItem.kind === 'video' ? (
          <video src={previewItem.fullUrl} controls autoPlay />
        ) : (
          <img src={previewItem.fullUrl} alt={previewItem.name} />
        )}
        <p>{previewItem.name}</p>
      </dialog>
      <div className="modal-scrim" onClick={closeModal} />
    </>
  );
}
