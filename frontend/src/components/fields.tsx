import { ALLOWANCES, useOcto } from '@/lib/octo';
import { useSession } from '@/lib/session';

/** The human confirmation gate: read the code off the screen and type it back. */
export function ConfirmCode() {
  const { confirmCode } = useOcto();
  if (!confirmCode) return <p className="muted">Preparing a confirmation code…</p>;
  return (
    <div className="field-group confirm-code" data-testid="confirm-code">
      <p>
        Type <strong>{confirmCode}</strong> and send it. This code is only for this action.
      </p>
      <label>
        Type the code
        <input name="secret" required autoComplete="off" spellCheck={false} autoCapitalize="characters" />
      </label>
    </div>
  );
}

/** Step-up for accounts that have enrolled an authenticator. */
export function MfaCodeInput({ labeled = true }: { labeled?: boolean }) {
  const { me } = useSession();
  if (!me?.mfaEnabled) return null;
  if (!labeled) {
    return (
      <input
        name="mfaCode"
        required
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="Authenticator code"
        aria-label="Authenticator code"
      />
    );
  }
  return (
    <label>
      Authenticator code
      <input
        name="mfaCode"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="6-digit code or recovery code"
        required
      />
    </label>
  );
}

export function AllowanceFields({ selected }: { selected: readonly string[] }) {
  return (
    <fieldset className="scope-choices">
      <legend className="sr-only">Allowances</legend>
      {ALLOWANCES.map((id) => (
        <label key={id}>
          <input type="checkbox" name="allowance" value={id} defaultChecked={selected.includes(id)} />
          {id}
        </label>
      ))}
    </fieldset>
  );
}
