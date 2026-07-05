// @vitest-environment jsdom
/**
 * Task 5: Q chat-toolbar search-engine picker.
 *
 * A compact <select> next to the existing "Web (Tor)" toggle lets the operator choose which
 * engine Q's [SEARCH:] loop uses. It is bound to settings.ai.searchEngine and patches that field
 * on change. Both shipped engines are onion (the "· Tor" badge in the label); no clearnet engine
 * ships. The picker is a pure UI control — it only writes the selected id into settings; the
 * .onion enforcement + untrusted-data fence live in main and are unaffected.
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act() against a
 * jsdom container, mirroring x-ghostscrape-cases-sidebar.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
// AiAssistantModule pulls in pdfExtract → pdfjs-dist, which touches DOMMatrix at import and
// crashes under jsdom. The picker doesn't exercise PDF extraction, so stub the module.
vi.mock('../src/renderer/lib/pdfExtract', () => ({ extractPdfText: vi.fn() }));

import { AiAssistantModule } from '../src/renderer/modules/ai-assistant/AiAssistantModule';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';

let container: HTMLDivElement;
let root: Root;
let settingsUpdate: ReturnType<typeof vi.fn>;

function installApi(): void {
  // settings.update backs the store's patch(): return the merged settings the way main would.
  settingsUpdate = vi.fn().mockImplementation(async (patch: Record<string, unknown>) => {
    const cur = useSettings.getState().settings!;
    return { ...cur, ...patch, ai: { ...cur.ai, ...(patch.ai as object) } };
  });
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    cases: { list: vi.fn().mockResolvedValue([]) },
    voice: { modelStatus: vi.fn().mockResolvedValue({ installed: false }) },
    aiConvos: { list: vi.fn().mockResolvedValue([]) },
    memory: { onRecall: vi.fn().mockReturnValue(() => {}) },
    tts: {
      listVoices: vi.fn().mockResolvedValue([]),
      piperStatus: vi.fn().mockResolvedValue({ available: false }),
      cancel: vi.fn().mockResolvedValue(undefined),
    },
    ai: { cancel: vi.fn().mockResolvedValue(undefined) },
    settings: { update: settingsUpdate },
  };
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

/** The engine picker: the <select> whose options include the SearXNG onion engine. */
function enginePicker(): HTMLSelectElement {
  const sel = Array.from(container.querySelectorAll('select')).find((s) =>
    Array.from(s.options).some((o) => /SearXNG/i.test(o.textContent ?? '')),
  );
  if (!sel) throw new Error('no engine picker <select> rendered');
  return sel as HTMLSelectElement;
}

/** Set a React-controlled <select>'s value the way a real change would (native setter + change event). */
function selectValue(sel: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  setter.call(sel, value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  installApi();
  // jsdom doesn't implement Element.scrollTo; the module's autoscroll effect calls it.
  if (!('scrollTo' in Element.prototype)) {
    (Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};
  }
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

describe('Q search-engine picker (Task 5)', () => {
  it('renders both onion engines with a · Tor badge', async () => {
    await act(async () => { root.render(<AiAssistantModule />); });
    await flush();

    const labels = Array.from(enginePicker().options).map((o) => o.textContent ?? '');
    expect(labels).toEqual(['DuckDuckGo · Tor', 'SearXNG · Tor']);
  });

  it('default selection reflects settings.ai.searchEngine', async () => {
    useSettings.setState({ settings: { ...defaultSettings, ai: { ...defaultSettings.ai, searchEngine: 'searxng' } } });
    await act(async () => { root.render(<AiAssistantModule />); });
    await flush();

    expect(enginePicker().value).toBe('searxng');
  });

  it('selecting SearXNG patches ai.searchEngine', async () => {
    await act(async () => { root.render(<AiAssistantModule />); });
    await flush();

    expect(enginePicker().value).toBe('ddg'); // defaultSettings default

    await act(async () => { selectValue(enginePicker(), 'searxng'); });
    await flush();

    expect(settingsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ ai: expect.objectContaining({ searchEngine: 'searxng' }) }),
    );
  });
});
