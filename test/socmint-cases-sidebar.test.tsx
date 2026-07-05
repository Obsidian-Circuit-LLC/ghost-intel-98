// @vitest-environment jsdom
/**
 * T6: SOCMINT independent Cases sidebar.
 *
 * SOCMINT collection runs live in their OWN scraping-case store (namespace 'socmint'),
 * kept apart from the main investigation cases (window.api.cases.*). The module's case
 * picker must therefore read window.api.scrapingCases.list('socmint') — NEVER cases.list()
 * — and expose Add / Open / Delete that call through to scrapingCases.create / .remove
 * with the 'socmint' store discriminator.
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act(),
 * against a jsdom container, mirroring hostinfo-standalone.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SocmintModule } from '../src/renderer/modules/socmint/SocmintModule';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';
import type { ScrapingCase } from '@shared/types';

const CASES: ScrapingCase[] = [
  { id: 'sc-2', name: 'Bravo Ring', createdAt: 2, updatedAt: 2 },
  { id: 'sc-1', name: 'Alpha Cell', createdAt: 1, updatedAt: 1 },
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
    { id: 'sc-new', name: 'Charlie Node', createdAt: 3, updatedAt: 3 } satisfies ScrapingCase,
  );
  scrapingRemove = vi.fn().mockResolvedValue(undefined);
  casesList = vi.fn().mockResolvedValue([]);
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    scrapingCases: { list: scrapingList, create: scrapingCreate, remove: scrapingRemove },
    // Present but must NOT be used for the SOCMINT picker.
    cases: { list: casesList },
    socmint: {
      listChannels: vi.fn().mockResolvedValue([]),
      listItems: vi.fn().mockResolvedValue([]),
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function sidebar(): HTMLElement {
  const el = container.querySelector('.sm-cases-sidebar');
  if (!el) throw new Error('no .sm-cases-sidebar rendered');
  return el as HTMLElement;
}

function buttonByText(scope: HTMLElement, re: RegExp): HTMLButtonElement {
  const btn = Array.from(scope.querySelectorAll('button')).find((b) => re.test(b.textContent ?? ''));
  if (!btn) throw new Error(`no button matching ${re} in ${scope.className}`);
  return btn as HTMLButtonElement;
}

/** The in-app name dialog that replaced window.prompt (rendered at the module root). */
function dialog(): HTMLElement {
  const el = container.querySelector('[role="dialog"]');
  if (!el) throw new Error('no [role="dialog"] rendered');
  return el as HTMLElement;
}

/** Set a React-controlled input's value the way a real keystroke would (native setter + input event). */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
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

describe('SOCMINT Cases sidebar (T6)', () => {
  it('lists cases from scrapingCases.list("socmint"), never cases.list()', async () => {
    await act(async () => { root.render(<SocmintModule />); });
    await flush();

    expect(scrapingList).toHaveBeenCalledWith('socmint');
    expect(casesList).not.toHaveBeenCalled();

    const text = sidebar().textContent ?? '';
    expect(text).toContain('Alpha Cell');
    expect(text).toContain('Bravo Ring');
  });

  it('Add Case opens the in-app dialog; Create calls scrapingCases.create("socmint", name)', async () => {
    await act(async () => { root.render(<SocmintModule />); });
    await flush();

    await act(async () => {
      buttonByText(sidebar(), /add case/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    typeInto(dialog().querySelector('#case-dialog-input') as HTMLInputElement, 'Charlie Node');
    await act(async () => {
      buttonByText(dialog(), /create/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(scrapingCreate).toHaveBeenCalledWith('socmint', 'Charlie Node');
  });

  it('does not create a case when the dialog is cancelled', async () => {
    await act(async () => { root.render(<SocmintModule />); });
    await flush();

    await act(async () => {
      buttonByText(sidebar(), /add case/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    await act(async () => {
      buttonByText(dialog(), /cancel/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(scrapingCreate).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('Delete calls scrapingCases.remove("socmint", id) for that case', async () => {
    await act(async () => { root.render(<SocmintModule />); });
    await flush();

    const row = sidebar().querySelector('[data-scraping-case-id="sc-1"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    await act(async () => {
      buttonByText(row!, /delete/i).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    expect(scrapingRemove).toHaveBeenCalledWith('socmint', 'sc-1');
  });
});
