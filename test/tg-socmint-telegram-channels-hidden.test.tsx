// @vitest-environment jsdom
/**
 * Telegram is PULL-only (visible-DOM capture in the Tor window) — there is no
 * `startMonitor`, and nothing consumes a "Monitored Channels" list for it. Rendering the
 * Channels list + Add-Channel form for Telegram is a monitor-framed UI that monitors
 * nothing (a fake-affordance honesty defect). This suite pins that the Telegram Channels
 * tab renders NO Add-Channel / monitor control, while WhatsApp keeps it unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { SocmintModule } from '../src/renderer/modules/socmint/SocmintModule';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';

const CASE_ID = 'case-1';

let container: HTMLDivElement;
let root: Root;

function installApi(): void {
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    scrapingCases: { list: vi.fn().mockResolvedValue([]), create: vi.fn(), remove: vi.fn() },
    cases: { list: vi.fn().mockResolvedValue([]) },
    socmint: {
      listChannels: vi.fn().mockResolvedValue([]),
      listItems: vi.fn().mockResolvedValue([]),
      hasWhatsappBurner: vi.fn().mockResolvedValue(false),
      telegram: {
        connect: vi.fn(),
        capture: vi.fn(),
        captureMembers: vi.fn(),
        captureProfile: vi.fn(),
        exportItems: vi.fn(),
        importExport: vi.fn(),
        keywordScan: vi.fn(),
      },
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function click(btn: HTMLButtonElement): Promise<void> {
  return act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

function buttonByText(scope: HTMLElement, re: RegExp): HTMLButtonElement {
  const btn = Array.from(scope.querySelectorAll('button')).find((b) => re.test(b.textContent ?? ''));
  if (!btn) throw new Error(`no button matching ${re}`);
  return btn as HTMLButtonElement;
}

beforeEach(() => {
  installApi();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  useSettings.setState({ settings: { ...defaultSettings } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSettings.setState({ settings: null });
  vi.restoreAllMocks();
});

async function render(): Promise<void> {
  await act(async () => { root.render(<SocmintModule caseId={CASE_ID} />); });
  await flush();
}

describe('SOCMINT Telegram tab — no dead Monitored-Channels UI', () => {
  it('renders NO Add-Channel / monitor control on the Telegram Channels tab', async () => {
    await render(); // defaults to platform=telegram, tab=channels
    // The Add-Channel input and its "Add Channel" button must not exist for Telegram.
    expect(container.querySelector('#sm-ch-id')).toBeNull();
    const addBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      /add\s+(channel|group)/i.test(b.textContent ?? ''),
    );
    expect(addBtn).toBeUndefined();
  });

  it('KEEPS the Add-Channel/monitor affordance for WhatsApp (unchanged)', async () => {
    await render();
    // Switch to WhatsApp and back to the Channels tab — the affordance must be present.
    await click(buttonByText(container, /whatsapp/i));
    await flush();
    expect(container.querySelector('#sm-ch-id')).not.toBeNull();
    const addBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      /add\s+group/i.test(b.textContent ?? ''),
    );
    expect(addBtn).toBeDefined();
  });
});
