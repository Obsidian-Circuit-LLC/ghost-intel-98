// @vitest-environment node
/**
 * VERIFY LIVE, end to end, through the REAL `verifyPost` — nothing about capture is mocked except
 * the window/network seams it already exposes for that purpose.
 *
 * The sibling file (`xls-embed-field-actions.test.ts`) proves the handler INJECTS a store. This one
 * proves the store it injects is one `verifyPost` can actually work against: his finding is found,
 * the outcome lands back on HIS record, and a `post_unavailable` reaches HIS change-event stream in
 * his field shape (`type`/`observedAt`), not the artifact's (`kind`/`at`).
 *
 * Mutation check performed when this was written: pointing `makeStationXStore` at an empty
 * document reproduces the field error verbatim — "Post not found in this campaign."
 */
import { describe, expect, it } from 'vitest';
import { verifyPost } from '../src/main/x-listening/capture';
import { makeStationXStore } from '../src/main/xls-embed/station-x-store';
import { defaultStationState, type PersistedStationState } from '../src/main/xls-embed/state-store';

const CASE_ID = 'ba5eba11-0000-4000-8000-00000000cafe';
const URL_1 = 'https://x.com/ExodusGhost/status/2073007611022004413';

function documentWithOnePost(): PersistedStationState {
  const s = defaultStationState(() => 'T0', () => 'seed') as PersistedStationState;
  s.activeCaseId = CASE_ID;
  s.cases = [{ id: CASE_ID, name: 'Operation Midnight', description: '', createdAt: 'T0', updatedAt: 'T0' }];
  s.posts = [{
    id: 'post-1', caseId: CASE_ID, profileId: 'profile-1', username: 'ExodusGhost',
    sourceUsername: 'exodusghost', url: URL_1, text: 'original text',
    createdAt: 'T0', collectedAt: 'T0', kind: 'post', isReply: false, parentPostId: null,
    metrics: { replies: 11, reposts: 2, likes: 16, views: 0 }, media: [], evidenceHash: 'h0',
  }] as never;
  return s;
}

/** The capture seams `verifyPost` already injects — no electron, no network, no Tor. */
function deps(page: { body: string; items: Array<{ id: string; text: string }> }) {
  const win = { destroyed: false, isDestroyed: () => win.destroyed, destroy: () => { win.destroyed = true; } };
  return {
    win,
    overrides: {
      loadClearnetEnabled: async () => true,
      resolveGate: () => ({ blocked: false }) as never,
      openWindow: async () => win as never,
      runCapture: async () => page,
      guard: async <T,>(_w: unknown, capture: () => Promise<T>) => ({ blocked: false, result: await capture() }),
      delay: async () => undefined,
      now: () => '2026-09-06T12:00:00.000Z',
    },
  };
}

function storeOver(s: PersistedStationState) {
  let saves = 0;
  const store = makeStationXStore(s, async () => { saves += 1; }, { makeId: () => 'event-1' });
  return { store, saves: () => saves };
}

describe('verifyPost against his document', () => {
  it('finds his finding and stamps an available verification onto his record', async () => {
    const s = documentWithOnePost();
    const { store, saves } = storeOver(s);
    const { win, overrides } = deps({ body: 'a normal thread', items: [{ id: '2073007611022004413', text: 'original text' }] });

    const result = await verifyPost(CASE_ID, 'post-1', overrides as never, store);

    expect(result).toEqual({ availability: 'available', verifiedAt: '2026-09-06T12:00:00.000Z', changed: false });
    expect(s.posts[0].availability).toBe('available');
    expect(s.posts[0].verifiedAt).toBe('2026-09-06T12:00:00.000Z');
    expect(s.posts[0].text).toBe('original text');
    expect(saves()).toBe(1);
    expect(win.destroyed, 'the verify window is always destroyed').toBe(true);
  });

  it('records an unavailable post as unavailable, with a change event in HIS shape', async () => {
    const s = documentWithOnePost();
    const { store } = storeOver(s);
    const { overrides } = deps({ body: 'This post is unavailable.', items: [] });

    const result = await verifyPost(CASE_ID, 'post-1', overrides as never, store);

    expect(result.availability).toBe('unavailable');
    expect(s.posts[0].availability).toBe('unavailable');
    const event = s.changeEvents.at(-1)!;
    expect(event.caseId).toBe(CASE_ID);
    // HIS CHANGE INTEL reads `type` and `observedAt`; the artifact calls them `kind` and `at`.
    expect(event.type).toBe('post_unavailable');
    expect(event.observedAt).toBe('2026-09-06T12:00:00.000Z');
    expect(event.sourceUsername).toBe('exodusghost');
    expect(event.details).toEqual({ postId: 'post-1' });
  });

  it('archives the prior version when the live post has been edited', async () => {
    const s = documentWithOnePost();
    const { store } = storeOver(s);
    const { overrides } = deps({ body: 'a normal thread', items: [{ id: '2073007611022004413', text: 'edited text' }] });

    const result = await verifyPost(CASE_ID, 'post-1', overrides as never, store);

    expect(result.changed).toBe(true);
    expect(s.posts[0].text).toBe('edited text');
    expect(s.posts[0].versionHistory?.[0]?.text).toBe('original text');
    expect(s.posts[0].evidenceHash).not.toBe('h0');
  });

  it('refuses any store member it does not implement rather than silently using another path', () => {
    const s = documentWithOnePost();
    const { store } = storeOver(s);
    expect(() => (store as unknown as { networks: unknown }).networks).toThrow(/does not implement networks/);
  });
});
