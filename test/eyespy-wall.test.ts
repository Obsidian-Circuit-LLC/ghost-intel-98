import { describe, it, expect } from 'vitest';
import { emptyWall, assignToSlot, clearSlot } from '../src/renderer/modules/eyespy/wall';

describe('wall slot helpers', () => {
  it('emptyWall has 9 null slots', () => {
    const w = emptyWall('id1', 'Untitled', '2026-01-01');
    expect(w.slots).toEqual(Array(9).fill(null));
    expect(w.name).toBe('Untitled');
  });
  it('assignToSlot fills the active slot (replacing) when one is given', () => {
    const w = emptyWall('id1', 'w', 't'); w.slots[2] = 'old';
    const r = assignToSlot(w, 2, 'new');
    expect(r.placed).toBe(2);
    expect(r.wall.slots[2]).toBe('new');
  });
  it('assignToSlot falls back to the first empty slot when no active slot', () => {
    const w = emptyWall('id1', 'w', 't'); w.slots[0] = 'a';
    const r = assignToSlot(w, null, 'b');
    expect(r.placed).toBe(1);
    expect(r.wall.slots[1]).toBe('b');
  });
  it('assignToSlot returns placed:null when full and no active slot', () => {
    const w = emptyWall('id1', 'w', 't'); w.slots = Array(9).fill('x');
    const r = assignToSlot(w, null, 'b');
    expect(r.placed).toBeNull();
    expect(r.wall).toBe(w);
  });
  it('clearSlot nulls one slot, leaves the rest', () => {
    const w = emptyWall('id1', 'w', 't'); w.slots[3] = 'z';
    expect(clearSlot(w, 3).slots[3]).toBeNull();
  });
});
