/**
 * One-time carry-over of GhostExodus's existing campaigns into the embedded station.
 *
 * WHY THIS EXISTS. The embed keeps his single state document at a new path and reads nothing from
 * `scrapingCaseDir('x', …)`, where every campaign, post, follower network and note collected up to
 * v3.72.8 lives. Nothing was deleted — but on upgrading to v3.73.0 he opened the station to a fresh
 * "Primary Campaign" with nothing in it, which from where he is sitting is indistinguishable from
 * losing the lot. That is a worse failure than the bug it shipped alongside.
 *
 * The document is therefore built ONCE from the old stores, on first run only, and never touches a
 * document that already exists.
 *
 * The mapping is deliberately explicit rather than clever. A migration that silently mis-maps is
 * worse than no migration: it looks like it worked while quietly corrupting an evidence set. Two
 * details are load-bearing:
 *
 *  - TARGET SOURCES are reconstructed from `channelId` — the source a post was collected FROM —
 *    never from `authorHandle`, which on a reply, repost or comment is a third party. Deriving
 *    targets from the author is the exact contamination defect the v3.71.0 scheduler review caught.
 *  - His relationship rows use the SINGULAR form (`follower` / `following`) while the old artifact
 *    is plural (`followers` / `following`). Getting that wrong yields rows his UI silently filters
 *    out — the failure would look like "the follower network is empty".
 *
 * Anything unreadable (a locked vault, a failed GCM tag on one campaign) is COUNTED and returned,
 * never dropped in silence.
 */
import type { PersistedStationState } from './state-store';
import { defaultStationState } from './state-store';
import type { StationCtx } from './station-service';

export interface LegacyCampaign {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Just enough of the old post artifact to map it; extra fields are ignored, not lost from disk. */
export interface LegacyPost {
  id: string;
  channelId: string;
  channelLabel?: string;
  authorHandle?: string;
  displayName?: string;
  avatar?: string;
  text?: string;
  url?: string;
  publishedAt?: string;
  harvestedAt?: string;
  kind?: string;
  parentPostId?: string | null;
  metrics?: { replies: number; reposts: number; likes: number; views: number };
  evidenceHash?: string;
  mediaRefs?: string[];
  synthetic?: boolean;
}

export interface LegacyNetwork {
  target: string;
  kind: 'followers' | 'following';
  capturedAt?: string;
  accounts: Array<{
    handle: string;
    displayName?: string;
    bio?: string;
    avatar?: string;
    evidenceHash?: string;
    firstObservedAt?: string;
    lastObservedAt?: string;
    observedCount?: number;
  }>;
}

export interface LegacyNote {
  id: string;
  findingId: string;
  text: string;
  savedAt?: string;
}

export interface LegacyReader {
  listCampaigns(): Promise<LegacyCampaign[]>;
  readPosts(caseId: string): Promise<LegacyPost[]>;
  readNetworks(caseId: string): Promise<LegacyNetwork[]>;
  readNotes(caseId: string): Promise<LegacyNote[]>;
}

export interface MigrationResult {
  state: PersistedStationState;
  /** Campaigns whose material could not be read, with the reason. Reported, never hidden. */
  skipped: Array<{ campaign: string; reason: string }>;
  counts: { campaigns: number; posts: number; relationships: number; notes: number };
}

const EMPTY_METRICS = { replies: 0, reposts: 0, likes: 0, views: 0 };

function reason(err: unknown): string {
  const e = err as { code?: string; message?: string } | undefined;
  return e?.code || e?.message || String(err);
}

/**
 * Build his document from the old stores, or null when there is nothing to carry over (in which
 * case the caller uses his plain `defaultStationState`).
 */
export async function migrateLegacyStation(
  legacy: LegacyReader,
  ctx: StationCtx
): Promise<MigrationResult | null> {
  let campaigns: LegacyCampaign[];
  try {
    campaigns = await legacy.listCampaigns();
  } catch {
    // If the campaign list itself cannot be read we do NOT invent a migration — first run proceeds
    // as a clean default and the old data stays untouched on disk for a later attempt.
    return null;
  }
  if (!campaigns.length) return null;

  const state = defaultStationState(ctx.now, ctx.makeId);
  // Start from his shape but drop the placeholder campaign — his real ones replace it.
  state.cases = [];
  state.campaignSettings = {};

  const skipped: MigrationResult['skipped'] = [];

  for (const campaign of campaigns) {
    const caseId = campaign.id;
    state.cases.push({
      id: caseId,
      name: campaign.name,
      purpose: '',
      description: '',
      createdAt: campaign.createdAt ?? ctx.now(),
      updatedAt: campaign.updatedAt ?? campaign.createdAt ?? ctx.now(),
    });
    state.campaignSettings[caseId] = { ...state.settings };

    let posts: LegacyPost[] = [];
    let networks: LegacyNetwork[] = [];
    let notes: LegacyNote[] = [];
    try {
      posts = await legacy.readPosts(caseId);
      networks = await legacy.readNetworks(caseId);
      notes = await legacy.readNotes(caseId);
    } catch (err) {
      // The campaign record still comes across — an empty campaign the analyst can see is better
      // than a campaign that silently vanished.
      skipped.push({ campaign: campaign.name, reason: reason(err) });
      continue;
    }

    // Reconstruct his TARGET SOURCES from the sources material was collected FROM. `channelId` is
    // the monitored target; `authorHandle` on a reply/repost/comment is somebody else entirely.
    const profileIdByHandle = new Map<string, string>();
    const ensureProfile = (handle: string, seenAt?: string): string => {
      const key = handle.toLowerCase();
      const existing = profileIdByHandle.get(key);
      if (existing) return existing;
      const id = ctx.makeId();
      profileIdByHandle.set(key, id);
      state.profiles.push({
        id, caseId, username: handle, displayName: `@${handle}`, bio: '', avatar: '',
        location: '', website: '', enabled: true, imageMode: 'inherit',
        addedAt: seenAt ?? ctx.now(), lastCheckedAt: seenAt ?? null, lastError: null,
        collectedCount: 0,
      });
      return id;
    };

    for (const post of posts) {
      const source = String(post.channelId ?? '').replace(/^@+/, '');
      if (!source) continue;
      const profileId = ensureProfile(source, post.harvestedAt);
      const kind = post.kind === 'reply' || post.kind === 'repost' || post.kind === 'comment'
        ? post.kind
        : 'post';
      state.posts.push({
        id: post.id,
        caseId,
        profileId,
        username: String(post.authorHandle ?? source),
        displayName: post.displayName,
        avatar: post.avatar,
        sourceUsername: source,
        url: String(post.url ?? ''),
        text: String(post.text ?? ''),
        // His model: `createdAt` is when X published it, `collectedAt` is when we harvested it.
        createdAt: String(post.publishedAt ?? post.harvestedAt ?? ctx.now()),
        collectedAt: String(post.harvestedAt ?? ctx.now()),
        firstObservedAt: post.harvestedAt,
        lastObservedAt: post.harvestedAt,
        evidenceHash: post.evidenceHash,
        kind,
        isReply: kind === 'reply',
        parentPostId: post.parentPostId ?? null,
        metrics: post.metrics ?? EMPTY_METRICS,
        media: post.mediaRefs ?? [],
      } as never);
    }

    for (const artifact of networks) {
      const target = String(artifact.target ?? '').replace(/^@+/, '');
      if (!target) continue;
      const profileId = ensureProfile(target, artifact.capturedAt);
      // Plural artifact kind → his singular relationship type. A row with the wrong value is
      // filtered out by his UI and reads as "the follower network is empty".
      const relationship = artifact.kind === 'following' ? 'following' : 'follower';
      for (const account of artifact.accounts ?? []) {
        const username = String(account.handle ?? '').replace(/^@+/, '');
        if (!username) continue;
        state.relationships.push({
          id: ctx.makeId(),
          caseId,
          profileId,
          sourceUsername: target,
          relationship,
          username,
          displayName: String(account.displayName ?? ''),
          bio: String(account.bio ?? ''),
          url: `https://x.com/${username}`,
          avatar: String(account.avatar ?? ''),
          collectedAt: String(artifact.capturedAt ?? ctx.now()),
          firstObservedAt: account.firstObservedAt,
          lastObservedAt: account.lastObservedAt,
          observedCount: account.observedCount,
          evidenceHash: account.evidenceHash,
        } as never);
      }
    }

    for (const note of notes) {
      state.notes.push({
        id: note.id || ctx.makeId(),
        caseId,
        postId: note.findingId,
        text: note.text,
        createdAt: note.savedAt ?? ctx.now(),
        updatedAt: note.savedAt ?? ctx.now(),
      });
    }

    // His per-profile counter, recomputed rather than carried (the old model did not keep one).
    for (const profile of state.profiles.filter((p) => p.caseId === caseId)) {
      profile.collectedCount = state.posts.filter(
        (p) => p.caseId === caseId && p.profileId === profile.id
      ).length;
    }
  }

  state.activeCaseId = state.cases[0]?.id ?? state.activeCaseId;
  if (state.campaignSettings[state.activeCaseId]) {
    state.settings = { ...state.campaignSettings[state.activeCaseId] };
  }

  return {
    state,
    skipped,
    counts: {
      campaigns: state.cases.length,
      posts: state.posts.length,
      relationships: state.relationships.length,
      notes: state.notes.length,
    },
  };
}
