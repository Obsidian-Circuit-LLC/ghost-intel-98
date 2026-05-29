/**
 * DialTerm SSH service.
 *
 * v1.0.1 hardening:
 *  - Host profiles in a dedicated ssh-hosts.json (no more settings.json hack)
 *  - keyPath restricted to the user's home directory (no /etc/shadow trick)
 *  - Persistent client error handler that survives past channel-open, so a
 *    mid-session network drop is surfaced as onClose rather than silently dying
 *  - shutdownAllSessions() called from main on before-quit to drain sockets cleanly
 *  - sessionId is round-tripped via the IPC payload — the renderer is supposed to
 *    filter by it, but the main process also gates writes so a stale write throws
 */

import { Client as SshClient, type ClientChannel, type ConnectConfig } from 'ssh2';
import { Socket } from 'node:net';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type { SshHostProfile } from '@shared/post-mvp-types';
import { channels } from '@shared/ipc-contracts';
import { secretStore, SecretsUnavailableError, SecretsCorruptedError } from '../secrets';
import * as hostStore from '../storage/hosts';
import { validateSshKeyPath } from '../security/validate';
import { newTelnetState, processTelnet, escapeTelnetOutput, type TelnetState } from './telnet';

interface Session {
  client: SshClient | null;
  channel: ClientChannel | null;
  socket: Socket | null;
  telnet: TelnetState | null;
  kind: 'ssh' | 'telnet';
  hostId: string;
  closed: boolean;
}

const sessions = new Map<string, Session>();

export async function listHosts(): Promise<SshHostProfile[]> {
  return hostStore.listHosts();
}

export async function upsertHost(input: SshHostProfile & { secret?: string }): Promise<SshHostProfile> {
  const id = input.id || `ssh-${randomUUID()}`;
  const secretRef = input.secretRef || `ssh.secret.${id}`;
  // Validate keyPath up-front so we fail loudly here, not at connect time.
  if (input.authKind === 'key' && input.keyPath) {
    await validateSshKeyPath(input.keyPath);
  }
  const cleaned: SshHostProfile = {
    id,
    label: input.label,
    host: input.host,
    port: input.port,
    username: input.username,
    authKind: input.authKind,
    keyPath: input.keyPath,
    secretRef,
    protocol: input.protocol ?? 'ssh'
  };
  // Profile first, then secret — with rollback if secret write fails.
  await hostStore.upsertHost(cleaned);
  if (input.secret) {
    try {
      await secretStore.set(secretRef, input.secret);
    } catch (err) {
      try { await hostStore.deleteHost(id); } catch { /* nothing more we can do */ }
      throw err;
    }
  }
  return cleaned;
}

export async function deleteHost(id: string): Promise<void> {
  const removed = await hostStore.deleteHost(id);
  if (removed) {
    try { await secretStore.delete(removed.secretRef); } catch { /* ok */ }
  }
}

async function connectTelnet(host: SshHostProfile, getWindow: () => BrowserWindow | null): Promise<{ sessionId: string }> {
  const sessionId = `t-${randomUUID()}`;
  const socket = new Socket();
  const session: Session = { client: null, channel: null, socket, telnet: newTelnetState(), kind: 'telnet', hostId: host.id, closed: false };
  sessions.set(sessionId, session);

  function closeOnce(reason: string): void {
    if (session.closed) return;
    session.closed = true;
    getWindow()?.webContents.send(channels.ssh.onClose, { sessionId, reason });
    sessions.delete(sessionId);
    try { socket.destroy(); } catch { /* nothing */ }
  }

  socket.on('error', (err) => closeOnce((err as Error).message || 'connection error'));
  socket.on('close', () => closeOnce('connection closed'));
  socket.on('data', (chunk: Buffer) => {
    const { out, reply } = processTelnet(session.telnet as TelnetState, chunk);
    if (reply.length) { try { socket.write(reply); } catch { /* nothing */ } }
    if (out.length) getWindow()?.webContents.send(channels.ssh.onData, { sessionId, data: out.toString('utf8') });
  });

  await new Promise<void>((resolve, reject) => {
    socket.setTimeout(15_000, () => { socket.destroy(); reject(new Error('Telnet connection timed out')); });
    socket.once('connect', () => { socket.setTimeout(0); socket.setNoDelay(true); resolve(); });
    socket.once('error', reject);
    socket.connect(host.port, host.host);
  });

  return { sessionId };
}

export async function connect(hostId: string, getWindow: () => BrowserWindow | null): Promise<{ sessionId: string }> {
  const hosts = await hostStore.listHosts();
  const host = hosts.find((h) => h.id === hostId);
  if (!host) throw new Error(`Host not found: ${hostId}`);
  const protocol = host.protocol ?? 'ssh';
  if (protocol === 'ftp') throw new Error('FTP hosts open in the file browser, not the terminal.');
  if (protocol === 'telnet') return connectTelnet(host, getWindow);

  let secret: string | null;
  try {
    secret = await secretStore.get(host.secretRef);
  } catch (err) {
    if (err instanceof SecretsUnavailableError) {
      throw new Error(`OS keyring is locked or unavailable — unlock it and retry. (${host.label})`);
    }
    if (err instanceof SecretsCorruptedError) {
      throw new Error(`Encrypted secrets file is unreadable — see Settings → About → secrets backend. (${host.label})`);
    }
    throw err;
  }

  const cfg: ConnectConfig = {
    host: host.host,
    port: host.port,
    username: host.username,
    readyTimeout: 15_000
  };
  if (host.authKind === 'key') {
    // Re-validate at connect time too — the file on disk could have been moved or symlinked
    // since the host was saved; never trust the persisted keyPath without re-checking.
    const safeKeyPath = await validateSshKeyPath(host.keyPath);
    const key = await readFile(safeKeyPath);
    cfg.privateKey = key;
    if (secret) cfg.passphrase = secret;
  } else {
    if (!secret) throw new Error('Password auth selected but no password stored.');
    cfg.password = secret;
  }

  const sessionId = `s-${randomUUID()}`;
  const client = new SshClient();
  const session: Session = { client, channel: null, socket: null, telnet: null, kind: 'ssh', hostId, closed: false };
  sessions.set(sessionId, session);

  function closeOnce(reason: string): void {
    if (session.closed) return;
    session.closed = true;
    const win = getWindow();
    win?.webContents.send(channels.ssh.onClose, { sessionId, reason });
    sessions.delete(sessionId);
    try { session.channel?.end(); } catch { /* nothing */ }
    try { client.end(); } catch { /* nothing */ }
  }

  // Persistent error handler that survives past channel-open.
  client.on('error', (err) => {
    closeOnce((err as Error).message || 'connection error');
  });
  client.on('end', () => closeOnce('connection ended'));
  client.on('close', () => closeOnce('connection closed'));

  await new Promise<void>((resolve, reject) => {
    client.once('ready', () => {
      client.shell({ term: 'xterm-256color', cols: 100, rows: 30 }, (err, channel) => {
        if (err) { reject(err); return; }
        session.channel = channel;
        channel.on('data', (chunk: Buffer) => {
          const win = getWindow();
          win?.webContents.send(channels.ssh.onData, { sessionId, data: chunk.toString('utf8') });
        });
        channel.on('close', () => closeOnce('channel closed'));
        resolve();
      });
    });
    client.once('error', (err) => {
      // initial-connect path — surface to the awaiter; closeOnce above will fire too
      reject(err);
    });
    client.connect(cfg);
  });

  return { sessionId };
}

export async function write(sessionId: string, data: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s || s.closed) throw new Error(`No active session: ${sessionId}`);
  if (s.kind === 'telnet') {
    if (!s.socket) throw new Error(`No active telnet session: ${sessionId}`);
    s.socket.write(escapeTelnetOutput(Buffer.from(data, 'utf8')));
  } else {
    if (!s.channel) throw new Error(`No active SSH session: ${sessionId}`);
    s.channel.write(data);
  }
}

export async function resize(sessionId: string, cols: number, rows: number): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s || s.closed) return;
  // Telnet window-size (NAWS) negotiation is omitted; most telnet servers don't require it.
  if (s.kind === 'ssh' && s.channel) s.channel.setWindow(rows, cols, rows * 16, cols * 8);
}

export async function disconnect(sessionId: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s) return;
  // Idempotent shutdown; the transport's own 'close' handler will no-op because closed is set.
  s.closed = true;
  try { s.channel?.end(); } catch { /* nothing */ }
  try { s.client?.end(); } catch { /* nothing */ }
  try { s.socket?.destroy(); } catch { /* nothing */ }
  sessions.delete(sessionId);
}

/** Called from main on before-quit so we don't leave dangling sockets / leak key material. */
export async function shutdownAllSessions(): Promise<void> {
  for (const [, s] of sessions) {
    s.closed = true;
    try { s.channel?.end(); } catch { /* nothing */ }
    try { s.client?.end(); } catch { /* nothing */ }
    try { s.socket?.destroy(); } catch { /* nothing */ }
  }
  sessions.clear();
}
