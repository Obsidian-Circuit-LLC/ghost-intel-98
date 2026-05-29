/**
 * FTP file browser — shown in DialTerm when the active host's protocol is 'ftp'. Connect, list,
 * cd (incl. ".." up), download (to a chosen local path), upload (from a chosen local file).
 * Downloads/uploads pick the local path via a native dialog in the main process — the renderer
 * never handles a filesystem path. Plaintext FTP; flagged in the header.
 */
import { useEffect, useState } from 'react';
import type { SshHostProfile, FtpEntry } from '@shared/post-mvp-types';
import { toast } from '../../state/toasts';

export function FtpBrowser({ host }: { host: SshHostProfile }): JSX.Element {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [cwd, setCwd] = useState('/');
  const [entries, setEntries] = useState<FtpEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { if (sessionId) void window.api.ftp.disconnect(sessionId).catch(() => undefined); }, [sessionId]);

  async function connect(): Promise<void> {
    setBusy(true); setError(null);
    try {
      const r = await window.api.ftp.connect(host.id);
      setSessionId(r.sessionId); setCwd(r.cwd); setEntries(r.entries);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function disconnect(): Promise<void> {
    const sid = sessionId;
    setSessionId(null); setEntries([]); setCwd('/');
    if (sid) await window.api.ftp.disconnect(sid).catch(() => undefined);
  }

  async function cd(path: string): Promise<void> {
    if (!sessionId) return;
    setBusy(true);
    try { const r = await window.api.ftp.cd(sessionId, path); setCwd(r.cwd); setEntries(r.entries); }
    catch (err) { toast.error(`cd failed: ${(err as Error).message}`); }
    finally { setBusy(false); }
  }

  async function download(name: string): Promise<void> {
    if (!sessionId) return;
    try { const saved = await window.api.ftp.download(sessionId, name); if (saved) toast.success(`Downloaded ${saved}.`); }
    catch (err) { toast.error(`Download failed: ${(err as Error).message}`); }
  }

  async function upload(): Promise<void> {
    if (!sessionId) return;
    setBusy(true);
    try { const r = await window.api.ftp.upload(sessionId); if (r) { setCwd(r.cwd); setEntries(r.entries); toast.success('Uploaded.'); } }
    catch (err) { toast.error(`Upload failed: ${(err as Error).message}`); }
    finally { setBusy(false); }
  }

  if (!sessionId) {
    return (
      <div style={{ padding: 16, color: '#aaffaa', fontFamily: '"Courier New", monospace' }}>
        <p>FTP — {host.username || 'anonymous'}@{host.host}:{host.port} <span style={{ opacity: 0.6 }}>(plaintext)</span></p>
        <button onClick={() => void connect()} disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button>
        {error && <p style={{ color: '#ff8080', marginTop: 8 }}>{error}</p>}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff', color: '#000' }}>
      <div className="ga98-toolbar">
        <button onClick={() => void cd('..')} disabled={busy} title="Up one directory">↑ Up</button>
        <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cwd}</span>
        {busy && <span style={{ fontSize: 11 }}>…</span>}
        <button onClick={() => void upload()} disabled={busy}>Upload…</button>
        <button onClick={() => void disconnect()}>Disconnect</button>
      </div>
      <ul className="ga98-list" style={{ flex: 1, overflow: 'auto', margin: 0 }}>
        {entries.length === 0 && <li style={{ color: '#666' }}>(empty directory)</li>}
        {entries.map((e) => (
          <li key={e.name}>
            <span style={{ width: 22 }} aria-hidden="true">{e.type === 'dir' ? '📁' : e.type === 'link' ? '🔗' : '📄'}</span>
            {e.type === 'dir'
              ? <a style={{ flex: 1, cursor: 'pointer', color: '#000080' }} onClick={() => void cd(e.name)}>{e.name}/</a>
              : <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name} <span style={{ opacity: 0.6, fontSize: 10 }}>({Math.ceil(e.size / 1024)} KB)</span></span>}
            {e.type === 'file' && <button onClick={() => void download(e.name)}>Download</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
