/**
 * Sweep progress reporting — port of his `emitProgress` (`main.cjs:589`).
 *
 * GhostExodus: "On my original app, it actually informs you what task is taking place when you hit
 * the Sweep button." His build pushes `{message, current, total, running}` on every target and shows
 * it in TWO places at once — the notice banner under the header and the session box in the sidebar —
 * so "Collecting @SebastianDAlex…" is visible wherever you are looking (his A/B video).
 *
 * Ours said only "X Listening Station ready." for the whole run.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeSweepProgress, COLLECTING } from '../src/main/x-listening/progress';

function fakeWindow() {
  const sent: Array<[string, unknown]> = [];
  return {
    sent,
    win: { isDestroyed: () => false, webContents: { send: (ch: string, payload: unknown) => sent.push([ch, payload]) } },
  };
}

describe('sweep progress', () => {
  it('announces the target being collected, with position in the run', () => {
    const w = fakeWindow();
    const p = makeSweepProgress(() => w.win as never);
    p.collecting('ADanielHill', 2, 5);
    const [, payload] = w.sent.at(-1)!;
    expect(payload).toMatchObject({ message: COLLECTING('ADanielHill'), current: 2, total: 5, running: true });
  });

  it('uses his exact wording so the two builds read identically', () => {
    expect(COLLECTING('SebastianDAlex')).toBe('Collecting @SebastianDAlex…');
  });

  it('formats the handle idempotently — a stored "@handle" never doubles', () => {
    expect(COLLECTING('@SebastianDAlex')).toBe('Collecting @SebastianDAlex…');
  });

  it('reports a single-target capture as one of one', () => {
    const w = fakeWindow();
    makeSweepProgress(() => w.win as never).collecting('solo');
    expect(w.sent.at(-1)![1]).toMatchObject({ current: 0, total: 1, running: true });
  });

  it('clears to not-running when the run finishes, so the UI stops showing a stale target', () => {
    const w = fakeWindow();
    const p = makeSweepProgress(() => w.win as never);
    p.collecting('a', 1, 2);
    p.done('Collection sweep complete.');
    expect(w.sent.at(-1)![1]).toMatchObject({ message: 'Collection sweep complete.', running: false });
  });

  it('is a no-op without a window — a background sweep after the window closed must not throw', () => {
    const p = makeSweepProgress(() => null);
    expect(() => p.collecting('a', 1, 1)).not.toThrow();
    expect(() => p.done('x')).not.toThrow();
  });

  it('never sends to a destroyed window', () => {
    const w = fakeWindow();
    const p = makeSweepProgress(() => ({ ...w.win, isDestroyed: () => true }) as never);
    p.collecting('a', 1, 1);
    expect(w.sent).toHaveLength(0);
  });
});
