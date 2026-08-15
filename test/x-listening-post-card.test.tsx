// @vitest-environment jsdom
/**
 * Task I1 — rich PostCard parity (Live / Dashboard / Search / Notes).
 *
 * The PostCard is extracted into its own co-located component and must reach Enterprise
 * v3.4.1 PostCard anatomy: author avatar (local mediaRefs/avatar → initial fallback),
 * display name, @handle, kind tag, "VIA @source" when monitored indirectly, timestamp,
 * preset MATCH rows, post text with preset highlighting, a media strip of ≤3 LOCAL thumbs
 * (via the mediaRead channel, "MEDIA NOT RETRIEVED" fallback), a metrics row (metricsRaw
 * where present), a provenance row (FIRST/LAST observed, availability badge, short SHA-256),
 * and actions — OPEN REAL THREAD (E1 openInX 'thread'), VERIFY LIVE (A1 verifyPost — hidden
 * for synthetic) and an ANALYST NOTES toggle with inline add/edit/delete (existing notes IPC).
 *
 * Harness: React 18 createRoot + act, NO @testing-library (Global Constraint: no new dep).
 */
import { vi } from 'vitest';

vi.mock('../src/renderer/state/dialogs', () => ({
  confirmDialog: vi.fn(),
  promptDialog: vi.fn(),
}));

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PostCard } from '../src/renderer/modules/x-listening/PostCard';
import { XListeningModule, type XPostRow } from '../src/renderer/modules/x-listening/XListeningModule';
import { useSettings } from '../src/renderer/state/store';
import { defaultSettings, type AppSettings } from '@shared/types';

const RICH_POST: XPostRow = {
  id: 'post-a',
  channelId: 'alice',
  channelLabel: '@alice',
  authorHandle: 'bob',
  displayName: 'Bob The Source',
  sourceUsername: 'alice',
  text: 'hello #osint from the field',
  publishedAt: '2026-08-01T00:00:00.000Z',
  firstObservedAt: '2026-08-01T00:00:00.000Z',
  lastObservedAt: '2026-08-03T00:00:00.000Z',
  url: 'https://x.com/bob/status/1',
  kind: 'repost',
  metrics: { replies: 5, reposts: 2, likes: 1200, views: 34000 },
  metricsRaw: { likes: '1.2K', views: '34K' },
  evidenceHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
  availability: 'available',
};

describe('X Listening Station — rich PostCard (Task I1)', () => {
  let container: HTMLDivElement;
  let root: Root;

  function installMediaRead(fn: (req: { caseId: string; ref: string }) => Promise<string | null>) {
    (globalThis as any).window.api = { xListening: { mediaRead: vi.fn(fn) } };
  }

  beforeEach(() => {
    installMediaRead(async () => null);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as any).window.api;
    vi.restoreAllMocks();
  });

  async function renderCard(props: Partial<React.ComponentProps<typeof PostCard>> = {}) {
    const base: React.ComponentProps<typeof PostCard> = {
      post: RICH_POST,
      caseId: 'camp-a',
      notes: [],
      verifying: false,
      onOpenThread: vi.fn(),
      onVerify: vi.fn(),
      onAddNote: vi.fn(async () => undefined),
      onUpdateNote: vi.fn(async () => undefined),
      onDeleteNote: vi.fn(async () => undefined),
      ...props,
    };
    await act(async () => { root.render(<PostCard {...base} />); });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    return base;
  }

  function findButton(matcher: RegExp): HTMLButtonElement {
    const hit = Array.from(container.querySelectorAll('button')).find((b) => matcher.test(b.textContent || ''));
    if (!hit) throw new Error(`button not found: ${matcher}`);
    return hit as HTMLButtonElement;
  }
  function maybeButton(matcher: RegExp): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll('button')).find((b) => matcher.test(b.textContent || '')) as
      | HTMLButtonElement
      | undefined;
  }
  function setValue(el: HTMLTextAreaElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('renders every anatomy element from a seeded post', async () => {
    await renderCard({ presetNames: ['Ransomware terms'], highlightTerms: ['osint'] });
    const text = container.textContent || '';
    // identity
    expect(text).toMatch(/Bob The Source/);
    expect(text).toMatch(/@bob/);
    // kind tag + VIA (monitored indirectly via @alice)
    expect(text).toMatch(/REPOST/);
    expect(text).toMatch(/VIA @alice/);
    // preset MATCH row
    expect(text).toMatch(/MATCH: Ransomware terms/);
    // post text + highlight
    expect(text).toMatch(/hello #osint from the field/);
    expect(container.querySelector('mark')?.textContent?.toLowerCase()).toBe('osint');
    // metrics row: raw where present (1.2K / 34K), derived where not (replies 5 / reposts 2)
    const metrics = container.querySelector('.xls-metrics')?.textContent || '';
    expect(metrics).toMatch(/1\.2K/);
    expect(metrics).toMatch(/34K/);
    expect(metrics).toMatch(/\b5\b/);
    expect(metrics).toMatch(/\b2\b/);
    // provenance row: FIRST / LAST / availability badge / short SHA
    const prov = container.querySelector('.xls-provenance-row')?.textContent || '';
    expect(prov).toMatch(/FIRST/);
    expect(prov).toMatch(/LAST/);
    expect(prov).toMatch(/AVAILABLE/);
    expect(prov).toMatch(/abcdef0123/); // first 10 of the hash
    expect(container.querySelector('.xls-availability')).toBeTruthy();
    // actions
    expect(maybeButton(/OPEN REAL THREAD/)).toBeTruthy();
    expect(maybeButton(/VERIFY LIVE/)).toBeTruthy();
    expect(maybeButton(/ANALYST NOTES/)).toBeTruthy();
  });

  it('falls back to an initial avatar when no local avatar ref resolves', async () => {
    await renderCard();
    const avatar = container.querySelector('.xls-post-avatar');
    expect(avatar).toBeTruthy();
    expect(avatar?.textContent).toMatch(/B/); // initial of @bob
    expect(avatar?.querySelector('img')).toBeFalsy();
  });

  it('renders up to 3 media thumbs and a "MEDIA NOT RETRIEVED" fallback for an unresolved ref', async () => {
    await renderCard({
      post: { ...RICH_POST, mediaRefs: ['x-media/a', 'x-media/b', 'x-media/c', 'x-media/d'] },
    });
    const strip = container.querySelector('.xls-media-strip');
    expect(strip).toBeTruthy();
    // capped at 3
    expect(strip!.children.length).toBe(3);
    // unresolved (mediaRead → null) shows the fallback, not a broken image
    expect(strip!.textContent).toMatch(/MEDIA NOT RETRIEVED/);
    expect(strip!.querySelector('img')).toBeFalsy();
  });

  it('hides BOTH network-window actions (VERIFY LIVE + OPEN REAL THREAD) for a synthetic post, keeps local ANALYST NOTES', async () => {
    // Spec Global Constraint "no network window for demo": a synthetic/demo record must expose NO
    // action that reaches x.com over Tor — neither VERIFY LIVE nor OPEN REAL THREAD. Only the
    // local-only ANALYST NOTES toggle remains.
    await renderCard({ post: { ...RICH_POST, synthetic: true } });
    expect(maybeButton(/VERIFY LIVE/)).toBeFalsy();
    expect(maybeButton(/OPEN REAL THREAD/)).toBeFalsy();
    expect(maybeButton(/ANALYST NOTES/)).toBeTruthy();
  });

  it('OPEN REAL THREAD forwards the post to the onOpenThread handler', async () => {
    const base = await renderCard();
    await act(async () => { findButton(/OPEN REAL THREAD/).click(); });
    expect(base.onOpenThread).toHaveBeenCalledWith(RICH_POST);
  });

  it('VERIFY LIVE forwards the post id to the onVerify handler', async () => {
    const base = await renderCard();
    await act(async () => { findButton(/VERIFY LIVE/).click(); });
    expect(base.onVerify).toHaveBeenCalledWith('post-a');
  });

  it('inline notes: opening the toggle and adding a note calls onAddNote(findingId, text)', async () => {
    const base = await renderCard({ notes: [] });
    await act(async () => { findButton(/ANALYST NOTES/).click(); });
    const compose = container.querySelector('.xls-note-compose textarea') as HTMLTextAreaElement;
    expect(compose).toBeTruthy();
    await act(async () => setValue(compose, 'first analyst assessment'));
    await act(async () => { findButton(/ADD NOTE/).click(); });
    for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
    expect(base.onAddNote).toHaveBeenCalledWith('post-a', 'first analyst assessment');
  });

  // M11: the composer stays available even when the post already has notes, so a second note
  // APPENDS (his multi-note model) rather than being hidden after the first.
  it('inline notes: the composer is still shown when notes already exist (multi-note append)', async () => {
    const base = await renderCard({
      notes: [{ id: 'n1', findingId: 'post-a', text: 'first note', savedAt: '2026-08-02T00:00:00.000Z' }],
    });
    await act(async () => { findButton(/ANALYST NOTES/).click(); });
    const compose = container.querySelector('.xls-note-compose textarea') as HTMLTextAreaElement;
    expect(compose).toBeTruthy();
    await act(async () => setValue(compose, 'a second, independent note'));
    await act(async () => { findButton(/ADD NOTE/).click(); });
    for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
    expect(base.onAddNote).toHaveBeenCalledWith('post-a', 'a second, independent note');
  });

  it('inline notes: an existing note can be edited in place through onUpdateNote(noteId, text)', async () => {
    const base = await renderCard({
      notes: [{ id: 'n1', findingId: 'post-a', text: 'original note', savedAt: '2026-08-02T00:00:00.000Z' }],
    });
    await act(async () => { findButton(/ANALYST NOTES/).click(); });
    // the existing note text is shown
    expect(container.textContent || '').toMatch(/original note/);
    await act(async () => { findButton(/^EDIT$/).click(); });
    const editor = container.querySelector('.xls-note-entry textarea') as HTMLTextAreaElement;
    expect(editor).toBeTruthy();
    await act(async () => setValue(editor, 'revised note'));
    await act(async () => { findButton(/SAVE EDIT/).click(); });
    for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
    expect(base.onUpdateNote).toHaveBeenCalledWith('n1', 'revised note');
  });

  it('inline notes: an existing note can be deleted by note id through onDeleteNote', async () => {
    const base = await renderCard({
      notes: [{ id: 'n1', findingId: 'post-a', text: 'original note', savedAt: '2026-08-02T00:00:00.000Z' }],
    });
    await act(async () => { findButton(/ANALYST NOTES/).click(); });
    await act(async () => { findButton(/^DELETE$/).click(); });
    for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
    expect(base.onDeleteNote).toHaveBeenCalledWith('n1');
  });
});

// ── Module integration: the feed wires OPEN REAL THREAD to the Tor-gated openInX('thread') ──
const CAMP_A = { id: 'camp-a', name: 'Alpha Watch', createdAt: 1, updatedAt: 1 };
const FEED_POST = {
  id: 'post-a',
  channelId: 'alice',
  channelLabel: '@alice',
  authorHandle: 'alice',
  text: 'field update',
  publishedAt: '2026-08-01T00:00:00.000Z',
  url: 'https://x.com/alice/status/1',
  kind: 'post',
  metrics: { replies: 0, reposts: 0, likes: 0, views: 0 },
  evidenceHash: 'f'.repeat(64),
};

function makeModuleApi() {
  return {
    xListening: {
      campaignsList: vi.fn(async () => [CAMP_A]),
      campaignsSwitch: vi.fn(async () => CAMP_A),
      sessionStatus: vi.fn(async () => ({ connected: true, windowOpen: true })),
      postsList: vi.fn(async () => [FEED_POST]),
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
      presetsRead: vi.fn(async () => ({ presets: [] })),
      archiveStatus: vi.fn(async () => ({ cursor: null, cycles: 0, lastRunAt: null })),
      mediaRead: vi.fn(async () => null),
      openInX: vi.fn(async () => undefined),
      verifyPost: vi.fn(async () => ({ availability: 'available', changed: false })),
      saveNote: vi.fn(async (req: { findingId: string; text: string }) => ({
        notes: [{ findingId: req.findingId, text: req.text, savedAt: '2026-08-05T00:00:00.000Z' }],
      })),
      removeNote: vi.fn(async () => ({ notes: [] })),
    },
  };
}

describe('X Listening Station — PostCard feed wiring (Task I1)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: ReturnType<typeof makeModuleApi>;

  beforeEach(() => {
    api = makeModuleApi();
    (globalThis as any).window.api = api;
    useSettings.setState({
      settings: { ...defaultSettings, xListening: { ...defaultSettings.xListening } } as AppSettings,
    });
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
    for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
  }

  it('OPEN REAL THREAD in the Live feed calls openInX with kind "thread" and the post URL', async () => {
    await mount();
    const liveTab = Array.from(container.querySelectorAll('.xls-tab')).find((b) => /^live$/i.test(b.getAttribute('data-tab') || b.textContent || '')) as HTMLButtonElement;
    await act(async () => { liveTab.click(); });
    for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
    const openBtn = Array.from(container.querySelectorAll('button')).find((b) => /OPEN REAL THREAD/.test(b.textContent || '')) as HTMLButtonElement;
    expect(openBtn).toBeTruthy();
    await act(async () => { openBtn.click(); });
    for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
    expect(api.xListening.openInX).toHaveBeenCalledWith({ kind: 'thread', ref: 'https://x.com/alice/status/1' });
  });
});
