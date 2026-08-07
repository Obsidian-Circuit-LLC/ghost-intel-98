// @vitest-environment jsdom
/**
 * Q (AI Assistant) banner (GhostExodus UI batch, Task 2). Mirrors the api mock shape used by
 * ai-assistant-memory-toggle.test.tsx (the nearest existing AiAssistantModule harness).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
// AiAssistantModule pulls in pdfExtract → pdfjs-dist, which touches DOMMatrix at import and
// crashes under jsdom. This test doesn't exercise PDF extraction, so stub the module.
vi.mock('../src/renderer/lib/pdfExtract', () => ({ extractPdfText: vi.fn() }));

import { AiAssistantModule } from '../src/renderer/modules/ai-assistant/AiAssistantModule';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';

let container: HTMLDivElement; let root: Root;

beforeEach(() => {
  (globalThis as any).window.api = {
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
    settings: { update: vi.fn() },
  };
  if (!('scrollTo' in Element.prototype)) {
    (Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};
  }
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  useSettings.setState({ settings: { ...defaultSettings } });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSettings.setState({ settings: null });
});

describe('Q banner', () => {
  it('renders the Q banner image as the first header element', async () => {
    await act(async () => { root.render(<AiAssistantModule />); });
    const img = container.querySelector('img.ga98-module-banner') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toMatch(/q-banner/);
    expect(img!.getAttribute('alt')).toBe('Q');
  });
});
