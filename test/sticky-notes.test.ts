import { describe, it, expect } from 'vitest';
import { ensureStickyNotes } from '../src/main/security/validate';

// The sticky-notes layer is renderer-supplied → validated/clamped before it hits disk.
describe('ensureStickyNotes', () => {
  it('keeps a valid note round-trip', () => {
    const s = ensureStickyNotes({
      notes: [{ id: 'n1', text: 'remember the milk', icon: '🔔', color: 'pink', x: 120, y: 200, reminderId: 'rem-1' }],
      hidden: false
    });
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0]).toMatchObject({ id: 'n1', text: 'remember the milk', icon: '🔔', color: 'pink', x: 120, y: 200, reminderId: 'rem-1' });
    expect(s.hidden).toBe(false);
  });

  it('falls back to a safe color and default icon for unknown values', () => {
    const s = ensureStickyNotes({ notes: [{ id: 'n', text: 't', color: 'rgb(0,0,0);x', icon: '' }], hidden: 'yes' });
    expect(s.notes[0].color).toBe('yellow');   // unknown palette key rejected
    expect(s.notes[0].icon).toBe('📌');         // empty icon → default
    expect(s.hidden).toBe(false);               // only literal true counts
  });

  it('clamps coordinates into range and rounds them', () => {
    const s = ensureStickyNotes({ notes: [{ id: 'n', text: '', icon: '📌', color: 'blue', x: -50, y: 99999.7 }] });
    expect(s.notes[0].x).toBe(0);
    expect(s.notes[0].y).toBe(50000);
  });

  it('bounds note count and text length', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ id: `n${i}`, text: 'x'.repeat(99999), icon: '📌', color: 'white', x: 0, y: 0 }));
    const s = ensureStickyNotes({ notes: many, hidden: false });
    expect(s.notes.length).toBeLessThanOrEqual(200);
    expect(s.notes[0].text.length).toBeLessThanOrEqual(4000);
  });

  it('tolerates garbage input without throwing', () => {
    expect(ensureStickyNotes(null)).toEqual({ notes: [], hidden: false });
    expect(ensureStickyNotes({ notes: 'nope' })).toEqual({ notes: [], hidden: false });
    expect(ensureStickyNotes(undefined)).toEqual({ notes: [], hidden: false });
  });

  it('omits w/h when absent so the CSS default size applies', () => {
    const s = ensureStickyNotes({ notes: [{ id: 'n', text: '', icon: '📌', color: 'yellow', x: 0, y: 0 }] });
    expect(s.notes[0]).not.toHaveProperty('w');
    expect(s.notes[0]).not.toHaveProperty('h');
  });

  it('keeps valid resize dimensions and rounds them', () => {
    const s = ensureStickyNotes({ notes: [{ id: 'n', text: '', icon: '📌', color: 'yellow', x: 0, y: 0, w: 240.6, h: 180.2 }] });
    expect(s.notes[0].w).toBe(241);
    expect(s.notes[0].h).toBe(180);
  });

  it('clamps resize dimensions to the min/max bounds', () => {
    const small = ensureStickyNotes({ notes: [{ id: 'a', text: '', icon: '📌', color: 'yellow', x: 0, y: 0, w: 10, h: 10 }] });
    expect(small.notes[0].w).toBe(140);   // STICKY_MIN_W
    expect(small.notes[0].h).toBe(90);    // STICKY_MIN_H
    const big = ensureStickyNotes({ notes: [{ id: 'b', text: '', icon: '📌', color: 'yellow', x: 0, y: 0, w: 99999, h: 99999 }] });
    expect(big.notes[0].w).toBe(1200);    // STICKY_MAX_DIM
    expect(big.notes[0].h).toBe(1200);
  });

  it('drops non-numeric w/h rather than persisting junk', () => {
    const s = ensureStickyNotes({ notes: [{ id: 'n', text: '', icon: '📌', color: 'yellow', x: 0, y: 0, w: 'wide', h: NaN }] });
    expect(s.notes[0]).not.toHaveProperty('w');
    expect(s.notes[0]).not.toHaveProperty('h');
  });
});
