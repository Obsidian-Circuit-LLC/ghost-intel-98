// @vitest-environment jsdom
/**
 * Audit HIGH #8 + #9 — highlight-preset MATCH DISPLAY + the full preset EDITOR (renderer wiring).
 *
 * The backend (`evaluatePreset`/`runPreset`/`presetsSave`) already implements match-any/all,
 * case-sensitivity, per-source `profileIds` scope and full match reporting (covered by
 * x-listening-presets.test.ts). This file pins the RENDERER wiring the audit flagged as lost:
 *
 *  #8 Running a preset renders the matched posts with keyword HIGHLIGHTING (`mark.xls-hl`) and a
 *     `MATCH: <preset name>` row (PostCard's presetNames path).
 *  #9 The editor restores MODE (any/all), CASE SENSITIVE, per-source scope checkboxes, a keywords
 *     TEXTAREA split on comma OR newline, and EDIT (load an existing preset into the form) — so the
 *     save sends the full {mode,caseSensitive,profileIds,keywords} the handler expects.
 *
 * createRoot + act, NO @testing-library (Global Constraint: no new dependency) — mirrors
 * x-listening-tabs2.test.tsx.
 */
import { vi } from 'vitest';

vi.mock('../src/renderer/state/dialogs', () => ({
  confirmDialog: vi.fn(),
  promptDialog: vi.fn(),
}));

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { XListeningModule } from '../src/renderer/modules/x-listening/XListeningModule';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings } from '@shared/types';

const CAMP = { id: 'camp-a', name: 'Alpha Watch', createdAt: 1, updatedAt: 1 };

const POST_A = {
  id: 'post-a',
  channelId: 'alice',
  channelLabel: '@alice',
  authorHandle: 'alice',
  text: 'hello #osint from @bob',
  publishedAt: '2026-08-01T00:00:00.000Z',
  url: 'https://x.com/alice/status/1',
  kind: 'post',
};
const POST_B = {
  id: 'post-b',
  channelId: 'carol',
  channelLabel: '@carol',
  authorHandle: 'carol',
  text: 'a totally unrelated update',
  publishedAt: '2026-08-02T00:00:00.000Z',
  url: 'https://x.com/carol/status/2',
  kind: 'post',
};

const RICH_PRESET = {
  id: 'preset-1',
  name: 'OSINT watch',
  keywords: ['osint', 'wallet'],
  mode: 'all' as const,
  caseSensitive: true,
  profileIds: ['alice'],
  enabled: true,
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function makeApi(preset = RICH_PRESET) {
  return {
    xListening: {
      campaignsList: vi.fn(async () => [CAMP]),
      campaignsCreate: vi.fn(),
      campaignsSwitch: vi.fn(async () => CAMP),
      campaignsUpdate: vi.fn(),
      campaignsDelete: vi.fn(),
      sessionStatus: vi.fn(async () => ({ connected: true, windowOpen: true })),
      openSession: vi.fn(async () => ({ blocked: false })),
      closeSession: vi.fn(async () => ({ cleared: true })),
      postsList: vi.fn(async () => [POST_A, POST_B]),
      analysis: vi.fn(async () => ({
        targetCount: 0, relationshipCount: 0, uniqueIdentityCount: 0, commonIdentityCount: 0,
        highOverlapCount: 0, pairs: [], identities: [], graph: { nodes: [], edges: [] },
      })),
      health: vi.fn(async () => []),
      entities: vi.fn(async () => []),
      networksList: vi.fn(async () => []),
      changeEvents: vi.fn(async () => []),
      runLog: vi.fn(async () => []),
      networkEvents: vi.fn(async () => []),
      readNotes: vi.fn(async () => ({ notes: [] })),
      archiveStatus: vi.fn(async () => null),
      presetsRead: vi.fn(async () => ({ presets: [preset] })),
      presetsSave: vi.fn(async (req: { id: string; name: string; keywords: string[] }) => ({
        presets: [{ ...RICH_PRESET, id: req.id, name: req.name, keywords: req.keywords }],
      })),
      presetsRun: vi.fn(async () => ({ matches: [{ postId: 'post-a', matchedKeywords: ['osint'] }] })),
      presetsRemove: vi.fn(async () => ({ presets: [] })),
    },
  };
}

describe('X Listening Station — preset match display + full editor (audit HIGH #8/#9)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: ReturnType<typeof makeApi>;

  beforeEach(() => {
    api = makeApi();
    (globalThis as any).window.api = api;
    useSettings.setState({ settings: { ...defaultSettings } });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as any).window.api;
    useSettings.setState({ settings: null });
    vi.restoreAllMocks();
  });

  async function mount() {
    await act(async () => { root.render(<XListeningModule />); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
  }
  function findTab(matcher: RegExp): HTMLButtonElement {
    const hit = Array.from(container.querySelectorAll('.xls-tab')).find((b) => matcher.test(b.getAttribute('data-tab') || b.textContent || ''));
    if (!hit) throw new Error(`tab not found: ${matcher}`);
    return hit as HTMLButtonElement;
  }
  async function clickTab(matcher: RegExp) {
    await act(async () => { findTab(matcher).click(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
  }
  function findButton(scope: ParentNode, matcher: RegExp): HTMLButtonElement {
    const hit = Array.from(scope.querySelectorAll('button')).find((b) => matcher.test(b.getAttribute('data-tab') || b.textContent || ''));
    if (!hit) throw new Error(`button not found: ${matcher}`);
    return hit as HTMLButtonElement;
  }
  function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function selectOption(select: HTMLSelectElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── #8 match display ─────────────────────────────────────────────────────────
  it('running a preset renders the matched posts with a MATCH:<name> row and highlight marks', async () => {
    await mount();
    await clickTab(/^search$/i);

    const presetRow = Array.from(container.querySelectorAll('.xls-search .xls-source-row')).find((r) =>
      (r.textContent || '').includes('OSINT watch'),
    )!;
    await act(async () => { findButton(presetRow, /^run$/i).click(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(api.xListening.presetsRun).toHaveBeenCalledWith({ caseId: 'camp-a', id: 'preset-1' });

    const results = container.querySelector('.xls-preset-results');
    expect(results).toBeTruthy();
    // The matched post (post-a) is rendered…
    expect(results!.textContent || '').toMatch(/hello/);
    // …with the preset MATCH row…
    const matchRow = results!.querySelector('.xls-preset-match-row');
    expect(matchRow?.textContent || '').toMatch(/MATCH:\s*OSINT watch/);
    // …and the keyword highlighted with a <mark class="xls-hl">.
    const mark = results!.querySelector('mark.xls-hl');
    expect(mark).toBeTruthy();
    expect((mark!.textContent || '').toLowerCase()).toContain('osint');
    // The non-matching post is NOT in the results block.
    expect(results!.textContent || '').not.toMatch(/totally unrelated/);
  });

  // ── #9 editor: save sends the full payload ───────────────────────────────────
  it('saving a preset sends mode / caseSensitive / profileIds (not just name+keywords)', async () => {
    await mount();
    await clickTab(/^search$/i);

    setValue(container.querySelector('.xls-preset-name') as HTMLInputElement, 'My Preset');
    await act(async () => setValue(container.querySelector('.xls-preset-keywords') as HTMLTextAreaElement, 'foo, bar'));
    // MATCH ALL
    await act(async () => selectOption(container.querySelector('[aria-label="Preset match mode"]') as HTMLSelectElement, 'all'));
    // CASE SENSITIVE
    const caseBox = container.querySelector('[aria-label="Case sensitive"]') as HTMLInputElement;
    await act(async () => { caseBox.click(); });
    // Scope to @alice
    const aliceBox = container.querySelector('[aria-label="Scope to @alice"]') as HTMLInputElement;
    await act(async () => { aliceBox.click(); });

    await act(async () => { findButton(container, /save preset/i).click(); });
    await act(async () => { await Promise.resolve(); });

    expect(api.xListening.presetsSave).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: 'camp-a',
        name: 'My Preset',
        keywords: ['foo', 'bar'],
        mode: 'all',
        caseSensitive: true,
        profileIds: ['alice'],
      }),
    );
  });

  it('keywords split on NEWLINE as well as comma', async () => {
    await mount();
    await clickTab(/^search$/i);

    setValue(container.querySelector('.xls-preset-name') as HTMLInputElement, 'Line Preset');
    await act(async () => setValue(container.querySelector('.xls-preset-keywords') as HTMLTextAreaElement, 'alpha\nbeta\ngamma'));
    await act(async () => { findButton(container, /save preset/i).click(); });
    await act(async () => { await Promise.resolve(); });

    expect(api.xListening.presetsSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Line Preset', keywords: ['alpha', 'beta', 'gamma'] }),
    );
  });

  // ── #9 editor: EDIT loads an existing preset into the form ────────────────────
  it('EDIT loads an existing preset (name/keywords/mode/case/scope) into the form', async () => {
    await mount();
    await clickTab(/^search$/i);

    const presetRow = Array.from(container.querySelectorAll('.xls-search .xls-source-row')).find((r) =>
      (r.textContent || '').includes('OSINT watch'),
    )!;
    await act(async () => { findButton(presetRow, /^edit$/i).click(); });
    await act(async () => { await Promise.resolve(); });

    expect((container.querySelector('.xls-preset-name') as HTMLInputElement).value).toBe('OSINT watch');
    // keywords are joined onto their own lines (newline-preserving round-trip)
    expect((container.querySelector('.xls-preset-keywords') as HTMLTextAreaElement).value).toBe('osint\nwallet');
    expect((container.querySelector('[aria-label="Preset match mode"]') as HTMLSelectElement).value).toBe('all');
    expect((container.querySelector('[aria-label="Case sensitive"]') as HTMLInputElement).checked).toBe(true);
    expect((container.querySelector('[aria-label="Scope to @alice"]') as HTMLInputElement).checked).toBe(true);
    expect((container.querySelector('[aria-label="Scope to @carol"]') as HTMLInputElement).checked).toBe(false);

    // Saving after EDIT upserts the SAME id (not a new random one).
    await act(async () => { findButton(container, /save changes/i).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.xListening.presetsSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'preset-1' }));
  });
});
