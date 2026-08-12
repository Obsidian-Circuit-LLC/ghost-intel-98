/**
 * A1 — live post verification ("VERIFY LIVE").
 *
 * Rebuilds Enterprise `verifyPostLive` (`main.cjs:2620-2668`) onto OUR hardened seams:
 *  - the availability-language matcher (`isPostUnavailableText`, extract.ts) that classifies a
 *    "this post is unavailable/deleted/removed" body — pure, no DOM;
 *  - `verifyPost` (capture.ts) which opens the real post URL in a Tor-gated capture window
 *    (`resolveXTorGate`, FAIL CLOSED — no clearnet fallback), reuses the openPostThread
 *    scheme/host/path guards + the `^[A-Za-z0-9_]{1,15}$` username validator, and routes an
 *    observed text edit through A2's `ingestPostsWithHistory` (prior version archived +
 *    `post_changed` emitted) / an unavailable post through A2's `markPostUnavailable`
 *    (`post_unavailable` emitted, availability updated).
 *
 * Every store op runs through the pure `makeXStore` factory over an in-memory fs seam (mirrors
 * x-listening-changes.test.ts); the window/gate/probe are injected deps — no electron, no network.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  makeXStore,
  type XStore,
  type XStoreDeps,
  type XPostArtifact,
} from '../src/main/x-listening/store';
import { verifyPost, type XVerifyPostDeps } from '../src/main/x-listening/capture';
import { isPostUnavailableText, X_POST_UNAVAILABLE_RE } from '../src/main/x-listening/extract';

// ---- in-memory fs seam (mirrors x-listening-changes.test.ts's memStore) -------

function memStore(): XStore {
  const files = new Map<string, string>();
  const enoent = (p: string): Error => {
    const e = new Error(`ENOENT: ${p}`);
    (e as NodeJS.ErrnoException).code = 'ENOENT';
    return e;
  };
  const deps: XStoreDeps = {
    readFile: async (p) => {
      if (!files.has(p)) throw enoent(p);
      return Buffer.from(files.get(p)!, 'utf8');
    },
    writeFile: async (p, d) => {
      files.set(p, d);
    },
    itemsPath: (id) => `x/${id}/x-items.json`,
    notesPath: (id) => `x/${id}/x-notes.json`,
    networksPath: (id) => `x/${id}/x-networks.json`,
    archiveStatePath: (id) => `x/${id}/x-archive-state.json`,
    postsPath: (id) => `x/${id}/x-posts.json`,
    presetsPath: (id) => `x/${id}/x-presets.json`,
    entitiesCachePath: (id) => `x/${id}/x-entities-cache.json`,
    changeEventsPath: (id) => `x/${id}/x-change-events.json`,
    profileSnapshotsPath: (id) => `x/${id}/x-profile-snapshots.json`,
  };
  return makeXStore(deps);
}

const CASE = 'case-a1';

function post(overrides: Partial<XPostArtifact> = {}): XPostArtifact {
  const base: XPostArtifact = {
    id: '100',
    platform: 'x',
    authorHandle: '@target',
    authorId: 'target',
    text: 'original text',
    mediaType: 'none',
    mediaRef: null,
    channelId: 'target',
    channelLabel: '@target',
    messageId: '100',
    publishedAt: '2026-08-12T00:00:00.000Z',
    harvestedAt: '2026-08-12T00:00:00.000Z',
    url: 'https://x.com/target/status/100',
    provenance: { caseId: CASE, jobId: CASE, collectorVersion: 'x-listening/1.0.0' } as XPostArtifact['provenance'],
    kind: 'post',
    parentPostId: null,
    metrics: { replies: 0, reposts: 0, likes: 0, views: 0 },
    metricsRaw: { replies: '', reposts: '', likes: '', views: '' },
    evidenceHash: 'HASH-ORIGINAL',
  };
  return { ...base, ...overrides };
}

function fakeWin() {
  return {
    isDestroyed: () => false,
    destroy: vi.fn(),
    webContents: { executeJavaScript: vi.fn() },
  } as unknown as Electron.BrowserWindow;
}

function deps(over: Partial<XVerifyPostDeps> = {}): Partial<XVerifyPostDeps> {
  return {
    loadClearnetEnabled: async () => false,
    resolveGate: () => ({ blocked: false, proxy: { socks: '127.0.0.1:9050' } }),
    openWindow: async () => fakeWin(),
    guard: async (_win, capture) => ({ blocked: false, result: await capture() }),
    runCapture: async () => ({ body: '', items: [{ id: '100', text: 'original text' }] }),
    now: () => '2026-08-12T12:00:00.000Z',
    ...over,
  };
}

// ---- 1. availability-language matcher (pure) ------------------------------

describe('A1 — availability-language matcher', () => {
  it('flags unavailable / deleted / removed post copy', () => {
    for (const s of [
      'This post is unavailable',
      'Post deleted',
      'This post was deleted',
      'This post has been removed',
      "Hmm...this page doesn't exist",
      'Nothing to see here',
    ]) {
      expect(isPostUnavailableText(s), s).toBe(true);
    }
  });

  it('does NOT flag an ordinary live post body (no over-matching)', () => {
    expect(isPostUnavailableText('Just a normal tweet about the weather today.')).toBe(false);
    expect(isPostUnavailableText('')).toBe(false);
    expect(X_POST_UNAVAILABLE_RE.test('a routine status update')).toBe(false);
  });
});

// ---- 2. verifyPost fails closed when Tor is unavailable + clearnet off -----

describe('A1 — verifyPost fails closed (no clearnet fallback)', () => {
  it('throws and opens NO capture window when the Tor gate is blocked and clearnet not acked', async () => {
    const store = memStore();
    await store.posts.write(CASE, [post()]);
    const openWindow = vi.fn(async () => fakeWin());
    await expect(
      verifyPost(
        CASE,
        '100',
        deps({
          loadClearnetEnabled: async () => false,
          resolveGate: () => ({
            blocked: true,
            reason: 'Tor is not ready — X capture is blocked (no clearnet fallback).',
          }),
          openWindow,
        }),
        store,
      ),
    ).rejects.toThrow(/Tor is not ready|blocked/i);
    expect(openWindow).not.toHaveBeenCalled();
    // Availability was never mutated because the capture never ran.
    const stored = await store.posts.read(CASE);
    expect(stored[0]!.availability).toBeUndefined();
  });

  it('rejects a stored post whose URL is off-host, never opening a window', async () => {
    const store = memStore();
    await store.posts.write(CASE, [post({ url: 'https://evil.example.com/target/status/100' })]);
    const openWindow = vi.fn(async () => fakeWin());
    await expect(verifyPost(CASE, '100', deps({ openWindow }), store)).rejects.toThrow(
      /non-X|valid X status/i,
    );
    expect(openWindow).not.toHaveBeenCalled();
  });
});

// ---- 3. an edited live post appends a version + emits post_changed ---------

describe('A1 — verifyPost detects an edit', () => {
  it('appends exactly one version, emits one post_changed, marks the post available', async () => {
    const store = memStore();
    await store.posts.write(CASE, [post()]);
    const res = await verifyPost(
      CASE,
      '100',
      deps({ runCapture: async () => ({ body: 'ordinary body', items: [{ id: '100', text: 'EDITED live text' }] }) }),
      store,
    );
    expect(res.availability).toBe('available');
    expect(res.changed).toBe(true);
    expect(res.verifiedAt).toBe('2026-08-12T12:00:00.000Z');

    const stored = await store.posts.read(CASE);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.text).toBe('EDITED live text');
    expect(stored[0]!.versionHistory).toHaveLength(1);
    expect(stored[0]!.versionHistory![0]!.text).toBe('original text');
    // The archived version carries the PRIOR post's evidence hash (reused from evidence.ts).
    expect(stored[0]!.versionHistory![0]!.sha256).toBe('HASH-ORIGINAL');
    expect(stored[0]!.availability).toBe('available');
    expect(stored[0]!.verifiedAt).toBe('2026-08-12T12:00:00.000Z');

    const events = await store.listChangeEvents(CASE);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('post_changed');
    expect(events[0]!.postId).toBe('100');
  });

  it('an UNCHANGED live post archives no version and emits no event, but stamps availability', async () => {
    const store = memStore();
    await store.posts.write(CASE, [post()]);
    const res = await verifyPost(
      CASE,
      '100',
      deps({ runCapture: async () => ({ body: 'ordinary body', items: [{ id: '100', text: 'original text' }] }) }),
      store,
    );
    expect(res.availability).toBe('available');
    expect(res.changed).toBe(false);
    const stored = await store.posts.read(CASE);
    expect(stored[0]!.versionHistory ?? []).toHaveLength(0);
    expect(stored[0]!.availability).toBe('available');
    expect(await store.listChangeEvents(CASE)).toHaveLength(0);
  });
});

// ---- 4. an unavailable post emits post_unavailable + updates availability --

describe('A1 — verifyPost detects an unavailable post', () => {
  it('emits post_unavailable, marks the post unavailable, archives no version', async () => {
    const store = memStore();
    await store.posts.write(CASE, [post()]);
    const res = await verifyPost(
      CASE,
      '100',
      deps({ runCapture: async () => ({ body: 'This post is unavailable', items: [] }) }),
      store,
    );
    expect(res.availability).toBe('unavailable');
    expect(res.changed).toBe(false);

    const stored = await store.posts.read(CASE);
    expect(stored[0]!.availability).toBe('unavailable');
    expect(stored[0]!.versionHistory ?? []).toHaveLength(0);
    // Original text is untouched — an unavailable post is not an edit.
    expect(stored[0]!.text).toBe('original text');

    const events = await store.listChangeEvents(CASE);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('post_unavailable');
    expect(events[0]!.postId).toBe('100');
  });

  it('re-verifying an already-unavailable post does NOT emit a duplicate event', async () => {
    const store = memStore();
    await store.posts.write(CASE, [post({ availability: 'unavailable' })]);
    const res = await verifyPost(
      CASE,
      '100',
      deps({ runCapture: async () => ({ body: 'This post is unavailable', items: [] }) }),
      store,
    );
    expect(res.availability).toBe('unavailable');
    expect(await store.listChangeEvents(CASE)).toHaveLength(0);
  });
});
