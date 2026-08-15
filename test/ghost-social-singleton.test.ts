/**
 * Ghost Social Media Manager (hardened port) — SINGLETON window guard (Finding 3).
 *
 * The module drives a PROCESS-GLOBAL per-account view manager (one native overlay host, one cache,
 * one teardown). Two Ghost Social windows would share that single manager and cross-composite / tear
 * each other's views down. The fix is a `singleton?: boolean` on the module descriptor + a window-
 * store `open()` rule: opening a singleton module that already has an open window FOCUSES the
 * existing window instead of creating a second. A non-singleton module still opens many.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerModule,
  getModule,
  _resetRegistryForTest,
  type ModuleDescriptor,
} from '../src/renderer/state/registry';
import { useWindows } from '../src/renderer/state/store';

const Dummy = (() => null) as unknown as ModuleDescriptor['component'];

describe('module registry — singleton flag', () => {
  beforeEach(() => _resetRegistryForTest());

  it('carries the singleton flag through register/get', () => {
    registerModule({ key: 'ghost-social', title: 'Ghost Social', glyph: '👻', component: Dummy, builtin: true, singleton: true });
    registerModule({ key: 'notepad', title: 'Notepad', glyph: '📝', component: Dummy, builtin: true });
    expect(getModule('ghost-social')?.singleton).toBe(true);
    expect(getModule('notepad')?.singleton).toBeFalsy();
  });
});

describe('window store — singleton open() (Finding 3)', () => {
  beforeEach(() => {
    _resetRegistryForTest();
    useWindows.setState({ windows: [], focusStack: [] });
    registerModule({ key: 'ghost-social', title: 'Ghost Social', glyph: '👻', component: Dummy, builtin: true, singleton: true });
    registerModule({ key: 'notepad', title: 'Notepad', glyph: '📝', component: Dummy, builtin: true });
  });

  it('opening a singleton module twice yields ONE window and focuses the existing one', () => {
    const id1 = useWindows.getState().open({ module: 'ghost-social', title: 'Ghost Social' });
    const id2 = useWindows.getState().open({ module: 'ghost-social', title: 'Ghost Social' });
    const s = useWindows.getState();
    const ghostWindows = s.windows.filter((w) => w.module === 'ghost-social');
    expect(ghostWindows).toHaveLength(1); // never a second window
    expect(id2).toBe(id1); // the second open returns the existing window's id
    expect(s.focusStack[s.focusStack.length - 1]).toBe(id1); // existing window focused
  });

  it('a minimized singleton window is restored + focused (not duplicated) on re-open', () => {
    const id1 = useWindows.getState().open({ module: 'ghost-social', title: 'Ghost Social' });
    useWindows.getState().minimize(id1);
    expect(useWindows.getState().windows.find((w) => w.id === id1)?.minimized).toBe(true);
    const id2 = useWindows.getState().open({ module: 'ghost-social', title: 'Ghost Social' });
    const s = useWindows.getState();
    expect(id2).toBe(id1);
    expect(s.windows.filter((w) => w.module === 'ghost-social')).toHaveLength(1);
    expect(s.windows.find((w) => w.id === id1)?.minimized).toBe(false); // restored
    expect(s.focusStack[s.focusStack.length - 1]).toBe(id1); // focused
  });

  it('a NON-singleton module still opens multiple windows', () => {
    const a = useWindows.getState().open({ module: 'notepad', title: 'Notepad' });
    const b = useWindows.getState().open({ module: 'notepad', title: 'Notepad' });
    expect(a).not.toBe(b);
    expect(useWindows.getState().windows.filter((w) => w.module === 'notepad')).toHaveLength(2);
  });
});
