/**
 * Phase-3 whole-branch review — Critical (evidence contamination) + the untested unattended
 * clearnet composition.
 *
 * 1. `defaultSchedulerDeps().listSources` must derive a sweep's `targetUsername` from the MONITORED
 *    channel (channelId), never from a post's `authorHandle`. For a reply/comment row extract.ts
 *    stores channelId = the monitored target but authorHandle = the third-party author, so keying the
 *    unattended sweep on authorHandle would sweep a commenter's timeline and file it under the
 *    target's channel (contamination) and defeat F1's per-source image override on the scheduled path.
 * 2. `requireAckedClearnet` (the composition BOTH unattended paths call) must be true ONLY when
 *    clearnet AND clearnetAck are both set — the whole background fail-closed guarantee.
 */
import { describe, it, expect, vi } from 'vitest';

const readPosts = vi.fn();
vi.mock('../src/main/x-listening/store', () => ({
  prodXStore: async () => ({ posts: { read: readPosts } }),
}));

import { defaultSchedulerDeps } from '../src/main/x-listening/scheduler';
import { requireAckedClearnet } from '../src/main/x-listening/capture';

describe('scheduler listSources — sweep target is the monitored channel, not a post author', () => {
  it('yields targetUsername === channelId even when the first-seen row is a reply by someone else', async () => {
    // A single monitored channel (@dcs_vortex) whose first stored row is a THIRD-PARTY comment:
    // channelId is the monitored target, authorHandle is the commenter.
    readPosts.mockResolvedValueOnce([
      { channelId: 'dcs_vortex', authorHandle: 'randomcommenter', channelLabel: '@dcs_vortex', kind: 'comment' },
      { channelId: 'dcs_vortex', authorHandle: 'dcs_vortex', channelLabel: '@dcs_vortex', kind: 'post' },
    ]);
    const sources = await defaultSchedulerDeps().listSources('case-x');
    expect(sources).toHaveLength(1);
    expect(sources[0]!.channelId).toBe('dcs_vortex');
    // The bug set this to 'randomcommenter' (the commenter) — it must be the monitored channel.
    expect(sources[0]!.targetUsername).toBe('dcs_vortex');
  });

  it('falls back to authorHandle only when a source genuinely has no channelId (self-post source)', async () => {
    readPosts.mockResolvedValueOnce([
      { channelId: '', authorHandle: 'soloacct', channelLabel: '@soloacct', kind: 'post' },
    ]);
    const sources = await defaultSchedulerDeps().listSources('case-y');
    expect(sources[0]!.targetUsername).toBe('soloacct');
  });
});

describe('requireAckedClearnet — unattended (scheduler + avatar-repair) fail-closed clearnet gate', () => {
  it('is true ONLY when clearnet AND clearnetAck are both true', () => {
    expect(requireAckedClearnet({ xListening: { clearnet: true, clearnetAck: true } })).toBe(true);
  });
  it('fails closed for clearnet-without-ack (the whole guarantee)', () => {
    expect(requireAckedClearnet({ xListening: { clearnet: true, clearnetAck: false } })).toBe(false);
  });
  it('fails closed for ack-without-clearnet', () => {
    expect(requireAckedClearnet({ xListening: { clearnet: false, clearnetAck: true } })).toBe(false);
  });
  it('fails closed for missing / empty / nullish settings', () => {
    expect(requireAckedClearnet({ xListening: {} })).toBe(false);
    expect(requireAckedClearnet({})).toBe(false);
    expect(requireAckedClearnet(null)).toBe(false);
    expect(requireAckedClearnet(undefined)).toBe(false);
  });
});
