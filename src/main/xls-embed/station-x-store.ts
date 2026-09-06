/**
 * A narrow `XStore` face over HIS single document, so the hardened capture services read and write
 * the records he can actually see.
 *
 * WHY THIS EXISTS. `verifyPost` (capture.ts, Task A1) is the hardened rebuild of his
 * `verifyPostLive` — Tor gate, hidden capture window, signed-in guard, window destroyed in a
 * `finally`. All of that is worth reusing verbatim. What is NOT reusable is where it looks for the
 * post: `store.posts.read(caseId)` is the OLD per-case split store, which the embed writes nothing
 * to. So every VERIFY LIVE click died on
 *
 *     Error: [xls:feed:verify-post] Post not found in this campaign.
 *
 * exactly the way GhostExodus's screenshot shows. Same class as the display-picture defect: a
 * hardened service wired to the store the station does not use.
 *
 * The same defect was in four more places. `entities`, `profileSnapshots`, `networkSnapshots` and
 * `networkEvents` each appeared in the embed exactly once outside `defaultStationState` — in a
 * filter that DELETES rows. Nothing ever added one, so ENTITY INDEX and CHANGE INTEL could never
 * show anything, which is what his sidebar read against 55 collected findings. Ghost Intel 98
 * already implements all of it (`snapshotProfile`, `extractEntities`, `deriveNetworkDeltaEvents`),
 * hardened and tested; the results were simply going to per-case sidecars his station never opens.
 *
 * Between them `verifyPost`, `markPostUnavailable`, `ingestPostsWithHistory` and `snapshotProfile`
 * touch five store members: `posts.read`, `posts.transform`, `changeEvents.append`,
 * `profileSnapshots.latest` and `profileSnapshots.append`. This implements those five against his
 * document and leaves the rest of `XStore` unreachable: anything else would be a silent second
 * persistence path, which is the mistake this file exists to undo. Reaching one of them throws
 * rather than resolving to a store nothing reads.
 */
import type { XChangeEvent, XPostArtifact, XStore } from '../x-listening/store';
import type { PersistedStationState } from './state-store';
import type { Post } from '@shared/xls/station-state';

/** His post record → the artifact shape `verifyPost` reasons over. Nothing is invented: fields he
 *  does not carry are left absent rather than defaulted into evidence. */
export function artifactFromStationPost(post: Post): XPostArtifact {
  const statusId = String(post.url ?? '').match(/\/status\/(\d+)/)?.[1] ?? '';
  return {
    id: post.id,
    platform: 'x',
    authorHandle: String(post.username ?? ''),
    authorId: String(post.username ?? ''),
    text: String(post.text ?? ''),
    channelId: String(post.profileId ?? ''),
    channelLabel: String(post.sourceUsername ?? ''),
    // The status id off the permalink — HIS ids are ours (a content hash), so `messageId` must come
    // from the URL or `assertValidPostUrl`'s fallback would build a nonsense /status/<hash>.
    messageId: statusId,
    publishedAt: String(post.createdAt ?? ''),
    harvestedAt: String(post.collectedAt ?? ''),
    url: String(post.url ?? ''),
    provenance: { collectorVersion: 'xls-embed', jobId: '', caseId: String(post.caseId ?? '') },
    kind: post.kind,
    parentPostId: post.parentPostId ?? null,
    metrics: post.metrics,
    metricsRaw: {},
    evidenceHash: String(post.evidenceHash ?? ''),
    ...(post.displayName ? { displayName: post.displayName } : {}),
    ...(post.avatar ? { avatar: post.avatar } : {}),
    ...(post.media?.length ? { mediaRefs: post.media } : {}),
    ...(post.versionHistory?.length
      ? { versionHistory: post.versionHistory.map((v) => ({ text: v.text, capturedAt: v.observedAt, sha256: String(v.evidenceHash ?? '') })) }
      : {}),
    ...(post.availability === 'available' || post.availability === 'unavailable'
      ? { availability: post.availability }
      : {}),
    ...(post.verifiedAt ? { verifiedAt: post.verifiedAt } : {}),
  };
}

/** Fold a verified artifact back onto his record. Only the fields a verification can legitimately
 *  change are copied; everything else on his record is preserved untouched. */
function mergeVerifiedFields(post: Post, artifact: XPostArtifact): Post {
  return {
    ...post,
    text: String(artifact.text ?? post.text),
    evidenceHash: artifact.evidenceHash || post.evidenceHash,
    ...(artifact.availability ? { availability: artifact.availability } : {}),
    ...(artifact.verifiedAt ? { verifiedAt: artifact.verifiedAt } : {}),
    ...(artifact.versionHistory
      ? {
          versionHistory: artifact.versionHistory.map((v) => ({
            observedAt: v.capturedAt,
            text: v.text,
            evidenceHash: v.sha256,
          })),
        }
      : {}),
  };
}

function unsupported(member: string): never {
  throw new Error(
    `The station's verify store does not implement ${member}. Adding one here would create a ` +
      'second persistence path the station never reads — the defect this adapter exists to fix.',
  );
}

/**
 * Build the adapter. `state` is the live document object (mutated in place, matching how every
 * other handler in `ipc.ts` works); `persist` is called after any write so the change reaches disk
 * and the renderer, exactly once per transform that asked to write.
 */
export function makeStationXStore(
  state: PersistedStationState,
  persist: () => Promise<void>,
  ctx: { makeId: () => string },
): XStore {
  const forCase = (caseId: string): Post[] => state.posts.filter((p) => p.caseId === caseId);

  return new Proxy(
    {
      posts: {
        read: async (caseId: string) => forCase(caseId).map(artifactFromStationPost),
        transform: async <R>(
          caseId: string,
          fn: (existing: XPostArtifact[]) => { next: XPostArtifact[]; write: boolean; result: R },
        ): Promise<R> => {
          const { next, write, result } = fn(forCase(caseId).map(artifactFromStationPost));
          if (!write) return result;
          const byId = new Map(next.map((a) => [a.id, a]));
          state.posts = state.posts.map((p) => {
            if (p.caseId !== caseId) return p;
            const artifact = byId.get(p.id);
            return artifact ? mergeVerifiedFields(p, artifact) : p;
          });
          await persist();
          return result;
        },
      },
      profileSnapshots: {
        latest: async (caseId: string, profileId: string) => {
          const rows = (state.profileSnapshots as Array<Record<string, unknown>>).filter(
            (r) => r.caseId === caseId && r.profileId === profileId,
          );
          return (rows.length ? rows[rows.length - 1] : null) as never;
        },
        append: async (caseId: string, snapshot: Record<string, unknown>) => {
          // His record shape (`username`, `capturedAt`, `signature`) alongside the artifact's, so
          // the same row satisfies his UI and the service that wrote it.
          const profile = state.profiles.find((p) => p.id === snapshot.profileId && p.caseId === caseId);
          (state.profileSnapshots as Array<Record<string, unknown>>).push({
            ...snapshot,
            id: ctx.makeId(),
            caseId,
            username: snapshot.sourceUsername ?? profile?.username ?? '',
          });
          await persist();
          return state.profileSnapshots as never;
        },
      },
      changeEvents: {
        append: async (caseId: string, event: XChangeEvent) => {
          // His CHANGE INTEL record shape (`type`/`observedAt`/`details`), not the artifact's
          // (`kind`/`at`) — the same singular-vs-plural care the relationship migration needed.
          const post = state.posts.find((p) => p.id === event.postId && p.caseId === caseId);
          const profileId = event.profileId ?? post?.profileId ?? null;
          // A `profile_change` carries a profileId and no post, so resolve the handle from the
          // source record — otherwise his CHANGE INTEL row has no account name on it.
          const profile = profileId
            ? state.profiles.find((p) => p.id === profileId && p.caseId === caseId)
            : undefined;
          state.changeEvents.push({
            id: event.id || ctx.makeId(),
            caseId,
            profileId,
            sourceUsername: event.sourceUsername ?? post?.sourceUsername ?? profile?.username ?? null,
            type: event.kind,
            summary: event.summary,
            details: event.postId ? { postId: event.postId } : {},
            observedAt: event.at,
          });
          await persist();
        },
      },
    } as unknown as XStore,
    {
      get(target, prop, receiver) {
        if (prop in (target as object)) return Reflect.get(target, prop, receiver);
        // The adapter is returned from an `async` function (`resolveVerifyStore`), so `await`
        // probes it for `then`. A symbol or a thenable probe is a language mechanic, not a store
        // member — answering those with a throw made the whole verification reject.
        if (typeof prop === 'symbol' || prop === 'then' || prop === 'catch' || prop === 'finally') {
          return undefined;
        }
        return unsupported(prop);
      },
    },
  );
}
