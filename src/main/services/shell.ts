/**
 * DialTerm local shell service (ConPTY via node-pty).
 *
 * Security posture:
 *  - node-pty is required LAZILY inside connect(), wrapped in try/catch, so a missing or
 *    ABI-mismatched native binary degrades to a thrown error (surfaced as a toast) rather
 *    than crashing the app at boot. Never import it at module top level.
 *  - The localShellEnabled gate lives in the shell.connect IPC handler (mirrors GeoINT's
 *    networkEnabled gate); this service receives an already-resolved program token.
 *  - The program is one of a fixed allowlist (cmd|powershell); main maps it to a fixed
 *    executable. The renderer never supplies an executable path.
 */
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type { BrowserWindow } from 'electron';
import { channels } from '@shared/ipc-contracts';

interface PtyLike {
  onData(cb: (d: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(d: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}
interface PtyModuleLike {
  spawn(file: string, args: string[], opts: Record<string, unknown>): PtyLike;
}
interface ShellSession { pty: PtyLike; closed: boolean; }

const sessions = new Map<string, ShellSession>();

/** win32 executable map. On non-win32 (dev) fall back to a POSIX shell so the service is
 *  runnable in development; production target is Windows. */
function resolveExecutable(program: 'cmd' | 'powershell'): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return program === 'powershell'
      ? { file: 'powershell.exe', args: [] }
      : { file: process.env.ComSpec || 'cmd.exe', args: [] };
  }
  return { file: process.env.SHELL || '/bin/bash', args: [] };
}

async function loadPty(): Promise<PtyModuleLike> {
  try {
    // Lazy dynamic import — never at module top level. The specifier is built at runtime so
    // the bundler/type-checker does not try to resolve node-pty (the native dep may be absent
    // in some build contexts, and is added by a later task). Cast through a local interface so
    // typecheck does not need node-pty's own types. Dynamic import is also what Vitest's
    // vi.mock('node-pty') intercepts, so tests run without the real binary.
    const spec = 'node-pty';
    const mod = (await import(/* @vite-ignore */ spec)) as unknown as
      | PtyModuleLike
      | { default: PtyModuleLike };
    return 'spawn' in mod ? mod : mod.default;
  } catch {
    throw new Error('Local shell unavailable: the terminal backend (node-pty) failed to load.');
  }
}

export async function connect(
  program: 'cmd' | 'powershell',
  getWindow: () => BrowserWindow | null
): Promise<{ sessionId: string }> {
  const pty = await loadPty();
  const { file, args } = resolveExecutable(program);
  const sessionId = `sh-${randomUUID()}`;

  const proc = pty.spawn(file, args, {
    name: 'xterm-color',
    cols: 100,
    rows: 30,
    cwd: homedir(),
    env: process.env as Record<string, string>
  });

  const session: ShellSession = { pty: proc, closed: false };
  sessions.set(sessionId, session);

  function closeOnce(reason: string): void {
    if (session.closed) return;
    session.closed = true;
    getWindow()?.webContents.send(channels.shell.onClose, { sessionId, reason });
    sessions.delete(sessionId);
    try { proc.kill(); } catch { /* nothing */ }
  }

  proc.onData((data) => {
    getWindow()?.webContents.send(channels.shell.onData, { sessionId, data });
  });
  proc.onExit(() => closeOnce('shell exited'));

  return { sessionId };
}

export async function write(sessionId: string, data: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s || s.closed) throw new Error(`No active shell session: ${sessionId}`);
  s.pty.write(data);
}

export async function resize(sessionId: string, cols: number, rows: number): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s || s.closed) return;
  const c = Math.max(1, Math.min(500, Math.floor(cols)));
  const r = Math.max(1, Math.min(300, Math.floor(rows)));
  try { s.pty.resize(c, r); } catch { /* pty may have exited */ }
}

export async function disconnect(sessionId: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.closed = true;
  try { s.pty.kill(); } catch { /* nothing */ }
  sessions.delete(sessionId);
}

/** Called from main on before-quit alongside shutdownAllSessions() (ssh). */
export async function shutdownAllShellSessions(): Promise<void> {
  for (const [, s] of sessions) {
    s.closed = true;
    try { s.pty.kill(); } catch { /* nothing */ }
  }
  sessions.clear();
}
