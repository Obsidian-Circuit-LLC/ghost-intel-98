// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The prompt/confirm dialogs are the project's async dialogs (window.prompt is a no-op in Electron).
vi.mock('../src/renderer/state/dialogs', () => ({
  promptDialog: vi.fn().mockResolvedValue('New One'),
  confirmDialog: vi.fn().mockResolvedValue(true)
}));

import { MyDocumentsModule } from '../src/renderer/modules/my-documents/MyDocumentsModule';
import { promptDialog } from '../src/renderer/state/dialogs';
import { useWindows } from '../src/renderer/state/store';

const api = {
  list: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  copy: vi.fn().mockResolvedValue('X/a.txt'),
  move: vi.fn().mockResolvedValue('X/a.txt'),
  importDropped: vi.fn().mockResolvedValue({ imported: [], failures: [] }),
  reveal: vi.fn().mockResolvedValue(undefined),
  open: vi.fn().mockResolvedValue(undefined),
  export: vi.fn().mockResolvedValue(undefined)
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  api.list.mockReset().mockResolvedValue([
    { name: 'Folder A', kind: 'folder', size: 0, modifiedAt: '2026-07-06T00:00:00Z' },
    { name: 'note.txt', kind: 'file', size: 12, modifiedAt: '2026-07-06T00:00:00Z' }
  ]);
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    documents: api,
    files: { getPathForFile: vi.fn() },
    // vault OFF by default → no encryption banner
    auth: { status: vi.fn().mockResolvedValue({ enabled: false, unlocked: true }) }
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('MyDocumentsModule', () => {
  it('lists the root folder on mount', async () => {
    await act(async () => { root.render(<MyDocumentsModule />); });
    await flush();
    expect(api.list).toHaveBeenCalledWith('');
    expect(container.textContent).toContain('Folder A');
    expect(container.textContent).toContain('note.txt');
  });

  it('New Folder prompts, calls mkdir, then refreshes', async () => {
    (promptDialog as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('New One');
    await act(async () => { root.render(<MyDocumentsModule />); });
    await flush();
    const btn = [...container.querySelectorAll('button')].find((b) => /new folder/i.test(b.textContent ?? ''))!;
    await act(async () => { btn.click(); });
    await flush();
    expect(api.mkdir).toHaveBeenCalledWith('', 'New One');
    expect(api.list).toHaveBeenCalledTimes(2); // mount + post-mkdir refresh
  });

  it('Reveal calls the reveal API for the current folder', async () => {
    await act(async () => { root.render(<MyDocumentsModule />); });
    await flush();
    const btn = [...container.querySelectorAll('button')].find((b) => /reveal/i.test(b.textContent ?? ''))!;
    await act(async () => { btn.click(); });
    expect(api.reveal).toHaveBeenCalledWith('');
  });

  it('root breadcrumb returns to the top folder without freezing', async () => {
    await act(async () => { root.render(<MyDocumentsModule />); });
    await flush();
    // Descend into a subfolder so dir !== ''.
    const folder = [...container.querySelectorAll('.ga98-mydocs-tile')]
      .find((el) => /Folder A/.test(el.textContent ?? ''))!;
    await act(async () => { folder.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    await flush();
    expect(api.list).toHaveBeenLastCalledWith('Folder A');
    // Click the "My Documents" root breadcrumb — must synchronously return, not spin.
    const crumb = [...container.querySelectorAll('a')]
      .find((a) => /my documents/i.test(a.textContent ?? ''))!;
    await act(async () => { crumb.click(); });
    await flush();
    expect(api.list).toHaveBeenLastCalledWith('');
  });

  it('shows the encryption banner when the vault is enabled', async () => {
    (window.api.auth.status as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ enabled: true, unlocked: true });
    await act(async () => { root.render(<MyDocumentsModule />); });
    await flush();
    expect(container.textContent).toMatch(/encrypted at rest/i);
  });

  it('hides the encryption banner when the vault is disabled', async () => {
    // beforeEach stubs auth.status → { enabled: false } (vault off); the banner must be absent.
    await act(async () => { root.render(<MyDocumentsModule />); });
    await flush();
    expect(container.textContent).not.toMatch(/encrypted at rest/i);
  });

  it('double-clicking a file opens it in the internal viewer (not an OS handoff)', async () => {
    const openSpy = vi.spyOn(useWindows.getState(), 'open').mockReturnValue('win-1');
    api.list.mockResolvedValue([{ name: 'a.pdf', kind: 'file', size: 3, modifiedAt: 'x' }]);
    await act(async () => { root.render(<MyDocumentsModule />); });
    await flush();
    const tile = container.querySelector('.ga98-mydocs-tile') as HTMLElement;
    await act(async () => { tile.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    // Never OS-launched — encrypted-at-rest files stay in-process.
    expect(api.open).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith(expect.objectContaining({
      module: 'doc-viewer',
      props: { source: 'documents', relPath: 'a.pdf', name: 'a.pdf' }
    }));
    openSpy.mockRestore();
  });

  it('context menu lists New Folder first, Paste under Cut, Open/Export files-only', async () => {
    api.list.mockResolvedValue([{ name: 'a.pdf', kind: 'file', size: 3, modifiedAt: 'x' }]);
    await act(async () => { root.render(<MyDocumentsModule />); });
    await flush();
    const tile = container.querySelector('.ga98-mydocs-tile') as HTMLElement;
    await act(async () => { tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 })); });
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((n) => n.textContent);
    expect(labels[0]).toBe('New Folder');
    expect(labels).toEqual(['New Folder', 'Open', 'Rename', 'Delete', 'Copy', 'Cut', 'Paste', 'Export…']);
  });

  it('omits Open and Export for a folder (files-only)', async () => {
    api.list.mockResolvedValue([{ name: 'sub', kind: 'folder', size: 0, modifiedAt: 'x' }]);
    await act(async () => { root.render(<MyDocumentsModule />); });
    await flush();
    const tile = container.querySelector('.ga98-mydocs-tile') as HTMLElement;
    await act(async () => { tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 })); });
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((n) => n.textContent);
    expect(labels).toEqual(['New Folder', 'Rename', 'Delete', 'Copy', 'Cut', 'Paste']);
    expect(labels).not.toContain('Open');
    expect(labels).not.toContain('Export…');
  });
});
