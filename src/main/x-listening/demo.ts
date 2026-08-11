/**
 * X Listening Station — demo data with honesty markers (Enterprise port, Task 12).
 *
 * Adapts the quarantined `loadDemoData` (`electron/main.cjs:2519-2610`): two seeded demo
 * profiles, three example posts each, and a follower + a following relationship each — for
 * interface testing/onboarding when the analyst has no live X session yet.
 *
 * Honesty fix over Enterprise (Global Constraints / design doc "Demo data" / plan Task 12):
 * Enterprise's demo posts get a `collectionMethod:'demo'`/`availability:'demo'` label but its
 * demo NETWORK rows carry no marker at all — they are indistinguishable from real capture and
 * leak straight into `computeNetworkAnalysis`'s common-connection output and every export. This
 * port stamps `synthetic: true` on EVERY demo post (`XPostArtifact.synthetic`, store.ts) AND
 * every demo network account (`XNetworkAccount.synthetic`, store.ts) — the single canonical
 * honesty flag the Task-1 store schema already anticipates for exactly this task (see store.ts's
 * doc on both fields). That one flag is enough to be enforced-excluded everywhere a synthetic
 * record must never leak:
 *   - `computeNetworkAnalysis` (analysis.ts) filters `synthetic` profiles/relationships itself;
 *   - `exportXPostsToFile`'s `excludeSynthetic` (exports.ts) drops `synthetic` posts before any
 *     serialization, count, or SHA-256 checksum is produced — so a demo post is never folded
 *     into hashed exported "evidence" either.
 * (The design doc's prose additionally names a `source:'demo'` marker; the Task-1 store schema
 * that already shipped and that every consumer here reads/filters on defines only `synthetic`
 * — no `source` field exists on `XPostArtifact`/`XNetworkAccount`. Adding an unused, unread
 * field would not strengthen the honesty guarantee (nothing consumes it) and would diverge from
 * the schema Task 1 already committed; `synthetic: true` IS the enforced marker.)
 *
 * Reuse, don't reinvent: every demo post/account is built by running FIXED, in-file fixture
 * data through the exact same pure normalizers a real capture uses —
 * `normalizePost`/`normalizeReply` + `toPostArtifact` (extract.ts/capture.ts) for posts,
 * `normalizeNetwork`'s `opts.synthetic` (extract.ts, Task 7 — built in anticipation of this
 * task) for relationships. A demo record can never accidentally diverge in SHAPE from a real
 * one; the only difference is the one flag that marks it fake.
 *
 * Determinism: `now` is the caller-injected ISO clock (never `Date.now()`/`new Date()` read
 * here); every id/timestamp is a pure function of `(caseId, jobId, now)`, so the same triple
 * always produces byte-identical demo data.
 *
 * Quarantine-clean at module load: no static `electron` import — the production store wiring
 * (`prodXStore`) is a LAZY dynamic `import('./store')` inside `defaultDeps()`, mirroring
 * capture.ts's/campaigns.ts's convention, so importing this module never evaluates electron.
 */
import {
  normalizePost,
  normalizeReply,
  normalizeNetwork,
  type RawPost,
  type RawUserCell,
  type NormalizeContext,
} from './extract';
import { toPostArtifact } from './capture';
import type { XPostArtifact, XNetworkArtifact } from './store';

/** One seeded demo profile — port of quarantine `demoProfiles` (`main.cjs:2520-2523`). */
export interface DemoProfile {
  username: string;
  displayName: string;
}

export const DEMO_PROFILES: readonly DemoProfile[] = [
  { username: 'SignalWatch', displayName: 'Signal Watch' },
  { username: 'OpenSourceDesk', displayName: 'Open Source Desk' },
];

/** This generator's own provenance stamp — deliberately DISTINCT from the real capture
 *  collector's `x-listening/1.0.0` (capture.ts `X_COLLECTOR_VERSION`) so a demo post's
 *  `provenance.collectorVersion` is honest about its origin even before `synthetic` is
 *  checked, defense in depth. */
export const DEMO_COLLECTOR_VERSION = 'x-listening/1.0.0-demo';

/** Per-profile example post texts — ported verbatim from quarantine `main.cjs:2544-2554`.
 *  A text starting with "Replying" becomes a `reply`-kind demo post (mirrors Enterprise's
 *  `kind: text.startsWith('Replying') ? 'reply' : 'post'`, `main.cjs:2575-2576`). */
const DEMO_POST_TEXT: Readonly<Record<string, readonly string[]>> = {
  SignalWatch: [
    'Demo alert: infrastructure disruption reports are increasing in the monitored region.',
    'Analyst note: verify the original source before treating screenshots as confirmed evidence.',
    'Replying to a researcher: archive the post URL and capture time before escalation.',
  ],
  OpenSourceDesk: [
    'Daily OSINT brief: several accounts are repeating the same unverified claim.',
    'Keyword watch detected references to a planned announcement later this week.',
    'Replying to the thread: geolocation remains inconclusive from the available imagery.',
  ],
};

/** Milliseconds subtracted from `now` per post index — mirrors quarantine's
 *  `timestamp - index * 3600000` staggered `createdAt` (`main.cjs:2567`). */
const DEMO_POST_INTERVAL_MS = 3600000;

/** A demo target's seeded follower + following identity — port of quarantine `demoNetwork`
 *  (`main.cjs:2583-2586`), `username` capped to the visible-handle length exactly as
 *  Enterprise did (`row.username.slice(0, 15)`, `main.cjs:2595`). */
function demoNetworkRow(profile: DemoProfile, suffix: string): RawUserCell {
  const username = `${profile.username}${suffix}`.slice(0, 15);
  return {
    username,
    displayName: `${profile.displayName} ${suffix}`,
    bio: 'Demo network identity for interface testing.',
    url: `https://x.com/${username}`,
    avatar: '',
  };
}

export interface DemoDataResult {
  posts: XPostArtifact[];
  networks: XNetworkArtifact[];
}

/**
 * Build the full deterministic demo data set for one campaign — PURE, no store I/O. Every
 * post carries `synthetic: true`; every network account (in both the seeded follower and the
 * seeded following artifact, per profile) carries `synthetic: true`.
 */
export function buildDemoData(caseId: string, jobId: string, now: string): DemoDataResult {
  const nowMs = Date.parse(now);
  const baseMs = Number.isFinite(nowMs) ? nowMs : 0;
  const posts: XPostArtifact[] = [];
  const networks: XNetworkArtifact[] = [];

  for (const profile of DEMO_PROFILES) {
    const ctx: NormalizeContext = {
      caseId,
      jobId,
      collectorVersion: DEMO_COLLECTOR_VERSION,
      harvestedAt: now,
      channelId: profile.username,
      channelLabel: `@${profile.username}`,
    };

    const texts = DEMO_POST_TEXT[profile.username] ?? [];
    texts.forEach((text, index) => {
      const isReply = text.startsWith('Replying');
      const raw: RawPost = {
        id: `demo-${profile.username}-${index}`,
        username: profile.username,
        url: `https://x.com/${profile.username}/status/demo-${index}`,
        text,
        createdAt: new Date(baseMs - index * DEMO_POST_INTERVAL_MS).toISOString(),
        isReply,
        isRepost: false,
        socialContext: '',
        metricsRaw: {
          replies: String(index + 1),
          reposts: String(index * 2),
          likes: String(10 + index * 3),
          views: String(100 + index * 50),
        },
        media: [],
      };
      const item = isReply ? normalizeReply(raw, ctx) : normalizePost(raw, ctx);
      posts.push({ ...toPostArtifact(item), synthetic: true });
    });

    const followerRow = demoNetworkRow(profile, 'Observer');
    const followingRow = demoNetworkRow(profile, 'Source');
    networks.push(
      normalizeNetwork([followerRow], profile.username, 'followers', now, { synthetic: true }),
    );
    networks.push(
      normalizeNetwork([followingRow], profile.username, 'following', now, { synthetic: true }),
    );
  }

  return { posts, networks };
}

/** Injectable seams so the persistence orchestration is testable without electron/secure-fs. */
export interface LoadDemoDataDeps {
  savePosts: (caseId: string, posts: XPostArtifact[]) => Promise<{ added: number; skipped: number }>;
  saveNetwork: (caseId: string, artifact: XNetworkArtifact) => Promise<number>;
  /** Injected clock — the ISO timestamp stamped onto every demo record (determinism). */
  now: () => string;
}

function defaultDeps(): LoadDemoDataDeps {
  return {
    savePosts: async (caseId, posts) => {
      const { prodXStore } = await import('./store');
      return (await prodXStore()).posts.save(caseId, posts);
    },
    saveNetwork: async (caseId, artifact) => {
      const { prodXStore } = await import('./store');
      return (await prodXStore()).networks.save(caseId, artifact);
    },
    now: () => new Date().toISOString(),
  };
}

export interface LoadDemoDataResult {
  added: number;
  skipped: number;
  posts: XPostArtifact[];
  networks: XNetworkArtifact[];
}

/**
 * Load the seeded demo data set into `caseId`'s campaign store — port of quarantine
 * `loadDemoData` (`main.cjs:2519-2610`) as an explicit, injectable-deps orchestration (rather
 * than a global-`appState` mutation). Idempotent the same way a real capture is: `store.posts`
 * dedups by `id` (a re-load of the same campaign adds nothing new, `added:0`), and
 * `store.networks.save`'s (target, kind) upsert accumulates the same two seeded accounts
 * without duplicating them.
 */
export async function loadDemoData(
  caseId: string,
  jobId: string = caseId,
  overrides: Partial<LoadDemoDataDeps> = {},
): Promise<LoadDemoDataResult> {
  const deps: LoadDemoDataDeps = { ...defaultDeps(), ...overrides };
  const now = deps.now();
  const { posts, networks } = buildDemoData(caseId, jobId, now);

  const { added, skipped } = await deps.savePosts(caseId, posts);
  for (const artifact of networks) {
    await deps.saveNetwork(caseId, artifact);
  }

  return { added, skipped, posts, networks };
}
