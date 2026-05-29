/**
 * DialTerm FTP transport — a file client, not a terminal. Control connection per session via
 * basic-ftp (pure-JS). Credentials come from secrets.enc like SSH/host profiles. Plain FTP
 * (no TLS) for now — plaintext, flagged in the UI like Telnet. Downloads/uploads stream
 * to/from a main-process-chosen path (the renderer never supplies a local filesystem path).
 */
import { Client, type FileInfo } from 'basic-ftp';
import { randomUUID } from 'node:crypto';
import type { FtpListing, FtpConnectResult, FtpEntry } from '@shared/post-mvp-types';
import * as hostStore from '../storage/hosts';
import { secretStore, SecretsUnavailableError, SecretsCorruptedError } from '../secrets';

interface FtpSession { client: Client; hostId: string }
const sessions = new Map<string, FtpSession>();

function toEntry(f: FileInfo): FtpEntry {
  const type: FtpEntry['type'] = f.isDirectory ? 'dir' : f.isSymbolicLink ? 'link' : f.isFile ? 'file' : 'other';
  return { name: f.name, type, size: f.size, modifiedAt: f.modifiedAt ? f.modifiedAt.toISOString() : undefined };
}

function getSession(sessionId: string): FtpSession {
  const s = sessions.get(sessionId);
  if (!s) throw new Error(`No active FTP session: ${sessionId}`);
  return s;
}

export async function connect(hostId: string): Promise<FtpConnectResult> {
  const hosts = await hostStore.listHosts();
  const host = hosts.find((h) => h.id === hostId);
  if (!host) throw new Error(`Host not found: ${hostId}`);
  if ((host.protocol ?? 'ssh') !== 'ftp') throw new Error('Not an FTP host');

  let password = '';
  try {
    password = (await secretStore.get(host.secretRef)) ?? '';
  } catch (err) {
    if (err instanceof SecretsUnavailableError) throw new Error(`OS keyring is locked or unavailable — unlock it and retry. (${host.label})`);
    if (err instanceof SecretsCorruptedError) throw new Error(`Encrypted secrets file is unreadable. (${host.label})`);
    throw err;
  }

  const client = new Client(20_000);
  client.ftp.verbose = false;
  try {
    await client.access({
      host: host.host,
      port: host.port,
      user: host.username || 'anonymous',
      password: password || 'anonymous@',
      secure: false
    });
  } catch (err) {
    try { client.close(); } catch { /* nothing */ }
    throw err;
  }
  const sessionId = `f-${randomUUID()}`;
  sessions.set(sessionId, { client, hostId });
  const cwd = await client.pwd();
  const entries = (await client.list()).map(toEntry);
  return { sessionId, cwd, entries };
}

export async function list(sessionId: string): Promise<FtpListing> {
  const s = getSession(sessionId);
  const cwd = await s.client.pwd();
  const entries = (await s.client.list()).map(toEntry);
  return { cwd, entries };
}

export async function cd(sessionId: string, path: string): Promise<FtpListing> {
  const s = getSession(sessionId);
  await s.client.cd(path);
  return list(sessionId);
}

export async function downloadToPath(sessionId: string, remoteName: string, localPath: string): Promise<void> {
  const s = getSession(sessionId);
  await s.client.downloadTo(localPath, remoteName);
}

export async function uploadFromPath(sessionId: string, localPath: string, remoteName: string): Promise<FtpListing> {
  const s = getSession(sessionId);
  await s.client.uploadFrom(localPath, remoteName);
  return list(sessionId);
}

export async function disconnect(sessionId: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s) return;
  try { s.client.close(); } catch { /* nothing */ }
  sessions.delete(sessionId);
}

export async function shutdownAll(): Promise<void> {
  for (const [, s] of sessions) { try { s.client.close(); } catch { /* nothing */ } }
  sessions.clear();
}
