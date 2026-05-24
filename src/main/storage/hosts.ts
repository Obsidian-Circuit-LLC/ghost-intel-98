/**
 * SSH host profiles persisted in `ssh-hosts.json`. Same pattern as accounts.ts —
 * dedicated file, mutex-protected, one-shot migration from legacy settings.sshHosts.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SshHostProfile } from '@shared/post-mvp-types';
import { dataRoot } from './paths';
import { withLock } from '../util/mutex';

function hostsFile(): string {
  return join(dataRoot(), 'ssh-hosts.json');
}

function legacySettingsFile(): string {
  return join(dataRoot(), 'settings.json');
}

async function readHostsFile(): Promise<SshHostProfile[]> {
  try {
    const buf = await readFile(hostsFile(), 'utf8');
    return JSON.parse(buf) as SshHostProfile[];
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== 'ENOENT') throw err;
    // Narrow migration catch — see accounts.ts for rationale.
    try {
      const sBuf = await readFile(legacySettingsFile(), 'utf8');
      const s = JSON.parse(sBuf) as { sshHosts?: SshHostProfile[] };
      if (Array.isArray(s.sshHosts) && s.sshHosts.length > 0) {
        await writeHostsFile(s.sshHosts);
        return s.sshHosts;
      }
      return [];
    } catch (mErr) {
      const me = mErr as NodeJS.ErrnoException;
      if (me.code === 'ENOENT') return [];
      if (mErr instanceof SyntaxError) return [];
      throw mErr;
    }
  }
}

async function writeHostsFile(list: SshHostProfile[]): Promise<void> {
  await mkdir(dirname(hostsFile()), { recursive: true });
  const tmp = `${hostsFile()}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, JSON.stringify(list, null, 2), 'utf8');
  await rename(tmp, hostsFile());
}

export async function listHosts(): Promise<SshHostProfile[]> {
  return withLock('ssh-hosts', () => readHostsFile());
}

export async function upsertHost(host: SshHostProfile): Promise<SshHostProfile> {
  return withLock('ssh-hosts', async () => {
    const list = await readHostsFile();
    const idx = list.findIndex((h) => h.id === host.id);
    if (idx >= 0) list[idx] = host;
    else list.push(host);
    await writeHostsFile(list);
    return host;
  });
}

export async function deleteHost(id: string): Promise<SshHostProfile | null> {
  return withLock('ssh-hosts', async () => {
    const list = await readHostsFile();
    const removed = list.find((h) => h.id === id) ?? null;
    await writeHostsFile(list.filter((h) => h.id !== id));
    return removed;
  });
}
