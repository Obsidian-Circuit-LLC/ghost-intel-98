// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JournalModule } from '../src/renderer/modules/journal/JournalModule';

let container: HTMLDivElement;
let root: Root;

function installApi(): void {
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    journal: {
      hasPin: vi.fn().mockResolvedValue(true),
      verifyPin: vi.fn().mockResolvedValue(true),
      setPin: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      read: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue({ id: 'x', title: 't', body: 'b', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }),
      delete: vi.fn().mockResolvedValue(undefined),
      changePin: vi.fn().mockResolvedValue(true)
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

describe('Journal Jots unlock relayout', () => {
  it('shows the PIN field and the book illustration on the locked gate, honesty copy intact', async () => {
    await act(async () => { root.render(<JournalModule />); });
    await flush();

    const pinInput = container.querySelector('input[type="password"]');
    expect(pinInput).not.toBeNull();

    const bookImg = Array.from(container.querySelectorAll('img')).find((img) =>
      (img.getAttribute('src') ?? '').match(/journal-jots-book/)
    );
    expect(bookImg).not.toBeUndefined();

    expect(container.textContent).toMatch(/convenience gate/);
  });
});
