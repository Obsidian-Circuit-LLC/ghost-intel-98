/**
 * DialTerm — SSH client wrapped in a 90s dial-up handshake animation.
 * Hosts persist via main process; xterm.js renders the terminal.
 * Passwords / passphrases live in safeStorage-encrypted secrets.enc only.
 *
 * v1.0.1 fixes: IPC listeners filter strictly by sessionId so two open windows
 * (or a reconnect against a freshly-disconnected prior session) can't cross-write.
 * Connect-failure path properly tears down listeners. Component unmount cleans
 * up listeners AND disconnects the live session.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SshHostProfile, DialTermProtocol } from '@shared/post-mvp-types';
import { useSettings } from '../../state/store';
import { playDialup } from '../../audio/synth';
import { toast } from '../../state/toasts';

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
  // Ref-tracked sessionId so listener callbacks (registered before setSessionId resolves)
  // can filter by the latest value without stale closures.
  const sessionIdRef = useRef<string | null>(null);
  const settings = useSettings((s) => s.settings);

  const loadHosts = useCallback(async () => {
    const list = await window.api.ssh.listHosts();
    setHosts(list);
    setActiveId((prev) => prev ?? list[0]?.id ?? null);
  }, []);
  useEffect(() => { void loadHosts(); }, [loadHosts]);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  async function doCopy(): Promise<void> {
    const term = termInstance.current;
    if (!term) return;
    const sel = term.getSelection();
    if (!sel) { setCtxMenu(null); return; }
    try {
      await navigator.clipboard.writeText(sel);
      toast.success('Copied.');
    } catch (err) {
      toast.error(`Copy failed: ${(err as Error).message}`);
    }
    setCtxMenu(null);
  }

  async function doPaste(): Promise<void> {
    const sid = sessionIdRef.current;
    if (!sid) { setCtxMenu(null); return; }
    try {
      const text = await navigator.clipboard.readText();
      if (text) await window.api.ssh.write(sid, text);
    } catch (err) {
      toast.error(`Paste failed: ${(err as Error).message}`);
    }
    setCtxMenu(null);
  }

  // mount xterm when we move to 'open'
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
      const sid = sessionIdRef.current;
      if (sid) void window.api.ssh.write(sid, d);
    });
    // Ctrl+Shift+C / Ctrl+Shift+V (or Cmd+C / Cmd+V on macOS when selection exists)
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const cmd = e.ctrlKey || e.metaKey;
      if (cmd && e.shiftKey && e.key.toLowerCase() === 'c') { void doCopy(); return false; }
      if (cmd && e.shiftKey && e.key.toLowerCase() === 'v') { void doPaste(); return false; }
      return true;
    });
    const onResize = (): void => {
      try {
        fit.fit();
        const sid = sessionIdRef.current;
        if (sid) void window.api.ssh.resize(sid, term.cols, term.rows);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[dialterm] resize failed', err);
      }
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      term.dispose();
      termInstance.current = null;
      fitInstance.current = null;
    };
  }, [state]);

  function teardown(): void {
    offData.current?.();
    offClose.current?.();
    offData.current = null;
    offClose.current = null;
    const sid = sessionIdRef.current;
    if (sid) void window.api.ssh.disconnect(sid).catch(() => {});
    sessionIdRef.current = null;
    setSessionId(null);
  }

  // Component unmount safety net.
  useEffect(() => {
    return () => teardown();
  }, []);

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

    // Subscribe ONCE per dial attempt; filter strictly by sessionId.
    offData.current = window.api.ssh.onData(({ data, sessionId: sid }) => {
      if (sid !== sessionIdRef.current) return;
      if (termInstance.current) termInstance.current.write(data);
    });
    offClose.current = window.api.ssh.onClose(({ reason, sessionId: sid }) => {
      if (sid !== sessionIdRef.current) return;
      if (termInstance.current) termInstance.current.write(`\r\n\x1b[31m[disconnected: ${reason}]\x1b[0m\r\n`);
      teardown();
      setState('closed');
    });

    try {
      const { sessionId: sid } = await window.api.ssh.connect(activeId);
      sessionIdRef.current = sid;
      setSessionId(sid);
      setState('open');
    } catch (err) {
      setHandshakeLog((h) => [...h, `ERROR: ${(err as Error).message}`]);
      teardown();
      setState('closed');
    }
  }

  async function hangup(): Promise<void> {
    teardown();
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
        <span style={{ fontSize: 11 }}>{state.toUpperCase()}{activeHost ? ` · ${activeHost.host}:${activeHost.port}` : ''}{sessionId ? ` · ${sessionId.slice(0, 8)}` : ''}</span>
      </div>
      <div
        style={{ flex: 1, background: '#000', color: '#aaffaa', padding: 4, overflow: 'hidden', position: 'relative' }}
        onContextMenu={(e) => {
          if (state !== 'open') return;
          e.preventDefault();
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
      >
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
      {ctxMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 29999 }} onMouseDown={() => setCtxMenu(null)} />
          <div className="ga98-context-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <button className="ga98-context-menu-item" onClick={() => void doCopy()}>
              Copy <span style={{ opacity: 0.7, marginLeft: 8 }}>Ctrl+Shift+C</span>
            </button>
            <button className="ga98-context-menu-item" onClick={() => void doPaste()}>
              Paste <span style={{ opacity: 0.7, marginLeft: 8 }}>Ctrl+Shift+V</span>
            </button>
          </div>
        </>
      )}
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
    protocol: 'ssh',
    secret: ''
  });
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setError(null);
    if (!draft.host || !draft.username) {
      setError('Host and username are required.');
      return;
    }
    try {
      await window.api.ssh.upsertHost(draft);
      toast.success(`Host "${draft.label}" saved.`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
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
              <label>Protocol:</label>
              <select className="ga98-text" value={draft.protocol ?? 'ssh'} onChange={(e) => {
                const protocol = e.target.value as DialTermProtocol;
                setDraft({ ...draft, protocol, port: protocol === 'telnet' ? 23 : 22, ...(protocol === 'telnet' ? { authKind: 'password' as const, keyPath: '', secret: '' } : {}) });
              }}>
                <option value="ssh">SSH</option>
                <option value="telnet">Telnet (plaintext)</option>
              </select>
              <label>Host:</label>
              <input className="ga98-text" value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} />
              <label>Port:</label>
              <input className="ga98-text" type="number" value={draft.port} onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) })} />
              <label>Username:</label>
              <input className="ga98-text" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
              {(draft.protocol ?? 'ssh') === 'ssh' ? (
                <>
                  <label>Auth:</label>
                  <select className="ga98-text" value={draft.authKind} onChange={(e) => setDraft({ ...draft, authKind: e.target.value as SshHostProfile['authKind'] })}>
                    <option value="key">Private key (recommended)</option>
                    <option value="password">Password</option>
                  </select>
                  {draft.authKind === 'key' && (
                    <>
                      <label>Key path:</label>
                      <input className="ga98-text" value={draft.keyPath} onChange={(e) => setDraft({ ...draft, keyPath: e.target.value })}
                        placeholder="must live inside your home dir, e.g. ~/.ssh/id_ed25519" />
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
                </>
              ) : (
                <>
                  <label>Auth:</label>
                  <span style={{ fontSize: 11, opacity: 0.7, alignSelf: 'center' }}>
                    Telnet is plaintext and logs in interactively in the terminal — no credentials are stored.
                  </span>
                </>
              )}
            </div>
          </fieldset>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button onClick={() => void save()}>Save</button>
            <button onClick={onClose}>Cancel</button>
            {error && <span style={{ color: '#900', fontSize: 11, marginLeft: 8 }}>{error}</span>}
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
