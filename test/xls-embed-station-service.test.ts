// @vitest-environment node
/**
 * The embedded station's pure document operations — PORTED from GhostExodus's `electron/main.cjs`,
 * not re-derived from our own model.
 *
 * Roughly 25 of his 47 handlers touch nothing but the state document: create a campaign, add a
 * profile, write a note, save a preset. Those are transcribed here as pure functions over his
 * document so they can be tested without Electron, a window, or the network — and so the next
 * person can diff them against his source line by line.
 *
 * Every expectation below is his behaviour, taken from his handlers, including the parts that look
 * like quirks: campaign duplication names the copy "<name> Copy" and remaps preset profileIds
 * through the cloned profiles; deleting a campaign refuses to remove the last one and cascades all
 * thirteen collections; removing a profile cascades to the posts it collected and everything
 * hanging off them. Getting any of these subtly wrong is exactly how the port drifted from his app
 * the first five times.
 */
import { describe, expect, it } from 'vitest';
import { defaultStationState } from '../src/main/xls-embed/state-store';
import { postFromArtifact } from '../src/main/xls-embed/migrate';
import {
  clientState,
  createCampaign,
  updateCampaign,
  duplicateCampaign,
  deleteCampaign,
  switchCampaign,
  addProfile,
  removeProfile,
  addNote,
  updateNote,
  removeNote,
  savePreset,
  removePreset,
  saveSettings,
  clearCollectedPosts,
  normalizeUsername,
} from '../src/main/xls-embed/station-service';

const NOW = '2026-08-24T12:00:00.000Z';
let seq = 0;
const ids = () => `id-${++seq}`;

function fresh() {
  seq = 0;
  return defaultStationState(() => NOW, ids);
}

const ctx = { now: () => NOW, makeId: ids };

describe('normalizeUsername — his gate', () => {
  it('accepts a bare handle, an @handle and a profile URL', () => {
    expect(normalizeUsername('alice')).toBe('alice');
    expect(normalizeUsername('@alice')).toBe('alice');
    expect(normalizeUsername('https://x.com/alice')).toBe('alice');
    expect(normalizeUsername('https://twitter.com/alice/status/1')).toBe('alice');
  });

  it('rejects anything X could not be', () => {
    expect(() => normalizeUsername('')).toThrow();
    expect(() => normalizeUsername('has spaces')).toThrow();
    expect(() => normalizeUsername('waytoolongusername12345')).toThrow();
    expect(() => normalizeUsername('bad-dash')).toThrow();
  });
});

describe('campaigns (his `cases` collection)', () => {
  it('creates one, makes it active and seeds its settings', () => {
    const s = fresh();
    createCampaign(s, { name: '  Operation Midnight  ', purpose: 'watch' }, ctx);
    expect(s.cases).toHaveLength(2);
    const made = s.cases[1];
    expect(made.name).toBe('Operation Midnight'); // trimmed
    expect(s.activeCaseId).toBe(made.id);
    expect(s.campaignSettings[made.id]).toBeDefined();
    expect(s.archive.nextOperationIndex).toBe(0);
  });

  it('requires a name', () => {
    const s = fresh();
    expect(() => createCampaign(s, { name: '   ' }, ctx)).toThrow(/name is required/i);
  });

  it('updates in place and stamps updatedAt', () => {
    const s = fresh();
    const id = s.cases[0].id;
    updateCampaign(s, id, { name: 'Renamed', purpose: 'p', description: 'd' }, ctx);
    expect(s.cases[0].name).toBe('Renamed');
    expect(s.cases[0].purpose).toBe('p');
    expect(s.cases[0].updatedAt).toBe(NOW);
  });

  it('duplicates with his exact semantics — "Copy", cloned profiles, remapped preset ids', () => {
    const s = fresh();
    const src = s.cases[0].id;
    addProfile(s, 'alice', ctx);
    const profileId = s.profiles[0].id;
    savePreset(s, { name: 'kw', keywords: ['a'], mode: 'any', caseSensitive: false, profileIds: [profileId], enabled: true }, ctx);

    duplicateCampaign(s, src, ctx);

    const copy = s.cases[1];
    expect(copy.name).toBe('Primary Campaign Copy');
    expect(s.activeCaseId).toBe(copy.id);
    // The profile is cloned into the copy with fresh collection bookkeeping.
    const cloned = s.profiles.find((p) => p.caseId === copy.id)!;
    expect(cloned.username).toBe('alice');
    expect(cloned.id).not.toBe(profileId);
    expect(cloned.collectedCount).toBe(0);
    expect(cloned.lastCheckedAt).toBeNull();
    // The preset follows, and its profileIds point at the CLONE, not the original.
    const clonedPreset = s.presets.find((p) => p.caseId === copy.id)!;
    expect(clonedPreset.profileIds).toEqual([cloned.id]);
  });

  it('refuses to delete the last campaign', () => {
    const s = fresh();
    expect(() => deleteCampaign(s, s.cases[0].id, ctx)).toThrow(/at least one/i);
  });

  it('deletes and cascades all thirteen collections', () => {
    const s = fresh();
    const first = s.cases[0].id;
    addProfile(s, 'alice', ctx);
    s.posts.push({ id: 'p1', caseId: first, profileId: s.profiles[0].id } as never);
    s.notes.push({ id: 'n1', caseId: first, postId: 'p1' } as never);
    s.entities.push({ id: 'e1', caseId: first } as never);
    createCampaign(s, { name: 'Second' }, ctx);

    deleteCampaign(s, first, ctx);

    expect(s.cases.map((c) => c.name)).toEqual(['Second']);
    expect(s.profiles).toHaveLength(0);
    expect(s.posts).toHaveLength(0);
    expect(s.notes).toHaveLength(0);
    expect(s.entities).toHaveLength(0);
    expect(s.campaignSettings[first]).toBeUndefined();
    expect(s.activeCaseId).toBe(s.cases[0].id);
  });

  it('switches only to a campaign that exists', () => {
    const s = fresh();
    createCampaign(s, { name: 'Second' }, ctx);
    switchCampaign(s, s.cases[0].id);
    expect(s.activeCaseId).toBe(s.cases[0].id);
    expect(() => switchCampaign(s, 'nope')).toThrow(/not found/i);
  });
});

describe('profiles', () => {
  it('adds a normalised profile to the active campaign', () => {
    const s = fresh();
    addProfile(s, '@Alice', ctx);
    expect(s.profiles).toHaveLength(1);
    expect(s.profiles[0].username).toBe('Alice');
    expect(s.profiles[0].displayName).toBe('@Alice');
    expect(s.profiles[0].caseId).toBe(s.activeCaseId);
    expect(s.profiles[0].imageMode).toBe('inherit');
  });

  it('rejects a duplicate in the same campaign, case-insensitively', () => {
    const s = fresh();
    addProfile(s, 'alice', ctx);
    expect(() => addProfile(s, 'ALICE', ctx)).toThrow(/already in this case/i);
  });

  it('allows the same handle in a DIFFERENT campaign', () => {
    const s = fresh();
    addProfile(s, 'alice', ctx);
    createCampaign(s, { name: 'Second' }, ctx);
    expect(() => addProfile(s, 'alice', ctx)).not.toThrow();
    expect(s.profiles).toHaveLength(2);
  });

  it('removing a profile cascades its posts and everything hanging off them', () => {
    const s = fresh();
    addProfile(s, 'alice', ctx);
    const pid = s.profiles[0].id;
    const caseId = s.activeCaseId;
    s.posts.push({ id: 'p1', caseId, profileId: pid } as never);
    s.notes.push({ id: 'n1', caseId, postId: 'p1' } as never);
    s.matches.push({ id: 'm1', caseId, postId: 'p1' } as never);
    s.relationships.push({ id: 'r1', caseId, profileId: pid } as never);
    s.collectionRuns.push({ id: 'cr1', caseId, profileId: pid } as never);

    removeProfile(s, pid, ctx);

    expect(s.profiles).toHaveLength(0);
    expect(s.posts).toHaveLength(0);
    expect(s.notes).toHaveLength(0);
    expect(s.matches).toHaveLength(0);
    expect(s.relationships).toHaveLength(0);
    expect(s.collectionRuns).toHaveLength(0);
  });

  it('will not remove a profile belonging to another campaign', () => {
    const s = fresh();
    addProfile(s, 'alice', ctx);
    const pid = s.profiles[0].id;
    createCampaign(s, { name: 'Second' }, ctx);
    expect(() => removeProfile(s, pid, ctx)).toThrow(/not found in the active campaign/i);
  });
});

describe('notes and presets', () => {
  it('adds, edits and removes a note', () => {
    const s = fresh();
    const n = addNote(s, 'p1', 'first', ctx);
    expect(s.notes).toHaveLength(1);
    updateNote(s, n.id, 'edited', ctx);
    expect(s.notes[0].text).toBe('edited');
    expect(s.notes[0].updatedAt).toBe(NOW);
    removeNote(s, n.id);
    expect(s.notes).toHaveLength(0);
  });

  it('rejects an empty note', () => {
    const s = fresh();
    expect(() => addNote(s, 'p1', '   ', ctx)).toThrow();
  });

  it('saves a preset scoped to the active campaign and removes it', () => {
    const s = fresh();
    const p = savePreset(s, { name: 'kw', keywords: ['alpha'], mode: 'any', caseSensitive: false, profileIds: [], enabled: true }, ctx);
    expect(s.presets).toHaveLength(1);
    expect(s.presets[0].caseId).toBe(s.activeCaseId);
    removePreset(s, p.id);
    expect(s.presets).toHaveLength(0);
  });
});

describe('settings and data', () => {
  it('saves settings against the ACTIVE campaign, leaving others alone', () => {
    const s = fresh();
    const first = s.activeCaseId;
    createCampaign(s, { name: 'Second' }, ctx);
    saveSettings(s, { ...s.settings, intervalMinutes: 5 });
    expect(s.campaignSettings[s.activeCaseId].intervalMinutes).toBe(5);
    expect(s.campaignSettings[first]?.intervalMinutes ?? 30).toBe(30);
  });

  it('clears collected posts for the active campaign only', () => {
    const s = fresh();
    const first = s.activeCaseId;
    s.posts.push({ id: 'p1', caseId: first } as never);
    s.entities.push({ id: 'e1', caseId: first } as never);
    createCampaign(s, { name: 'Second' }, ctx);
    s.posts.push({ id: 'p2', caseId: s.activeCaseId } as never);

    clearCollectedPosts(s);

    expect(s.posts.map((p) => p.id)).toEqual(['p1']); // the other campaign's post survives
    expect(s.entities.map((e) => e.id)).toEqual(['e1']);
  });
});

describe('clientState — what his renderer actually receives', () => {
  it('filters every collection to the active campaign', () => {
    const s = fresh();
    const first = s.activeCaseId;
    s.posts.push({ id: 'p1', caseId: first } as never);
    createCampaign(s, { name: 'Second' }, ctx);
    s.posts.push({ id: 'p2', caseId: s.activeCaseId } as never);

    const view = clientState(s);
    expect(view.posts.map((p) => p.id)).toEqual(['p2']);
    // …but the campaign LIST is not filtered — the picker needs all of them.
    expect(view.cases).toHaveLength(2);
  });

  it('caps the log collections the way his getClientState does', () => {
    const s = fresh();
    const caseId = s.activeCaseId;
    for (let i = 0; i < 2500; i++) s.changeEvents.push({ id: `c${i}`, caseId } as never);
    for (let i = 0; i < 1200; i++) s.collectionRuns.push({ id: `r${i}`, caseId } as never);
    for (let i = 0; i < 2500; i++) s.networkEvents.push({ id: `n${i}`, caseId } as never);
    for (let i = 0; i < 300; i++) s.networkSnapshots.push({ id: `s${i}`, caseId } as never);

    const view = clientState(s);
    expect(view.changeEvents).toHaveLength(2000);
    expect(view.collectionRuns).toHaveLength(1000);
    expect(view.networkEvents).toHaveLength(2000);
    expect(view.networkSnapshots).toHaveLength(200);
    // The cap keeps the NEWEST (his `.slice(-n)`).
    expect((view.changeEvents.at(-1) as { id: string }).id).toBe('c2499');
  });

  it('serves the active campaign settings, not the base ones', () => {
    const s = fresh();
    saveSettings(s, { ...s.settings, scrollPasses: 42 });
    expect(clientState(s).settings.scrollPasses).toBe(42);
  });
});

describe('postFromArtifact — one mapping for capture AND migration', () => {
  const artifact = {
    id: 'p1', channelId: 'darkwebtoday', authorHandle: 'darkwebtoday', displayName: 'DWT',
    avatar: 'https://pbs.twimg.com/profile_images/1/a.jpg',
    text: 'hello', url: 'https://x.com/darkwebtoday/status/1',
    publishedAt: '2026-08-01T10:00:00.000Z', harvestedAt: '2026-08-01T11:00:00.000Z',
    kind: 'reply', parentPostId: 'p0',
    metrics: { replies: 1, reposts: 2, likes: 3, views: 4 },
    evidenceHash: 'abc', mediaRefs: ['x-media/' + 'c'.repeat(64)],
  };

  it("maps the artifact's `mediaRefs` onto HIS `media`", () => {
    // His model reads Post.media; the capture artifact calls it mediaRefs. Capture and migration
    // were two separate mappings and they drifted — migration carried media and the avatar, the
    // capture path spread the artifact and set neither, so old posts had pictures and newly
    // collected ones never did.
    const post = postFromArtifact(artifact as never, {
      caseId: 'c1', profileId: 'pr1', source: 'darkwebtoday', now: NOW,
    });
    expect(post.media).toEqual(['x-media/' + 'c'.repeat(64)]);
  });

  it('carries the avatar, which is where his display pictures come from', () => {
    const post = postFromArtifact(artifact as never, {
      caseId: 'c1', profileId: 'pr1', source: 'darkwebtoday', now: NOW,
    });
    expect(post.avatar).toBe('https://pbs.twimg.com/profile_images/1/a.jpg');
  });

  it('keeps his publish/collect distinction and his reply flag', () => {
    const post = postFromArtifact(artifact as never, {
      caseId: 'c1', profileId: 'pr1', source: 'darkwebtoday', now: NOW,
    });
    expect(post.createdAt).toBe('2026-08-01T10:00:00.000Z');
    expect(post.collectedAt).toBe('2026-08-01T11:00:00.000Z');
    expect(post.kind).toBe('reply');
    expect(post.isReply).toBe(true);
    expect(post.metrics).toEqual({ replies: 1, reposts: 2, likes: 3, views: 4 });
  });

  it('records the SOURCE it was collected from, not the author', () => {
    // On a reply or repost the author is a third party; the source is the monitored target.
    const post = postFromArtifact({ ...artifact, authorHandle: 'someone_else' } as never, {
      caseId: 'c1', profileId: 'pr1', source: 'darkwebtoday', now: NOW,
    });
    expect(post.sourceUsername).toBe('darkwebtoday');
    expect(post.username).toBe('someone_else');
  });
});
