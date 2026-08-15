// @vitest-environment jsdom
/**
 * WebSDR Viewer — renderer module (Phase 4, R9/R10 + control-bar + host bounds + markers).
 *
 * Drives the real <WebSdrModule/> against a mocked `window.api.websdr` (the P1/P2/P3 IPC surface),
 * with React 18's createRoot inside act() on a jsdom container — mirroring
 * briefcase-banner.test.tsx / newsview-standalone.test.tsx (no @testing-library dependency).
 *
 * Covers:
 *  - R10 failure screen: with the preload bridge absent, a readable fault surface renders (not a
 *    blank window).
 *  - R9 station-menu customize round-trip: hide + rename + reorder an item, Done → saveMenu is
 *    called with the mutated items (the customization persists through the P1 menu-config seam).
 *  - Control bar → the RIGHT confined IPC: TUNE → receiverTune(hz); a mode button → receiverMode;
 *    mute → receiverMute; volume → receiverVolume.
 *  - Receiver host reports bounds: selecting a receiver calls receiverLoad(url) AND presents the
 *    overlay with a numeric bounds object (so P2's overlay can track the host region).
 *  - CLEARNET/TOR marker renders and reflects the persisted egress mode.
 *  - Record indicator: starting a capture (stubbed getUserMedia + MediaRecorder) flips the pulsing
 *    recording indicator on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WebSdrModule } from '../src/renderer/modules/websdr/WebSdrModule';
import { useWindows } from '../src/renderer/state/store';
import { defaultWebSdrMenu, type WebSdrReceiver } from '@shared/websdr/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Names chosen so the favorite-then-alphabetical sort is deterministic: neither is a favorite, so
// "Alpha Twente" sorts first — the first `.sdr-receiver-main` in the DOM.
const RX: WebSdrReceiver[] = [
  { id: 'rx-1', name: 'Alpha Twente WebSDR', url: 'https://websdr.ewi.utwente.nl/', type: 'WebSDR', location: 'NL', notes: '', favorite: false },
  { id: 'rx-2', name: 'Beta Kiwi', url: 'https://kiwi.example.org/', type: 'KiwiSDR', location: 'US', notes: '', favorite: false },
];

/** Set a controlled <input>'s value through React's tracked native setter, then fire `input` — a
 *  bare `el.value = x` bypasses React 18's value tracker and the onChange never fires. */
function setInputValue(el: HTMLInputElement, value: string): void {
  const proto = el.type === 'range' ? window.HTMLInputElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
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
    receiverEgressApply: vi.fn().mockImplementation((mode: unknown) => Promise.resolve({ mode, showWarning: mode === 'tor' })),
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

let container: HTMLDivElement;
let root: Root;

function setApi(websdr: Record<string, any> | undefined): void {
  (globalThis as any).window.api = websdr ? { websdr } : {};
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(<WebSdrModule />);
  });
  // Let the mount-time Promise.all settle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const buttons = () => Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
const byText = (t: string) => buttons().find((b) => (b.textContent ?? '').trim().includes(t));

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (globalThis as any).window.api;
  vi.restoreAllMocks();
});

describe('WebSDR renderer module', () => {
  it('R10: renders the failure screen when the preload bridge is absent', async () => {
    setApi(undefined);
    await mount();
    const fatal = container.querySelector('.sdr-fatal');
    expect(fatal).not.toBeNull();
    expect((fatal!.textContent ?? '').toLowerCase()).toContain('preload');
    // No station menu is drawn on the fault surface.
    expect(container.querySelector('.sdr-nav')).toBeNull();
  });

  it('renders the banner, the station menu, and a CLEARNET egress marker', async () => {
    setApi(mkApi());
    await mount();
    const img = container.querySelector('img.sdr-banner-art') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toMatch(/websdr-banner/);
    expect(container.querySelector('.sdr-nav')).not.toBeNull();
    const marker = container.querySelector('.sdr-egress-marker');
    expect(marker).not.toBeNull();
    expect((marker!.textContent ?? '').toUpperCase()).toContain('CLEARNET');
  });

  it('R9: station-menu customize round-trips hide + rename + reorder through saveMenu', async () => {
    const api = mkApi();
    setApi(api);
    await mount();

    // Open the Customize editor (its built-in menu button).
    await act(async () => {
      byText('Customize')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const editor = container.querySelector('.sdr-menu-editor');
    expect(editor, 'customize editor opens').not.toBeNull();

    // Rename the first row (All Feeds) and hide it, then move it down one.
    const rowInputs = Array.from(editor!.querySelectorAll('input')) as HTMLInputElement[];
    expect(rowInputs.length).toBeGreaterThan(0);
    await act(async () => {
      setInputValue(rowInputs[0], 'RENAMED FEEDS');
    });
    // Hide toggle + move-down are the row's icon buttons; find them within the first row.
    const firstRow = editor!.querySelector('.sdr-menu-edit-row')!;
    const rowBtns = Array.from(firstRow.querySelectorAll('button')) as HTMLButtonElement[];
    // Convention: [0]=hide toggle, [1]=move up, [2]=move down.
    await act(async () => {
      rowBtns[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); // hide
    });
    await act(async () => {
      rowBtns[2].dispatchEvent(new MouseEvent('click', { bubbles: true })); // move down
    });

    // Done → saveMenu called with the mutated config.
    await act(async () => {
      byText('Done')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(api.saveMenu).toHaveBeenCalled();
    const saved = api.saveMenu.mock.calls.at(-1)![0] as { items: any[] };
    const renamed = saved.items.find((i) => i.label === 'RENAMED FEEDS');
    expect(renamed, 'rename persisted').toBeTruthy();
    expect(renamed.hidden, 'hide persisted').toBe(true);
    // Reorder: all-feeds is no longer at index 0.
    expect(saved.items[0].key).not.toBe('all-feeds');
    expect(saved.items.some((i) => i.key === 'all-feeds')).toBe(true);
  });

  it('control bar drives the confined receiver IPC (tune/mode/mute/volume)', async () => {
    const api = mkApi();
    setApi(api);
    await mount();

    // Select a receiver so the overlay + controls are live.
    await act(async () => {
      (container.querySelector('.sdr-receiver-main') as HTMLButtonElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(api.receiverLoad).toHaveBeenCalledWith(RX[0].url);

    // Frequency + TUNE.
    const freq = container.querySelector('.sdr-freq input') as HTMLInputElement;
    await act(async () => {
      setInputValue(freq, '7100000');
    });
    await act(async () => {
      byText('TUNE')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(api.receiverTune).toHaveBeenCalledWith(7100000);

    // Mode button.
    const usb = Array.from(container.querySelectorAll('.sdr-modes button')).find(
      (b) => (b.textContent ?? '').trim() === 'USB',
    ) as HTMLButtonElement;
    await act(async () => {
      usb.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(api.receiverMode).toHaveBeenCalledWith('USB');

    // Mute.
    await act(async () => {
      (container.querySelector('.sdr-mute') as HTMLButtonElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(api.receiverMute).toHaveBeenCalledWith(true);

    // Volume.
    const vol = container.querySelector('.sdr-volume input[type="range"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(vol, '0.3');
    });
    expect(api.receiverVolume).toHaveBeenCalled();
    expect(api.receiverVolume.mock.calls.at(-1)![0]).toBeCloseTo(0.3);
  });

  it('reports the receiver-host bounds to the overlay on select', async () => {
    const api = mkApi();
    setApi(api);
    await mount();
    await act(async () => {
      (container.querySelector('.sdr-receiver-main') as HTMLButtonElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    // present is called with a { visible, bounds } shape carrying numeric bounds.
    expect(api.receiverPresent).toHaveBeenCalled();
    const withBounds = api.receiverPresent.mock.calls
      .map((c: any[]) => c[0])
      .find((a: any) => a && a.bounds);
    expect(withBounds, 'a present() carried bounds').toBeTruthy();
    for (const k of ['x', 'y', 'width', 'height']) {
      expect(typeof withBounds.bounds[k]).toBe('number');
    }
  });

  it('savePreset creates a preset through the in-app dialog (not window.prompt)', async () => {
    const api = mkApi();
    setApi(api);
    // Guard the regression directly: if the code ever falls back to window.prompt, this rejects it.
    (window as any).prompt = () => {
      throw new Error('window.prompt must not be used — it is a no-op in Electron.');
    };
    await mount();

    // Go to the presets panel via its station-menu button.
    await act(async () => {
      byText('Presets')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // The panel's save-preset button is the only button in its section title; click it.
    const section = Array.from(container.querySelectorAll('.sdr-section-title')).find(
      (s) => (s.textContent ?? '').includes('FREQUENCY PRESETS'),
    )!;
    await act(async () => {
      (section.querySelector('button') as HTMLButtonElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    // The in-app PromptDialog is now open (NOT a browser prompt). Enter a name and submit.
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(dialog, 'in-app preset dialog opened').not.toBeNull();
    const input = dialog!.querySelector('input') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, 'Ham net 40m');
    });
    const save = Array.from(dialog!.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'Save',
    ) as HTMLButtonElement;
    await act(async () => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(api.savePreset).toHaveBeenCalledTimes(1);
    const arg = api.savePreset.mock.calls[0][0];
    expect(arg.name).toBe('Ham net 40m');
    expect(typeof arg.frequencyHz).toBe('number');
    expect(typeof arg.mode).toBe('string');
    // Dialog closes after submit.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('Customize > Add receiver shortcut appends a shortcut through the in-app dialog', async () => {
    const api = mkApi();
    setApi(api);
    (window as any).prompt = () => {
      throw new Error('window.prompt must not be used — it is a no-op in Electron.');
    };
    await mount();

    // Open the Customize editor.
    await act(async () => {
      byText('Customize')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // Click "Add receiver shortcut".
    await act(async () => {
      byText('Add receiver shortcut')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const dialog = container.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(dialog, 'in-app shortcut dialog opened').not.toBeNull();
    const input = dialog!.querySelector('input') as HTMLInputElement;
    // Enter an EXACT receiver name (case-insensitive match on RX[0]).
    await act(async () => {
      setInputValue(input, 'alpha twente websdr');
    });
    const add = Array.from(dialog!.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === 'Add',
    ) as HTMLButtonElement;
    await act(async () => {
      add.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // A new custom shortcut row (labeled with the receiver's name) is now in the menu editor.
    const rowInputs = Array.from(
      container.querySelectorAll('.sdr-menu-edit-row input'),
    ) as HTMLInputElement[];
    expect(rowInputs.some((i) => i.value === RX[0].name), 'shortcut row added').toBe(true);
  });

  it('record indicator turns on when a capture starts', async () => {
    const api = mkApi();
    setApi(api);

    // Stub the capture stack jsdom lacks. Zero audio tracks → the AudioContext monitor is skipped.
    const fakeStream = { getAudioTracks: () => [], getTracks: () => [] };
    (navigator as any).mediaDevices = { getUserMedia: vi.fn().mockResolvedValue(fakeStream) };
    class FakeMediaRecorder {
      static isTypeSupported() {
        return false;
      }
      state = 'inactive';
      ondataavailable: ((e: any) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.onstop?.();
      }
    }
    (globalThis as any).MediaRecorder = FakeMediaRecorder as any;

    await mount();
    // Select a receiver (RECORD requires one).
    await act(async () => {
      (container.querySelector('.sdr-receiver-main') as HTMLButtonElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    // Click RECORD.
    await act(async () => {
      byText('RECORD')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.receiverCaptureSource).toHaveBeenCalled();
    expect(container.querySelector('.sdr-rec-indicator')).not.toBeNull();
  });
});

// The native WebContentsView overlay composites ABOVE all DOM, so it must be torn down / hidden the
// instant this window is no longer the active surface — else it floats over the desktop and every
// other GI98 window (the two confirmed criticals + the minimize gap from the whole-branch review).
describe('WebSDR overlay lifecycle — the native view never leaks', () => {
  function setWindows(focusStack: string[], windows: Array<{ id: string; minimized?: boolean }>): void {
    act(() => useWindows.setState({ focusStack, windows } as never));
  }
  async function mountFocusedWithReceiver(api: Record<string, any>): Promise<void> {
    setApi(api);
    useWindows.setState({ windows: [{ id: 'w1' }], focusStack: ['w1'] } as never);
    await act(async () => { root.render(<WebSdrModule windowId="w1" />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // Select a receiver so the overlay is presented (visible:true) before we test hide paths.
    await act(async () => {
      (container.querySelector('.sdr-receiver-main') as HTMLButtonElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
  }
  afterEach(() => {
    useWindows.setState({ windows: [], focusStack: [] } as never);
  });

  it('closing the window (unmount) tears the overlay down via receiverHide', async () => {
    const api = mkApi();
    await mountFocusedWithReceiver(api);
    api.receiverHide.mockClear();
    act(() => root.unmount());
    expect(api.receiverHide).toHaveBeenCalled();
  });

  it('losing focus (another window on top) hides the overlay', async () => {
    const api = mkApi();
    await mountFocusedWithReceiver(api);
    api.receiverPresent.mockClear();
    setWindows(['w1', 'w2'], [{ id: 'w1' }, { id: 'w2' }]);
    await act(async () => { await Promise.resolve(); });
    expect(api.receiverPresent.mock.calls.at(-1)![0]).toEqual({ visible: false });
  });

  it('minimizing the window hides the overlay', async () => {
    const api = mkApi();
    await mountFocusedWithReceiver(api);
    api.receiverPresent.mockClear();
    setWindows(['w1'], [{ id: 'w1', minimized: true }]);
    await act(async () => { await Promise.resolve(); });
    expect(api.receiverPresent.mock.calls.at(-1)![0]).toEqual({ visible: false });
  });
});
