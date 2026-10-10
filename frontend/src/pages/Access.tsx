import { useEffect, useState, type FormEvent } from 'react';
import { apiSend, formError } from '@/lib/api';
import { ConfirmCode } from '@/components/fields';
import { KeyNotice, ShareNotice } from '@/components/Notices';
import { date } from '@/components/shared';
import { ALLOWANCES, useOcto } from '@/lib/octo';
import { useSession } from '@/lib/session';
import { useWorkspace } from '@/lib/workspace';
import { shareIsActive } from '@/lib/format';
import { showError, showSuccess } from '@/utils/toast';
import type { ApiKeyRow } from '@/lib/types';

const matches = (value: string, needle: string): boolean =>
  value.toLowerCase().includes(needle.trim().toLowerCase());

/** Collapsed allowance editor; the summary shows what the key can do right now. */
function AllowanceDropdown({ selected }: { selected: readonly string[] }) {
  return (
    <details className="dropdown">
      <summary className="dropdown-summary">
        <span className="scope-text">{selected.length ? selected.join(', ') : 'none'}</span>
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </summary>
      <div className="dropdown-body">
        <fieldset className="scope-choices">
          <legend className="sr-only">Allowances</legend>
          {ALLOWANCES.map((id) => (
            <label key={id}>
              <input type="checkbox" name="allowance" value={id} defaultChecked={selected.includes(id)} />
              {id}
            </label>
          ))}
        </fieldset>
        <button className="button secondary small" type="submit">
          Save
        </button>
      </div>
    </details>
  );
}

function RevokeMenu({ id, name }: { id: string; name: string }) {
  const { refreshKeys } = useWorkspace();
  return (
    <details className="dropdown dropdown-end">
      <summary className="dropdown-summary icon-summary" aria-label={`${name} actions`}>
        <span aria-hidden="true">⋯</span>
      </summary>
      <div className="dropdown-body">
        <button
          className="text-button danger"
          type="button"
          data-action="revoke-key"
          data-id={id}
          onClick={async () => {
            await apiSend(`/api/keys/${encodeURIComponent(id)}`, 'DELETE');
            await refreshKeys();
          }}
        >
          Revoke key
        </button>
      </div>
    </details>
  );
}

export default function Access() {
  const {
    openModal,
    refreshConfirmCode,
    confirmCode,
    setShareUrl,
    setMfaSetup,
    setMfaRecoveryCodes,
    showOneTime,
    keyFilter,
    setKeyFilter,
    keyView,
    setKeyView,
    shareFilter,
    setShareFilter,
    shareView,
    setShareView,
  } = useOcto();
  const { me, refreshMe } = useSession();
  const { workspace, keys, setKeys, shares, refreshShares, refreshKeys } = useWorkspace();
  const [busy, setBusy] = useState(false);

  // The key form is tall; on a phone the confirmation code and the submit button
  // land under the fold. Bring the button into view once the code has drawn, the
  // same way the shell reveals the form when the Access view opens.
  useEffect(() => {
    if (!confirmCode) return;
    const button = document.querySelector('[data-testid="key-mint-form"] button[type="submit"]');
    if (button instanceof HTMLElement) button.scrollIntoView({ block: 'end', inline: 'nearest' });
  }, [confirmCode]);

  const visibleKeys = keys.filter(
    (key) =>
      !keyFilter.trim() ||
      matches(key.name, keyFilter) ||
      matches(key.workspaceName ?? (key.isAccountWide ? 'account-wide' : ''), keyFilter)
  );
  const visibleShares = shares.filter(
    (share) =>
      !shareFilter.trim() ||
      matches(shareIsActive(share) ? 'active gallery link' : 'revoked', shareFilter) ||
      matches(share.permission, shareFilter)
  );

  // The inline form carries the live confirmation code. Row edits submit from
  // their own forms, so they read the code the human typed into that one.
  const typedStamp = (): { confirmSecret: string; mfaCode: string | undefined } => {
    const stamp = document.querySelector('form[data-form="key"]');
    return {
      confirmSecret: (stamp?.querySelector('input[name="secret"]') as HTMLInputElement | null)?.value ?? '',
      mfaCode: (stamp?.querySelector('input[name="mfaCode"]') as HTMLInputElement | null)?.value || undefined,
    };
  };

  const mint = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    try {
      const result = await apiSend<{ rawSecret: string }>('/api/keys', 'POST', {
        name: String(data.get('name') ?? '').trim(),
        workspaceId: data.get('scope') === 'account' ? null : workspace?.id ?? null,
        scopes: data.getAll('allowance').map(String),
        expiresInDays: Number(data.get('expires')) || undefined,
        confirmSecret: String(data.get('secret') ?? ''),
        mfaCode: String(data.get('mfaCode') ?? '') || undefined,
      });
      form.reset();
      await refreshKeys();
      await refreshConfirmCode();
      // A one-time secret belongs to the session that minted it, shown as an
      // app-level notice so it survives a view switch until dismissed.
      showOneTime({ secret: result.rawSecret, kind: 'key' });
    } catch (error) {
      showError(formError(error));
      try {
        await refreshConfirmCode();
      } catch {
        /* keep the action error */
      }
    } finally {
      setBusy(false);
    }
  };

  const saveAllowances = async (event: FormEvent<HTMLFormElement>, keyId: string) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const { confirmSecret, mfaCode } = typedStamp();
    try {
      const updated = await apiSend<ApiKeyRow>(`/api/keys/${encodeURIComponent(keyId)}`, 'PATCH', {
        scopes: data.getAll('allowance').map(String),
        confirmSecret,
        mfaCode,
      });
      setKeys(keys.map((key) => (key.id === updated.id ? { ...key, scopes: updated.scopes } : key)));
      await refreshConfirmCode();
      showSuccess('Allowances saved');
    } catch (error) {
      showError(formError(error));
      try {
        await refreshConfirmCode();
      } catch {
        /* keep the action error */
      }
    }
  };

  const revokeShare = async (id: string) => {
    await apiSend(`/api/shares/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(workspace?.id ?? '')}`, 'DELETE');
    await refreshShares();
  };

  const keyTable = (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Workspace</th>
            <th>Created</th>
            <th>Last used</th>
            <th>Allowances</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visibleKeys.map((key) => (
            <tr key={key.id}>
              <td>
                <strong>{key.name}</strong>
                <small>
                  <code>{key.prefix}…</code>
                </small>
              </td>
              <td>{key.isAccountWide ? 'Account-wide' : key.workspaceName ?? 'This workspace'}</td>
              <td>{date(key.createdAt)}</td>
              <td>{date(key.lastUsedAt)}</td>
              <td>
                <form className="key-allowance" data-form="key-allowances" data-id={key.id} onSubmit={(event) => void saveAllowances(event, key.id)}>
                  <AllowanceDropdown selected={key.scopes ?? []} />
                </form>
              </td>
              <td className="row-actions">
                <RevokeMenu id={key.id} name={key.name} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const keyCards = (
    <div className="record-cards">
      {visibleKeys.map((key) => (
        <article className="record-card" key={key.id}>
          <header>
            <strong>{key.name}</strong>
            <span className="role-tag">{key.isAccountWide ? 'Account-wide' : key.workspaceName ?? 'This workspace'}</span>
          </header>
          <small>
            <code>{key.prefix}…</code>
          </small>
          <dl className="record-facts">
            <div>
              <dt>Created</dt>
              <dd>{date(key.createdAt)}</dd>
            </div>
            <div>
              <dt>Last used</dt>
              <dd>{date(key.lastUsedAt)}</dd>
            </div>
          </dl>
          <form className="key-allowance" data-form="key-allowances" data-id={key.id} onSubmit={(event) => void saveAllowances(event, key.id)}>
            <AllowanceDropdown selected={key.scopes ?? []} />
          </form>
          <footer>
            <RevokeMenu id={key.id} name={key.name} />
          </footer>
        </article>
      ))}
    </div>
  );

  const shareTable = (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Link</th>
            <th>Permission</th>
            <th>Created</th>
            <th>Visits</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visibleShares.map((share) => (
            <tr key={share.id}>
              <td>
                <strong>{shareIsActive(share) ? 'Active gallery link' : 'Revoked'}</strong>
                <small>Expires {date(share.validUntil)}</small>
              </td>
              <td>{share.permission}</td>
              <td>{date(share.createdAt)}</td>
              <td>{share.accessCount}</td>
              <td className="row-actions">
                {shareIsActive(share) ? (
                  <button className="text-button danger" data-action="revoke-share" data-id={share.id} onClick={() => void revokeShare(share.id)}>
                    Revoke
                  </button>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const shareCards = (
    <div className="record-cards">
      {visibleShares.map((share) => (
        <article className="record-card" key={share.id}>
          <header>
            <strong>{shareIsActive(share) ? 'Active gallery link' : 'Revoked'}</strong>
            <span className="role-tag">{share.permission}</span>
          </header>
          <small>Expires {date(share.validUntil)}</small>
          <dl className="record-facts">
            <div>
              <dt>Created</dt>
              <dd>{date(share.createdAt)}</dd>
            </div>
            <div>
              <dt>Visits</dt>
              <dd>{share.accessCount}</dd>
            </div>
          </dl>
          <footer>
            {shareIsActive(share) ? (
              <button className="text-button danger" data-action="revoke-share" data-id={share.id} onClick={() => void revokeShare(share.id)}>
                Revoke link
              </button>
            ) : (
              <span className="muted">Revoked</span>
            )}
          </footer>
        </article>
      ))}
    </div>
  );

  const keyBody = !keys.length ? (
    <div className="empty-panel compact">
      <strong>No API keys yet</strong>
      <p>Create one for an application or agent.</p>
    </div>
  ) : (
    <>
      <div className="table-toolbar">
        <label className="filter-field">
          <input
            type="search"
            data-filter="keys"
            value={keyFilter}
            placeholder="Filter keys…"
            aria-label="Filter keys…"
            onChange={(event) => setKeyFilter(event.target.value)}
          />
        </label>
        <div className="view-toggle" role="group" aria-label="keys view">
          {(['table', 'cards'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`view-button${keyView === option ? ' is-active' : ''}`}
              data-view-mode={`keys:${option}`}
              onClick={() => setKeyView(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      {visibleKeys.length ? (keyView === 'cards' ? keyCards : keyTable) : (
        <div className="empty-panel compact">
          <strong>No keys match</strong>
          <p>Nothing here matches “{keyFilter}”.</p>
        </div>
      )}
    </>
  );

  const shareBody = !shares.length ? (
    <div className="empty-panel compact">
      <strong>No share links</strong>
      <p>Create a read-only gallery link for this workspace.</p>
    </div>
  ) : (
    <>
      <div className="table-toolbar">
        <label className="filter-field">
          <input
            type="search"
            data-filter="shares"
            value={shareFilter}
            placeholder="Filter links…"
            aria-label="Filter links…"
            onChange={(event) => setShareFilter(event.target.value)}
          />
        </label>
        <div className="view-toggle" role="group" aria-label="shares view">
          {(['table', 'cards'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`view-button${shareView === option ? ' is-active' : ''}`}
              data-view-mode={`shares:${option}`}
              onClick={() => setShareView(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      {visibleShares.length ? (shareView === 'cards' ? shareCards : shareTable) : (
        <div className="empty-panel compact">
          <strong>No links match</strong>
          <p>Nothing here matches “{shareFilter}”.</p>
        </div>
      )}
    </>
  );

  const mfaBody = me?.mfaEnabled ? (
    <>
      <p className="muted">Enabled. {me.mfaRecoveryCodesRemaining} recovery codes remaining.</p>
      <form
        data-form="mfa-rotate"
        className="access-create-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const code = String(new FormData(event.currentTarget).get('code') ?? '').trim();
          try {
            const result = await apiSend<{ recoveryCodes: string[] }>('/api/me/mfa/recovery-codes', 'POST', { code });
            setMfaRecoveryCodes(result.recoveryCodes);
            await refreshMe();
            openModal('mfa-recovery');
          } catch (error) {
            showError(formError(error));
          }
        }}
      >
        <input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="Authenticator code" aria-label="Authenticator code" required />
        <button className="button secondary" type="submit">
          Rotate recovery codes
        </button>
      </form>
      <form
        data-form="mfa-disable"
        className="access-create-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const code = String(new FormData(event.currentTarget).get('code') ?? '').trim();
          try {
            await apiSend('/api/me/mfa/disable', 'POST', { code });
            await refreshMe();
          } catch (error) {
            showError(formError(error));
          }
        }}
      >
        <input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="Code or recovery code" aria-label="Authenticator or recovery code" required />
        <button className="button danger-button" type="submit">
          Disable two-factor
        </button>
      </form>
    </>
  ) : (
    <>
      <p className="muted">
        Not enabled. Require a code from your authenticator for destructive commands like deleting a workspace.
      </p>
      <button
        className="button secondary"
        type="button"
        data-action="mfa-begin"
        onClick={async () => {
          const setup = await apiSend<{ secret: string; otpauthUri: string }>('/api/me/mfa/begin', 'POST');
          setMfaSetup({ secret: setup.secret, uri: setup.otpauthUri });
          openModal('mfa-enroll');
        }}
      >
        Set up two-factor authentication
      </button>
    </>
  );

  return (
    <div data-testid="view-access">
      <KeyNotice />
      <ShareNotice />

      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">MACHINE ACCESS</p>
            <h2>API keys</h2>
            <p className="panel-copy">
              Keys for this workspace, plus account-wide keys that can act here. Allowances are read, write, files,
              and delete. write includes publish and unpublish. delete removes the private file, and that call still
              needs an admin role on the key.
            </p>
            <form data-form="key" className="access-create-form" data-testid="key-mint-form" onSubmit={mint}>
              <input name="name" required placeholder="e.g. Ingest Agent" aria-label="API key name" />
              <select name="scope" aria-label="API key scope" defaultValue="workspace">
                <option value="workspace">This workspace</option>
                <option value="account">Account-wide</option>
              </select>
              <select name="expires" aria-label="API key expiration" defaultValue="">
                <option value="">Never</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
              </select>
              <fieldset className="scope-choices">
                <legend className="sr-only">Allowances</legend>
                {(['read', 'write', 'files'] as const).map((id) => (
                  <label key={id}>
                    <input type="checkbox" name="allowance" value={id} defaultChecked />
                    {id}
                  </label>
                ))}
              </fieldset>
              <ConfirmCode key={confirmCode} />
              {me?.mfaEnabled ? (
                <input name="mfaCode" required inputMode="numeric" autoComplete="one-time-code" placeholder="Authenticator code" aria-label="Authenticator code" />
              ) : null}
              <button className="button primary" type="submit" disabled={busy}>
                Generate API Key
              </button>
            </form>
          </div>
        </div>
        {keyBody}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">SHARED CONTENT</p>
            <h2>Share links</h2>
            <p className="panel-copy">Read-only access to this workspace gallery.</p>
          </div>
          <div className="share-create-controls" data-testid="share-create">
            <label className="sr-only" htmlFor="share-expiry">
              Share link expiration
            </label>
            <select id="share-expiry" defaultValue="0">
              <option value="0">No expiry</option>
              <option value="1">1 hour</option>
              <option value="24">24 hours</option>
              <option value="168">7 days</option>
            </select>
            <button
              className="button secondary"
              type="button"
              data-action="new-share"
              onClick={async () => {
                const expiry = Number((document.getElementById('share-expiry') as HTMLSelectElement | null)?.value) || null;
                const result = await apiSend<{ rawToken: string }>('/api/workspaces/shares', 'POST', {
                  workspaceId: workspace?.id ?? '',
                  resourceType: 'gallery',
                  permission: 'read',
                  expiresInHours: expiry,
                });
                setShareUrl(`${window.location.origin}/share/${result.rawToken}`);
                await refreshShares();
              }}
            >
              Create link
            </button>
          </div>
        </div>
        {shareBody}
      </section>

      <section className="panel settings-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">SECURITY</p>
            <h2>Two-factor authentication</h2>
            <p className="panel-copy">Per-account step-up for destructive commands.</p>
          </div>
        </div>
        {mfaBody}
      </section>

      <section className="panel settings-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">WORKSPACE</p>
            <h2>{workspace?.name}</h2>
            <p className="panel-copy">{workspace?.description || 'No description'}</p>
          </div>
          <span className="role-tag">{workspace?.role}</span>
        </div>
        <dl className="detail-list">
          <div>
            <dt>Workspace slug</dt>
            <dd>{workspace?.slug}</dd>
          </div>
          <div>
            <dt>File retention</dt>
            <dd>{workspace?.retentionDays ? `${workspace.retentionDays} days` : 'No automatic archive'}</dd>
          </div>
          <div>
            <dt>Confirmation</dt>
            <dd>Type the code shown on the form</dd>
          </div>
          <div>
            <dt>Two-factor</dt>
            <dd>{me?.mfaEnabled ? 'Enabled' : 'Not enabled'}</dd>
          </div>
        </dl>
        <button
          className="button danger-button"
          type="button"
          data-action="delete-workspace"
          onClick={async () => {
            await refreshConfirmCode();
            openModal('delete-workspace');
          }}
        >
          Delete Workspace
        </button>
      </section>
    </div>
  );
}
