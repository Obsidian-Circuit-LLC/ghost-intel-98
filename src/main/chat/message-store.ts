/**
 * Message store (Phase 1) — per-contact encrypted-at-rest chat history. One file per contact
 * (contactId is hex → safe filename) to bound size; capped to the most-recent MAX_HISTORY. Not
 * durable-fsync'd (losing the tail on a crash is acceptable, unlike prekey consumption). Path
 * injected (no electron). Caller stamps timestamps (no time() inside — determinism).
 */
import { join } from 'node:path';
import { secureReadText, secureWriteFile } from '../storage/secure-fs';

export const MAX_HISTORY = 5000;

export type MessageState = 'queued' | 'sent' | 'delivered' | 'received';
export interface ChatMessage {
  id: string;
  direction: 'in' | 'out';
  seq: number;
  ts: number;
  text: string;
  state: MessageState;
}

export class MessageStore {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly dir: string, private readonly maxHistory: number = MAX_HISTORY) {}

  private file(contactId: string): string {
    if (!/^[0-9a-f]{64}$/.test(contactId)) throw new Error('bad contactId');
    return join(this.dir, `${contactId}.json`);
  }
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }
  private async read(contactId: string): Promise<ChatMessage[]> {
    try {
      const arr = JSON.parse(await secureReadText(this.file(contactId))) as unknown;
      return Array.isArray(arr) ? (arr as ChatMessage[]) : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  list(contactId: string): Promise<ChatMessage[]> {
    return this.read(contactId);
  }

  append(contactId: string, msg: ChatMessage): Promise<void> {
    return this.serialize(async () => {
      const list = await this.read(contactId);
      if (list.some((m) => m.id === msg.id)) return; // dedup by id
      list.push(msg);
      if (list.length > this.maxHistory) list.splice(0, list.length - this.maxHistory);
      await secureWriteFile(this.file(contactId), JSON.stringify(list));
    });
  }

  updateState(contactId: string, id: string, state: MessageState): Promise<void> {
    return this.serialize(async () => {
      const list = await this.read(contactId);
      const m = list.find((x) => x.id === id);
      if (!m) return;
      m.state = state;
      await secureWriteFile(this.file(contactId), JSON.stringify(list));
    });
  }
}
