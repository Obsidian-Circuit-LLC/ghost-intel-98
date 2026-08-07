// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JournalModule } from '../src/renderer/modules/journal/JournalModule';
import type { JournalEntry, JournalEntrySummary } from '@shared/types';

let container: HTMLDivElement;
let root: Root;

const XSS_HTML = '<img src=x onerror=alert(1)>hi <a href="javascript:alert(1)">x</a>';
const LEGACY_ESCAPED_HTML = '<p>hello &lt;world&gt; &amp; friends</p>';

const ENTRIES: Record<string, JournalEntry> = {
  e1: {
    id: 'e1', title: 'XSS entry', blocks: [{ id: 'b1', kind: 'text', html: XSS_HTML }],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'
  },
  legacy1: {
    id: 'legacy1', title: 'Legacy entry', blocks: [{ id: 'b2', kind: 'text', html: LEGACY_ESCAPED_HTML }],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'
  }
};

const SUMMARIES: JournalEntrySummary[] = [
  { id: 'e1', title: 'XSS entry', updatedAt: '2026-01-01T00:00:00Z', bytes: 40 },
  { id: 'legacy1', title: 'Legacy entry', updatedAt: '2026-01-01T00:00:00Z', bytes: 30 }
];

function installApi(overrides: Partial<Record<string, unknown>> = {}): void {
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
      getAsset: vi.fn().mockResolvedValue({ mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA' }),
      ...overrides
    }
  };
}

beforeEach(() => {
  installApi();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

/** Drive from the locked PIN gate to 'open'. */
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

/** Open an entry by clicking its row in the left list. */
async function openEntry(id: string): Promise<void> {
  const span = Array.from(container.querySelectorAll('li span')).find(
    (el) => el.textContent === ENTRIES[id].title
  ) as HTMLElement;
  await act(async () => { span.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
}

/** Simulate a file pick on a <input type=file> the way a real selection would. */
function pickFile(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Journal block editor', () => {
  it('renders a TextBlock contentEditable body with B/I/U toolbar buttons', async () => {
    await unlock();
    const body = container.querySelector('.ga98-report-textblock-body');
    expect(body).toBeTruthy();
    expect(body?.getAttribute('contenteditable')).toBe('true');
    expect(container.querySelector('button[aria-label="Bold"]')).toBeTruthy();
    expect(container.querySelector('button[aria-label="Italic"]')).toBeTruthy();
    expect(container.querySelector('button[aria-label="Underline"]')).toBeTruthy();
  });

  it('read-side sanitizes a stored text block before display — no onerror, no javascript: href', async () => {
    await unlock();
    await openEntry('e1');
    const body = container.querySelector('.ga98-report-textblock-body') as HTMLElement;
    expect(body).toBeTruthy();
    expect(body.innerHTML).not.toContain('onerror');
    expect(body.innerHTML).not.toContain('javascript:');
    expect(body.querySelector('img')).toBeNull();
  });

  it('a legacy entry (blocks synthesized from a plain-text body) renders its text unchanged', async () => {
    await unlock();
    await openEntry('legacy1');
    const body = container.querySelector('.ga98-report-textblock-body') as HTMLElement;
    expect(body.textContent).toContain('hello <world> & friends');
  });

  it('"+ Photo" encrypts the picked bytes via putAsset and appends a rendered ImageBlock', async () => {
    await unlock();
    const input = container.querySelector('input[aria-label="Add photo"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'pic.png', { type: 'image/png' });
    await act(async () => { pickFile(input, file); });
    await flush();
    expect((window as any).api.journal.putAsset).toHaveBeenCalled();
    await vi.waitFor(() => {
      const img = container.querySelector('.ga98-report-imageblock-img') as HTMLImageElement | null;
      expect(img).toBeTruthy();
      expect(img?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    });
  });

  it('Save sends { id, title, blocks } to window.api.journal.save — no body string', async () => {
    await unlock();
    const saveBtn = Array.from(container.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Save')) as HTMLButtonElement;
    await act(async () => { saveBtn.click(); });
    await flush();
    expect((window as any).api.journal.save).toHaveBeenCalled();
    const arg = (window as any).api.journal.save.mock.calls[0][0];
    expect(arg).toHaveProperty('id');
    expect(arg).toHaveProperty('title');
    expect(arg).toHaveProperty('blocks');
    expect(arg).not.toHaveProperty('body');
    expect(Array.isArray(arg.blocks)).toBe(true);
  });
});
