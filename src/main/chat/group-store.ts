/**
 * Group store (Phase 3, client-side fan-out) — local group metadata, encrypted at rest. A group is
 * just a shared groupId + name + a member list of contactIds (hex sha256 fingerprints). There is NO
 * group cryptography: a group message is sent by encrypting it separately over each member's existing
 * 1:1 session (the audited Phase 1 ratchet). Membership is a LOCAL view — peers converge on the same
 * groupId/name/members via `group-invite` control messages, but each device owns its own copy.
 *
 * Path injected (no electron). Caller stamps timestamps (no time() here — determinism).
 */
import { secureReadText, secureWriteFile } from '../storage/secure-fs';

export interface ChatGroup {
  groupId: string; // hex, 32 chars (16 bytes)
  name: string;
  memberIds: string[]; // contactId hex (64 chars each)
  createdAt: number;
}

export const MAX_GROUPS = 256;

export class GroupStore {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string) {}

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }
  private async read(): Promise<ChatGroup[]> {
    try {
      const arr = JSON.parse(await secureReadText(this.path)) as unknown;
      return Array.isArray(arr) ? (arr as ChatGroup[]) : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  list(): Promise<ChatGroup[]> {
    return this.read();
  }

  async get(groupId: string): Promise<ChatGroup | null> {
    return (await this.read()).find((g) => g.groupId === groupId) ?? null;
  }

  /** Create or merge a group. If the groupId already exists, the member set is unioned (peers may
   *  each know a different subset) and the name updated; otherwise a new row is appended. */
  upsert(group: ChatGroup): Promise<void> {
    return this.serialize(async () => {
      const list = await this.read();
      const existing = list.find((g) => g.groupId === group.groupId);
      if (existing) {
        existing.name = group.name || existing.name;
        existing.memberIds = [...new Set([...existing.memberIds, ...group.memberIds])];
      } else {
        if (list.length >= MAX_GROUPS) throw new Error('too many groups');
        list.push({ ...group, memberIds: [...new Set(group.memberIds)] });
      }
      await secureWriteFile(this.path, JSON.stringify(list));
    });
  }

  /** Replace a group's member list (explicit add/remove from the UI). */
  setMembers(groupId: string, memberIds: string[]): Promise<void> {
    return this.serialize(async () => {
      const list = await this.read();
      const g = list.find((x) => x.groupId === groupId);
      if (!g) return;
      g.memberIds = [...new Set(memberIds)];
      await secureWriteFile(this.path, JSON.stringify(list));
    });
  }

  remove(groupId: string): Promise<void> {
    return this.serialize(async () => {
      const list = (await this.read()).filter((g) => g.groupId !== groupId);
      await secureWriteFile(this.path, JSON.stringify(list));
    });
  }
}
