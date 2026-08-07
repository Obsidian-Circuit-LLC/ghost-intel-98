// @vitest-environment jsdom
/**
 * Task 4: hyperlinks inside a journal text block open ONLY through the scheme-guarded external
 * opener (window.api.system.openExternal via useClearnetLinkOpener), never as in-app navigation.
 *
 * TextBlock's contentEditable body is raw DOM (dangerouslySetInnerHTML), so anchor clicks are
 * caught with a delegated click handler on the editor container, not a per-anchor React onClick.
 * A javascript:-scheme href never reaches this point at all — sanitizeReportHtml (write AND the
 * read-side pass in JournalModule) already strips it, so no anchor exists to click.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JournalModule } from '../src/renderer/modules/journal/JournalModule';
import { useSettings } from '../src/renderer/state/store';
import type { JournalEntry, JournalEntrySummary } from '@shared/types';
import { defaultSettings } from '@shared/types';

let container: HTMLDivElement;
let root: Root;
let openExternal: ReturnType<typeof vi.fn>;

const LINK_HTML = '<a href="https://example.com">go</a>';
const JS_HTML = '<a href="javascript:alert(1)">bad</a>';

const ENTRIES: Record<string, JournalEntry> = {
  linked: {
    id: 'linked', title: 'Linked entry', blocks: [{ id: 'b1', kind: 'text', html: LINK_HTML }],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'
  },
  jsonly: {
    id: 'jsonly', title: 'JS-scheme entry', blocks: [{ id: 'b2', kind: 'text', html: JS_HTML }],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'
  }
};

const SUMMARIES: JournalEntrySummary[] = [
  { id: 'linked', title: 'Linked entry', updatedAt: '2026-01-01T00:00:00Z', bytes: 40 },
  { id: 'jsonly', title: 'JS-scheme entry', updatedAt: '2026-01-01T00:00:00Z', bytes: 40 }
];

function installApi(): void {
  openExternal = vi.fn().mockResolvedValue(undefined);
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    journal: {
      hasPin: vi.fn().mockResolvedValue(true),
      verifyPin: vi.fn().mockResolvedValue(true),
      setPin: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue(SUMMARIES),
      read: vi.fn(async (id: string) => ENTRIES[id] ?? null),
      save: vi.fn(async (input: unknown) => ({
        ...(input as { id: string; title: string; blocks: unknown }),
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z'
      })),
      delete: vi.fn().mockResolvedValue(undefined),
      changePin: vi.fn().mockResolvedValue(true),
      putAsset: vi.fn().mockResolvedValue('new-asset.png'),
      getAsset: vi.fn().mockResolvedValue(null)
    },
    system: { openExternal },
    settings: { update: vi.fn().mockResolvedValue(undefined) }
  };
  // Already acknowledged the clearnet-open warning — isolates this test to the click→open wiring,
  // the ack-dialog flow itself is covered by use-clearnet-link-opener.test.tsx.
  useSettings.setState({
    settings: { ...defaultSettings, ai: { ...defaultSettings.ai, linkClearnetAcknowledged: true } }
  });
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

async function unlock(): Promise<void> {
  await act(async () => { root.render(<JournalModule />); });
  await flush();
  const pinInput = container.querySelector('input[type="password"]') as HTMLInputElement;
  await act(async () => {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    nativeSetter.call(pinInput, '1234');
    pinInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const form = container.querySelector('form') as HTMLFormElement;
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await flush();
}

async function openEntry(id: string): Promise<void> {
  const span = Array.from(container.querySelectorAll('li span')).find(
    (el) => el.textContent === ENTRIES[id].title
  ) as HTMLElement;
  await act(async () => { span.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
}

beforeEach(() => {
  installApi();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

describe('Journal hyperlinks open via the guarded external opener', () => {
  it('clicking an http(s) link calls window.api.system.openExternal and prevents default navigation', async () => {
    await unlock();
    await openEntry('linked');
    const anchor = container.querySelector('a[href="https://example.com"]') as HTMLAnchorElement;
    expect(anchor).toBeTruthy();
    let defaultPrevented = false;
    await act(async () => {
      const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
      defaultPrevented = !anchor.dispatchEvent(evt) || evt.defaultPrevented;
    });
    expect(defaultPrevented).toBe(true);
    expect(openExternal).toHaveBeenCalledWith('https://example.com');
  });

  it('a javascript:-scheme href never reaches openExternal — sanitize already stripped the anchor', async () => {
    await unlock();
    await openEntry('jsonly');
    const body = container.querySelector('.ga98-report-textblock-body') as HTMLElement;
    expect(body.innerHTML).not.toContain('javascript:');
    expect(container.querySelector('a[href]')).toBeNull();
    // Clicking the block body (no anchor present) must not call openExternal.
    await act(async () => {
      body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(openExternal).not.toHaveBeenCalled();
  });
});
