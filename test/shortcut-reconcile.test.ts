import { describe, it, expect } from 'vitest';
import { reconcileShortcuts, defaultShortcuts, type AccessShortcut } from '../src/shared/types';

// Existing installs persisted their Access-menu shortcuts before Jukebox/GeoINT shipped and
// before the Help→RTFM rename. reconcileShortcuts repairs a persisted list so those modules
// surface and the label updates — seeding each required module exactly once so a later
// deletion sticks.

describe('reconcileShortcuts', () => {
  it('appends Jukebox + GeoINT when missing (the GhostExodus "can\'t find them" bug)', () => {
    const legacy: AccessShortcut[] = [
      { id: 'cases', label: 'Case Files', kind: 'module', target: 'cases' },
      { id: 'help', label: 'Help', kind: 'module', target: 'help' }
    ];
    const { shortcuts, seededShortcuts } = reconcileShortcuts(legacy, []);
    expect(shortcuts.some((s) => s.target === 'media-player')).toBe(true);
    expect(shortcuts.some((s) => s.target === 'geoint')).toBe(true);
    expect(seededShortcuts).toEqual(expect.arrayContaining(['media-player', 'geoint']));
  });

  it('renames the default "Help" label to "RTFM"', () => {
    const { shortcuts } = reconcileShortcuts([{ id: 'help', label: 'Help', kind: 'module', target: 'help' }], []);
    expect(shortcuts.find((s) => s.target === 'help')?.label).toBe('RTFM');
  });

  it('does NOT rename a user-customised help label', () => {
    const { shortcuts } = reconcileShortcuts([{ id: 'help', label: 'My Docs', kind: 'module', target: 'help' }], []);
    expect(shortcuts.find((s) => s.target === 'help')?.label).toBe('My Docs');
  });

  it('respects a deletion: a seeded module the user removed is NOT re-added (red-team M2)', () => {
    // First reconcile seeds media-player + geoint.
    const first = reconcileShortcuts(
      [{ id: 'cases', label: 'Case Files', kind: 'module', target: 'cases' }],
      []
    );
    expect(first.shortcuts.some((s) => s.target === 'media-player')).toBe(true);
    // User deletes Jukebox; the seeded list still records it.
    const afterDelete = first.shortcuts.filter((s) => s.target !== 'media-player');
    const second = reconcileShortcuts(afterDelete, first.seededShortcuts);
    expect(second.shortcuts.some((s) => s.target === 'media-player')).toBe(false); // stays gone
    expect(second.shortcuts.some((s) => s.target === 'geoint')).toBe(true); // untouched
  });

  it('is idempotent and does not duplicate already-present modules', () => {
    const once = reconcileShortcuts(defaultShortcuts, []);
    const twice = reconcileShortcuts(once.shortcuts, once.seededShortcuts);
    expect(twice.shortcuts.filter((s) => s.target === 'media-player')).toHaveLength(1);
    expect(twice.shortcuts.filter((s) => s.target === 'geoint')).toHaveLength(1);
    expect(twice.shortcuts).toHaveLength(once.shortcuts.length);
  });

  it('does not mutate the shared defaultShortcuts constant', () => {
    const before = defaultShortcuts.length;
    reconcileShortcuts(defaultShortcuts, []);
    reconcileShortcuts(defaultShortcuts, []);
    expect(defaultShortcuts).toHaveLength(before);
  });

  it('preserves user ordering and unrelated shortcuts', () => {
    const custom: AccessShortcut[] = [
      { id: 'x', label: 'My Link', kind: 'url', target: 'https://example.com' },
      { id: 'cases', label: 'Case Files', kind: 'module', target: 'cases' }
    ];
    const { shortcuts } = reconcileShortcuts(custom, []);
    expect(shortcuts[0]).toEqual(custom[0]);
    expect(shortcuts[1]).toEqual(custom[1]);
  });
});
