// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../src/renderer/state/dialogs', () => ({
  confirmDialog: vi.fn().mockResolvedValue(true)
}));

const { toastWarn } = vi.hoisted(() => ({ toastWarn: vi.fn() }));
vi.mock('../src/renderer/state/toasts', () => ({
  toast: { info: vi.fn(), success: vi.fn(), warn: toastWarn, error: vi.fn() }
}));

import { BriefcaseModule } from '../src/renderer/modules/briefcase/BriefcaseModule';

const GA98_ITEM = 'application/x-ga98-item';

// jsdom does not implement DataTransfer/DragEvent — same minimal stand-in as my-documents-dnd.
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

const briefcaseApi = {
  list: vi.fn(),
  read: vi.fn(),
  save: vi.fn().mockResolvedValue({ id: 'new-id', name: 'note', body: 'x', updatedAt: '2026-07-06T00:00:00Z', bytes: 1 }),
  delete: vi.fn().mockResolvedValue(undefined)
};

const documentsApi = {
  readText: vi.fn()
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  briefcaseApi.list.mockReset().mockResolvedValue([
    { id: 'n1', name: 'todo', updatedAt: '2026-07-06T00:00:00Z', bytes: 12 }
  ]);
  briefcaseApi.read.mockReset();
  briefcaseApi.save.mockClear();
  documentsApi.readText.mockReset();
  toastWarn.mockClear();
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    briefcase: briefcaseApi,
    documents: documentsApi
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

function findNoteTile(name: string): HTMLElement {
  const items = [...container.querySelectorAll<HTMLElement>('.ga98-list li')];
  return items.find((li) => li.textContent?.includes(name))!;
}

describe('BriefcaseModule drag-and-drop (cross-module, My Documents ↔ Briefcase)', () => {
  it('a note tile is draggable and sets the briefcase payload', async () => {
    await act(async () => { root.render(<BriefcaseModule />); });
    await flush();
    const tile = findNoteTile('todo');
    expect(tile.getAttribute('draggable')).toBe('true');
    const dt = new FakeDataTransfer();
    await act(async () => { tile.dispatchEvent(dragEvent('dragstart', dt)); });
    expect(dt.getData(GA98_ITEM)).toBe(JSON.stringify({ src: 'briefcase', id: 'n1', name: 'todo' }));
  });

  it('dropping a docs text payload reads it and saves it as a briefcase note', async () => {
    documentsApi.readText.mockResolvedValue('buy milk');
    await act(async () => { root.render(<BriefcaseModule />); });
    await flush();
    const list = container.querySelector('.ga98-list') as HTMLElement;
    const dt = new FakeDataTransfer();
    dt.setData(GA98_ITEM, JSON.stringify({ src: 'docs', relPath: 'notes/todo.txt', name: 'todo', kind: 'file' }));
    await act(async () => { list.dispatchEvent(dragEvent('drop', dt)); });
    expect(documentsApi.readText).toHaveBeenCalledWith('notes/todo.txt');
    expect(briefcaseApi.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'todo', body: 'buy milk' }));
  });

  it('a docs payload whose readText rejects surfaces a warn toast and does not save', async () => {
    documentsApi.readText.mockRejectedValue(new Error('Only text notes can be moved this way.'));
    await act(async () => { root.render(<BriefcaseModule />); });
    await flush();
    const list = container.querySelector('.ga98-list') as HTMLElement;
    const dt = new FakeDataTransfer();
    dt.setData(GA98_ITEM, JSON.stringify({ src: 'docs', relPath: 'notes/photo.png', name: 'photo', kind: 'file' }));
    await act(async () => { list.dispatchEvent(dragEvent('drop', dt)); });
    expect(documentsApi.readText).toHaveBeenCalledWith('notes/photo.png');
    expect(briefcaseApi.save).not.toHaveBeenCalled();
    expect(toastWarn).toHaveBeenCalledWith('Only text notes can be moved this way.');
  });
});
