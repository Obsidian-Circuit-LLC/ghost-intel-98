/**
 * Mail accounts persisted in their own JSON file (`mail-accounts.json`) — moved out of
 * settings.json so the type system can protect them and they can't be silently dropped
 * by a settings refactor. Includes a one-shot migration from the legacy `mailAccountsV2`
 * field inside settings.json.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MailAccount } from '@shared/post-mvp-types';
import { dataRoot } from './paths';
import { withLock } from '../util/mutex';
import { secureReadText, secureWriteFile } from './secure-fs';

function accountsFile(): string {
  return join(dataRoot(), 'mail-accounts.json');
}

function legacySettingsFile(): string {
  return join(dataRoot(), 'settings.json');
}

async function readAccountsFile(): Promise<MailAccount[]> {
  try {
    return JSON.parse(await secureReadText(accountsFile())) as MailAccount[];
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== 'ENOENT') throw err;
    // One-shot migration from settings.mailAccountsV2. Narrow catch: only ENOENT (no legacy
    // file) and SyntaxError (legacy file unparseable) are treated as "fine, start empty".
    // Anything else (EACCES, EIO) propagates so the user sees it rather than silently losing data.
    try {
      const sBuf = await readFile(legacySettingsFile(), 'utf8');
      const s = JSON.parse(sBuf) as { mailAccountsV2?: MailAccount[] };
      if (Array.isArray(s.mailAccountsV2) && s.mailAccountsV2.length > 0) {
        await writeAccountsFile(s.mailAccountsV2);
        return s.mailAccountsV2;
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

async function writeAccountsFile(list: MailAccount[]): Promise<void> {
  await secureWriteFile(accountsFile(), JSON.stringify(list, null, 2));
}

export async function listAccounts(): Promise<MailAccount[]> {
  return withLock('mail-accounts', () => readAccountsFile());
}

export async function upsertAccount(acct: MailAccount): Promise<MailAccount> {
  return withLock('mail-accounts', async () => {
    const list = await readAccountsFile();
    const idx = list.findIndex((a) => a.id === acct.id);
    if (idx >= 0) list[idx] = acct;
    else list.push(acct);
    await writeAccountsFile(list);
    return acct;
  });
}

export async function deleteAccount(id: string): Promise<MailAccount | null> {
  return withLock('mail-accounts', async () => {
    const list = await readAccountsFile();
    const removed = list.find((a) => a.id === id) ?? null;
    await writeAccountsFile(list.filter((a) => a.id !== id));
    return removed;
  });
}
