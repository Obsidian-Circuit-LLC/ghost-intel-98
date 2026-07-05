// @vitest-environment jsdom
/**
 * Task 4: useClearnetLinkOpener — the one-time clearnet-ack open policy for Q-reply links.
 *
 * Opening a link from Q's replies launches the OS default browser over the clearnet
 * (real IP, not Tor). The FIRST open shows a one-time confirmDialog; acknowledging patches
 * ai.linkClearnetAcknowledged=true, after which opens go straight through.
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act() against a
 * jsdom container, mirroring x-ghostscrape-cases-sidebar.test.tsx. The hook is rendered in a
 * tiny harness that captures the returned openLink() so the test can invoke it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  useClearnetLinkOpener,
  CLEARNET_LINK_TEXT,
} from '../src/renderer/modules/ai-assistant/useClearnetLinkOpener';
import { useSettings } from '../src/renderer/state/store';
import { confirmDialog } from '../src/renderer/state/dialogs';
import { defaultSettings, type AppSettings } from '@shared/types';

vi.mock('../src/renderer/state/dialogs', () => ({
  confirmDialog: vi.fn(),
}));
const confirmDialogMock = vi.mocked(confirmDialog);

const URL_1 = 'https://example.com/a';

let container: HTMLDivElement;
let root: Root;
let openExternal: ReturnType<typeof vi.fn>;
let settingsUpdate: ReturnType<typeof vi.fn>;
/** Captured from the hook by the harness render. */
let openLink: (safeUrl: string) => void;

function Harness(): null {
  openLink = useClearnetLinkOpener();
  return null;
}

function installApi(): void {
  openExternal = vi.fn().mockResolvedValue(undefined);
  // The store's patch() calls window.api.settings.update and stores the result.
  settingsUpdate = vi.fn().mockImplementation(async (p: Partial<AppSettings>) => {
    const cur = useSettings.getState().settings as AppSettings;
    return { ...cur, ...p, ai: { ...cur.ai, ...p.ai } };
  });
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    system: { openExternal },
    settings: { update: settingsUpdate },
  };
}

function setAck(acknowledged: boolean): void {
  useSettings.setState({
    settings: {
      ...defaultSettings,
      ai: { ...defaultSettings.ai, linkClearnetAcknowledged: acknowledged },
    },
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  installApi();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSettings.setState({ settings: null });
  vi.restoreAllMocks();
  confirmDialogMock.mockReset();
});

describe('useClearnetLinkOpener (Task 4)', () => {
  it('acknowledged → opens directly via openExternal, no confirmDialog', async () => {
    setAck(true);
    await act(async () => { root.render(<Harness />); });
    await flush();

    await act(async () => { openLink(URL_1); });
    await flush();

    expect(confirmDialogMock).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith(URL_1);
  });

  it('not acknowledged + confirm → patches flag true AND opens', async () => {
    setAck(false);
    confirmDialogMock.mockResolvedValue(true);
    await act(async () => { root.render(<Harness />); });
    await flush();

    await act(async () => { openLink(URL_1); });
    await flush();

    expect(confirmDialogMock).toHaveBeenCalledWith(
      CLEARNET_LINK_TEXT,
      'Open link in clearnet browser?',
    );
    // patch() routes through window.api.settings.update with the flag flipped true.
    expect(settingsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ ai: expect.objectContaining({ linkClearnetAcknowledged: true }) }),
    );
    expect(openExternal).toHaveBeenCalledWith(URL_1);
  });

  it('not acknowledged + cancel → neither patch nor open', async () => {
    setAck(false);
    confirmDialogMock.mockResolvedValue(false);
    await act(async () => { root.render(<Harness />); });
    await flush();

    await act(async () => { openLink(URL_1); });
    await flush();

    expect(confirmDialogMock).toHaveBeenCalledWith(
      CLEARNET_LINK_TEXT,
      'Open link in clearnet browser?',
    );
    expect(settingsUpdate).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('exports the clearnet warning copy', () => {
    expect(CLEARNET_LINK_TEXT).toMatch(/clearnet/i);
    expect(CLEARNET_LINK_TEXT).toMatch(/real IP/i);
  });
});
