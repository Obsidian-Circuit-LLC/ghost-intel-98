/**
 * Mail drafts — persisted across launches. Per-account scoping via accountId field.
 */

import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataRoot } from './paths';
import { withLock } from '../util/mutex';
import { secureReadText, secureWriteFile } from './secure-fs';

export interface MailDraft {
  id: string;
  accountId: string;
  to: string;
  subject: string;
  body: string;
  attachments: { name: string; path: string; size: number }[];
  savedAt: string;
}

function file(): string {
  return join(dataRoot(), 'mail-drafts.json');
}

async function readAll(): Promise<MailDraft[]> {
  try {
    return JSON.parse(await secureReadText(file())) as MailDraft[];
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeAll(list: MailDraft[]): Promise<void> {
  await secureWriteFile(file(), JSON.stringify(list, null, 2));
}

export async function list(accountId?: string): Promise<MailDraft[]> {
  return withLock('drafts', async () => {
    const all = await readAll();
    return accountId ? all.filter((d) => d.accountId === accountId) : all;
  });
}

export async function upsert(input: Omit<MailDraft, 'id' | 'savedAt'> & { id?: string }): Promise<MailDraft> {
  return withLock('drafts', async () => {
    const all = await readAll();
    const id = input.id || `dr-${randomUUID()}`;
    const draft: MailDraft = {
      id,
      accountId: input.accountId,
      to: input.to,
      subject: input.subject,
      body: input.body,
      attachments: input.attachments ?? [],
      savedAt: new Date().toISOString()
    };
    const idx = all.findIndex((d) => d.id === id);
    if (idx >= 0) all[idx] = draft;
    else all.push(draft);
    await writeAll(all);
    return draft;
  });
}

export async function remove(id: string): Promise<void> {
  return withLock('drafts', async () => {
    const all = await readAll();
    await writeAll(all.filter((d) => d.id !== id));
  });
}
