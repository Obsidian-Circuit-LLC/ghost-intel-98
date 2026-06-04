/**
 * Full-screen lock gate. Shown by App whenever the vault is enabled but locked. Renders over
 * the saved wallpaper (settings load pre-unlock, so the retro look persists). Unlock with the
 * master password or the one-time recovery key; on success App re-checks auth.status and the
 * desktop mounts.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../state/store';

/** Strip the "[auth:unlock] " channel prefix the IPC boundary adds, for a clean message. */
function cleanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/^\[[^\]]+\]\s*/, '');
}

export function LockScreen(): JSX.Element {
  const refresh = useAuth((st) => st.refresh);
  const [mode, setMode] = useState<'password' | 'recovery'>('password');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'password') await window.api.auth.unlock(value);
      else await window.api.auth.unlockRecovery(value);
      setValue('');
      await refresh(); // status -> unlocked -> App swaps in the desktop
    } catch (err) {
      setError(cleanError(err));
      setValue('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ga98-lock-overlay">
      <div className="window ga98-lock-window">
        <div className="title-bar">
          <div className="title-bar-text">Dead Cyber Society 98 — Locked</div>
        </div>
        <div className="window-body">
          <p style={{ marginTop: 0 }}>
            {mode === 'password'
              ? 'Enter your master password to unlock.'
              : 'Enter your recovery key (dashes and case optional).'}
          </p>
          <form onSubmit={submit}>
            <div className="field-row-stacked">
              <input
                type={mode === 'password' ? 'password' : 'text'}
                autoFocus
                value={value}
                disabled={busy}
                onChange={(e) => setValue(e.target.value)}
                aria-label={mode === 'password' ? 'Master password' : 'Recovery key'}
              />
            </div>
            {error && <p role="alert" style={{ color: '#a00', margin: '4px 0' }}>{error}</p>}
            <div className="field-row" style={{ justifyContent: 'space-between', gap: 6, marginTop: 8 }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => { setMode(mode === 'password' ? 'recovery' : 'password'); setValue(''); setError(null); }}
              >
                {mode === 'password' ? 'Use recovery key' : 'Use password'}
              </button>
              <button type="submit" disabled={busy || !value}>{busy ? 'Unlocking…' : 'Unlock'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
