/**
 * Full-screen lock gate. Shown by App whenever the vault is enabled but locked. Renders over the
 * Ghost Intel 98 "Welcome" splash image (the same boot-splash art) so boot → login share one look.
 * Unlock with the master password or the one-time recovery key; on success App re-checks auth.status
 * and the desktop mounts.
 */
import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useAuth, useSettings } from '../state/store';
import splash from '../assets/boot-splash.jpg';
import logoUrl from '../assets/logo.png';

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

/** Close Ghost Intel 98. Cancel/× on a Logon dialog means "do not log on", and while the vault is
 *  locked there is nowhere else to go. Guarded so a host that refuses `close()` is a no-op rather
 *  than a thrown error on the lock screen. */
function cancelLogon(): void {
  try {
    window.close();
  } catch {
    /* nothing sensible to do on the lock screen */
  }
}

/** The classic key-and-monitor logon glyph, drawn inline so it needs no asset and stays crisp. */
function LogonKeyIcon(): JSX.Element {
  return (
    <svg width="72" height="72" viewBox="0 0 32 32" shapeRendering="crispEdges" role="img" aria-label="">
      {/* monitor */}
      <rect x="11" y="9" width="18" height="13" fill="#c0c0c0" stroke="#000" />
      <rect x="13" y="11" width="14" height="9" fill="#000080" />
      <rect x="17" y="22" width="6" height="3" fill="#c0c0c0" stroke="#000" />
      <rect x="14" y="25" width="12" height="2" fill="#c0c0c0" stroke="#000" />
      {/* key, overlapping the monitor's lower-left like the original */}
      <circle cx="9" cy="14" r="5" fill="#ffd700" stroke="#000" />
      <circle cx="9" cy="14" r="2" fill="#000080" />
      <rect x="8" y="18" width="2" height="9" fill="#ffd700" stroke="#000" />
      <rect x="10" y="22" width="3" height="2" fill="#ffd700" stroke="#000" />
      <rect x="10" y="25" width="3" height="2" fill="#ffd700" stroke="#000" />
    </svg>
  );
}

export function LockScreen(): JSX.Element {
  const refresh = useAuth((st) => st.refresh);
  const settings = useSettings((st) => st.settings);
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

  const isRecovery = mode === 'recovery';

  return (
    <div
      className="ga98-lock-overlay"
      style={{ background: `var(--ga98-shadow-deep) url(${JSON.stringify(settings?.bootSplashImage || splash)}) center / cover no-repeat` }}
    >
      <div className="window ga98-logon-window has-brand">
        <div className="title-bar">
          <div className="title-bar-text">Ghost Intel 98 - Logon</div>
          <div className="title-bar-controls">
            {/* Win98 semantics: Cancel/× on a Logon dialog means "do not log on". There is nowhere
                else to go while the vault is locked, so it closes the app. `window.close()` needs no
                new IPC — inventing a lock-exempt quit channel for a cosmetic change would add a
                capability reachable while locked. */}
            <button aria-label="Close" onClick={cancelLogon} />
          </div>
        </div>
        <div className="window-body ga98-logon-body">
          {/* Left brand panel + divider, to GhostExodus's mockup. The artwork is the app's own
              shipped logo; his mock used a wordmark we do not have as an asset, so the LAYOUT is
              reproduced rather than the lettering imitated. Swapping in a supplied PNG is one
              import. Hidden below 620px so a narrow window keeps the form usable. */}
          <div className="ga98-logon-brand" aria-hidden="true">
            <div className="ga98-logon-welcome">WELCOME</div>
            <img className="ga98-logon-logo" src={logoUrl} alt="" />
          </div>

          <div className="ga98-logon-form">
          <div className="ga98-logon-head">
            <div className="ga98-logon-icon" aria-hidden="true">
              <LogonKeyIcon />
            </div>
            <p className="ga98-logon-prompt">
              {isRecovery
                ? <>Enter your recovery key<br />to log on to Ghost Intel 98.</>
                : <>Enter your master password<br />to log on to Ghost Intel 98.</>}
            </p>
          </div>

          <hr className="ga98-logon-rule" />

          <form onSubmit={submit}>
            <div className="ga98-logon-field">
              <label htmlFor="ga98-logon-input">{isRecovery ? 'Recovery key:' : 'Password:'}</label>
              <input
                id="ga98-logon-input"
                type={isRecovery ? 'text' : 'password'}
                autoFocus
                value={value}
                disabled={busy}
                onChange={(e) => setValue(e.target.value)}
                aria-label={isRecovery ? 'Recovery key' : 'Master password'}
              />
            </div>

            {/* Unlock-error ink: the ORIGINAL classic literal was #a00 — route to the parity-exact
                --ga98-neg-ink (#a00) its sibling sites use, NOT the LOCKED status tier (#9a1621),
                which would shift the classic hue. Amethyst variant (#ff8a8a) stays legible on dark. */}
            {error && (
              <p role="alert" className="ga98-logon-error" style={{ color: 'var(--ga98-neg-ink)' }}>
                {error}
              </p>
            )}

            <hr className="ga98-logon-rule" />

            <div className="ga98-logon-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => { setMode(isRecovery ? 'password' : 'recovery'); setValue(''); setError(null); }}
              >
                {isRecovery ? 'Use password…' : 'Use recovery key…'}
              </button>
              <div className="ga98-logon-actions-right">
                <button type="submit" className="default" disabled={busy || !value}>
                  {busy ? 'Unlocking…' : 'OK'}
                </button>
                <button type="button" onClick={cancelLogon}>Cancel</button>
              </div>
            </div>
          </form>

          </div>

          {bgConns.length > 0 && (
            <div className="ga98-lock-bgconn">
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
