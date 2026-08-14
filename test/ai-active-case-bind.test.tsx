// @vitest-environment jsdom
/**
 * Q auto-binds to the app-wide active case (operator decision 2026-08-14 "App-wide active case").
 *
 * Q's memory is per-case (one shard/case), but its Case-context dropdown used to default to "(none)",
 * so recall fell back to GLOBAL cross-case mixing. Now a shared `useActiveCase.currentCaseId` — set
 * wherever a case is opened (Cases module, Searchlight) — drives Q: on mount and whenever the app's
 * current case changes, Q's context binds to it. The dropdown remains a manual override.
 *
 * Reuses the AiAssistantModule mount harness (createRoot + act, no @testing-library).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
vi.mock('../src/renderer/lib/pdfExtract', () => ({ extractPdfText: vi.fn() }));

import { AiAssistantModule } from '../src/renderer/modules/ai-assistant/AiAssistantModule';
import { useSettings, useActiveCase } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';

let container: HTMLDivElement;
let root: Root;

function installApi(): void {
  (globalThis as unknown as { window: { api: unknown } }).window.api = {
    cases: {
      list: vi.fn().mockResolvedValue([
        { id: 'case-x', title: 'Case X' },
        { id: 'case-y', title: 'Case Y' },
      ]),
      read: vi.fn().mockImplementation(async (id: string) => ({
        id, title: id === 'case-x' ? 'Case X' : 'Case Y', reference: '', description: '', tags: [],
        createdAt: 1, updatedAt: 1, attachments: [], timeline: [], entities: [],
      })),
    },
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
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

/** The Case-context <select> (its options carry the case titles + a "(none)" entry). */
function caseSelect(): HTMLSelectElement {
  const sel = Array.from(container.querySelectorAll('select')).find((s) =>
    Array.from(s.options).some((o) => /Case X/.test(o.textContent ?? '')),
  );
  if (!sel) throw new Error('no case-context <select> rendered');
  return sel as HTMLSelectElement;
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
  useActiveCase.setState({ currentCaseId: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useSettings.setState({ settings: null });
  useActiveCase.setState({ currentCaseId: null });
  vi.restoreAllMocks();
});

describe('Q auto-binds to the app-wide active case', () => {
  it('mounts already bound to the current case (not "(none)" → no global recall)', async () => {
    useActiveCase.setState({ currentCaseId: 'case-x' });
    await act(async () => { root.render(<AiAssistantModule />); });
    await flush();
    expect(caseSelect().value).toBe('case-x');
  });

  it('re-binds when the app switches to another case', async () => {
    await act(async () => { root.render(<AiAssistantModule />); });
    await flush();
    expect(caseSelect().value).toBe(''); // no active case yet → (none)

    await act(async () => { useActiveCase.getState().setCurrentCase('case-y'); });
    await flush();
    expect(caseSelect().value).toBe('case-y');
  });
});

describe('Searchlight → app-wide active case wiring', () => {
  it('selecting a case in Searchlight sets the app-wide current case; deselecting does not clear it', async () => {
    const { useSearchlightStore } = await import('../src/renderer/modules/searchlight/store');
    useActiveCase.setState({ currentCaseId: null });

    useSearchlightStore.getState().setActiveCaseId('case-x');
    expect(useActiveCase.getState().currentCaseId).toBe('case-x');

    // Deselecting a case in Searchlight must NOT wipe the app-wide case (no global "close case").
    useSearchlightStore.getState().setActiveCaseId(null);
    expect(useActiveCase.getState().currentCaseId).toBe('case-x');
  });
});
