/**
 * AI conversation store — ChatGPT-style saved chats.
 *
 * Persisted under dataRoot via secure-fs (encrypted at rest when login is on), like case data:
 * a conversation transcript can contain case-sensitive material and must not sit in plaintext.
 * Zero network egress — these never leave the machine.
 *
 * One JSON file holding the array. The list is small and personal; the IPC boundary validates
 * each conversation via ensureAiConversation, and we keep only the most-recent MAX_CONVOS.
 */

import { join } from 'node:path';
import { dataRoot } from './paths';
import { secureReadText, secureWriteFile } from './secure-fs';
import type { AiConversation, AiConversationSummary, AiConversationInput } from '@shared/post-mvp-types';

const MAX_CONVOS = 200;
const convosFile = (): string => join(dataRoot(), 'ai-conversations.json');

// Serialize all read-modify-write mutations so two windows (now both kept mounted across
// minimize) can't interleave a stale snapshot and clobber each other's just-saved chat.
// secureWriteFile is atomic per-file, but that only prevents torn files, not lost updates.
let writeChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => undefined);
  return run;
}

async function readAll(): Promise<AiConversation[]> {
  try {
    const parsed = JSON.parse(await secureReadText(convosFile())) as unknown;
    return Array.isArray(parsed) ? (parsed as AiConversation[]) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    return [];
  }
}

async function writeAll(list: AiConversation[]): Promise<void> {
  await secureWriteFile(convosFile(), JSON.stringify(list, null, 2));
}

export async function list(): Promise<AiConversationSummary[]> {
  const all = await readAll();
  return all
    .slice()
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, messageCount: c.messages?.length ?? 0 }));
}

export async function get(id: string): Promise<AiConversation | null> {
  const all = await readAll();
  return all.find((c) => c.id === id) ?? null;
}

/** Upsert a conversation; the store owns createdAt (first save) and updatedAt (every save). */
export async function save(input: AiConversationInput): Promise<AiConversation> {
  return serialize(async () => {
    const all = await readAll();
    const now = new Date().toISOString();
    const existing = all.find((c) => c.id === input.id);
    const record: AiConversation = {
      id: input.id,
      title: input.title,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      messages: input.messages,
      // Whatever case (if any) is selected as context at save time, verbatim — never carried
      // forward from a prior save, so clearing the case selector actually stops scoping this
      // conversation's learned facts to that case.
      caseId: input.caseId
    };
    const others = all.filter((c) => c.id !== input.id);
    // Newest first, capped — drops the oldest beyond MAX_CONVOS.
    const next = [record, ...others.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))].slice(0, MAX_CONVOS);
    await writeAll(next);
    return record;
  });
}

export async function remove(id: string): Promise<void> {
  return serialize(async () => {
    const all = await readAll();
    const next = all.filter((c) => c.id !== id);
    if (next.length !== all.length) await writeAll(next);
  });
}

export async function _resetForTest(): Promise<void> { await writeAll([]); }
