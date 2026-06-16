/**
 * Full-screen lock gate. Shown by App whenever the vault is enabled but locked. Renders over
 * the saved wallpaper (settings load pre-unlock, so the retro look persists). Unlock with the
 * master password or the one-time recovery key; on success App re-checks auth.status and the
 * desktop mounts.
 */
import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../state/store';

/** A live background-connection summary, as returned by the lock-exempt bgconn:status channel. */
interface BgConnStatus {
  connId: string;
  routing: 'tor' | 'direct';
  startedAt: number;
}

/** Strip the "[auth:unlock] " channel prefix the IPC boundary adds, for a clean message. */
function cleanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/^\[[^\]]+\]\s*/, '');
}

/**
 * Pure helper: build the human-readable LIVE badge text for the active background
 * Telegram monitor connections. Empty string when none are live.
 */
export function lockScreenBgconnLabel(
  conns: Array<{ connId: string; routing: string; startedAt: number }>
): string {
  if (conns.length === 0) return '';
  return conns.map((c) => `Telegram monitor: LIVE (${c.routing})`).join(' · ');
}

export function LockScreen(): JSX.Element {
  const refresh = useAuth((st) => st.refresh);
  const [mode, setMode] = useState<'password' | 'recovery'>('password');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bgConns, setBgConns] = useState<BgConnStatus[]>([]);

  // Poll the lock-exempt bgconn:status channel so the operator can SEE a live monitor while
  // locked. A failed status call must never break the lock screen: swallow and keep last state.
  useEffect(() => {
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const next = await window.api.bgconn.status();
        if (!cancelled) setBgConns(next);
      } catch {
        /* ignore — leave the last known state intact */
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Emergency-stop a live monitor via the lock-exempt bgconn:stop channel, then refresh the list
  // so the badge updates immediately.
  const stopConn = async (connId: string): Promise<void> => {
    try {
      await window.api.bgconn.stop(connId);
    } catch {
      /* ignore */
    } finally {
      try {
        const next = await window.api.bgconn.status();
        setBgConns(next);
      } catch {
        /* leave last-known state; the poll will refresh */
      }
    }
  };

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
          <div className="title-bar-text">Ghost Intel 98 — Locked</div>
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
          {bgConns.length > 0 && (
            <div
              className="ga98-lock-bgconn"
              style={{
                marginTop: 12,
                border: '1px solid #808080',
                borderTop: '1px solid #404040',
                borderLeft: '1px solid #404040',
                padding: '6px 8px',
                background: '#c0c0c0',
                fontSize: '0.85em'
              }}
            >
              <p style={{ margin: '0 0 6px' }}>{lockScreenBgconnLabel(bgConns)}</p>
              <div className="field-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {bgConns.map((c) => (
                  <button key={c.connId} type="button" onClick={() => void stopConn(c.connId)}>
                    Stop {c.connId}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
