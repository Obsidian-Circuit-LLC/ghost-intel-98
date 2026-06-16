import type { Wall } from '@shared/post-mvp-types';

/** Initial slot count for a fresh, empty wall — keeps a familiar 3×3 grid on first open. NOT a cap:
 *  the wall grows past this as cameras are added (see assignToSlot/addStreams). */
export const WALL_SIZE = 9;

export function emptyWall(id: string, name: string, nowIso: string): Wall {
  return { id, name, slots: Array(WALL_SIZE).fill(null), createdAt: nowIso, updatedAt: nowIso };
}

/** Place streamId in the active slot (replacing it) if a valid index is given, else the first empty
 *  slot. If there is no active target AND no empty slot, APPENDS a new slot (the wall grows) rather
 *  than rejecting — the wall is unlimited. Returns the new wall and the slot index used. */
export function assignToSlot(wall: Wall, active: number | null, streamId: string): { wall: Wall; placed: number } {
  const slots = [...wall.slots];
  let target = (active != null && active >= 0 && active < slots.length) ? active : slots.findIndex((s) => s == null);
  if (target < 0) target = slots.length; // no active, no empty → append, growing the wall
  slots[target] = streamId;
  return { wall: { ...wall, slots }, placed: target };
}

export function clearSlot(wall: Wall, index: number): Wall {
  const slots = [...wall.slots];
  if (index >= 0 && index < slots.length) slots[index] = null;
  return { ...wall, slots };
}

/** Set the wall's slots to the FULL, variable-length list of stream ids (NOT capped). Used by
 *  "Fill wall from <node>" so every stream under a node gets a tile. */
export function addStreams(wall: Wall, streamIds: string[]): Wall {
  return { ...wall, slots: [...streamIds] };
}
