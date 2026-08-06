/**
 * X Listening Station — renderer shell (Task X1).
 *
 * Clearnet-quarantine module. Capture runs main-side in a hardened BrowserWindow on a named
 * clearnet partition (see src/main/capture/capture-window.ts); this renderer never touches the
 * network, never sees the auth token, and only drives the main-process capture surface through
 * the sender-validated `window.api.xListening` IPC group.
 *
 * X1 scope is the shell + the connect affordance only. Session status, visible-DOM capture,
 * follower networks, notes, archive cycles, and exports arrive in Tasks X2–X8; each adds its own
 * method to the `xListening` surface and its own panel here. Nothing in this file imports
 * bgconn/Tor/socmint/telegram code — the import-graph sentinel must stay green.
 *
 * Honesty note (carried forward from the quarantine exemplar): the connect flow opens a real
 * hardened login window and lets the operator sign in directly to X. No cookie copying, and the
 * auth token is never read, echoed, or logged by this module — status is a derived boolean only.
 */

import { useCallback, useEffect, useState } from 'react';
import './x-listening.css';

export function XListeningModule(_props: { caseId?: string }): JSX.Element {
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);

  // Derive the session's connected boolean on mount. status() never returns the token —
  // just `{ connected }` (X2 wires the real cookie-presence check main-side).
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const s = await window.api.xListening.status();
        if (active) setConnected(s.connected);
      } catch (err) {
        // Status unavailable (e.g. main not yet wired) → treat as offline, never crash the shell.
        console.warn('[XListening] status:', err);
      }
    })();
    return () => { active = false; };
  }, []);

  const handleConnect = useCallback(async () => {
    setBusy(true);
    try {
      await window.api.xListening.connect();
      const s = await window.api.xListening.status();
      setConnected(s.connected);
    } catch (err) {
      console.warn('[XListening] connect:', err);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="xls-root">
      <header className="xls-session-bar">
        <span className={`xls-status-dot${connected ? ' xls-online' : ''}`} aria-hidden="true" />
        <div className="xls-session-label">
          <strong>{connected ? 'X SESSION ONLINE' : 'X SESSION OFFLINE'}</strong>
          <small>Visible-DOM capture only · clearnet-quarantined</small>
        </div>
      </header>

      <section className="xls-connect-card">
        <div className={`xls-connection-banner${connected ? ' xls-connected' : ''}`}>
          {connected ? 'CONNECTED' : 'NOT CONNECTED'}
        </div>
        <p className="xls-connect-help">
          Opens a dedicated hardened login window. Sign in directly to X — no cookie copying is
          required, and your auth token is never read or logged by this module.
        </p>
        <div className="xls-card-actions">
          <button
            className="xls-btn xls-btn-primary"
            onClick={() => void handleConnect()}
            disabled={busy}
          >
            {busy ? 'Opening…' : connected ? 'Reopen X' : 'Connect X'}
          </button>
        </div>
      </section>
    </div>
  );
}
