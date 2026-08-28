/**
 * GhostExodus's single state document, stored the way Ghost Intel 98 stores things.
 *
 * His app keeps ONE `station-state.json` (`schemaVersion: 9`) holding 13 collections plus
 * settings/tor/archive, and all 53 of his IPC handlers are written against that shape. The embed
 * keeps his document EXACTLY — porting his source model rather than re-deriving it is the whole
 * lesson of the five display-picture releases. Only storage is substituted.
 *
 * Two deliberate departures from `electron/main.cjs`, both hardening:
 *
 *  1. Bytes go through the injected reader/writer, which in production is secure-fs — encrypted at
 *     rest, like every other artifact in this app.
 *
 *  2. `loadState()` in his source catches ANY read error, falls back to `defaultState()` and
 *     immediately persists it. Against a plaintext file whose only realistic failure is ENOENT
 *     that is a reasonable first-run path. Against an ENCRYPTED file it is data loss: a locked
 *     vault or a failed GCM tag would overwrite a populated campaign with an empty one, silently.
 *     Here ENOENT alone means first run. Anything else propagates and writes NOTHING.
 */
import type { StationState, Settings, ArchiveState } from '@shared/xls/station-state';

/** The persisted document is a superset of the client-facing `StationState` his renderer sees. */
export interface PersistedStationState extends StationState {
  /** Per-campaign settings overrides (`appState.campaignSettings`). */
  campaignSettings: Record<string, Settings>;
  /** His avatar back-fill bookkeeping. */
  avatarRepair: {
    version: number;
    pending: boolean;
    migratedAt: string | null;
    lastAttemptAt: string | null;
    completedAt: string | null;
    lastError: string | null;
  };
}

export interface XlsStateDeps {
  /** Read raw bytes; must throw with `code === 'ENOENT'` when the document does not exist yet. */
  readFile(path: string): Promise<Buffer>;
  /** Write the serialised document. */
  writeFile(path: string, data: string): Promise<void>;
  /** Absolute path of the state document. */
  statePath(): string;
  /** ISO timestamp source (injected so first-run output is deterministic under test). */
  now(): string;
  /** Id source (injected for the same reason). */
  makeId(): string;
  /**
   * FIRST RUN ONLY: build the document from the pre-embed stores, or null when there is nothing to
   * carry over. Without this, upgrading to the embed opened a station with none of the analyst's
   * existing campaigns in it — the data was never deleted, just never read (see migrate.ts).
   * Only ever consulted on ENOENT, so it can never overwrite a live document.
   */
  migrate?(): Promise<PersistedStationState | null>;
}

/** His `defaultState()` (electron/main.cjs:82), transcribed — values unchanged. */
export function defaultStationState(now: () => string, makeId: () => string): PersistedStationState {
  const defaultCaseId = makeId();
  const timestamp = now();
  return {
    schemaVersion: 9,
    // His UI calls this a campaign; `cases` is the legacy field name, and his own default record
    // says so ("Primary Campaign" / "Migrated/default campaign workspace").
    cases: [{
      id: defaultCaseId,
      name: 'Primary Campaign',
      purpose: 'General intelligence monitoring',
      description: 'Migrated/default campaign workspace',
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    activeCaseId: defaultCaseId,
    profiles: [],
    posts: [],
    relationships: [],
    notes: [],
    presets: [],
    matches: [],
    entities: [],
    profileSnapshots: [],
    changeEvents: [],
    collectionRuns: [],
    networkSnapshots: [],
    networkEvents: [],
    settings: {
      autoSweep: false,
      intervalMinutes: 30,
      scrollPasses: 5,
      scrollDelayMs: 1100,
      retentionLimit: 50000,
      collectReplies: true,
      collectReposts: false,
      collectComments: false,
      collectImages: true,
      commentThreadsPerSweep: 3,
      commentScrollPasses: 2,
      relationshipScrollPasses: 8,
      networkStagnationLimit: 7,
      networkSnapshotLimit: 20,
      archiveEnabled: false,
      archiveIntervalMinutes: 240,
      archivePostStep: 2,
      archivePostMaxPasses: 40,
      archiveFollowers: false,
      archiveFollowing: false,
      archiveRelationshipStep: 3,
      archiveRelationshipMaxPasses: 160,
    },
    campaignSettings: {},
    archive: {
      lastCycleAt: null,
      nextOperationIndex: 0,
      cyclesCompleted: 0,
      profiles: {},
    } as ArchiveState,
    avatarRepair: {
      version: 1,
      pending: false,
      migratedAt: null,
      lastAttemptAt: null,
      completedAt: null,
      lastError: null,
    },
    lastSweepAt: null,
  };
}

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

export interface StationStore {
  /** His document, or a fresh default on first run. Throws on any other read failure. */
  load(): Promise<PersistedStationState>;
  /** Persist the document. Writes are serialised in call order (his `saveQueue`). */
  save(state: PersistedStationState): Promise<void>;
}

export function makeStationStore(deps: XlsStateDeps): StationStore {
  // His `saveQueue`: a burst of saves must land in call order, never interleaved, or a later
  // snapshot can be overtaken by an earlier one and silently lose the newer collections.
  let queue: Promise<void> = Promise.resolve();

  return {
    async load(): Promise<PersistedStationState> {
      try {
        const buf = await deps.readFile(deps.statePath());
        return JSON.parse(buf.toString('utf8')) as PersistedStationState;
      } catch (err) {
        // FIRST RUN ONLY. Every other failure — locked vault, failed decrypt, corrupt document —
        // propagates untouched: an unreadable document is not an empty one, and resetting here
        // would destroy the campaign it failed to read.
        if (!isEnoent(err)) throw err;
        // No document yet. Carry the analyst's existing campaigns over if there are any, and
        // PERSIST the result so the migration runs exactly once.
        if (deps.migrate) {
          const migrated = await deps.migrate();
          if (migrated) {
            await deps.writeFile(deps.statePath(), JSON.stringify(migrated, null, 2));
            return migrated;
          }
        }
        return defaultStationState(deps.now, deps.makeId);
      }
    },

    save(state: PersistedStationState): Promise<void> {
      const snapshot = JSON.stringify(state, null, 2);
      queue = queue
        .catch(() => undefined)
        .then(() => deps.writeFile(deps.statePath(), snapshot));
      return queue;
    },
  };
}
