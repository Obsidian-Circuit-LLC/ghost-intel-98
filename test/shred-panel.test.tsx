// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ShredModule } from '../src/renderer/modules/shred/ShredModule';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    shred: {
      list: vi.fn().mockResolvedValue([]),
      restore: vi.fn().mockResolvedValue(undefined),
      purge: vi.fn().mockResolvedValue(undefined),
      purgeAll: vi.fn().mockResolvedValue(undefined)
    }
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

describe('Shred banner + SHRED IT panel', () => {
  it('renders the shred banner, the ghost-bin art, and the SHRED IT copy', async () => {
    await act(async () => { root.render(<ShredModule />); });

    const banner = container.querySelector('img.ga98-module-banner') as HTMLImageElement | null;
    expect(banner).not.toBeNull();
    expect(banner!.getAttribute('src')).toMatch(/shred-banner/);

    const panelImg = container.querySelector('.ga98-shred-it-panel img') as HTMLImageElement | null;
    expect(panelImg).not.toBeNull();
    expect(panelImg!.getAttribute('src')).toMatch(/shred-ghost-bin/);

    expect(container.textContent).toContain('SHRED IT');
    expect(container.textContent).toContain('Delete it');
    expect(container.textContent).toContain('Forget it');
    expect(container.textContent).toContain('It never existed');
    expect(container.textContent).toContain("ONCE IT'S SHREDDED, IT'S GONE FOR GOOD");
  });
});
