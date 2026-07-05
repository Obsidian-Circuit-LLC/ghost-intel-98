// @vitest-environment jsdom
/**
 * Task 6: XCollector accounts picker — label + status, sends accountId.
 *
 * The account <select> must list stored SESSIONS by human LABEL (with a status
 * hint, e.g. "· expired") via window.api.x.listSessions() — NOT raw account IDs.
 * Each option's value stays the opaque accountId, and starting a collect must
 * carry the SELECTED accountId in the IPC request.
 *
 * This is the renderer↔main seam guard from [[socmint-collect-path-wiring-v3.24.2]]:
 * a picker that renders labels but forgets to thread the accountId would run an
 * anonymous (logged-out) harvest that silently returns nothing. The second test
 * pins the accountId onto the exact collect request.
 *
 * No @testing-library — drive React 18's createRoot inside act(), mirroring
 * test/x-ghostscrape-cases-sidebar.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { XCollectorModule } from '../src/renderer/modules/x/XCollectorModule';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';
import type { XSessionMeta } from '@shared/ipc-contracts';

const SESSIONS: XSessionMeta[] = [
  { accountId: 'uuid-alpha', label: 'Alpha burner', status: 'valid', handle: 'alpha_ops' },
  { accountId: 'uuid-bravo', label: 'Bravo burner', status: 'expired', username: 'bravo' },
];

let container: HTMLDivElement;
let root: Root;
let listSessions: ReturnType<typeof vi.fn>;
let collect: ReturnType<typeof vi.fn>;
let listItems: ReturnType<typeof vi.fn>;

function installApi(): void {
  listSessions = vi.fn().mockResolvedValue([...SESSIONS]);
  collect = vi.fn().mockResolvedValue({
    status: 'done', itemsAdded: 0, itemsSkipped: 0, totalFromSidecar: 0, jobId: 'job-1',
  });
  listItems = vi.fn().mockResolvedValue([]);
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    scrapingCases: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'x', name: 'x', createdAt: 0, updatedAt: 0 }),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    cases: { list: vi.fn().mockResolvedValue([]) },
    x: {
      listSessions,
      listAccounts: vi.fn().mockResolvedValue([]),
      collect,
      listItems,
      rankItems: vi.fn().mockResolvedValue([]),
    },
    socmint: { recordLabel: vi.fn().mockResolvedValue(undefined) },
  };
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function accountSelect(): HTMLSelectElement {
  const el = container.querySelector('#xc-account');
  if (!el) throw new Error('no #xc-account select rendered');
  return el as HTMLSelectElement;
}

/** The Collect *submit* button (xc-btn-primary) — distinct from the "Collect" tab button. */
function collectButton(): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button.xc-btn-primary'))
    .find((b) => /^collect/i.test(b.textContent ?? ''));
  if (!btn) throw new Error('no Collect submit button');
  return btn as HTMLButtonElement;
}

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function selectValue(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  setter.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  installApi();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // Gate open: authenticated X collection enabled + acknowledged.
  useSettings.setState({
    settings: { ...defaultSettings, x: { ...defaultSettings.x, networkEnabled: true, clearnetAcknowledged: true } },
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSettings.setState({ settings: null });
  vi.restoreAllMocks();
});

describe('XCollector account picker (Task 6)', () => {
  it('lists sessions by label with a status hint from listSessions()', async () => {
    // caseId prop skips the sidebar and renders the collect panel directly.
    await act(async () => { root.render(<XCollectorModule caseId="case-1" />); });
    await flush();

    expect(listSessions).toHaveBeenCalled();

    const options = Array.from(accountSelect().querySelectorAll('option'));
    const values = options.map((o) => o.value);
    expect(values).toContain('uuid-alpha');
    expect(values).toContain('uuid-bravo');

    const text = accountSelect().textContent ?? '';
    // Human label, not the opaque accountId.
    expect(text).toContain('Alpha burner');
    expect(text).toContain('Bravo burner');
    // Status hint for a non-valid session.
    expect(text).toContain('expired');
    // The raw UUID must NOT be the visible label.
    expect(text).not.toContain('uuid-alpha');
  });

  it('sends the SELECTED accountId in the collect request (seam guard)', async () => {
    await act(async () => { root.render(<XCollectorModule caseId="case-1" />); });
    await flush();

    // Pick the second session explicitly.
    await act(async () => { selectValue(accountSelect(), 'uuid-bravo'); });
    await flush();

    // Provide a search query so the collect gate opens.
    await act(async () => {
      typeInto(container.querySelector('#xc-query') as HTMLInputElement, 'nightfall');
    });
    await flush();

    await act(async () => {
      collectButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(collect).toHaveBeenCalledTimes(1);
    expect(collect.mock.calls[0][0]).toMatchObject({ accountId: 'uuid-bravo' });
  });
});
