// @vitest-environment jsdom
/**
 * TG5 — SOCMINT Telegram tab ↔ Telegram Hunter engine SEAM suite.
 *
 * The v3.24.2 / Plan-A hollow-renderer failure class: a handler passes its own unit
 * test, yet the renderer never invokes it (or omits a field), so the wired feature is
 * dead. This suite pins the seam directly — the SOCMINT Telegram tab must DRIVE the new
 * capture-window engine (connect / capture / members / export) with the correct payload.
 *
 * Two complementary parts, both against the genuine surfaces:
 *   A/C. Render `SocmintModule`, switch to the Telegram Capture tab, and drive the
 *        buttons — asserting each flows to `window.api.socmint.telegram.*` with the
 *        payload the handler needs (caseId + target channel for capture; caseId for
 *        members; caseId + format for export).
 *   B.   The real handlers (`captureTelegramMessages` / `captureTelegramMembers`) REJECT
 *        a payload missing a required field — establishing exactly which fields are
 *        load-bearing, which A then proves the renderer includes.
 *
 * The shared capture-window harness + Tor singleton are mocked so importing the real
 * handlers never constructs a BrowserWindow or touches Tor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../src/main/capture/capture-window', () => ({
  createCaptureWindow: vi.fn(async () => ({
    webContents: { setWebRTCIPHandlingPolicy: vi.fn(), executeJavaScript: vi.fn(async () => []) },
    isDestroyed: () => false,
    show: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
  })),
  assertTrustedSender: vi.fn(),
}));
vi.mock('../src/main/bgconn/tor-singleton', () => ({
  getBgTor: vi.fn(() => ({ isBootstrapped: () => true, socksPort: () => 9050 })),
}));

import { SocmintModule } from '../src/renderer/modules/socmint/SocmintModule';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';
import {
  captureTelegramMessages,
  captureTelegramMembers,
  captureTelegramProfile,
} from '../src/main/socmint/telegram-hunter/ipc';

const CASE_ID = 'case-1';
const VALID_UUID = '11111111-1111-4111-8111-111111111111';

let container: HTMLDivElement;
let root: Root;
let telegram: {
  connect: ReturnType<typeof vi.fn>;
  capture: ReturnType<typeof vi.fn>;
  captureMembers: ReturnType<typeof vi.fn>;
  captureProfile: ReturnType<typeof vi.fn>;
  exportItems: ReturnType<typeof vi.fn>;
  importExport: ReturnType<typeof vi.fn>;
  keywordScan: ReturnType<typeof vi.fn>;
};

function installApi(): void {
  telegram = {
    connect: vi.fn().mockResolvedValue({ opened: true }),
    capture: vi.fn().mockResolvedValue({ blocked: false, added: 0, skipped: 0, items: [] }),
    captureMembers: vi.fn().mockResolvedValue({ blocked: false, added: 0, captured: 0, members: [] }),
    captureProfile: vi.fn().mockResolvedValue({ blocked: false, added: 1, captured: 1, profiles: [] }),
    // Echo the requested format/collection back so the seam test can prove the renderer
    // drives them (not a hardcoded json/messages) and the download path stays exercised.
    exportItems: vi.fn(async (req: { format: string; collection?: string }) => ({
      format: req.format,
      collection: req.collection ?? 'messages',
      count: 0,
      encoding: 'utf8',
      data: req.format === 'json' ? '[]' : '',
      mime: req.format === 'csv' ? 'text/csv' : req.format === 'html' ? 'text/html' : 'application/json',
    })),
    importExport: vi.fn().mockResolvedValue({ canceled: false, name: 'result.json', itemCount: 3, setCount: 1 }),
    keywordScan: vi.fn().mockResolvedValue({
      rules: [{ term: 'wallet', addedAt: '2026-01-01T00:00:00.000Z' }],
      scanned: 5,
      matched: 2,
      matches: [],
    }),
  };
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    scrapingCases: { list: vi.fn().mockResolvedValue([]), create: vi.fn(), remove: vi.fn() },
    cases: { list: vi.fn().mockResolvedValue([]) },
    socmint: {
      listChannels: vi.fn().mockResolvedValue([]),
      listItems: vi.fn().mockResolvedValue([]),
      hasWhatsappBurner: vi.fn().mockResolvedValue(false),
      telegram,
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function buttonByText(scope: HTMLElement, re: RegExp): HTMLButtonElement {
  const btn = Array.from(scope.querySelectorAll('button')).find((b) => re.test(b.textContent ?? ''));
  if (!btn) throw new Error(`no button matching ${re}`);
  return btn as HTMLButtonElement;
}

function click(btn: HTMLButtonElement): Promise<void> {
  return act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function typeIntoTextarea(ta: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
  setter.call(ta, value);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function selectOption(sel: HTMLSelectElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  return act(async () => {
    setter.call(sel, value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function openCaptureTab(): Promise<HTMLElement> {
  await act(async () => { root.render(<SocmintModule caseId={CASE_ID} />); });
  await flush();
  await click(buttonByText(container, /capture/i));
  await flush();
  const panel = container.querySelector('.sm-tg-capture') as HTMLElement | null;
  if (!panel) throw new Error('no .sm-tg-capture panel rendered');
  return panel;
}

beforeEach(() => {
  installApi();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  useSettings.setState({ settings: { ...defaultSettings } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // jsdom lacks the Blob-download primitives the export path uses; stub them so the
  // click reaches window.api and the download never navigates the test document.
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:tg');
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSettings.setState({ settings: null });
  vi.restoreAllMocks();
});

// ---- A/C. the Telegram tab drives the new engine ----------------------

describe('seam A/C — the SOCMINT Telegram tab drives the Telegram Hunter engine', () => {
  it('Connect flows to window.api.socmint.telegram.connect()', async () => {
    const panel = await openCaptureTab();
    await click(buttonByText(panel, /connect|open telegram/i));
    expect(telegram.connect).toHaveBeenCalledTimes(1);
  });

  it('Capture Messages sends { caseId, channelId } (the v3.24.2-class field the bug would drop)', async () => {
    const panel = await openCaptureTab();
    typeInto(panel.querySelector('input') as HTMLInputElement, '@target');
    await click(buttonByText(panel, /capture messages/i));
    expect(telegram.capture).toHaveBeenCalledTimes(1);
    const payload = telegram.capture.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.caseId).toBe(CASE_ID);
    expect(payload.channelId).toBe('@target');
  });

  it('Capture Members sends { caseId }', async () => {
    const panel = await openCaptureTab();
    await click(buttonByText(panel, /capture members/i));
    expect(telegram.captureMembers).toHaveBeenCalledTimes(1);
    const payload = telegram.captureMembers.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.caseId).toBe(CASE_ID);
  });

  it('Export defaults to { caseId, format: json, collection: messages }', async () => {
    const panel = await openCaptureTab();
    await click(buttonByText(panel, /^export$/i));
    expect(telegram.exportItems).toHaveBeenCalledTimes(1);
    const payload = telegram.exportItems.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.caseId).toBe(CASE_ID);
    expect(payload.format).toBe('json');
    expect(payload.collection).toBe('messages');
  });

  it('the format selector drives CSV — the formula-guarded export is reachable', async () => {
    const panel = await openCaptureTab();
    const fmt = panel.querySelector('#sm-tg-export-format') as HTMLSelectElement;
    await selectOption(fmt, 'csv');
    await click(buttonByText(panel, /^export$/i));
    const payload = telegram.exportItems.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.format).toBe('csv');
    expect(payload.collection).toBe('messages');
  });

  it('the format selector drives HTML — the escaped report is reachable', async () => {
    const panel = await openCaptureTab();
    const fmt = panel.querySelector('#sm-tg-export-format') as HTMLSelectElement;
    await selectOption(fmt, 'html');
    await click(buttonByText(panel, /^export$/i));
    const payload = telegram.exportItems.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.format).toBe('html');
  });

  it('the collection selector drives members — not only messages', async () => {
    const panel = await openCaptureTab();
    const coll = panel.querySelector('#sm-tg-export-collection') as HTMLSelectElement;
    const fmt = panel.querySelector('#sm-tg-export-format') as HTMLSelectElement;

    await selectOption(coll, 'members');
    await selectOption(fmt, 'csv');
    await click(buttonByText(panel, /^export$/i));
    const payload = telegram.exportItems.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(payload.collection).toBe('members');
    expect(payload.format).toBe('csv');
  });

  it('Capture Profile flows to window.api.socmint.telegram.captureProfile({ caseId }) — captureProfile is reachable', async () => {
    const panel = await openCaptureTab();
    await click(buttonByText(panel, /capture profile/i));
    expect(telegram.captureProfile).toHaveBeenCalledTimes(1);
    const payload = telegram.captureProfile.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.caseId).toBe(CASE_ID);
  });

  it('the Profiles export option is now a REAL collection — export("profiles") is reachable', async () => {
    const panel = await openCaptureTab();
    const coll = panel.querySelector('#sm-tg-export-collection') as HTMLSelectElement;
    const values = Array.from(coll.querySelectorAll('option')).map((o) => o.value);
    expect(values).toEqual(['messages', 'members', 'profiles']);

    const fmt = panel.querySelector('#sm-tg-export-format') as HTMLSelectElement;
    await selectOption(coll, 'profiles');
    await selectOption(fmt, 'csv');
    await click(buttonByText(panel, /^export$/i));
    const payload = telegram.exportItems.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(payload.collection).toBe('profiles');
    expect(payload.format).toBe('csv');
  });

  it('Import flows to window.api.socmint.telegram.importExport({ caseId }) — parseTelegramExport is reachable', async () => {
    const panel = await openCaptureTab();
    await click(buttonByText(panel, /import json export/i));
    expect(telegram.importExport).toHaveBeenCalledTimes(1);
    const payload = telegram.importExport.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.caseId).toBe(CASE_ID);
  });

  it('Keyword scan sends { caseId, terms } (split on newline/comma) — matchKeywords is reachable', async () => {
    const panel = await openCaptureTab();
    const ta = panel.querySelector('#sm-tg-keywords') as HTMLTextAreaElement;
    typeIntoTextarea(ta, 'wallet drainer\nseed phrase, mixer');
    await click(buttonByText(panel, /add & scan|add &amp; scan|scan captured/i));
    expect(telegram.keywordScan).toHaveBeenCalledTimes(1);
    const payload = telegram.keywordScan.mock.calls[0][0] as { caseId: string; terms: string[] };
    expect(payload.caseId).toBe(CASE_ID);
    expect(payload.terms).toEqual(['wallet drainer', 'seed phrase', 'mixer']);
  });
});

// ---- honesty: the fake Telegram "Start Monitor" is gone -----------------

describe('honesty — the pull-only Telegram tab shows no fake background monitor', () => {
  it('the Telegram Channels tab offers NO "Start Monitor" (it never harvests in the background)', async () => {
    await act(async () => { root.render(<SocmintModule caseId={CASE_ID} />); });
    await flush();
    // Default platform is Telegram and the default tab is Channels — the monitor control lived here.
    const startBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      /start monitor/i.test(b.textContent ?? ''),
    );
    expect(startBtn).toBeUndefined();
    // and the honest pull-model pointer is shown instead of an active-job/stop-monitor state.
    expect(container.textContent ?? '').toMatch(/pull-based/i);
    expect(container.textContent ?? '').not.toMatch(/Active job:/i);
    const stopBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      /stop monitor/i.test(b.textContent ?? ''),
    );
    expect(stopBtn).toBeUndefined();
  });
});

// ---- B. the real handler rejects a payload missing a required field ----

describe('seam B — the real Telegram Hunter handlers require their fields', () => {
  it('captureTelegramMessages requires BOTH caseId and channelId', async () => {
    await expect(captureTelegramMessages({ caseId: VALID_UUID })).rejects.toThrow(/caseId and a target/i);
    await expect(captureTelegramMessages({ channelId: '@t' })).rejects.toThrow(/caseId and a target/i);
  });

  it('captureTelegramMembers requires a caseId', async () => {
    await expect(captureTelegramMembers({})).rejects.toThrow(/caseId/i);
  });

  it('captureTelegramProfile requires a caseId', async () => {
    await expect(captureTelegramProfile({})).rejects.toThrow(/caseId/i);
  });
});
