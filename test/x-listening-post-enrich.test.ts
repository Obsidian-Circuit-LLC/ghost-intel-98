/**
 * Re-observing a post must ENRICH it with newly-available fields.
 *
 * FIELD BUG (GhostExodus, on v3.72.5): display pictures still absent after the release that started
 * capturing them. `posts.save` skips a post whose id is already stored — so the author avatar added
 * in v3.72.5 could only ever land on posts that were BRAND NEW after upgrading. An established
 * campaign already holds every recent post from its sources, so a fresh sweep adds almost nothing and
 * the stored posts never gain the field. The pictures were unreachable by construction, again.
 *
 * Enrichment is deliberately conservative: fill in values we did NOT have, never rewrite an observed
 * one. Evidence-bearing content (text, metrics, hashes, timestamps) is untouched, so re-observation
 * can never launder a change into an existing record.
 */
import { describe, it, expect } from 'vitest';
import { enrichExistingPost } from '../src/main/x-listening/store';

const base = {
  id: 'p1',
  text: 'original text',
  authorHandle: '@a',
  postEvidenceHash: 'hash-1',
  harvestedAt: '2026-08-01T00:00:00.000Z',
} as Record<string, unknown>;

describe('enrichExistingPost', () => {
  it('fills in an avatar the stored post never had', () => {
    const out = enrichExistingPost({ ...base }, { ...base, avatar: 'https://pbs.twimg.com/profile_images/1/a.jpg' });
    expect(out.changed).toBe(true);
    expect(out.post.avatar).toBe('https://pbs.twimg.com/profile_images/1/a.jpg');
  });

  it('fills in a display name the stored post never had', () => {
    const out = enrichExistingPost({ ...base }, { ...base, displayName: 'Alberto Daniel Hill' });
    expect(out.post.displayName).toBe('Alberto Daniel Hill');
  });

  it('does NOT overwrite a value already observed', () => {
    const out = enrichExistingPost(
      { ...base, avatar: 'https://pbs.twimg.com/profile_images/1/old.jpg' },
      { ...base, avatar: 'https://pbs.twimg.com/profile_images/1/new.jpg' },
    );
    expect(out.post.avatar).toBe('https://pbs.twimg.com/profile_images/1/old.jpg');
    expect(out.changed).toBe(false);
  });

  it('NEVER touches evidence-bearing content', () => {
    const out = enrichExistingPost(
      { ...base },
      { ...base, text: 'rewritten text', postEvidenceHash: 'hash-2', harvestedAt: '2026-09-09T00:00:00.000Z', metrics: { likes: 99 } },
    );
    expect(out.post.text).toBe('original text');
    expect(out.post.postEvidenceHash).toBe('hash-1');
    expect(out.post.harvestedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(out.post.metrics).toBeUndefined();
  });

  it('reports no change when the fresh observation adds nothing', () => {
    const out = enrichExistingPost({ ...base, avatar: 'x' }, { ...base, avatar: 'x' });
    expect(out.changed).toBe(false);
  });

  it('ignores an empty incoming value — absence never overwrites presence, or creates a blank', () => {
    const out = enrichExistingPost({ ...base }, { ...base, avatar: '', displayName: '   ' });
    expect(out.changed).toBe(false);
    expect(out.post.avatar).toBeUndefined();
    expect(out.post.displayName).toBeUndefined();
  });
});
