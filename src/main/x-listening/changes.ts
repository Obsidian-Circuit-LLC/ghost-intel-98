/**
 * X Listening Station — post version history + profile snapshots + change events (Task A2).
 *
 * Rebuilds Enterprise's `ingestPosts` `post_changed` diff (`main.cjs:1772-1794`),
 * `updateProfileMetadata` snapshot/`profile_change` logic (`main.cjs:504-538`), and
 * `addChangeEvent` (`main.cjs:457-468`) onto OUR hardened seams — the encrypted `XStore`
 * (store.ts), the deterministic evidence hashes (evidence.ts). No electron/network here; the
 * store is an injectable dep (production default is the lazily-resolved `prodXStore`, mirroring
 * capture.ts's `defaultDeps`), so this module is quarantine-clean and unit-testable over an
 * in-memory `makeXStore`.
 *
 * Determinism: every change event's `id` is a content-derived sha256 digest (kind + ref + `at`
 * + summary) — no unseeded RNG (charter). `at` is the caller-supplied ISO clock, never computed
 * here. Version/snapshot hashes reuse evidence.ts's fixed-key canonicalization.
 *
 * Honesty (conservative, not-fabricating): an UNCHANGED re-ingest is a no-op — no version, no
 * event, the stored post is left exactly as it was (its evidence trail is not perturbed). A
 * profile's FIRST snapshot is a baseline, never a `profile_change` (there is nothing it changed
 * FROM). Only an observed text/media diff, or a metadata-signature diff vs the last snapshot,
 * produces an event.
 */
import type { XPostArtifact, XChangeEvent, XProfileSnapshot, XStore } from './store';
import { X_MAX_POST_VERSIONS } from './store';
import { postEvidenceHash, profileMetadataSignature, canonicalProfileMetadata, sha256 } from './evidence';

/** Deterministic, content-derived change-event id — no RNG. Truncated to 16 hex chars (64 bits):
 *  a change event is keyed by its content, so two events with the same kind/ref/time/summary are
 *  the same event, and collisions across distinct events are negligible at this surface. */
function changeEventId(kind: string, ref: string, at: string, summary: string): string {
  return sha256(`${kind}|${ref}|${at}|${summary}`).slice(0, 16);
}

async function resolveStore(store?: XStore): Promise<XStore> {
  if (store) return store;
  const { prodXStore } = await import('./store');
  return prodXStore();
}

// ---- post version history on re-ingest ------------------------------------

export interface IngestHistoryResult {
  /** Brand-new posts (id not previously stored). */
  added: number;
  /** Posts whose id already existed (whether changed or not) — mirrors `posts.save`'s `skipped`. */
  skipped: number;
  /** Existing posts whose text/media differed → a version was archived + an event emitted. */
  changed: number;
  /** The `post_changed` events emitted this ingest (also appended to the store). */
  events: XChangeEvent[];
}

/**
 * Ingest captured post artifacts with version tracking. For each incoming post:
 *  - a NEW id is appended as-is (`added`);
 *  - an EXISTING id with identical text + `mediaRefs` is a no-op (`skipped`, left untouched);
 *  - an EXISTING id whose text or `mediaRefs` differ archives the PRIOR version onto
 *    `versionHistory` (capped `X_MAX_POST_VERSIONS`, oldest dropped), replaces the stored post
 *    with the incoming content, and emits ONE `post_changed` event (`changed` + `skipped`).
 *
 * Writes the merged post list wholesale (`posts.write`) only when something actually changed, and
 * appends each event through the encrypted `changeEvents` sidecar.
 */
export async function ingestPostsWithHistory(
  caseId: string,
  incoming: readonly XPostArtifact[],
  opts: { now: string },
  store?: XStore,
): Promise<IngestHistoryResult> {
  const s = await resolveStore(store);
  const at = opts.now;

  // ATOMIC read-modify-write: compute the merged list + version diffs INSIDE the single posts
  // lock (via `posts.transform`), so a concurrent capture/verify cannot clobber captured evidence
  // with a stale snapshot. The diff computation is pure; change-event persistence (a separate
  // sidecar/lock) happens after the transform returns.
  const { added, skipped, changed, events } = await s.posts.transform(caseId, (existing) => {
    const next = [...existing];
    const idxById = new Map<string, number>();
    next.forEach((p, i) => idxById.set(p.id, i));

    const evs: XChangeEvent[] = [];
    let added = 0;
    let skipped = 0;
    let changed = 0;

    for (const post of incoming) {
      const idx = idxById.get(post.id);
      if (idx === undefined) {
        next.push(post);
        idxById.set(post.id, next.length - 1);
        added++;
        continue;
      }
      skipped++;
      const prev = next[idx]!;
      const prevText = String(prev.text ?? '');
      const nextText = String(post.text ?? '');
      const prevMedia = JSON.stringify(prev.mediaRefs ?? []);
      const nextMedia = JSON.stringify(post.mediaRefs ?? []);
      if (prevText === nextText && prevMedia === nextMedia) continue; // unchanged — leave as stored

      const priorHash = prev.evidenceHash || postEvidenceHash(prev);
      const history = Array.isArray(prev.versionHistory) ? [...prev.versionHistory] : [];
      history.push({
        text: prevText,
        media: Array.isArray(prev.mediaRefs) ? [...prev.mediaRefs] : [],
        capturedAt: at,
        sha256: priorHash,
      });
      const capped =
        history.length > X_MAX_POST_VERSIONS ? history.slice(-X_MAX_POST_VERSIONS) : history;
      next[idx] = { ...post, versionHistory: capped };
      changed++;

      const sourceUsername =
        String(post.channelLabel || prev.channelLabel || post.authorHandle || '') || undefined;
      const summary = `Previously captured post ${post.id} changed.`;
      evs.push({
        id: changeEventId('post_changed', String(post.id), at, summary),
        kind: 'post_changed',
        postId: post.id,
        summary,
        ...(sourceUsername ? { sourceUsername } : {}),
        at,
      });
    }

    return {
      next,
      write: added > 0 || changed > 0,
      result: { added, skipped, changed, events: evs },
    };
  });

  for (const event of events) await s.changeEvents.append(caseId, event);

  return { added, skipped, changed, events };
}

// ---- post_unavailable (Task A1, VERIFY LIVE) ------------------------------

export interface MarkPostUnavailableInput {
  postId: string;
  sourceUsername?: string;
  /** Optional override for the event summary (defaults to the Enterprise wording). */
  summary?: string;
}

/**
 * Emit a `post_unavailable` change event for a post whose live URL no longer resolves (A1's
 * VERIFY LIVE, ported from Enterprise `verifyPostLive`'s `addChangeEvent(profile,
 * 'post_unavailable', …)`, `main.cjs:2648`). Centralised here (the A2 module owns change-event
 * construction) so the deterministic content-derived `id` and the encrypted `changeEvents`
 * sidecar append stay in one place. The CALLER (`verifyPost`) is responsible for the availability
 * transition gate — it emits only when the post was not ALREADY unavailable, matching Enterprise's
 * `previousAvailability !== 'unavailable'` guard — so this function always appends when called.
 */
export async function markPostUnavailable(
  caseId: string,
  input: MarkPostUnavailableInput,
  opts: { now: string },
  store?: XStore,
): Promise<{ event: XChangeEvent }> {
  const s = await resolveStore(store);
  const at = opts.now;
  const postId = String(input.postId ?? '');
  const sourceUsername = input.sourceUsername ? String(input.sourceUsername) : undefined;
  const summary = input.summary ?? `Post ${postId} is no longer available at its original URL.`;
  const event: XChangeEvent = {
    id: changeEventId('post_unavailable', postId, at, summary),
    kind: 'post_unavailable',
    postId,
    summary,
    ...(sourceUsername ? { sourceUsername } : {}),
    at,
  };
  await s.changeEvents.append(caseId, event);
  return { event };
}

// ---- profile snapshots + profile_change -----------------------------------

export interface ProfileSnapshotInput {
  profileId: string;
  sourceUsername?: string;
  /** The visible profile display name (FB2) — folded into the signature so a rename is detected. */
  displayName?: string;
  bio?: string;
  avatar?: string;
  location?: string;
  website?: string;
}

export interface ProfileSnapshotResult {
  /** True when a NEW snapshot was stored (either the baseline, or a metadata-diff). False when
   *  the metadata signature matched the last snapshot (a no-op re-capture). */
  changed: boolean;
  /** The snapshot that is now current for this profile (the new one, or the unchanged prior). */
  snapshot: XProfileSnapshot;
  /** The `profile_change` event emitted (only on a diff vs a PRIOR snapshot — never the baseline). */
  event?: XChangeEvent;
}

/**
 * Snapshot a captured profile's metadata. Computes the deterministic metadata signature; if it
 * matches the last stored snapshot for this profile, nothing is written (no-op). Otherwise a new
 * snapshot is appended, and — only when a PRIOR snapshot existed — one `profile_change` event is
 * emitted (the first-ever snapshot is a baseline, not a change).
 */
export async function snapshotProfile(
  caseId: string,
  input: ProfileSnapshotInput,
  opts: { now: string },
  store?: XStore,
): Promise<ProfileSnapshotResult> {
  const s = await resolveStore(store);
  const at = opts.now;
  const canonical = canonicalProfileMetadata(input);
  const signature = profileMetadataSignature(input);
  const profileId = String(input.profileId ?? '');
  const sourceUsername = input.sourceUsername ? String(input.sourceUsername) : undefined;

  const previous = await s.profileSnapshots.latest(caseId, profileId);
  if (previous && previous.signature === signature) {
    return { changed: false, snapshot: previous };
  }

  const snapshot: XProfileSnapshot = {
    profileId,
    ...(sourceUsername ? { sourceUsername } : {}),
    displayName: canonical.displayName,
    bio: canonical.bio,
    avatar: canonical.avatar,
    location: canonical.location,
    website: canonical.website,
    capturedAt: at,
    signature,
  };
  await s.profileSnapshots.append(caseId, snapshot);

  if (!previous) {
    return { changed: true, snapshot }; // baseline — no change event
  }

  const label = sourceUsername || profileId;
  const summary = `Profile metadata changed for @${label}.`;
  const event: XChangeEvent = {
    id: changeEventId('profile_change', profileId, at, summary),
    kind: 'profile_change',
    profileId,
    summary,
    at,
  };
  await s.changeEvents.append(caseId, event);
  return { changed: true, snapshot, event };
}
