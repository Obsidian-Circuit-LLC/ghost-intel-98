import type { Wall } from '@shared/post-mvp-types';

export const WALL_SIZE = 9;

export function emptyWall(id: string, name: string, nowIso: string): Wall {
  return { id, name, slots: Array(WALL_SIZE).fill(null), createdAt: nowIso, updatedAt: nowIso };
}

/** Place streamId in the active slot (replacing it) if a valid index is given, else the first empty
 *  slot. Returns the new wall and which slot was used (null if the wall is full and no active slot). */
export function assignToSlot(wall: Wall, active: number | null, streamId: string): { wall: Wall; placed: number | null } {
  const slots = [...wall.slots];
  const target = (active != null && active >= 0 && active < slots.length) ? active : slots.findIndex((s) => s == null);
  if (target < 0) return { wall, placed: null };
  slots[target] = streamId;
  return { wall: { ...wall, slots }, placed: target };
}

export function clearSlot(wall: Wall, index: number): Wall {
  const slots = [...wall.slots];
  if (index >= 0 && index < slots.length) slots[index] = null;
  return { ...wall, slots };
}
