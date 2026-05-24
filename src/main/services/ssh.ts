/**
 * DialTerm SSH service. Host profiles + creds persisted via secrets.enc;
 * live sessions are in-memory Maps keyed by sessionId. Data is streamed back
 * to the renderer over ssh:onData and connection close over ssh:onClose.
 */

import { Client as SshClient, type ClientChannel, type ConnectConfig } from 'ssh2';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type { SshHostProfile } from '@shared/post-mvp-types';
import { channels } from '@shared/ipc-contracts';
import { secretStore } from '../secrets';
import { settingsStore } from '../storage/json-fs';

interface Session {
  client: SshClient;
  channel: ClientChannel | null;
  hostId: string;
}

const sessions = new Map<string, Session>();

async function readHosts(): Promise<SshHostProfile[]> {
  const s = await settingsStore.read();
  return ((s as unknown as { sshHosts?: SshHostProfile[] }).sshHosts) ?? [];
}

async function writeHosts(list: SshHostProfile[]): Promise<void> {
  const s = await settingsStore.read();
  const next = { ...s, sshHosts: list };
  await settingsStore.update(next as unknown as Parameters<typeof settingsStore.update>[0]);
}

export async function listHosts(): Promise<SshHostProfile[]> {
  return readHosts();
}

export async function upsertHost(input: SshHostProfile & { secret?: string }): Promise<SshHostProfile> {
  const list = await readHosts();
  const id = input.id || `ssh-${randomUUID()}`;
  const secretRef = input.secretRef || `ssh.secret.${id}`;
  if (input.secret) await secretStore.set(secretRef, input.secret);
  const cleaned: SshHostProfile = {
    id,
    label: input.label,
    host: input.host,
    port: input.port,
    username: input.username,
    authKind: input.authKind,
    keyPath: input.keyPath,
    secretRef
  };
  const idx = list.findIndex((h) => h.id === id);
  if (idx >= 0) list[idx] = cleaned;
  else list.push(cleaned);
  await writeHosts(list);
  return cleaned;
}

export async function deleteHost(id: string): Promise<void> {
  const list = await readHosts();
  const h = list.find((x) => x.id === id);
  if (h) await secretStore.delete(h.secretRef);
  await writeHosts(list.filter((x) => x.id !== id));
}

export async function connect(hostId: string, getWindow: () => BrowserWindow | null): Promise<{ sessionId: string }> {
  const hosts = await readHosts();
  const host = hosts.find((h) => h.id === hostId);
  if (!host) throw new Error(`SSH host not found: ${hostId}`);
  const secret = await secretStore.get(host.secretRef);

  const cfg: ConnectConfig = {
    host: host.host,
    port: host.port,
    username: host.username,
    readyTimeout: 15_000
  };
  if (host.authKind === 'key') {
    if (!host.keyPath) throw new Error('Key auth selected but no key path set.');
    const key = await readFile(host.keyPath);
    cfg.privateKey = key;
    if (secret) cfg.passphrase = secret;
  } else {
    if (!secret) throw new Error('Password auth selected but no password stored.');
    cfg.password = secret;
  }

  const sessionId = `s-${randomUUID()}`;
  const client = new SshClient();
  const session: Session = { client, channel: null, hostId };
  sessions.set(sessionId, session);

  await new Promise<void>((resolve, reject) => {
    client.on('ready', () => {
      client.shell({ term: 'xterm-256color', cols: 100, rows: 30 }, (err, channel) => {
        if (err) { reject(err); return; }
        session.channel = channel;
        channel.on('data', (chunk: Buffer) => {
          const win = getWindow();
          win?.webContents.send(channels.ssh.onData, { sessionId, data: chunk.toString('utf8') });
        });
        channel.on('close', () => {
          const win = getWindow();
          win?.webContents.send(channels.ssh.onClose, { sessionId, reason: 'channel closed' });
          sessions.delete(sessionId);
          client.end();
        });
        resolve();
      });
    });
    client.on('error', (err) => {
      const win = getWindow();
      win?.webContents.send(channels.ssh.onClose, { sessionId, reason: err.message });
      sessions.delete(sessionId);
      reject(err);
    });
    client.connect(cfg);
  });

  return { sessionId };
}

export async function write(sessionId: string, data: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s?.channel) throw new Error(`No active SSH session: ${sessionId}`);
  s.channel.write(data);
}

export async function resize(sessionId: string, cols: number, rows: number): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s?.channel) return;
  s.channel.setWindow(rows, cols, rows * 16, cols * 8);
}

export async function disconnect(sessionId: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.channel?.end();
  s.client.end();
  sessions.delete(sessionId);
}
