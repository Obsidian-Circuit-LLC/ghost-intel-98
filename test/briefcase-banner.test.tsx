// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BriefcaseModule } from '../src/renderer/modules/briefcase/BriefcaseModule';

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  (globalThis as any).window.api = {
    briefcase: {
      list: () => Promise.resolve([]),
      read: () => Promise.resolve(null),
      save: () => Promise.resolve({ id: 'x', name: 'note', body: '', updatedAt: '2026-08-07T00:00:00Z', bytes: 0 }),
      delete: () => Promise.resolve(undefined)
    },
    documents: { readText: () => Promise.resolve('') }
  };
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Briefcase banner', () => {
  it('renders the briefcase banner image as the first header element', async () => {
    await act(async () => { root.render(<BriefcaseModule />); });
    const img = container.querySelector('img.ga98-module-banner') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toMatch(/briefcase-banner/);
    expect(img!.getAttribute('alt')).toBe('Briefcase');
  });
});
