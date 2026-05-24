/**
 * DialTerm — SSH client wrapped in a 90s dial-up handshake animation.
 * Hosts persist via main process; xterm.js renders the terminal.
 * Passwords / passphrases live in safeStorage-encrypted secrets.enc only.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SshHostProfile } from '@shared/post-mvp-types';
import { useSettings } from '../../state/store';
import { playDialup } from '../../audio/synth';

type ConnState = 'idle' | 'dialing' | 'connecting' | 'open' | 'closed';

export function DialTermModule(): JSX.Element {
  const [hosts, setHosts] = useState<SshHostProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [state, setState] = useState<ConnState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [handshakeLog, setHandshakeLog] = useState<string[]>([]);
  const termRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitInstance = useRef<FitAddon | null>(null);
  const offData = useRef<(() => void) | null>(null);
  const offClose = useRef<(() => void) | null>(null);
  const settings = useSettings((s) => s.settings);

  const loadHosts = useCallback(async () => {
    const list = await window.api.ssh.listHosts();
    setHosts(list);
    if (!activeId && list.length > 0) setActiveId(list[0].id);
  }, [activeId]);
  useEffect(() => { void loadHosts(); }, [loadHosts]);

  // mount xterm on demand
  useEffect(() => {
    if (state !== 'open' || !termRef.current || termInstance.current) return;
    const term = new Terminal({ fontSize: 13, fontFamily: '"Courier New", monospace', theme: { background: '#000', foreground: '#aaffaa' } });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termRef.current);
    fit.fit();
    termInstance.current = term;
    fitInstance.current = fit;
    term.onData((d) => {
      if (sessionId) void window.api.ssh.write(sessionId, d);
    });
    const onResize = (): void => {
      try {
        fit.fit();
        if (sessionId) void window.api.ssh.resize(sessionId, term.cols, term.rows);
      } catch {
        // ignore
      }
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      term.dispose();
      termInstance.current = null;
      fitInstance.current = null;
    };
  }, [state, sessionId]);

  async function dial(): Promise<void> {
    if (!activeId) return;
    setState('dialing');
    setHandshakeLog([
      'ATDT9,5555551212',
      'CONNECT 33600',
      'PROTOCOL: LAP-M / V.42bis',
      'NEGOTIATING…'
    ]);
    if (settings?.soundEnabled) {
      await playDialup();
    } else {
      await new Promise((r) => setTimeout(r, 1500));
    }
    setState('connecting');
    setHandshakeLog((h) => [...h, 'CARRIER LOCK', 'OPENING SSH SESSION…']);
    try {
      offData.current = window.api.ssh.onData(({ data, sessionId: sid }) => {
        if (sid && termInstance.current) termInstance.current.write(data);
      });
      offClose.current = window.api.ssh.onClose(({ reason }) => {
        if (termInstance.current) termInstance.current.write(`\r\n\x1b[31m[disconnected: ${reason}]\x1b[0m\r\n`);
        setState('closed');
      });
      const { sessionId: sid } = await window.api.ssh.connect(activeId);
      setSessionId(sid);
      setState('open');
    } catch (err) {
      setHandshakeLog((h) => [...h, `ERROR: ${(err as Error).message}`]);
      setState('closed');
    }
  }

  async function hangup(): Promise<void> {
    if (sessionId) await window.api.ssh.disconnect(sessionId);
    offData.current?.();
    offClose.current?.();
    offData.current = null;
    offClose.current = null;
    setSessionId(null);
    setState('idle');
  }

  const activeHost = hosts.find((h) => h.id === activeId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-toolbar">
        <select className="ga98-text" value={activeId ?? ''} onChange={(e) => setActiveId(e.target.value || null)} disabled={state === 'open' || state === 'dialing'}>
          <option value="">(no host)</option>
          {hosts.map((h) => <option key={h.id} value={h.id}>{h.label} — {h.username}@{h.host}</option>)}
        </select>
        <button onClick={() => setShowSetup(true)} disabled={state === 'open' || state === 'dialing'}>Hosts…</button>
        {state === 'open'
          ? <button onClick={() => void hangup()}>Hang up</button>
          : <button onClick={() => void dial()} disabled={!activeId || state === 'dialing'}>Dial</button>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11 }}>{state.toUpperCase()}{activeHost ? ` · ${activeHost.host}:${activeHost.port}` : ''}</span>
      </div>
      <div style={{ flex: 1, background: '#000', color: '#aaffaa', padding: 4, overflow: 'hidden', position: 'relative' }}>
        {state === 'open' ? (
          <div ref={termRef} style={{ width: '100%', height: '100%' }} />
        ) : (
          <pre style={{ margin: 0, fontFamily: 'Courier New, monospace', fontSize: 13 }}>
            {state === 'idle' && (activeHost
              ? `Ready to dial ${activeHost.username}@${activeHost.host}:${activeHost.port}\n\nPress Dial to begin the handshake.`
              : 'Add a host profile via "Hosts…" to begin.')}
            {(state === 'dialing' || state === 'connecting' || state === 'closed') && handshakeLog.map((l) => `${l}\n`).join('')}
            {state === 'closed' && '\nDisconnected. Press Dial to redial.'}
          </pre>
        )}
      </div>
      {showSetup && <HostSetup hosts={hosts} onClose={() => { setShowSetup(false); void loadHosts(); }} />}
    </div>
  );
}

function HostSetup({ hosts, onClose }: { hosts: SshHostProfile[]; onClose: () => void }): JSX.Element {
  const [draft, setDraft] = useState<SshHostProfile & { secret: string }>({
    id: '',
    label: 'New host',
    host: '',
    port: 22,
    username: '',
    authKind: 'key',
    keyPath: '',
    secretRef: '',
    secret: ''
  });

  async function save(): Promise<void> {
    if (!draft.host || !draft.username) {
      alert('Host and username are required.');
      return;
    }
    await window.api.ssh.upsertHost(draft);
    onClose();
  }

  return (
    <div style={overlayStyle}>
      <div className="window" style={{ width: 480 }}>
        <div className="title-bar"><div className="title-bar-text">SSH hosts</div></div>
        <div className="window-body ga98-stack">
          {hosts.length > 0 && (
            <fieldset>
              <legend>Existing</legend>
              <ul className="ga98-list">
                {hosts.map((h) => (
                  <li key={h.id}>
                    <span style={{ flex: 1 }}>{h.label} — {h.username}@{h.host}:{h.port} ({h.authKind})</span>
                    <button onClick={async () => { await window.api.ssh.deleteHost(h.id); onClose(); }}>Delete</button>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          <fieldset>
            <legend>New / edit</legend>
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 4 }}>
              <label>Label:</label>
              <input className="ga98-text" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
              <label>Host:</label>
              <input className="ga98-text" value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} />
              <label>Port:</label>
              <input className="ga98-text" type="number" value={draft.port} onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) })} />
              <label>Username:</label>
              <input className="ga98-text" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
              <label>Auth:</label>
              <select className="ga98-text" value={draft.authKind} onChange={(e) => setDraft({ ...draft, authKind: e.target.value as SshHostProfile['authKind'] })}>
                <option value="key">Private key (recommended)</option>
                <option value="password">Password</option>
              </select>
              {draft.authKind === 'key' && (
                <>
                  <label>Key path:</label>
                  <input className="ga98-text" value={draft.keyPath} onChange={(e) => setDraft({ ...draft, keyPath: e.target.value })}
                    placeholder="e.g. /home/you/.ssh/id_ed25519 or C:\\Users\\you\\.ssh\\id_ed25519" />
                  <label>Passphrase:</label>
                  <input className="ga98-text" type="password" value={draft.secret} onChange={(e) => setDraft({ ...draft, secret: e.target.value })}
                    placeholder="(optional, encrypted in secrets.enc)" />
                </>
              )}
              {draft.authKind === 'password' && (
                <>
                  <label>Password:</label>
                  <input className="ga98-text" type="password" value={draft.secret} onChange={(e) => setDraft({ ...draft, secret: e.target.value })}
                    placeholder="(encrypted in secrets.enc)" />
                </>
              )}
            </div>
          </fieldset>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => void save()}>Save</button>
            <button onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(0,0,0,0.3)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 50
};
