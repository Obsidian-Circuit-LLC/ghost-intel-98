// @vitest-environment jsdom
/**
 * The WebSDR receiver overlay must be CLIPPED to the window that owns it.
 *
 * FIELD REPORT (GhostExodus): "as long as it's not resized, the display is perfect" — resize the
 * window and the receiver paints outside it, over neighbouring windows.
 *
 * A `WebContentsView` is a sibling of the whole renderer, not a DOM child, so NOTHING in the DOM
 * clips it — not the module window, not a scroll container, not the viewport. `syncBounds` handed
 * `host.getBoundingClientRect()` straight to `receiverPresent`, and main applies it verbatim
 * (`view.setBounds(bounds)`, no clamping anywhere). While the host fits inside its window the two
 * rects agree and everything looks right; shrink the window so the host overflows it and the
 * overlay keeps painting the host's full rectangle — across whatever else is on screen.
 *
 * receiver-view.ts already documents this exact hazard on the HIDE path ("a stray native view
 * outliving its window is a release blocker"). The resize path needs the same guarantee: present
 * the INTERSECTION of the host with its window, and present nothing at all when that intersection
 * has collapsed. Same rule Ghost Social's account tiles already follow (clipOverlayBounds).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WebSdrModule } from '../src/renderer/modules/websdr/WebSdrModule';
import { useWindows } from '../src/renderer/state/store';
import { defaultWebSdrMenu, type WebSdrReceiver } from '@shared/websdr/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RX: WebSdrReceiver[] = [
  { id: 'rx-1', name: 'Alpha Twente WebSDR', url: 'https://websdr.ewi.utwente.nl/', type: 'WebSDR', location: 'NL', notes: '', favorite: false },
];

/** The module window. The overlay must never paint outside this rectangle. */
const SHELL = { x: 40, y: 20, width: 400, height: 300 };

function rect(r: { x: number; y: number; width: number; height: number }): DOMRect {
  return {
    x: r.x, y: r.y, left: r.x, top: r.y, width: r.width, height: r.height,
    right: r.x + r.width, bottom: r.y + r.height, toJSON: () => ({}),
  } as DOMRect;
}

function mkApi(over: Record<string, any> = {}) {
  return {
    listReceivers: vi.fn().mockResolvedValue(RX),
    saveReceiver: vi.fn().mockResolvedValue(RX),
    deleteReceiver: vi.fn().mockResolvedValue(RX),
    listPresets: vi.fn().mockResolvedValue([]),
    savePreset: vi.fn().mockResolvedValue([]),
    deletePreset: vi.fn().mockResolvedValue([]),
    listNotes: vi.fn().mockResolvedValue([]),
    saveNote: vi.fn().mockResolvedValue([]),
    deleteNote: vi.fn().mockResolvedValue([]),
    getMenu: vi.fn().mockResolvedValue(defaultWebSdrMenu()),
    saveMenu: vi.fn().mockImplementation((m: unknown) => Promise.resolve(m)),
    getEgress: vi.fn().mockResolvedValue({ mode: 'clearnet' }),
    setEgress: vi.fn().mockImplementation((mode: unknown) => Promise.resolve({ mode })),
    receiverLoad: vi.fn().mockResolvedValue(undefined),
    receiverHide: vi.fn().mockResolvedValue(undefined),
    receiverPresent: vi.fn().mockResolvedValue(undefined),
    receiverModal: vi.fn().mockResolvedValue(undefined),
    receiverStatus: vi.fn().mockResolvedValue({ online: true, status: 200 }),
    receiverMute: vi.fn().mockResolvedValue(undefined),
    receiverExternalOpen: vi.fn().mockResolvedValue(undefined),
    receiverEgressApply: vi.fn().mockImplementation((mode: unknown) => Promise.resolve({ mode })),
    receiverTune: vi.fn().mockResolvedValue({ ok: true, message: 'Tuned.' }),
    receiverMode: vi.fn().mockResolvedValue({ ok: true, message: 'Mode set.' }),
    receiverVolume: vi.fn().mockResolvedValue({ ok: true, message: 'Volume set.' }),
    receiverCaptureSource: vi.fn().mockResolvedValue('src-id-1'),
    listRecordings: vi.fn().mockResolvedValue([]),
    saveRecording: vi.fn().mockResolvedValue([]),
    recordingData: vi.fn().mockResolvedValue({ id: 'r', mime: 'video/webm', bytes: new Uint8Array() }),
    annotateRecording: vi.fn().mockResolvedValue([]),
    deleteRecording: vi.fn().mockResolvedValue([]),
    exportRecording: vi.fn().mockResolvedValue(true),
    ...over,
  };
}

let shellEl: HTMLDivElement;
let container: HTMLDivElement;
let root: Root;

/** Give the window shell SHELL, and every other element (the receiver host included) `hostRect`. */
function stubLayout(hostRect: { x: number; y: number; width: number; height: number }) {
  return vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return this.classList?.contains('ga98-window-shell') ? rect(SHELL) : rect(hostRect);
    });
}

async function mountWithReceiver(api: Record<string, any>): Promise<void> {
  (globalThis as any).window.api = { websdr: api };
  useWindows.setState({ windows: [{ id: 'w1' }], focusStack: ['w1'] } as never);
  await act(async () => { root.render(<WebSdrModule windowId="w1" />); });
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
  await act(async () => {
    (container.querySelector('.sdr-receiver-main') as HTMLButtonElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
  });
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}

/** The last present() call that actually carried bounds. */
function lastShown(api: Record<string, any>) {
  return api.receiverPresent.mock.calls.map((c: any[]) => c[0]).filter((a: any) => a?.bounds).at(-1);
}

describe('WebSDR overlay is clipped to its window', () => {
  beforeEach(() => {
    shellEl = document.createElement('div');
    shellEl.className = 'ga98-window-shell';
    container = document.createElement('div');
    shellEl.appendChild(container);
    document.body.appendChild(shellEl);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    shellEl.remove();
    delete (globalThis as any).window.api;
    useWindows.setState({ windows: [], focusStack: [] } as never);
    vi.restoreAllMocks();
  });

  it('presents the intersection when the host overflows the window', async () => {
    const api = mkApi();
    // The window was resized smaller than the host: the host runs 460px past its right edge and
    // 280px past its bottom. Unclipped, the overlay paints all of that over whatever is behind it.
    const spy = stubLayout({ x: 100, y: 60, width: 800, height: 560 });
    await mountWithReceiver(api);
    spy.mockRestore();
    const shown = lastShown(api);
    expect(shown, 'a present() carried bounds').toBeTruthy();
    // Intersection of host(100,60,800x560) with shell(40,20,400x300) = (100,60,340x260).
    expect(shown.bounds).toEqual({ x: 100, y: 60, width: 340, height: 260 });
  });

  it('leaves bounds untouched when the host already fits inside the window', async () => {
    const api = mkApi();
    const spy = stubLayout({ x: 60, y: 40, width: 200, height: 150 });
    await mountWithReceiver(api);
    spy.mockRestore();
    expect(lastShown(api).bounds).toEqual({ x: 60, y: 40, width: 200, height: 150 });
  });

  it('hides rather than painting elsewhere when the host is scrolled fully out of the window', async () => {
    const api = mkApi();
    const spy = stubLayout({ x: 900, y: 700, width: 800, height: 560 });
    await mountWithReceiver(api);
    spy.mockRestore();
    expect(api.receiverPresent.mock.calls.at(-1)![0]).toMatchObject({ visible: false });
  });

  it('resyncs the overlay when the window is DRAGGED, not just resized', async () => {
    // The overlay is positioned in window coordinates and was resynced only from `window.resize`
    // and a ResizeObserver on the host. Neither fires on a move: the host changes position without
    // changing size, so the native receiver stayed at its old coordinates, painting over whatever
    // was now underneath it. Resizing worked only because the SIZE changed and the observer caught
    // that; nothing was watching position at all.
    const api = mkApi();
    const spy = stubLayout({ x: 60, y: 40, width: 200, height: 150 });
    await mountWithReceiver(api);
    const before = lastShown(api);
    expect(before.bounds).toEqual({ x: 60, y: 40, width: 200, height: 150 });

    // Move the window: same size, new position. The host now reports a shifted rect.
    spy.mockRestore();
    const moved = stubLayout({ x: 160, y: 90, width: 200, height: 150 });
    api.receiverPresent.mockClear();
    await act(async () => {
      useWindows.setState({
        windows: [{ id: 'w1', x: 100, y: 50 }],
        focusStack: ['w1'],
      } as never);
    });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    moved.mockRestore();

    const after = lastShown(api);
    expect(after, 'a move must re-present the overlay').toBeTruthy();
    expect(after.bounds).toEqual({ x: 160, y: 90, width: 200, height: 150 });
  });
});
