import { useOcto } from '@/lib/octo';

// One-time material — a minted key secret, a workspace key, a share link — is
// shown exactly once and dismissed. Sign-out drops it (see OctoProvider).

export function KeyNotice() {
  const { oneTimeSecret, oneTimeKind, clearOneTime } = useOcto();
  if (oneTimeKind !== 'key' || !oneTimeSecret) return null;
  return (
    <section className="one-time-notice" role="status" data-testid="one-time-secret">
      <div>
        <strong>New API Key Minted</strong>
        <p>Copy this secret now. It is shown only once.</p>
        <code>{oneTimeSecret}</code>
      </div>
      <button className="text-button" type="button" onClick={() => navigator.clipboard.writeText(oneTimeSecret)}>
        Copy
      </button>
      <button className="text-button" type="button" onClick={clearOneTime}>
        Done
      </button>
    </section>
  );
}

export function ShareNotice() {
  const { shareUrl, clearOneTime } = useOcto();
  if (!shareUrl) return null;
  return (
    <section className="one-time-notice" role="status" data-testid="one-time-secret">
      <div>
        <strong>Copy this link now</strong>
        <p>This read-only link is shown once.</p>
        <code>{shareUrl}</code>
      </div>
      <button className="text-button" type="button" onClick={() => navigator.clipboard.writeText(shareUrl)}>
        Copy
      </button>
      <button className="text-button" type="button" onClick={clearOneTime}>
        Done
      </button>
    </section>
  );
}

/** A workspace's one-time key renders at app level, on whichever view is active. */
export function WorkspaceNotice() {
  const { oneTimeSecret, oneTimeLabel, oneTimeKind, clearOneTime } = useOcto();
  if (oneTimeKind !== 'workspace' || !oneTimeSecret) return null;
  return (
    <section className="one-time-notice" role="status" data-testid="one-time-secret">
      <div>
        <strong>Workspace created</strong>
        <p>
          <strong>{oneTimeLabel}</strong> is now your active workspace. Save its workspace key now — it is shown
          only once.
        </p>
        <code>{oneTimeSecret}</code>
      </div>
      <button className="text-button" type="button" onClick={() => navigator.clipboard.writeText(oneTimeSecret)}>
        Copy
      </button>
      <button className="text-button" type="button" onClick={clearOneTime}>
        Done
      </button>
    </section>
  );
}
