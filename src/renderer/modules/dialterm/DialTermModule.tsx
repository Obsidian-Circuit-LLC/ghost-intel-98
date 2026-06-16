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
import { playCarrier, playLegacyDialup, playHangup, CARRIER_BEAT } from '../../audio/synth';
import { toast } from '../../state/toasts';
import { FtpBrowser } from './FtpBrowser';
import { nextPortOnProtocolChange } from './port';
import logoUrl from '../../assets/logo.png';

type ConnState = 'idle' | 'connecting' | 'open' | 'closed';

/** Sentinel host id for the "Local Shell" option. Real host ids are uuids (sc-/uuid form), so this
 *  cannot collide; we reuse activeId as the carrier of selection rather than adding a second state. */
const LOCAL_SHELL_ID = '__local__';

/** Transport abstraction so the xterm plumbing can target either the SSH session or a local shell
 *  session. Both backends expose an identical surface (see preload api.d.ts); the only divergence is
 *  the connect signature, which is handled in dial() (hostId vs. program token). */
interface DialTransport {
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  disconnect(sessionId: string): Promise<void>;
  onData(cb: (p: { sessionId: string; data: string }) => void): () => void;
  onClose(cb: (p: { sessionId: string; reason: string }) => void): () => void;
}

const sshTransport: DialTransport = {
  write: (sessionId, data) => window.api.ssh.write(sessionId, data),
  resize: (sessionId, cols, rows) => window.api.ssh.resize(sessionId, cols, rows),
  disconnect: (sessionId) => window.api.ssh.disconnect(sessionId),
  onData: (cb) => window.api.ssh.onData(cb),
  onClose: (cb) => window.api.ssh.onClose(cb)
};

const shellTransport: DialTransport = {
  write: (sessionId, data) => window.api.shell.write(sessionId, data),
  resize: (sessionId, cols, rows) => window.api.shell.resize(sessionId, cols, rows),
  disconnect: (sessionId) => window.api.shell.disconnect(sessionId),
  onData: (cb) => window.api.shell.onData(cb),
  onClose: (cb) => window.api.shell.onClose(cb)
};

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A flavour phone number to "dial". Math.random is fine here — this is purely cosmetic
 *  animation, not a correctness-critical path; the digits drive lights + tones, nothing else. */
function makeDialNumber(): string {
  let n = '9';
  for (let i = 0; i < 10; i += 1) n += String(Math.floor(Math.random() * 10));
  return n;
}

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
  // Guards against the multi-second connect animation outliving the component: if the window is
  // closed (or Dial is re-invoked) before ssh.connect resolves, the resolved session would
  // otherwise be set on a dead component and never torn down. mountedRef + a per-dial epoch close that.
  const mountedRef = useRef(true);
  const dialEpochRef = useRef(0);
  // The active backend for the current/next session. Defaults to ssh so all existing host behaviour
  // is unchanged; dial() swaps it to shellTransport only when the Local Shell sentinel is selected.
  const transportRef = useRef<DialTransport>(sshTransport);
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
      if (text) await transportRef.current.write(sid, text);
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
      if (sid) void transportRef.current.write(sid, d);
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
        if (sid) void transportRef.current.resize(sid, term.cols, term.rows);
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
    if (sid) void transportRef.current.disconnect(sid).catch(() => {});
    sessionIdRef.current = null;
    setSessionId(null);
  }

  // Component unmount safety net.
  useEffect(() => {
    return () => { mountedRef.current = false; dialEpochRef.current += 1; teardown(); };
  }, []);

  async function dial(): Promise<void> {
    if (!activeId) return;
    const isLocalShell = activeId === LOCAL_SHELL_ID;
    // Cosmetic gate only — the shell.connect IPC handler is authoritative and refuses regardless.
    if (isLocalShell && !settings?.localShellEnabled) {
      toast.error('Local shell is disabled. Enable it in Settings → Terminal.');
      return;
    }
    // Select the backend for this dial. Default stays ssh; only the local-shell sentinel swaps it.
    transportRef.current = isLocalShell ? shellTransport : sshTransport;
    const epoch = (dialEpochRef.current += 1);
    const live = (): boolean => mountedRef.current && dialEpochRef.current === epoch;
    const sound = !!settings?.soundEnabled;
    const number = makeDialNumber();
    // The touch-tone dialpad phase was removed (GhostExodus: drop the "starting dial" animation,
    // keep the AOL-style dial-up client). Go straight into the carrier handshake; the ATDT line is
    // kept as flavour at the head of the negotiation log the DialClient renders.
    setHandshakeLog([
      `ATDT${number}`,
      'CONNECT 33600',
      'PROTOCOL: LAP-M / V.42bis',
      'NEGOTIATING…',
      'CARRIER DETECT…'
    ]);
    setState('connecting');
    // Start the handshake tones and reveal the negotiation log on the same packet beat the uplink
    // animation runs on, so audio + visuals + log advance in lockstep. The waits pace the log
    // whether or not sound is enabled; when sound is on we then await the carrier's tail.
    // Reveal the negotiation log + advance the stage stepper in lockstep with the handshake audio.
    // Default (synthesized) carrier runs 12 beats and we reveal on its phase boundaries (3/6/9). The
    // opt-in Legacy pack plays a bundled clip whose length we don't control, so we pace the reveals as
    // fractions of the clip's actual duration instead.
    const legacy = sound && !!settings?.legacySounds;
    let total: number;                       // ms from here until the SSH session opens
    let revealAt: [number, number, number];
    if (legacy) {
      const durS = await playLegacyDialup(); // starts the clip, resolves to its length in seconds
      total = (durS > 0 ? durS : 13) * 1000;
      revealAt = [total * 0.30, total * 0.55, total * 0.80];
    } else {
      const beat = CARRIER_BEAT * 1000;
      if (sound) void playCarrier();
      total = beat * 12;
      revealAt = [beat * 3, beat * 6, beat * 9];
    }
    const lines = ['CARRIER LOCK · 33600', 'LAP-M / V.42bis OK', isLocalShell ? 'OPENING LOCAL SHELL…' : 'OPENING SSH SESSION…'];
    let elapsed = 0;
    for (let i = 0; i < lines.length; i += 1) {
      await wait(revealAt[i] - elapsed); elapsed = revealAt[i];
      if (!live()) return;
      setHandshakeLog((h) => [...h, lines[i]]);
    }
    await wait(total - elapsed);
    if (!live()) return;

    // Drop any listeners a prior (superseded) dial attempt left registered before re-subscribing.
    offData.current?.();
    offClose.current?.();
    // Subscribe ONCE per dial attempt; filter strictly by sessionId. Sourced from the active
    // transport so a local-shell session listens on shell:onData/onClose, not ssh:*.
    const transport = transportRef.current;
    offData.current = transport.onData(({ data, sessionId: sid }) => {
      if (sid !== sessionIdRef.current) return;
      if (termInstance.current) termInstance.current.write(data);
    });
    offClose.current = transport.onClose(({ reason, sessionId: sid }) => {
      if (sid !== sessionIdRef.current) return;
      if (termInstance.current) termInstance.current.write(`\r\n\x1b[31m[disconnected: ${reason}]\x1b[0m\r\n`);
      teardown();
      setState('closed');
    });

    try {
      const { sessionId: sid } = isLocalShell
        ? await window.api.shell.connect(settings?.localShellProgram)
        : await window.api.ssh.connect(activeId);
      // If the component unmounted or a new dial superseded this one while connect was in
      // flight, the session would be orphaned (teardown ran with a null sessionIdRef). Close it.
      if (!live()) {
        void transport.disconnect(sid).catch(() => {});
        return;
      }
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
    if (settings?.soundEnabled) playHangup(); // legacy handset dropped back on the cradle
    dialEpochRef.current += 1; // cancel any dial animation still in flight
    teardown();
    setState('idle');
  }

  const isLocalShellSelected = activeId === LOCAL_SHELL_ID;
  const activeHost = hosts.find((h) => h.id === activeId);
  const activeIsFtp = (activeHost?.protocol ?? 'ssh') === 'ftp';
  // Cosmetic disable hint; the shell.connect IPC handler is the authoritative gate.
  const localShellBlocked = isLocalShellSelected && !settings?.localShellEnabled;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="ga98-toolbar">
        <select className="ga98-text" value={activeId ?? ''} onChange={(e) => setActiveId(e.target.value || null)} disabled={state === 'open' || state === 'connecting'}>
          <option value="">(no host)</option>
          <option value={LOCAL_SHELL_ID}>💻 Local Shell</option>
          {hosts.map((h) => <option key={h.id} value={h.id}>{h.label} — {h.username}@{h.host}</option>)}
        </select>
        <button onClick={() => setShowSetup(true)} disabled={state === 'open' || state === 'connecting'}>Hosts…</button>
        {!activeIsFtp && (state === 'open'
          ? <button onClick={() => void hangup()}>Hang up</button>
          : <button onClick={() => void dial()} disabled={!activeId || localShellBlocked || state === 'connecting'}>Dial</button>)}
        <span style={{ flex: 1 }} />
        {localShellBlocked && <span style={{ fontSize: 11, color: '#900' }}>Local shell disabled — enable in Settings → Terminal</span>}
        <span style={{ fontSize: 11 }}>{activeIsFtp ? 'FTP' : isLocalShellSelected ? 'LOCAL' : state.toUpperCase()}{activeHost ? ` · ${activeHost.host}:${activeHost.port}` : ''}{sessionId ? ` · ${sessionId.slice(0, 8)}` : ''}</span>
      </div>
      <div
        style={{ flex: 1, background: '#000', color: '#aaffaa', padding: 4, overflow: 'hidden', position: 'relative' }}
        onContextMenu={(e) => {
          if (state !== 'open') return;
          e.preventDefault();
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {activeIsFtp && activeHost ? (
          <FtpBrowser key={activeHost.id} host={activeHost} />
        ) : state === 'open' ? (
          <div ref={termRef} style={{ width: '100%', height: '100%' }} />
        ) : state === 'connecting' ? (
          <DialClient host={activeHost ? `${activeHost.host}:${activeHost.port}` : isLocalShellSelected ? 'LOCALHOST' : 'REMOTE'} log={handshakeLog} />
        ) : (
          <pre style={{
            // Override 98.css's global `pre` rule (white sunken text-box) so the
            // dial-up handshake reads as a green-on-black terminal, matching the
            // xterm session view. Inline styles beat the element-selector rule.
            margin: 0,
            padding: 0,
            fontFamily: 'Courier New, monospace',
            fontSize: 13,
            background: 'transparent',
            boxShadow: 'none',
            color: '#aaffaa'
          }}>
            {state === 'idle' && (activeHost
              ? `Ready to dial ${activeHost.username}@${activeHost.host}:${activeHost.port}\n\nPress Dial to begin the handshake.`
              : isLocalShellSelected
                ? (localShellBlocked
                  ? 'Local shell is disabled.\n\nEnable it in Settings → Terminal to begin.'
                  : `Ready to open a local ${settings?.localShellProgram === 'powershell' ? 'PowerShell' : 'Command Prompt'} shell.\n\nPress Dial to begin.`)
                : 'Add a host profile via "Hosts…" to begin.')}
            {state === 'closed' && `${handshakeLog.map((l) => `${l}\n`).join('')}\nDisconnected. Press Dial to redial.`}
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

/** The three connection stages, in the spirit of a familiar 90s dial-up client's progress panels
 *  (Dial → Link → Auth), with the AOL-style status caption per stage. Ghost Intel 98-branded — no third-party
 *  marks or mascot. */
const DIAL_STAGES = ['DIAL', 'LINK', 'AUTH'] as const;
const DIAL_STATUS = ['Dialing…', 'Connecting…', 'Verifying credentials…'];

/** A small original "marcher" figure that advances across the active stage panel — our take on the
 *  little walking guy a dial-up client shows while it connects (not the AOL mascot; a green
 *  wireframe runner in the DialTerm palette). */
function Marcher(): JSX.Element {
  return (
    <svg className="ga98-marcher" viewBox="0 0 26 30" fill="none" stroke="#7CFC7C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="14" cy="5" r="3.4" fill="#7CFC7C" stroke="none" />
      <path d="M14 9 L12 18" />
      <path d="M12 18 L6 25 M12 18 L18 24" />
      <path d="M13 12 L6 11 M13 12 L20 15" />
    </svg>
  );
}

/** Ghost Intel 98 dial-up connection client shown during the carrier handshake. Familiar dial-up-client
 *  chrome — Ghost Intel 98 logo header, a three-panel stage stepper, and an AOL-style status caption —
 *  wrapped around the kept uplink packet animation and the live negotiation log. The stepper is
 *  derived from the log so it tracks the (beat-synced) handshake: once we're connecting the number
 *  is dialed (DIAL done), LINK runs through negotiation, and AUTH lights as the SSH session opens. */
function DialClient({ host, log }: { host: string; log: string[] }): JSX.Element {
  const stage = log.some((l) => l.startsWith('OPENING SSH') || l.startsWith('OPENING LOCAL SHELL')) ? 2 : 1;
  return (
    <div className="ga98-dialclient">
      <div className="ga98-dialclient-head">
        <img src={logoUrl} alt="" className="ga98-dialclient-logo" />
        <div className="ga98-dialclient-brand">
          <span className="ga98-dialclient-brand-name">DEAD CYBER SOCIETY</span>
          <span className="ga98-dialclient-brand-sub">98 · DIAL-UP NETWORKING</span>
        </div>
      </div>
      <div className="ga98-dialclient-stages">
        {DIAL_STAGES.map((s, i) => (
          <div key={s} className={`ga98-dialstage${i < stage ? ' done' : i === stage ? ' active' : ''}`}>
            <div className="ga98-dialstage-panel">
              {i === stage ? <Marcher /> : i < stage ? <span className="ga98-dialstage-check">✓</span> : null}
            </div>
            <span className="ga98-dialstage-label">{s}</span>
          </div>
        ))}
      </div>
      <div className="ga98-uplink-route">
        <div className="ga98-node">
          <div className="ga98-node-screen" />
          <span>YOU</span>
        </div>
        <div className="ga98-link">
          <span className="ga98-packet" />
          <span className="ga98-packet d2" />
          <span className="ga98-packet d3" />
        </div>
        <div className="ga98-node">
          <div className="ga98-node-screen" />
          <span>{host}</span>
        </div>
      </div>
      <div className="ga98-dialclient-status">{DIAL_STATUS[stage]}</div>
      <pre className="ga98-uplink-log">{log.map((l) => `${l}\n`).join('')}</pre>
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
                const port = nextPortOnProtocolChange(draft.port, protocol);
                setDraft({ ...draft, protocol, port, ...(protocol !== 'ssh' ? { authKind: 'password' as const, keyPath: '' } : {}) });
              }}>
                <option value="ssh">SSH</option>
                <option value="telnet">Telnet (plaintext)</option>
                <option value="ftp">FTP (plaintext)</option>
              </select>
              <label>Host:</label>
              <input className="ga98-text" value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} />
              <label>Port:</label>
              <input className="ga98-text" type="number" value={draft.port} onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) })} />
              <label></label>
              <span style={{ fontSize: 10, color: '#666' }}>Any port 1–65535 (e.g. SSH on 2222).</span>
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
              ) : draft.protocol === 'ftp' ? (
                <>
                  <label>Password:</label>
                  <input className="ga98-text" type="password" value={draft.secret} onChange={(e) => setDraft({ ...draft, secret: e.target.value })}
                    placeholder="(encrypted in secrets.enc; leave blank for anonymous)" />
                  <label></label>
                  <span style={{ fontSize: 11, opacity: 0.7 }}>FTP is plaintext. Uses the username above + this password.</span>
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
