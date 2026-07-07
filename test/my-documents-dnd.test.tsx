// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The prompt/confirm dialogs are the project's async dialogs (window.prompt is a no-op in Electron).
vi.mock('../src/renderer/state/dialogs', () => ({
  promptDialog: vi.fn().mockResolvedValue('New One'),
  confirmDialog: vi.fn().mockResolvedValue(true)
}));

const { toastWarn } = vi.hoisted(() => ({ toastWarn: vi.fn() }));
vi.mock('../src/renderer/state/toasts', () => ({
  toast: { info: vi.fn(), success: vi.fn(), warn: toastWarn, error: vi.fn() }
}));

import { MyDocumentsModule } from '../src/renderer/modules/my-documents/MyDocumentsModule';

const GA98_ITEM = 'application/x-ga98-item';

// jsdom does not implement DataTransfer/DragEvent — provide a minimal stand-in and attach it
// to a plain Event so React's synthetic drag handlers (which just read `nativeEvent.dataTransfer`)
// see the same shape a real browser would give them.
class FakeDataTransfer {
  private store = new Map<string, string>();
  types: string[] = [];
  setData(type: string, value: string): void {
    this.store.set(type, value);
    if (!this.types.includes(type)) this.types.push(type);
  }
  getData(type: string): string {
    return this.store.get(type) ?? '';
  }
}

function dragEvent(type: string, dataTransfer: FakeDataTransfer): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer, enumerable: true });
  return ev;
}

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
  export: vi.fn().mockResolvedValue(undefined),
  writeText: vi.fn().mockResolvedValue({ name: 'todo.txt', kind: 'file', size: 9, modifiedAt: '2026-07-06T00:00:00Z' })
};

const briefcaseApi = {
  read: vi.fn()
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  api.list.mockReset().mockResolvedValue([
    { name: 'Folder A', kind: 'folder', size: 0, modifiedAt: '2026-07-06T00:00:00Z' },
    { name: 'note.txt', kind: 'file', size: 12, modifiedAt: '2026-07-06T00:00:00Z' }
  ]);
  briefcaseApi.read.mockReset();
  toastWarn.mockClear();
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    documents: api,
    briefcase: briefcaseApi,
    files: { getPathForFile: vi.fn() },
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

function findTile(name: string): HTMLElement {
  const tiles = [...container.querySelectorAll<HTMLElement>('.ga98-mydocs-tile')];
  return tiles.find((t) => t.title === name)!;
}

describe('MyDocumentsModule drag-and-drop (in-folder move)', () => {
  it('a file tile is draggable', async () => {
    await act(async () => { root.render(<MyDocumentsModule />); });
    await flush();
    const tile = findTile('note.txt');
    expect(tile.getAttribute('draggable')).toBe('true');
  });

  it('dragging a file sets the ga98 item payload', async () => {
    await act(async () => { root.render(<MyDocumentsModule />); });
    await flush();
    const tile = findTile('note.txt');
    const dt = new FakeDataTransfer();
    await act(async () => { tile.dispatchEvent(dragEvent('dragstart', dt)); });
    expect(dt.getData(GA98_ITEM)).toBe(JSON.stringify({ src: 'docs', relPath: 'note.txt', name: 'note.txt', kind: 'file' }));
  });

  it('dropping a docs payload onto a folder tile moves the file into it', async () => {
    await act(async () => { root.render(<MyDocumentsModule />); });
    await flush();
    const folderTile = findTile('Folder A');
    const dt = new FakeDataTransfer();
    dt.setData(GA98_ITEM, JSON.stringify({ src: 'docs', relPath: 'note.txt', name: 'note.txt', kind: 'file' }));
    await act(async () => { folderTile.dispatchEvent(dragEvent('drop', dt)); });
    expect(api.move).toHaveBeenCalledWith('note.txt', 'Folder A');
  });
});

describe('MyDocumentsModule drag-and-drop (cross-module, Briefcase → My Documents)', () => {
  it('dropping a briefcase payload writes a text note into the current folder', async () => {
    briefcaseApi.read.mockResolvedValue({ id: 'b1', name: 'todo', body: 'buy milk', updatedAt: '2026-07-06T00:00:00Z' });
    await act(async () => { root.render(<MyDocumentsModule />); });
    await flush();
    const view = container.querySelector('.ga98-mydocs-view') as HTMLElement;
    const dt = new FakeDataTransfer();
    dt.setData(GA98_ITEM, JSON.stringify({ src: 'briefcase', id: 'b1', name: 'todo' }));
    await act(async () => { view.dispatchEvent(dragEvent('drop', dt)); });
    expect(briefcaseApi.read).toHaveBeenCalledWith('b1');
    expect(api.writeText).toHaveBeenCalledWith('', 'todo.txt', 'buy milk');
  });

  it('a stale/deleted briefcase note (read resolves null) surfaces a warn toast and does not write', async () => {
    briefcaseApi.read.mockResolvedValue(null);
    await act(async () => { root.render(<MyDocumentsModule />); });
    await flush();
    const view = container.querySelector('.ga98-mydocs-view') as HTMLElement;
    const dt = new FakeDataTransfer();
    dt.setData(GA98_ITEM, JSON.stringify({ src: 'briefcase', id: 'gone', name: 'todo' }));
    await act(async () => { view.dispatchEvent(dragEvent('drop', dt)); });
    expect(briefcaseApi.read).toHaveBeenCalledWith('gone');
    expect(api.writeText).not.toHaveBeenCalled();
    expect(toastWarn).toHaveBeenCalledTimes(1);
  });

  it('a briefcase read that rejects surfaces a warn toast and does not write', async () => {
    briefcaseApi.read.mockRejectedValue(new Error('Briefcase note unavailable.'));
    await act(async () => { root.render(<MyDocumentsModule />); });
    await flush();
    const view = container.querySelector('.ga98-mydocs-view') as HTMLElement;
    const dt = new FakeDataTransfer();
    dt.setData(GA98_ITEM, JSON.stringify({ src: 'briefcase', id: 'b1', name: 'todo' }));
    await act(async () => { view.dispatchEvent(dragEvent('drop', dt)); });
    expect(briefcaseApi.read).toHaveBeenCalledWith('b1');
    expect(api.writeText).not.toHaveBeenCalled();
    expect(toastWarn).toHaveBeenCalledWith('Briefcase note unavailable.');
  });
});
