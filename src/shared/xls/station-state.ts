/**
 * GhostExodus's X Listening Station — his state model, lifted VERBATIM from
 * `src/main.tsx` of X Listening Station Enterprise v3.4.1.
 *
 * DO NOT "improve" these types. They are the contract his UI is written against, and the whole
 * point of the embed is that his renderer runs unmodified. Five consecutive display-picture
 * releases were spent re-deriving his model instead of porting it; the recorded lesson is to port
 * the ORIGINAL source model rather than iterate on ours. If something here looks wrong, it is
 * still what his code expects — change it only with a matching change in his renderer, which is
 * the same as saying: don't.
 *
 * Note on naming: `cases` is his LEGACY internal name for what the UI calls campaigns
 * (`campaigns:create` pushes into `appState.cases`, and his default record is named
 * "Primary Campaign"). His `cases:*` IPC channels are dead in v3.4.1 — exposed by his preload,
 * never called by his UI. There is exactly one workspace concept here, not two.
 *
 * Source: electron/main.cjs `defaultState()` (schemaVersion 9) + src/main.tsx type block.
 */
export type PostKind = 'post' | 'reply' | 'repost' | 'comment';
export type RelationshipType = 'follower' | 'following';

export type CaseRecord = { id: string; name: string; purpose?: string; description: string; createdAt: string; updatedAt: string };
export type Profile = {
  id: string; caseId: string; username: string; displayName: string; bio?: string; avatar?: string; location?: string; website?: string;
  enabled: boolean; imageMode?: 'on' | 'off' | 'inherit'; addedAt: string; lastCheckedAt: string | null; lastError: string | null; collectedCount: number;
};
export type Post = {
  id: string; caseId: string; profileId: string; username: string; displayName?: string; avatar?: string; sourceUsername: string; url: string; text: string;
  createdAt: string; collectedAt: string; firstObservedAt?: string; lastObservedAt?: string; collectionMethod?: string;
  evidenceHash?: string; availability?: string; verifiedAt?: string | null; versionHistory?: Array<{ observedAt: string; text: string; evidenceHash?: string }>;
  kind: PostKind; isReply: boolean; parentPostId: string | null;
  metrics: { replies: number; reposts: number; likes: number; views: number }; media: string[]; mediaEvidence?: Array<{ sourceUrl: string; filePath: string; contentType: string; size: number; sha256: string; collectedAt: string }>;
};
export type InvestigationNote = { id: string; caseId: string; postId: string; text: string; createdAt: string; updatedAt: string };
export type RelationshipRecord = {
  id: string; caseId: string; profileId: string; sourceUsername: string; relationship: RelationshipType; username: string;
  displayName: string; bio: string; url: string; avatar: string; collectedAt: string; firstObservedAt?: string; lastObservedAt?: string;
  observedCount?: number; evidenceHash?: string;
};
export type Preset = { id: string; caseId: string; name: string; keywords: string[]; mode: 'any' | 'all'; caseSensitive: boolean; profileIds: string[]; enabled: boolean; updatedAt: string };
export type Match = { id: string; caseId: string; presetId: string; postId: string; matchedKeywords: string[]; createdAt: string };
export type EntityRecord = { id: string; caseId: string; type: string; value: string; normalizedValue: string; postIds: string[]; sourceUsernames: string[]; firstObservedAt: string; lastObservedAt: string; count: number };
export type ChangeEvent = { id: string; caseId: string; profileId: string | null; sourceUsername: string | null; type: string; summary: string; details: Record<string, unknown>; observedAt: string };
export type CollectionRun = {
  id: string; caseId: string; profileId: string; username: string; operation: string; startedAt: string; completedAt: string | null;
  requestedPasses: number; passesCompleted: number; observed: number; added: number; duplicates: number; stopReason: string | null;
  reachedEnd: boolean; frontierUsernames: string[]; status: string; error: string | null;
};
export type NetworkEvent = { id: string; caseId: string; profileId: string; sourceUsername: string; relationship: RelationshipType; username: string; eventType: 'newly_observed' | 'not_seen_latest'; observedAt: string; confidence: string };

export type Settings = {
  autoSweep: boolean; intervalMinutes: number; scrollPasses: number; scrollDelayMs: number; retentionLimit: number;
  collectReplies: boolean; collectReposts: boolean; collectComments: boolean; collectImages: boolean; commentThreadsPerSweep: number; commentScrollPasses: number;
  relationshipScrollPasses: number; networkStagnationLimit: number; networkSnapshotLimit: number;
  archiveEnabled: boolean; archiveIntervalMinutes: number; archivePostStep: number; archivePostMaxPasses: number;
  archiveFollowers: boolean; archiveFollowing: boolean; archiveRelationshipStep: number; archiveRelationshipMaxPasses: number;
};
export type ArchiveProfileProgress = { postPasses: number; followerPasses: number; followingPasses: number; lastPostRunAt: string | null; lastFollowerRunAt: string | null; lastFollowingRunAt: string | null; oldestPostAt: string | null; postAddedTotal: number; followerAddedTotal: number; followingAddedTotal: number };
export type ArchiveState = { lastCycleAt: string | null; nextOperationIndex: number; cyclesCompleted: number; profiles: Record<string, ArchiveProfileProgress> };
export type StationState = {
  schemaVersion: number; cases: CaseRecord[]; activeCaseId: string; profiles: Profile[]; posts: Post[]; relationships: RelationshipRecord[];
  notes: InvestigationNote[]; presets: Preset[]; matches: Match[]; entities: EntityRecord[]; profileSnapshots: unknown[];
  changeEvents: ChangeEvent[]; collectionRuns: CollectionRun[]; networkSnapshots: unknown[]; networkEvents: NetworkEvent[];
  settings: Settings; archive: ArchiveState; lastSweepAt: string | null; tor?: { enabled: boolean; connected: boolean; port: number | null; exitIp: string | null; lastCheckedAt?: string | null; error?: string | null; source?: 'integrated' | 'external' | null; bootstrapPercent?: number; bundledAvailable?: boolean };
};
export type ExportFilters = { profileId?: string; kind?: 'all' | PostKind; query?: string; presetId?: string };
export type NetworkFilters = { profileId?: string; relationship?: 'all' | RelationshipType; query?: string };
export type SweepProgress = { message: string; current: number; total: number; running: boolean };
export type NetworkIdentity = {
  username: string; displayName: string; bio: string; avatar: string; url: string; profileIds: string[];
  followerOfProfileIds: string[]; followingFromProfileIds: string[]; followerOf: string[]; followingFrom: string[];
  connectedTargets: number; overlapScore: number; firstObservedAt: string | null; lastObservedAt: string | null;
};
