// @vitest-environment jsdom
/**
 * T7: X / GhostScrape independent Cases sidebar.
 *
 * X Collector and GhostScrape collection runs live in the SAME per-namespace scraping-case
 * store as each other — namespace 'x' — kept apart from the main investigation cases
 * (window.api.cases.*). Both modules' case pickers must therefore read
 * window.api.scrapingCases.list('x') — NEVER cases.list() — and expose Add / Open / Delete
 * that call through to scrapingCases.create / .remove with the 'x' store discriminator.
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act(),
 * against a jsdom container, mirroring socmint-cases-sidebar.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { XCollectorModule } from '../src/renderer/modules/x/XCollectorModule';
import { GhostScrapeModule } from '../src/renderer/modules/ghostscrape/GhostScrapeModule';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';
import type { ScrapingCase } from '@shared/types';

const CASES: ScrapingCase[] = [
  { id: 'xc-2', name: 'Bravo Ring', createdAt: 2, updatedAt: 2 },
  { id: 'xc-1', name: 'Alpha Cell', createdAt: 1, updatedAt: 1 },
];

let container: HTMLDivElement;
let root: Root;
let scrapingList: ReturnType<typeof vi.fn>;
let scrapingCreate: ReturnType<typeof vi.fn>;
let scrapingRemove: ReturnType<typeof vi.fn>;
let casesList: ReturnType<typeof vi.fn>;

function installApi(): void {
  scrapingList = vi.fn().mockResolvedValue([...CASES]);
  scrapingCreate = vi.fn().mockResolvedValue(
    { id: 'xc-new', name: 'Charlie Node', createdAt: 3, updatedAt: 3 } satisfies ScrapingCase,
  );
  scrapingRemove = vi.fn().mockResolvedValue(undefined);
  casesList = vi.fn().mockResolvedValue([]);
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    scrapingCases: { list: scrapingList, create: scrapingCreate, remove: scrapingRemove },
    // Present but must NOT be used for the X / GhostScrape picker.
    cases: { list: casesList },
    x: {
      listAccounts: vi.fn().mockResolvedValue([]),
      listItems: vi.fn().mockResolvedValue([]),
    },
    ghostscrape: {
      onProgress: vi.fn().mockReturnValue(() => {}),
      onDone: vi.fn().mockReturnValue(() => {}),
    },
    socmint: {
      recordLabel: vi.fn().mockResolvedValue(undefined),
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function buttonByText(scope: HTMLElement, re: RegExp): HTMLButtonElement {
  const btn = Array.from(scope.querySelectorAll('button')).find((b) => re.test(b.textContent ?? ''));
  if (!btn) throw new Error(`no button matching ${re} in ${scope.className}`);
  return btn as HTMLButtonElement;
}

beforeEach(() => {
  installApi();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  useSettings.setState({ settings: { ...defaultSettings } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSettings.setState({ settings: null });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// X Collector
// ---------------------------------------------------------------------------

describe('X Collector Cases sidebar (T7)', () => {
  function sidebar(): HTMLElement {
    const el = container.querySelector('.xc-cases-sidebar');
    if (!el) throw new Error('no .xc-cases-sidebar rendered');
    return el as HTMLElement;
  }

  it('lists cases from scrapingCases.list("x"), never cases.list()', async () => {
    await act(async () => { root.render(<XCollectorModule />); });
    await flush();

    expect(scrapingList).toHaveBeenCalledWith('x');
    expect(casesList).not.toHaveBeenCalled();

    const text = sidebar().textContent ?? '';
    expect(text).toContain('Alpha Cell');
    expect(text).toContain('Bravo Ring');
  });

  it('Add Case prompts for a name and calls scrapingCases.create("x", name)', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Charlie Node');
    await act(async () => { root.render(<XCollectorModule />); });
    await flush();

    await act(async () => {
      buttonByText(sidebar(), /add case/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(promptSpy).toHaveBeenCalled();
    expect(scrapingCreate).toHaveBeenCalledWith('x', 'Charlie Node');
  });

  it('does not create a case when the name prompt is cancelled', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    await act(async () => { root.render(<XCollectorModule />); });
    await flush();

    await act(async () => {
      buttonByText(sidebar(), /add case/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(scrapingCreate).not.toHaveBeenCalled();
  });

  it('Delete calls scrapingCases.remove("x", id) for that case', async () => {
    await act(async () => { root.render(<XCollectorModule />); });
    await flush();

    const row = sidebar().querySelector('[data-scraping-case-id="xc-1"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    await act(async () => {
      buttonByText(row!, /delete/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(scrapingRemove).toHaveBeenCalledWith('x', 'xc-1');
  });
});

// ---------------------------------------------------------------------------
// GhostScrape
// ---------------------------------------------------------------------------

describe('GhostScrape Cases sidebar (T7)', () => {
  function sidebar(): HTMLElement {
    const el = container.querySelector('.gs-cases-sidebar');
    if (!el) throw new Error('no .gs-cases-sidebar rendered');
    return el as HTMLElement;
  }

  it('lists cases from scrapingCases.list("x"), never cases.list()', async () => {
    await act(async () => { root.render(<GhostScrapeModule />); });
    await flush();

    expect(scrapingList).toHaveBeenCalledWith('x');
    expect(casesList).not.toHaveBeenCalled();

    const text = sidebar().textContent ?? '';
    expect(text).toContain('Alpha Cell');
    expect(text).toContain('Bravo Ring');
  });

  it('Add Case prompts for a name and calls scrapingCases.create("x", name)', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Charlie Node');
    await act(async () => { root.render(<GhostScrapeModule />); });
    await flush();

    await act(async () => {
      buttonByText(sidebar(), /add case/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(promptSpy).toHaveBeenCalled();
    expect(scrapingCreate).toHaveBeenCalledWith('x', 'Charlie Node');
  });

  it('Delete calls scrapingCases.remove("x", id) for that case', async () => {
    await act(async () => { root.render(<GhostScrapeModule />); });
    await flush();

    const row = sidebar().querySelector('[data-scraping-case-id="xc-1"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    await act(async () => {
      buttonByText(row!, /delete/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(scrapingRemove).toHaveBeenCalledWith('x', 'xc-1');
  });
});
