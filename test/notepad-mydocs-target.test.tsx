// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../src/renderer/state/dialogs', () => ({
  confirmDialog: vi.fn().mockResolvedValue(true)
}));

const { toastWarn, toastInfo, toastSuccess, toastError } = vi.hoisted(() => ({
  toastWarn: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn()
}));
vi.mock('../src/renderer/state/toasts', () => ({
  toast: { info: toastInfo, success: toastSuccess, warn: toastWarn, error: toastError }
}));

import { NotepadModule } from '../src/renderer/modules/notepad/NotepadModule';

const casesApi = {
  list: vi.fn()
};
const notesApi = {
  list: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  delete: vi.fn()
};
const briefcaseApi = {
  list: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  delete: vi.fn()
};
const documentsApi = {
  writeText: vi.fn().mockResolvedValue({ name: 'untitled.txt', kind: 'file', size: 0, modifiedAt: '2026-07-07T00:00:00Z' }),
  readText: vi.fn()
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  casesApi.list.mockReset().mockResolvedValue([]);
  notesApi.list.mockReset().mockResolvedValue([]);
  notesApi.read.mockReset();
  notesApi.write.mockReset();
  notesApi.delete.mockReset();
  briefcaseApi.list.mockReset().mockResolvedValue([]);
  briefcaseApi.read.mockReset();
  briefcaseApi.save.mockReset();
  briefcaseApi.delete.mockReset();
  documentsApi.writeText.mockClear().mockResolvedValue({ name: 'untitled.txt', kind: 'file', size: 0, modifiedAt: '2026-07-07T00:00:00Z' });
  documentsApi.readText.mockReset();
  toastWarn.mockClear();
  toastInfo.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    cases: casesApi,
    notes: notesApi,
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

function render(): void {
  act(() => {
    root.render(<NotepadModule initialCaseId={null} />);
  });
}

function typeInto(el: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('NotepadModule — Save to My Documents target', () => {
  it('saves the body to My Documents when the My Documents target is selected', async () => {
    render();
    await flush();

    const select = container.querySelector('select.ga98-text') as HTMLSelectElement;
    act(() => {
      select.value = '__mydocs__';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    act(() => { typeInto(textarea, 'field notes'); });
    await flush();

    const saveBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save')!;
    act(() => { saveBtn.click(); });
    await flush();

    expect(documentsApi.writeText).toHaveBeenCalledWith('', 'untitled.txt', 'field notes');
  });

  it('warns and does not call writeText when (no case) is selected', async () => {
    render();
    await flush();

    const saveBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save')!;
    act(() => { saveBtn.click(); });
    await flush();

    expect(documentsApi.writeText).not.toHaveBeenCalled();
    expect(toastWarn).toHaveBeenCalled();
  });
});
