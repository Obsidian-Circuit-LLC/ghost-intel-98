/**
 * A2 — post version history + profile-change snapshots + change events.
 *
 * Covers the Enterprise `post_changed` / `profile_change` / profile-snapshot logic rebuilt
 * onto OUR seams (store.ts `XPostArtifact.versionHistory`, the `changeEvents`/
 * `profileSnapshots` secure-fs sidecars, and `changes.ts`'s pure diff orchestration).
 * Every store op is exercised through the pure `makeXStore` factory over an in-memory fs seam
 * — no electron/vault.
 */
import { describe, it, expect } from 'vitest';

import {
  makeXStore,
  type XStore,
  type XStoreDeps,
  type XPostArtifact,
  type XChangeEvent,
  X_MAX_POST_VERSIONS,
  X_MAX_CHANGE_EVENTS,
} from '../src/main/x-listening/store';
import {
  ingestPostsWithHistory,
  snapshotProfile,
} from '../src/main/x-listening/changes';
import {
  canonicalProfileMetadata,
  profileMetadataSignature,
} from '../src/main/x-listening/evidence';

// ---- in-memory fs seam (mirrors x-listening-store.test.ts's memDeps) -------

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
    runLogPath: (id) => `x/${id}/x-run-log.json`,
  };
  return makeXStore(deps);
}

const CASE = 'case-a2';

function post(overrides: Partial<XPostArtifact> = {}): XPostArtifact {
  const base: XPostArtifact = {
    id: 'p1',
    platform: 'x',
    authorHandle: '@target',
    authorId: 'target',
    text: 'original text',
    mediaType: 'none',
    mediaRef: null,
    channelId: 'target',
    channelLabel: '@target',
    messageId: 'p1',
    publishedAt: '2026-08-12T00:00:00.000Z',
    harvestedAt: '2026-08-12T00:00:00.000Z',
    url: 'https://x.com/target/status/p1',
    provenance: { caseId: CASE, jobId: CASE, collectorVersion: 'x-listening/1.0.0' } as XPostArtifact['provenance'],
    kind: 'post',
    parentPostId: null,
    metrics: { replies: 0, reposts: 0, likes: 0, views: 0 },
    metricsRaw: { replies: '', reposts: '', likes: '', views: '' },
    evidenceHash: 'HASH-ORIGINAL',
  };
  return { ...base, ...overrides };
}

describe('A2 — post version history on re-ingest', () => {
  it('re-ingesting a post with CHANGED text appends exactly one version + emits exactly one post_changed', async () => {
    const store = memStore();
    // First ingest — a brand-new post: added, no version, no change event.
    const first = await ingestPostsWithHistory(CASE, [post()], { now: '2026-08-12T01:00:00.000Z' }, store);
    expect(first.added).toBe(1);
    expect(first.changed).toBe(0);
    expect(first.events).toHaveLength(0);

    // Re-ingest the SAME id with different text — the prior version is archived, one event fires.
    const second = await ingestPostsWithHistory(
      CASE,
      [post({ text: 'edited text', evidenceHash: 'HASH-EDITED' })],
      { now: '2026-08-12T02:00:00.000Z' },
      store,
    );
    expect(second.added).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.changed).toBe(1);
    expect(second.events).toHaveLength(1);
    expect(second.events[0]!.kind).toBe('post_changed');
    expect(second.events[0]!.postId).toBe('p1');
    expect(second.events[0]!.sourceUsername).toBe('@target');
    expect(second.events[0]!.at).toBe('2026-08-12T02:00:00.000Z');

    const stored = await store.posts.read(CASE);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.text).toBe('edited text');
    expect(stored[0]!.versionHistory).toHaveLength(1);
    expect(stored[0]!.versionHistory![0]!.text).toBe('original text');
    // The archived version carries the PRIOR post's evidence hash (reused from evidence.ts).
    expect(stored[0]!.versionHistory![0]!.sha256).toBe('HASH-ORIGINAL');

    // The change event landed in the secure-fs sidecar and is retrievable newest-first.
    const events = await store.listChangeEvents(CASE);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('post_changed');
  });

  it('re-ingesting an UNCHANGED post appends no version and emits no event (dedup)', async () => {
    const store = memStore();
    await ingestPostsWithHistory(CASE, [post()], { now: '2026-08-12T01:00:00.000Z' }, store);
    const again = await ingestPostsWithHistory(CASE, [post()], { now: '2026-08-12T02:00:00.000Z' }, store);
    expect(again.added).toBe(0);
    expect(again.skipped).toBe(1);
    expect(again.changed).toBe(0);
    expect(again.events).toHaveLength(0);
    const stored = await store.posts.read(CASE);
    expect(stored[0]!.versionHistory ?? []).toHaveLength(0);
    expect(await store.listChangeEvents(CASE)).toHaveLength(0);
  });

  it('version history is capped at X_MAX_POST_VERSIONS (drops oldest)', async () => {
    const store = memStore();
    await ingestPostsWithHistory(CASE, [post({ text: 'v0' })], { now: '2026-08-12T00:00:00.000Z' }, store);
    for (let i = 1; i <= X_MAX_POST_VERSIONS + 5; i++) {
      await ingestPostsWithHistory(
        CASE,
        [post({ text: `v${i}`, evidenceHash: `HASH-${i}` })],
        { now: `2026-08-12T00:00:${String(i).padStart(2, '0')}.000Z` },
        store,
      );
    }
    const stored = await store.posts.read(CASE);
    expect(stored[0]!.versionHistory).toHaveLength(X_MAX_POST_VERSIONS);
    // Oldest ('v0') was dropped; the newest archived version is the text just before the last write.
    const texts = stored[0]!.versionHistory!.map((v) => v.text);
    expect(texts).not.toContain('v0');
  });
});

describe('A2 — profile-change snapshots', () => {
  it('a changed bio emits a profile_change event; the baseline snapshot does NOT', async () => {
    const store = memStore();
    // Baseline snapshot — first time we see this profile: snapshot stored, NO change event.
    const base = await snapshotProfile(
      CASE,
      { profileId: 'prof-1', sourceUsername: 'target', bio: 'hello world' },
      { now: '2026-08-12T01:00:00.000Z' },
      store,
    );
    expect(base.changed).toBe(true);
    expect(base.event).toBeUndefined();
    expect(await store.listChangeEvents(CASE)).toHaveLength(0);

    // Same metadata again — no new snapshot, no event.
    const same = await snapshotProfile(
      CASE,
      { profileId: 'prof-1', sourceUsername: 'target', bio: 'hello world' },
      { now: '2026-08-12T02:00:00.000Z' },
      store,
    );
    expect(same.changed).toBe(false);
    expect(same.event).toBeUndefined();

    // Changed bio — profile_change fires.
    const changed = await snapshotProfile(
      CASE,
      { profileId: 'prof-1', sourceUsername: 'target', bio: 'goodbye world' },
      { now: '2026-08-12T03:00:00.000Z' },
      store,
    );
    expect(changed.changed).toBe(true);
    expect(changed.event).toBeDefined();
    expect(changed.event!.kind).toBe('profile_change');
    expect(changed.event!.profileId).toBe('prof-1');
    expect(changed.event!.at).toBe('2026-08-12T03:00:00.000Z');

    const snapshots = await store.profileSnapshots.read(CASE);
    expect(snapshots).toHaveLength(2); // baseline + changed (the identical middle one added nothing)
    const events = await store.listChangeEvents(CASE);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('profile_change');
  });
});

describe('A2 — deterministic profile-metadata signature', () => {
  it('the sha256 signature is identical across two runs on identical input', () => {
    const meta = { bio: 'analyst bio', avatar: 'x-media/abc', location: 'Berlin', website: 'https://example.org' };
    const a = profileMetadataSignature(meta);
    const b = profileMetadataSignature({ ...meta });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('canonicalProfileMetadata is a fixed-key-order literal (field reorder does not change the hash)', () => {
    const a = profileMetadataSignature({ bio: 'b', avatar: 'a', location: 'l', website: 'w' });
    const b = profileMetadataSignature({ website: 'w', location: 'l', avatar: 'a', bio: 'b' });
    expect(a).toBe(b);
    // A real content change DOES perturb the signature.
    const c = profileMetadataSignature({ bio: 'B', avatar: 'a', location: 'l', website: 'w' });
    expect(c).not.toBe(a);
    expect(canonicalProfileMetadata({ bio: ' trim me ' }).bio).toBe('trim me');
  });
});

describe('A2 — change-event log is capped newest-first', () => {
  it('listChangeEvents returns newest-first, capped at X_MAX_CHANGE_EVENTS', async () => {
    const store = memStore();
    for (let i = 0; i < X_MAX_CHANGE_EVENTS + 10; i++) {
      const ev: XChangeEvent = {
        id: `e${i}`,
        kind: 'post_unavailable',
        postId: `p${i}`,
        summary: `event ${i}`,
        at: `2026-08-12T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`,
      };
      await store.changeEvents.append(CASE, ev);
    }
    const listed = await store.listChangeEvents(CASE);
    expect(listed).toHaveLength(X_MAX_CHANGE_EVENTS);
    // Newest-first: the last appended event is first in the list.
    expect(listed[0]!.summary).toBe(`event ${X_MAX_CHANGE_EVENTS + 9}`);
    // The oldest events were dropped.
    expect(listed.some((e) => e.summary === 'event 0')).toBe(false);
  });
});

describe('A2 — atomicity: concurrent ingests must not clobber captured evidence', () => {
  it('serializes read-modify-write via posts.transform so every concurrently-ingested post survives', async () => {
    // Regression for the Phase-1 whole-branch finding: the first cut read+wrote the posts file in
    // SEPARATE lock acquisitions, so two concurrent ingests each read the same base and the second
    // write clobbered the first (last-writer-wins), silently dropping captured posts. The atomic
    // `posts.transform` does read+merge+write in ONE lock, so all concurrent appends survive.
    const store = memStore();
    await store.posts.write(CASE, [post({ id: 'seed', text: 'seed' })]);
    const ids = ['a', 'b', 'c', 'd', 'e'];
    await Promise.all(
      ids.map((id, i) =>
        ingestPostsWithHistory(
          CASE,
          [post({ id, text: `t-${id}` })],
          { now: `2026-08-12T00:00:0${i}.000Z` },
          store,
        ),
      ),
    );
    const finalIds = (await store.posts.read(CASE)).map((p) => p.id).sort();
    expect(finalIds).toEqual(['a', 'b', 'c', 'd', 'e', 'seed']);
  });
});
