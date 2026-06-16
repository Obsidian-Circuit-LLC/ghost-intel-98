import { describe, it, expect } from 'vitest';
import { emptyWall, assignToSlot, clearSlot, addStreams } from '../src/renderer/modules/eyespy/wall';

describe('wall slot helpers', () => {
  it('emptyWall has 9 null slots (familiar initial grid)', () => {
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
  it('assignToSlot APPENDS a new slot when full and no active slot (wall grows)', () => {
    const w = emptyWall('id1', 'w', 't'); w.slots = Array(9).fill('x');
    const r = assignToSlot(w, null, 'b');
    expect(r.placed).toBe(9);
    expect(r.wall.slots).toHaveLength(10);
    expect(r.wall.slots[9]).toBe('b');
    // original wall untouched (pure)
    expect(w.slots).toHaveLength(9);
  });
  it('clearSlot nulls one slot in place, leaves the rest', () => {
    const w = emptyWall('id1', 'w', 't'); w.slots[3] = 'z';
    const c = clearSlot(w, 3);
    expect(c.slots[3]).toBeNull();
    expect(c.slots).toHaveLength(9);
  });
  it('addStreams sets the full variable-length list (not capped at 9)', () => {
    const w = emptyWall('id1', 'w', 't');
    const ids = Array.from({ length: 15 }, (_, i) => `s${i}`);
    const r = addStreams(w, ids);
    expect(r.slots).toHaveLength(15);
    expect(r.slots).toEqual(ids);
  });
  it('a wall with >9 slots round-trips at variable length', () => {
    const w = emptyWall('id1', 'w', 't');
    const ids = Array.from({ length: 12 }, (_, i) => `s${i}`);
    const filled = addStreams(w, ids);
    const json = JSON.parse(JSON.stringify(filled));
    expect(json.slots).toHaveLength(12);
    expect(json.slots).toEqual(ids);
  });
});
