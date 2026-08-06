// @vitest-environment jsdom
/**
 * X — X Listening Station RENDERER-UI seam suite (the v3.24.2 reachability class).
 *
 * A handler that passes its own unit test is NOT proven reachable from the UI. This suite renders
 * the REAL `XListeningModule` against a mocked `window.api.xListening` (+ `window.api.settings`) and
 * drives the actual buttons — proving each captured-intel action is WIRED: the UI genuinely invokes
 * capture / captureThreadComments / captureFollowers / exportItems / exportNetwork / runArchiveCycle
 * / runArchiveCycles / saveNote, each with the payload shape the main-side handler requires.
 *
 * createRoot + act, NO @testing-library (Global Constraint: no new dependency).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { XListeningModule } from '../src/renderer/modules/x-listening/XListeningModule';

const ITEM = {
  id: 'itm-1',
  messageId: '123',
  channelId: 'target',
  channelLabel: '@target',
  authorHandle: '@target',
  text: 'hello world',
  url: 'https://x.com/target/status/123',
  kind: 'post',
  metrics: { replies: { raw: '5' }, reposts: { raw: '' }, likes: { raw: '1.2K' }, views: { raw: '' } },
  media: [],
};

function makeXls() {
  return {
    status: vi.fn(async () => ({ connected: true })),
    connect: vi.fn(async () => ({ opened: true })),
    capture: vi.fn(async () => ({ blocked: false, added: 1, skipped: 0, items: [ITEM] })),
    captureThreadComments: vi.fn(async () => ({ blocked: false, added: 0, skipped: 0, items: [] })),
    captureFollowers: vi.fn(async () => ({ blocked: false, target: '@target', kind: 'followers', accounts: [] })),
    captureFollowing: vi.fn(async () => ({ blocked: false, target: '@target', kind: 'following', accounts: [] })),
    exportNetwork: vi.fn(async () => ({ csv: 'handle,displayName\r\n', count: 0 })),
    saveNote: vi.fn(async (req: { caseId: string; findingId: string; text: string }) => ({
      notes: [{ findingId: req.findingId, text: req.text, savedAt: '2026-08-06T12:00:00.000Z' }],
    })),
    readNotes: vi.fn(async () => ({ notes: [] })),
    exportItems: vi.fn(async () => ({
      format: 'json', count: 0, encoding: 'utf8', data: '[]', mime: 'application/json', suggestedName: 'x.json',
    })),
    runArchiveCycle: vi.fn(async () => ({ ran: true, blocked: false, added: 0, skipped: 0, items: [], state: { cursor: null, cycles: 1, lastRunAt: 't' } })),
    runArchiveCycles: vi.fn(async () => ({ cyclesRun: 1, totalAdded: 0, blocked: false, cancelled: false, state: { cursor: null, cycles: 1, lastRunAt: 't' } })),
  };
}

describe('XListeningModule — UI seam (the UI actually invokes each channel)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let xls: ReturnType<typeof makeXls>;
  let settings: { read: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    xls = makeXls();
    settings = {
      read: vi.fn(async () => ({
        xListening: { collect: { replies: false, reposts: false, comments: true }, archiveCycles: false },
      })),
      update: vi.fn(async () => undefined),
    };
    (globalThis as any).window.api = { xListening: xls, settings };
    // downloadExport() reaches for URL.createObjectURL + an <a>.click(); neither is implemented in
    // jsdom. Stub them so the export paths run without touching a real Blob URL / navigation.
    (URL as any).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as any).revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

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

  // ── helpers ────────────────────────────────────────────────────────────────
  async function mount() {
    await act(async () => { root.render(<XListeningModule caseId="case-1" />); });
    await act(async () => { await Promise.resolve(); }); // settle status() + settings.read()
  }
  function findButton(matcher: string | RegExp): HTMLButtonElement {
    const btns = Array.from(container.querySelectorAll('button'));
    const hit = btns.find((b) => {
      const t = (b.textContent || '').trim();
      return typeof matcher === 'string' ? t === matcher : matcher.test(t);
    });
    if (!hit) throw new Error(`button not found: ${String(matcher)}`);
    return hit as HTMLButtonElement;
  }
  async function click(matcher: string | RegExp) {
    await act(async () => { findButton(matcher).click(); });
    await act(async () => { await Promise.resolve(); });
  }
  async function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    await act(async () => { el.dispatchEvent(new Event('input', { bubbles: true })); });
  }
  async function addTarget(handle = 'target') {
    const input = container.querySelector('input[aria-label="Add X target handle"]') as HTMLInputElement;
    await setValue(input, handle);
    await click('ADD SOURCE');
  }

  // ── the wiring proofs ───────────────────────────────────────────────────────
  it('CAPTURE POSTS → capture({ caseId, channelId, channelLabel })', async () => {
    await mount();
    await addTarget('target');
    await click('CAPTURE POSTS');
    expect(xls.capture).toHaveBeenCalledWith({ caseId: 'case-1', channelId: 'target', channelLabel: '@target' });
  });

  it('CAPTURE REPLIES on a captured post → captureThreadComments with the root post fields', async () => {
    await mount();
    await addTarget('target');
    await click('CAPTURE POSTS'); // populates the feed with ITEM
    await click('LIVE FEED');
    await click('CAPTURE REPLIES');
    expect(xls.captureThreadComments).toHaveBeenCalledWith({
      caseId: 'case-1',
      channelId: 'target',
      channelLabel: '@target',
      rootPostId: '123',
      rootPostUrl: 'https://x.com/target/status/123',
    });
  });

  it('CAPTURE FOLLOWERS → captureFollowers({ caseId, target })', async () => {
    await mount();
    await addTarget('target');
    await click('FOLLOWER NETWORK');
    await click('CAPTURE FOLLOWERS');
    expect(xls.captureFollowers).toHaveBeenCalledWith({ caseId: 'case-1', target: 'target' });
  });

  it('EXPORT CSV (network) → exportNetwork(caseId)', async () => {
    await mount();
    await addTarget('target');
    await click('FOLLOWER NETWORK');
    await click('EXPORT CSV');
    expect(xls.exportNetwork).toHaveBeenCalledWith('case-1');
  });

  it('EXPORT JSON → exportItems({ caseId, format })', async () => {
    await mount();
    await click('EXPORTS');
    await click('EXPORT JSON');
    expect(xls.exportItems).toHaveBeenCalledWith({ caseId: 'case-1', format: 'json' });
  });

  it('archive → runArchiveCycle and runArchiveCycles carry { caseId, channelId }', async () => {
    await mount();
    await addTarget('target');
    await click('ARCHIVE');
    await click('RUN ONE CYCLE');
    expect(xls.runArchiveCycle).toHaveBeenCalledWith({ caseId: 'case-1', channelId: 'target', channelLabel: '@target' });
    await click('RUN CYCLES');
    expect(xls.runArchiveCycles).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 'case-1', channelId: 'target', channelLabel: '@target', maxCycles: 3 })
    );
  });

  it('RUN CYCLES surfaces the run\'s captured records in the LIVE FEED (like RUN ONE CYCLE)', async () => {
    xls.runArchiveCycles.mockResolvedValueOnce({
      cyclesRun: 2,
      totalAdded: 1,
      blocked: false,
      cancelled: false,
      items: [ITEM],
      state: { cursor: null, cycles: 2, lastRunAt: 't' },
    } as any);
    await mount();
    await addTarget('target');
    await click('ARCHIVE');
    await click('RUN CYCLES');
    await click('LIVE FEED');
    expect((container.textContent || '')).toContain('hello world');
  });

  it('a network account card renders a single @ (handle already carries a leading @)', async () => {
    xls.captureFollowers.mockResolvedValueOnce({
      blocked: false,
      target: '@target',
      kind: 'followers',
      accounts: [{ handle: '@alice', displayName: 'Alice', bio: '', avatar: '' }],
    } as any);
    await mount();
    await addTarget('target');
    await click('FOLLOWER NETWORK');
    await click('CAPTURE FOLLOWERS');
    const handleSpan = Array.from(container.querySelectorAll('.xls-account-body span')).find((s) =>
      (s.textContent || '').includes('alice'),
    );
    expect(handleSpan?.textContent).toBe('@alice');
    expect(container.textContent || '').not.toContain('@@alice');
  });

  it('the rendered NotesPanel saves through saveNote({ caseId, findingId, text })', async () => {
    await mount();
    await addTarget('target');
    await click('CAPTURE POSTS'); // a finding to pin the note to
    await click('ANALYST NOTES');
    // select the captured finding → NotesPanel mounts for it
    await act(async () => { (container.querySelector('.xls-finding') as HTMLButtonElement).click(); });
    await act(async () => { await Promise.resolve(); }); // NotesPanel readNotes() settle
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    await setValue(ta, 'analyst observation');
    await click(/save note/i);
    expect(xls.saveNote).toHaveBeenCalledWith({ caseId: 'case-1', findingId: 'itm-1', text: 'analyst observation' });
  });

  it('toggling a collect setting persists the FULL xListening block (no sibling dataloss)', async () => {
    await mount();
    await click('SYSTEM');
    // click the "collect replies" checkbox label
    const checks = Array.from(container.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    await act(async () => { checks[0].click(); });
    await act(async () => { await Promise.resolve(); });
    expect(settings.update).toHaveBeenCalledWith({
      xListening: { collect: expect.objectContaining({ replies: true }), archiveCycles: false },
    });
  });
});
