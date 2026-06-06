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
  creator: string; // contactId of whoever created the group ('me' for locally-created); authz anchor
  createdAt: number;
}

export const MAX_GROUPS = 256;
/** Cap on groups auto-created from a SINGLE peer's invites — bounds invite-spam DoS. */
export const MAX_GROUPS_PER_PEER = 32;

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

  /** Insert a new group. No-op if the groupId already exists (caller decides how to treat collisions —
   *  the engine refuses peer-driven mutation of an existing group it didn't authorize). Returns true if
   *  it was actually created. Enforces the global cap and a per-creator cap (invite-spam bound). */
  create(group: ChatGroup): Promise<boolean> {
    return this.serialize(async () => {
      const list = await this.read();
      if (list.some((g) => g.groupId === group.groupId)) return false; // collision — do NOT mutate
      if (list.length >= MAX_GROUPS) throw new Error('too many groups');
      if (list.filter((g) => g.creator === group.creator).length >= MAX_GROUPS_PER_PEER) {
        throw new Error('too many groups from this creator');
      }
      list.push({ ...group, memberIds: [...new Set(group.memberIds)] });
      await secureWriteFile(this.path, JSON.stringify(list));
      return true;
    });
  }

  /** Apply a scoped patch to an existing group (member union and/or name). Caller is responsible for
   *  authorization (the engine only calls this after verifying the inviter may mutate the group). */
  update(groupId: string, patch: { memberIds?: string[]; name?: string }): Promise<void> {
    return this.serialize(async () => {
      const list = await this.read();
      const g = list.find((x) => x.groupId === groupId);
      if (!g) return;
      if (patch.memberIds) g.memberIds = [...new Set([...g.memberIds, ...patch.memberIds])];
      if (patch.name) g.name = patch.name;
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
