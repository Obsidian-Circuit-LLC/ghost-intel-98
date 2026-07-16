// @vitest-environment jsdom
/**
 * T4: AI Assistant conversation-list Forget/Remember-from-memory toggle (reversibility).
 *
 * Each saved-conversation row carries a memory toggle bound to the summary's `memoryExcluded`
 * flag (T1). When a conversation is NOT excluded the toggle offers "Forget from memory" and
 * clicking it calls `window.api.memory.forgetConversation(<id>)`; when it IS excluded the toggle
 * offers "Remember" and clicking it calls `window.api.memory.rememberConversation(<id>)`. Either
 * way the list is refreshed (a second `aiConvos.list()`), so the tombstone is fully reversible
 * from the chat list — the chat record itself is never deleted here.
 *
 * No @testing-library (not a dependency) — drive React 18's createRoot inside act() against a
 * jsdom container, mirroring ai-search-engine-picker.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
// AiAssistantModule pulls in pdfExtract → pdfjs-dist, which touches DOMMatrix at import and
// crashes under jsdom. This test doesn't exercise PDF extraction, so stub the module.
vi.mock('../src/renderer/lib/pdfExtract', () => ({ extractPdfText: vi.fn() }));

import { AiAssistantModule } from '../src/renderer/modules/ai-assistant/AiAssistantModule';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';
import type { AiConversationSummary } from '@shared/post-mvp-types';

let container: HTMLDivElement;
let root: Root;
let listMock: ReturnType<typeof vi.fn>;
let forgetConversation: ReturnType<typeof vi.fn>;
let rememberConversation: ReturnType<typeof vi.fn>;

const CONVOS: AiConversationSummary[] = [
  { id: 'c-included', title: 'Alpha chat', updatedAt: '2026-07-16T00:00:00.000Z', messageCount: 2, memoryExcluded: false },
  { id: 'c-excluded', title: 'Beta chat', updatedAt: '2026-07-15T00:00:00.000Z', messageCount: 4, memoryExcluded: true },
];

function installApi(): void {
  listMock = vi.fn().mockResolvedValue(CONVOS);
  forgetConversation = vi.fn().mockResolvedValue(undefined);
  rememberConversation = vi.fn().mockResolvedValue(undefined);
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    cases: { list: vi.fn().mockResolvedValue([]) },
    voice: { modelStatus: vi.fn().mockResolvedValue({ installed: false }) },
    aiConvos: { list: listMock },
    memory: { onRecall: vi.fn().mockReturnValue(() => {}), forgetConversation, rememberConversation },
    tts: {
      listVoices: vi.fn().mockResolvedValue([]),
      piperStatus: vi.fn().mockResolvedValue({ available: false }),
      cancel: vi.fn().mockResolvedValue(undefined),
    },
    ai: { cancel: vi.fn().mockResolvedValue(undefined) },
    settings: { update: vi.fn() },
  };
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

/** The memory toggle button whose aria-label matches `label` (case-insensitive substring). */
function memoryToggle(label: RegExp): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) =>
    label.test(b.getAttribute('aria-label') ?? ''),
  );
  if (!btn) throw new Error(`no memory toggle button matching ${label}`);
  return btn as HTMLButtonElement;
}

beforeEach(() => {
  installApi();
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

describe('AI Assistant conversation-list memory toggle (T4)', () => {
  it('non-excluded row offers "Forget from memory" and forgets by id, then refreshes', async () => {
    await act(async () => { root.render(<AiAssistantModule />); });
    await flush();

    const btn = memoryToggle(/forget from memory/i);
    const listCallsBefore = listMock.mock.calls.length;
    await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();

    expect(forgetConversation).toHaveBeenCalledTimes(1);
    expect(forgetConversation).toHaveBeenCalledWith('c-included');
    expect(rememberConversation).not.toHaveBeenCalled();
    expect(listMock.mock.calls.length).toBe(listCallsBefore + 1);
  });

  it('excluded row offers "Remember" and remembers by id, then refreshes', async () => {
    await act(async () => { root.render(<AiAssistantModule />); });
    await flush();

    const btn = memoryToggle(/^remember/i);
    const listCallsBefore = listMock.mock.calls.length;
    await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();

    expect(rememberConversation).toHaveBeenCalledTimes(1);
    expect(rememberConversation).toHaveBeenCalledWith('c-excluded');
    expect(forgetConversation).not.toHaveBeenCalled();
    expect(listMock.mock.calls.length).toBe(listCallsBefore + 1);
  });
});
