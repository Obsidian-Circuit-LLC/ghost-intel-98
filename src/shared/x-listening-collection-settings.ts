/**
 * X Listening Station — per-campaign COLLECTION SETTINGS shape, clamp ranges + defaults (F2).
 *
 * The Enterprise `settings:save` form (`electron/main.cjs:2986-3020`) persisted one settings
 * object PER CAMPAIGN (`appState.campaignSettings[id]`), every numeric field clamped to a sane
 * [min,max] MAIN-side (the renderer is never trusted with a raw number). This port mirrors that:
 * the record lives per-campaign under secure-fs (`src/main/x-listening/collection-settings.ts`),
 * but the SHAPE, the clamp RANGES, and the pure `clampCollectionSettings` reducer live here so
 * BOTH the main clamp path AND the renderer form (input min/max/step, defaults) read one source
 * of truth — no drift between the number the UI offers and the number main will accept.
 *
 * Field naming is GI98's (the F2 task spec), mapped from the Enterprise knob it restores:
 *   automaticSweeps            ← autoSweep
 *   collectReplies/Reposts/Comments ← collectReplies/collectReposts/collectComments
 *   retrieveImages             ← collectImages
 *   commentThreadsPerSource    ← commentThreadsPerSweep
 *   commentScrollPasses        ← commentScrollPasses
 *   sweepIntervalMinutes       ← intervalMinutes
 *   profileScrollPasses        ← scrollPasses
 *   followerBasePasses/followingBasePasses ← relationshipScrollPasses (split per direction)
 *   networkStagnationLimit     ← networkStagnationLimit
 *   networkSnapshotsRetained   ← networkSnapshotLimit
 *   delayPerPassMs             ← scrollDelayMs
 *   retentionLimit             ← retentionLimit
 *   archiveEnabled             ← archiveEnabled
 *   archiveIntervalMinutes     ← archiveIntervalMinutes
 *   postDepthPerCycle/maxPostDepth ← archivePostStep/archivePostMaxPasses
 *   archiveFollowers/archiveFollowing ← archiveFollowers/archiveFollowing
 *   networkDepthPerCycle/maxNetworkDepth ← archiveRelationshipStep/archiveRelationshipMaxPasses
 *
 * The clamp ranges + defaults are the EXACT Enterprise values (verified against the quarantined
 * `main.cjs` `settings:save` clamps + `defaultState().settings`).
 *
 * Determinism: `clampCollectionSettings` is a pure function of its argument — no clock, no RNG.
 */

/** The per-campaign collection-settings record (all knobs from the F2 System-tab form). */
export interface XCollectionSettings {
  /** Automatic sweep scheduling (G1 reads this — the free-running timer's on/off). */
  automaticSweeps: boolean;
  // ── RECORD TYPES ──────────────────────────────────────────────────────────
  collectReplies: boolean;
  collectReposts: boolean;
  collectComments: boolean;
  /** Retrieve + archive post images (per-campaign; F1 layers a per-profile override on top). */
  retrieveImages: boolean;
  commentThreadsPerSource: number;
  commentScrollPasses: number;
  // ── TIMING + HEALTH ───────────────────────────────────────────────────────
  sweepIntervalMinutes: number;
  profileScrollPasses: number;
  followerBasePasses: number;
  followingBasePasses: number;
  networkStagnationLimit: number;
  networkSnapshotsRetained: number;
  delayPerPassMs: number;
  retentionLimit: number;
  // ── INCREMENTAL ARCHIVE ───────────────────────────────────────────────────
  archiveEnabled: boolean;
  archiveIntervalMinutes: number;
  postDepthPerCycle: number;
  maxPostDepth: number;
  archiveFollowers: boolean;
  archiveFollowing: boolean;
  networkDepthPerCycle: number;
  maxNetworkDepth: number;
}

/** A clamp band for one numeric field: `[min,max]` with the `def` used when the value is
 *  absent / 0 / NaN (mirrors Enterprise's `Math.max(min, Math.min(max, Number(x) || def))`). */
export interface CollectionSettingRange {
  min: number;
  max: number;
  def: number;
}

/** Every numeric field's clamp band — the EXACT Enterprise `settings:save` ranges. The renderer
 *  reads `min`/`max` straight onto each `<input type="number">` so the UI can never offer a value
 *  main will silently rewrite. */
export const COLLECTION_SETTINGS_RANGES = {
  commentThreadsPerSource: { min: 1, max: 20, def: 3 },
  commentScrollPasses: { min: 1, max: 12, def: 2 },
  sweepIntervalMinutes: { min: 5, max: 1440, def: 30 },
  profileScrollPasses: { min: 1, max: 20, def: 5 },
  followerBasePasses: { min: 1, max: 60, def: 8 },
  followingBasePasses: { min: 1, max: 60, def: 8 },
  networkStagnationLimit: { min: 4, max: 20, def: 7 },
  networkSnapshotsRetained: { min: 5, max: 100, def: 20 },
  delayPerPassMs: { min: 500, max: 5000, def: 1100 },
  retentionLimit: { min: 1000, max: 250000, def: 50000 },
  archiveIntervalMinutes: { min: 30, max: 10080, def: 240 },
  postDepthPerCycle: { min: 1, max: 20, def: 2 },
  maxPostDepth: { min: 5, max: 120, def: 40 },
  networkDepthPerCycle: { min: 1, max: 40, def: 3 },
  maxNetworkDepth: { min: 8, max: 240, def: 160 },
} as const satisfies Record<string, CollectionSettingRange>;

/** Which numeric fields carry a clamp band (keyof the ranges table). */
export type CollectionSettingNumericField = keyof typeof COLLECTION_SETTINGS_RANGES;

/** Boolean field defaults — the Enterprise `defaultState().settings` values. `collectReplies`
 *  and `retrieveImages` default TRUE (Enterprise `collectReplies`/`collectImages`); everything
 *  else defaults FALSE (minimal capture until the operator opts in). */
const BOOL_DEFAULTS = {
  automaticSweeps: false,
  collectReplies: true,
  collectReposts: false,
  collectComments: false,
  retrieveImages: true,
  archiveEnabled: false,
  archiveFollowers: false,
  archiveFollowing: false,
} as const;

/** The all-default collection settings for a fresh campaign (numeric defs + boolean defaults). */
export const DEFAULT_COLLECTION_SETTINGS: XCollectionSettings = clampCollectionSettings(null);

/** Clamp one numeric field the same way Enterprise `settings:save` did: `Number(x) || def` (so 0,
 *  NaN, and non-numeric heal to the default) then hard-bounded to `[min,max]` and floored to an
 *  integer (pass counts / minutes / ms are always whole numbers — a fractional renderer value can
 *  never reach the capture/archive loop). */
function clampNumber(raw: unknown, band: CollectionSettingRange): number {
  const floored = Math.floor(Number(raw));
  const base = Number.isFinite(floored) && floored !== 0 ? floored : band.def;
  return Math.max(band.min, Math.min(band.max, base));
}

/**
 * Reduce an arbitrary (renderer-supplied, legacy, partial, or null) object to a FULLY-populated,
 * clamped `XCollectionSettings`. Every numeric field is bounded to its Enterprise band; every
 * boolean heals to its default when absent. Missing keys never throw — a settings.json predating
 * a field, or a renderer that sent only one knob, both yield a complete record. Pure + deterministic
 * (no clock/RNG), so it is safe on the evidence-adjacent settings path and reusable in the renderer.
 */
export function clampCollectionSettings(
  raw: Partial<XCollectionSettings> | Record<string, unknown> | null | undefined,
): XCollectionSettings {
  const r: Record<string, unknown> = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const num = (key: CollectionSettingNumericField): number =>
    clampNumber(r[key], COLLECTION_SETTINGS_RANGES[key]);
  // Default-TRUE booleans: only an explicit `false` turns them off (absent ⇒ default true).
  const boolTrue = (key: keyof typeof BOOL_DEFAULTS): boolean => r[key] !== false;
  // Default-FALSE booleans: only an explicit `true` turns them on.
  const boolFalse = (key: keyof typeof BOOL_DEFAULTS): boolean => r[key] === true;
  return {
    automaticSweeps: boolFalse('automaticSweeps'),
    collectReplies: boolTrue('collectReplies'),
    collectReposts: boolFalse('collectReposts'),
    collectComments: boolFalse('collectComments'),
    retrieveImages: boolTrue('retrieveImages'),
    commentThreadsPerSource: num('commentThreadsPerSource'),
    commentScrollPasses: num('commentScrollPasses'),
    sweepIntervalMinutes: num('sweepIntervalMinutes'),
    profileScrollPasses: num('profileScrollPasses'),
    followerBasePasses: num('followerBasePasses'),
    followingBasePasses: num('followingBasePasses'),
    networkStagnationLimit: num('networkStagnationLimit'),
    networkSnapshotsRetained: num('networkSnapshotsRetained'),
    delayPerPassMs: num('delayPerPassMs'),
    retentionLimit: num('retentionLimit'),
    archiveEnabled: boolFalse('archiveEnabled'),
    archiveIntervalMinutes: num('archiveIntervalMinutes'),
    postDepthPerCycle: num('postDepthPerCycle'),
    maxPostDepth: num('maxPostDepth'),
    archiveFollowers: boolFalse('archiveFollowers'),
    archiveFollowing: boolFalse('archiveFollowing'),
    networkDepthPerCycle: num('networkDepthPerCycle'),
    maxNetworkDepth: num('maxNetworkDepth'),
  };
}

/** The three surrounding-thread capture toggles as the `XCollectSettings` gate the timeline
 *  capture path (`capture.ts` `selectTimelineCaptures`) consumes — derived from the per-campaign
 *  RECORD TYPES, so what the capture actually pulls in is exactly what the operator saved for THIS
 *  campaign (parity with Enterprise's `activeSettings().collect*`). */
export function collectGateFromSettings(
  s: XCollectionSettings,
): { replies: boolean; reposts: boolean; comments: boolean } {
  return { replies: s.collectReplies, reposts: s.collectReposts, comments: s.collectComments };
}
