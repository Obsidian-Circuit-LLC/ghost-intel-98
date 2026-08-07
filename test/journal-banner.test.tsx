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

describe('Journal Jots editor banner', () => {
  it('is absent while the PIN gate is locked', async () => {
    await act(async () => { root.render(<JournalModule />); });
    await flush();
    expect(container.querySelector('img.ga98-module-banner')).toBeNull();
    // sanity: we are actually on the locked PIN screen
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('renders the journal banner as the first header element once unlocked', async () => {
    await act(async () => { root.render(<JournalModule />); });
    await flush();
    const pinInput = container.querySelector('input[type="password"]') as HTMLInputElement;
    await act(async () => {
      pinInput.dispatchEvent(new Event('focus'));
    });
    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      nativeSetter.call(pinInput, '1234');
      pinInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();

    const img = container.querySelector('img.ga98-module-banner') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toMatch(/journal-jots-banner/);
    expect(img!.getAttribute('alt')).toBe('Journal Jots');
  });
});
