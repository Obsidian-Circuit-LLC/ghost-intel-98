/**
 * X Listening Station — sweep progress reporting (port of his `emitProgress`, `main.cjs:589`).
 *
 * GhostExodus: "On my original app, it actually informs you what task is taking place when you hit
 * the Sweep button." His build pushes `{message, current, total, running}` as each target is
 * collected and the renderer shows it in TWO places — the notice banner under the header and the
 * sidebar session box — so the current target is visible wherever the analyst is looking. Ours
 * showed a static "X Listening Station ready." for the entire run.
 *
 * Pure over an injected window getter: no electron import, so the emitter is unit-testable and a
 * background run that outlives the window is a no-op rather than a crash.
 */
import { channels } from '@shared/ipc-contracts';
import { displayXHandle } from '@shared/x-listening-source';

/** His exact wording, so the two builds read identically (`main.cjs:1840,1880`). */
export const COLLECTING = (handle: string): string => `Collecting ${displayXHandle(handle)}…`;

export interface SweepProgressPayload {
  message: string;
  current: number;
  total: number;
  running: boolean;
}

interface WindowLike {
  isDestroyed(): boolean;
  webContents: { send(channel: string, payload: unknown): void };
}

export interface SweepProgress {
  /** Announce the target now being collected (`current`/`total` position within the run). */
  collecting(handle: string, current?: number, total?: number): void;
  /** Announce that the run finished — clears `running` so the UI stops showing a stale target. */
  done(message: string): void;
  /** Push an arbitrary in-flight message (e.g. a network extraction) without a handle. */
  say(message: string, current?: number, total?: number): void;
}

export function makeSweepProgress(getWindow: () => WindowLike | null | undefined): SweepProgress {
  const push = (payload: SweepProgressPayload): void => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    try {
      win.webContents.send(channels.xListening.sweepProgress, payload);
    } catch {
      /* a window torn down mid-send must never fail the collection run */
    }
  };
  return {
    collecting: (handle, current = 0, total = 1) =>
      push({ message: COLLECTING(handle), current, total, running: true }),
    say: (message, current = 0, total = 1) => push({ message, current, total, running: true }),
    done: (message) => push({ message, current: 0, total: 0, running: false }),
  };
}

/** The emitter the IPC layer installs at registration, so collection paths anywhere in the module
 *  can report progress without threading a window through every call. Defaults to a no-op, which is
 *  what tests and any pre-registration call get. */
let current: SweepProgress = { collecting: () => {}, say: () => {}, done: () => {} };

/** Install the production emitter (called once, from `registerXListeningIpc`). */
export function setSweepProgress(progress: SweepProgress): void {
  current = progress;
}

/** The installed emitter. */
export function sweepProgress(): SweepProgress {
  return current;
}
