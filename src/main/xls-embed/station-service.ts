/**
 * The embedded station's pure document operations — TRANSCRIBED from GhostExodus's
 * `electron/main.cjs` (X Listening Station Enterprise v3.4.1), vendored at
 * `vendor/x-listening-station-v3.4.1/`.
 *
 * These are the ~25 of his 47 handlers that touch nothing but the state document. They are pure
 * functions over his `PersistedStationState` so they can be tested without Electron, a window or
 * the network, and so anyone can diff them against his source.
 *
 * THE RULE FOR THIS FILE: his source is the authority. Where his behaviour looks like a quirk —
 * the "<name> Copy" suffix, remapping preset `profileIds` through cloned profiles, refusing to
 * delete the last campaign, cascading a profile removal into the posts it collected — transcribe
 * it. Five releases were lost re-deriving this model instead of porting it; "I would have done it
 * differently" is not a reason to change any line here.
 *
 * Naming: `cases` is his legacy field for what the UI calls campaigns (`campaigns:create` pushes
 * into `appState.cases`). One workspace concept, not two.
 */
import type { PersistedStationState } from './state-store';
import { defaultStationState } from './state-store';
import type {
  CaseRecord,
  InvestigationNote,
  Preset,
  Profile,
  Settings,
  StationState,
} from '@shared/xls/station-state';

/** Injected clock + id source, so every operation is deterministic under test. */
export interface StationCtx {
  now(): string;
  makeId(): string;
}

/** The thirteen per-campaign collections his `campaigns:delete` cascades over. */
const CASE_SCOPED = [
  'profiles', 'posts', 'relationships', 'notes', 'presets', 'matches', 'entities',
  'profileSnapshots', 'changeEvents', 'collectionRuns', 'networkSnapshots', 'networkEvents',
] as const;

// ---- helpers (his) ---------------------------------------------------------

/**
 * His `normalizeUsername` (main.cjs:145): accepts a bare handle, an @handle or a profile URL, and
 * rejects anything X could not be. Kept verbatim — it is the gate every profile passes through.
 */
export function normalizeUsername(input: unknown): string {
  const value = String(input || '')
    .trim()
    .replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0];

  if (!/^[A-Za-z0-9_]{1,15}$/.test(value)) {
    throw new Error('Enter a valid X username containing letters, numbers, or underscores.');
  }
  return value;
}

export function activeCaseId(s: PersistedStationState): string {
  return s.activeCaseId || s.cases[0]?.id || 'case-default';
}

/** His `activeSettings()`: the active campaign's overrides, else the base settings. */
export function activeSettings(s: PersistedStationState): Settings {
  return s.campaignSettings?.[activeCaseId(s)] ?? s.settings;
}

/** His `syncActiveSettings`: the campaign's settings become the live ones. */
function syncActiveSettings(s: PersistedStationState, caseId: string): void {
  const next = s.campaignSettings?.[caseId];
  if (next) s.settings = { ...next };
}

function caseScoped<T extends { caseId?: string }>(rows: T[], caseId: string): T[] {
  return rows.filter((r) => r.caseId === caseId);
}

// ---- the client view -------------------------------------------------------

/**
 * His `getClientState()` (main.cjs:379) — the snapshot his renderer receives from `state:get` and
 * `state:changed`. Every per-campaign collection is filtered to the active campaign, the log
 * collections are capped to their newest N, and `settings` resolves to the active campaign's.
 * `cases` is deliberately NOT filtered: the campaign picker needs the whole list.
 */
export function clientState(s: PersistedStationState): StationState {
  const caseId = activeCaseId(s);
  return {
    ...s,
    settings: { ...activeSettings(s) },
    profiles: caseScoped(s.profiles, caseId),
    posts: caseScoped(s.posts, caseId),
    relationships: caseScoped(s.relationships, caseId),
    notes: caseScoped(s.notes, caseId),
    presets: caseScoped(s.presets, caseId),
    matches: caseScoped(s.matches, caseId),
    entities: caseScoped(s.entities, caseId),
    profileSnapshots: caseScoped(s.profileSnapshots as Array<{ caseId?: string }>, caseId),
    changeEvents: caseScoped(s.changeEvents, caseId).slice(-2000),
    collectionRuns: caseScoped(s.collectionRuns, caseId).slice(-1000),
    networkSnapshots: caseScoped(s.networkSnapshots as Array<{ caseId?: string }>, caseId).slice(-200),
    networkEvents: caseScoped(s.networkEvents, caseId).slice(-2000),
  };
}

// ---- campaigns -------------------------------------------------------------

export function createCampaign(
  s: PersistedStationState,
  input: { name?: string; purpose?: string; description?: string },
  ctx: StationCtx
): CaseRecord {
  const name = String(input?.name || '').trim();
  const purpose = String(input?.purpose || '').trim();
  const description = String(input?.description || '').trim();
  if (!name) throw new Error('Campaign name is required.');
  const campaign: CaseRecord = {
    id: ctx.makeId(), name, purpose, description, createdAt: ctx.now(), updatedAt: ctx.now(),
  };
  s.cases.push(campaign);
  s.campaignSettings[campaign.id] = { ...defaultStationState(ctx.now, ctx.makeId).settings, ...activeSettings(s) };
  s.activeCaseId = campaign.id;
  syncActiveSettings(s, campaign.id);
  s.archive.nextOperationIndex = 0;
  return campaign;
}

export function switchCampaign(s: PersistedStationState, id: string): void {
  if (!s.cases.some((c) => c.id === id)) throw new Error('Campaign not found.');
  s.activeCaseId = id;
  syncActiveSettings(s, id);
  s.archive.nextOperationIndex = 0;
}

export function updateCampaign(
  s: PersistedStationState,
  id: string,
  input: { name?: string; purpose?: string; description?: string },
  ctx: StationCtx
): CaseRecord {
  const campaign = s.cases.find((c) => c.id === id);
  if (!campaign) throw new Error('Campaign not found.');
  const name = String(input?.name ?? campaign.name).trim();
  if (!name) throw new Error('Campaign name is required.');
  campaign.name = name;
  campaign.purpose = String(input?.purpose ?? campaign.purpose ?? '').trim();
  campaign.description = String(input?.description ?? campaign.description ?? '').trim();
  campaign.updatedAt = ctx.now();
  return campaign;
}

/**
 * His `campaigns:duplicate`. Clones the campaign's profiles with FRESH collection bookkeeping
 * (nothing has been collected into the copy yet) and carries its presets across, remapping each
 * preset's `profileIds` onto the cloned profiles — a preset pointing at the original campaign's
 * profile ids would silently match nothing in the copy.
 */
export function duplicateCampaign(s: PersistedStationState, id: string, ctx: StationCtx): CaseRecord {
  const source = s.cases.find((c) => c.id === id);
  if (!source) throw new Error('Campaign not found.');
  const campaign: CaseRecord = {
    ...source, id: ctx.makeId(), name: `${source.name} Copy`, createdAt: ctx.now(), updatedAt: ctx.now(),
  };
  s.cases.push(campaign);
  s.campaignSettings[campaign.id] = {
    ...defaultStationState(ctx.now, ctx.makeId).settings,
    ...(s.campaignSettings?.[id] || activeSettings(s)),
  };

  const profileMap = new Map<string, string>();
  for (const profile of caseScoped(s.profiles, id)) {
    const cloned: Profile = {
      ...profile, id: ctx.makeId(), caseId: campaign.id, addedAt: ctx.now(),
      lastCheckedAt: null, lastError: null, collectedCount: 0,
    };
    profileMap.set(profile.id, cloned.id);
    s.profiles.push(cloned);
  }
  for (const preset of caseScoped(s.presets, id)) {
    s.presets.push({
      ...preset,
      id: ctx.makeId(),
      caseId: campaign.id,
      profileIds: (preset.profileIds || []).map((pid) => profileMap.get(pid)).filter(Boolean) as string[],
      updatedAt: ctx.now(),
    });
  }

  s.activeCaseId = campaign.id;
  syncActiveSettings(s, campaign.id);
  s.archive.nextOperationIndex = 0;
  return campaign;
}

/**
 * His `campaigns:delete`. Refuses to remove the last campaign, then cascades every case-scoped
 * collection, the per-profile archive progress and the campaign's settings.
 *
 * His version also removes the campaign's `evidence-media` directory from disk. That is a
 * filesystem effect, so it does not live in this pure module — the IPC layer performs it, against
 * secure-fs paths, after this returns the ids it needs.
 */
export function deleteCampaign(
  s: PersistedStationState,
  id: string,
  _ctx: StationCtx
): { removedProfileIds: string[] } {
  if (s.cases.length <= 1) throw new Error('At least one campaign must remain.');
  const campaign = s.cases.find((c) => c.id === id);
  if (!campaign) throw new Error('Campaign not found.');

  const removedProfileIds = caseScoped(s.profiles, id).map((p) => p.id);
  for (const key of CASE_SCOPED) {
    const rows = (s[key] ?? []) as Array<{ caseId?: string }>;
    (s as unknown as Record<string, unknown>)[key] = rows.filter((r) => r.caseId !== id);
  }
  for (const profileId of removedProfileIds) delete s.archive.profiles[profileId];
  delete s.campaignSettings[id];

  s.cases = s.cases.filter((c) => c.id !== id);
  if (s.activeCaseId === id) s.activeCaseId = s.cases[0].id;
  syncActiveSettings(s, s.activeCaseId);
  s.archive.nextOperationIndex = 0;
  return { removedProfileIds };
}

// ---- profiles --------------------------------------------------------------

export function addProfile(s: PersistedStationState, input: unknown, ctx: StationCtx): Profile {
  const username = normalizeUsername(input);
  const caseId = activeCaseId(s);
  if (s.profiles.some((p) => p.caseId === caseId && p.username.toLowerCase() === username.toLowerCase())) {
    throw new Error(`@${username} is already in this case.`);
  }
  const profile: Profile = {
    id: ctx.makeId(), caseId, username, displayName: `@${username}`, bio: '', avatar: '',
    location: '', website: '', enabled: true, imageMode: 'inherit', addedAt: ctx.now(),
    lastCheckedAt: null, lastError: null, collectedCount: 0,
  };
  s.profiles.push(profile);
  return profile;
}

/** His `profiles:remove`: the profile, its posts, and everything keyed to those posts. */
export function removeProfile(s: PersistedStationState, id: string, _ctx: StationCtx): void {
  const caseId = activeCaseId(s);
  const profile = s.profiles.find((p) => p.id === id && p.caseId === caseId);
  if (!profile) throw new Error('Profile not found in the active campaign.');

  const removedPostIds = new Set(
    s.posts.filter((p) => p.profileId === id && p.caseId === caseId).map((p) => p.id)
  );
  s.profiles = s.profiles.filter((p) => p.id !== id);
  s.posts = s.posts.filter((p) => p.profileId !== id);
  s.relationships = s.relationships.filter((r) => r.profileId !== id);
  s.matches = s.matches.filter((m) => !removedPostIds.has(m.postId));
  s.notes = s.notes.filter((n) => !removedPostIds.has(n.postId));
  s.profileSnapshots = (s.profileSnapshots as Array<{ profileId?: string }>).filter((r) => r.profileId !== id);
  s.changeEvents = s.changeEvents.filter((r) => r.profileId !== id);
  s.collectionRuns = s.collectionRuns.filter((r) => r.profileId !== id);
  s.networkSnapshots = (s.networkSnapshots as Array<{ profileId?: string }>).filter((r) => r.profileId !== id);
  s.networkEvents = s.networkEvents.filter((r) => r.profileId !== id);
  delete s.archive.profiles[id];
  s.archive.nextOperationIndex = 0;
}

// ---- notes -----------------------------------------------------------------

export function addNote(
  s: PersistedStationState,
  postId: string,
  text: string,
  ctx: StationCtx
): InvestigationNote {
  const body = String(text || '').trim();
  if (!body) throw new Error('Note text is required.');
  const note: InvestigationNote = {
    id: ctx.makeId(), caseId: activeCaseId(s), postId: String(postId),
    text: body, createdAt: ctx.now(), updatedAt: ctx.now(),
  };
  s.notes.push(note);
  return note;
}

export function updateNote(
  s: PersistedStationState,
  noteId: string,
  text: string,
  ctx: StationCtx
): InvestigationNote {
  const note = s.notes.find((n) => n.id === noteId);
  if (!note) throw new Error('Note not found.');
  const body = String(text || '').trim();
  if (!body) throw new Error('Note text is required.');
  note.text = body;
  note.updatedAt = ctx.now();
  return note;
}

export function removeNote(s: PersistedStationState, noteId: string): void {
  s.notes = s.notes.filter((n) => n.id !== noteId);
}

// ---- presets ---------------------------------------------------------------

export function savePreset(
  s: PersistedStationState,
  input: Partial<Preset> & { id?: string },
  ctx: StationCtx
): Preset {
  const name = String(input?.name || '').trim();
  if (!name) throw new Error('Preset name is required.');
  const existing = input.id ? s.presets.find((p) => p.id === input.id) : undefined;
  const preset: Preset = {
    id: existing?.id ?? ctx.makeId(),
    caseId: existing?.caseId ?? activeCaseId(s),
    name,
    keywords: (input.keywords ?? []).map((k) => String(k).trim()).filter(Boolean),
    mode: input.mode === 'all' ? 'all' : 'any',
    caseSensitive: Boolean(input.caseSensitive),
    profileIds: (input.profileIds ?? []).map(String),
    enabled: input.enabled !== false,
    updatedAt: ctx.now(),
  };
  if (existing) Object.assign(existing, preset);
  else s.presets.push(preset);
  return preset;
}

export function removePreset(s: PersistedStationState, id: string): void {
  s.presets = s.presets.filter((p) => p.id !== id);
  s.matches = s.matches.filter((m) => m.presetId !== id);
}

// ---- settings and data -----------------------------------------------------

/** His `settings:save`: the ACTIVE campaign's overrides, and the live settings with them. */
export function saveSettings(s: PersistedStationState, next: Settings): Settings {
  const caseId = activeCaseId(s);
  const merged: Settings = { ...s.settings, ...next };
  s.campaignSettings[caseId] = merged;
  s.settings = { ...merged };
  return merged;
}

/** His `data:clear-posts`: the active campaign's collected material only. */
export function clearCollectedPosts(s: PersistedStationState): void {
  const caseId = activeCaseId(s);
  const cleared = new Set(caseScoped(s.posts, caseId).map((p) => p.id));
  s.posts = s.posts.filter((p) => p.caseId !== caseId);
  s.entities = s.entities.filter((e) => e.caseId !== caseId);
  s.matches = s.matches.filter((m) => !cleared.has(m.postId));
  s.notes = s.notes.filter((n) => !cleared.has(n.postId));
}
