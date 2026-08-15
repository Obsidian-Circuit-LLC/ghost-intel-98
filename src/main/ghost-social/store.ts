/**
 * Ghost Social Media Manager (hardened GI98 port) — secure application-state store.
 *
 * Ported from his `readStateInternal`/`writeStateInternal` + `defaultState` (electron/main.ts).
 * Two changes from his design, both required by the port's constraints:
 *   1. Persistence goes through GI98 **secure-fs** (`secureReadFile`/`secureWriteFile`), so the
 *      state file is encrypted-at-rest under the GI98 app vault — ENCX magic on disk (his raw
 *      `fs.writeFileSync` is replaced). His password vault (vault.ts) still gates access on top.
 *   2. The state carries the default-OFF `autoPostArmed` flag (G7, safety-critical) — the
 *      single source of truth MAIN consults before the scheduler may auto-click Publish.
 *
 * Reads/writes are gated on the module vault being unlocked (his `if (!unlocked) throw`),
 * injected as `isUnlocked` so the store round-trips in a unit test with an in-memory IO.
 * Determinism: no clock, no RNG on any path here.
 */

import type { GhostState } from '@shared/ghost-social/types';

/** His default state, plus the hardening ARM flag defaulting OFF. A fresh install starts with
 *  one empty campaign selected (his `defaultState`). */
export function defaultGhostState(): GhostState {
  return {
    campaigns: [{ id: 'campaign-default', name: 'My Campaign', accounts: [], notes: '' }],
    selectedCampaignId: 'campaign-default',
    postHistory: [],
    messageNotes: [],
    browserCacheMode: 'recent3',
    scheduledPosts: [],
    autoPostArmed: false,
  };
}

/**
 * Heal a raw persisted/parsed object into a well-formed `GhostState`. Mirrors his defensive
 * `if (!Array.isArray(s.scheduledPosts)) s.scheduledPosts = []`, extended to every array field
 * and to the ARM flag: `autoPostArmed` heals to a STRICT boolean — anything other than the
 * literal `true` becomes `false`, so a corrupt/absent flag can never read as "armed" (G7).
 */
export function normalizeGhostState(raw: unknown): GhostState {
  const base = defaultGhostState();
  if (!raw || typeof raw !== 'object') return base;
  const s = raw as Partial<GhostState>;
  return {
    campaigns: Array.isArray(s.campaigns) ? s.campaigns : base.campaigns,
    selectedCampaignId:
      typeof s.selectedCampaignId === 'string' && s.selectedCampaignId
        ? s.selectedCampaignId
        : base.selectedCampaignId,
    postHistory: Array.isArray(s.postHistory) ? s.postHistory : [],
    messageNotes: Array.isArray(s.messageNotes) ? s.messageNotes : [],
    browserCacheMode:
      s.browserCacheMode === 'all' || s.browserCacheMode === 'recent3' || s.browserCacheMode === 'reload'
        ? s.browserCacheMode
        : 'recent3',
    scheduledPosts: Array.isArray(s.scheduledPosts) ? s.scheduledPosts : [],
    // SAFETY-CRITICAL (G7): only the literal `true` arms auto-posting; everything else is OFF.
    autoPostArmed: s.autoPostArmed === true,
  };
}

/** Injectable dependencies. Production wires these to the module vault + secure-fs + the
 *  module's state-file path; tests wire them to an in-memory map + a boolean gate. */
export interface StoreDeps {
  /** The module password vault must be unlocked before state can be read or written. */
  isUnlocked(): boolean;
  /** Read the state blob (production: `secureReadText`) — rejects when the file is absent. */
  read(path: string): Promise<string>;
  /** Persist the state blob (production: `secureWriteFile` → ENCX on disk). */
  write(path: string, data: string): Promise<void>;
  /** Whether the state file exists yet. */
  exists(path: string): Promise<boolean>;
  /** The state-file path (production: `ghostSocialStateFile()`). */
  statePath: string;
}

function assertUnlocked(deps: StoreDeps): void {
  if (!deps.isUnlocked()) throw new Error('Vault is locked');
}

/** Read the whole module state, healed. Requires the vault unlocked (his gate). A missing file
 *  yields the default state (his `if (!fs.existsSync) return {...defaultState}`). */
export async function getGhostState(deps: StoreDeps): Promise<GhostState> {
  assertUnlocked(deps);
  if (!(await deps.exists(deps.statePath))) return defaultGhostState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(await deps.read(deps.statePath));
  } catch {
    // A corrupt/unreadable blob heals to defaults rather than bricking the module — the
    // normalizer would reject it anyway, and an unlocked-but-unreadable state is non-fatal.
    return defaultGhostState();
  }
  return normalizeGhostState(parsed);
}

/** Persist the whole module state (normalized first, so the ARM flag can never be smuggled in
 *  as a truthy non-boolean). Requires the vault unlocked. Returns the exact stored state. */
export async function saveGhostState(deps: StoreDeps, state: unknown): Promise<GhostState> {
  assertUnlocked(deps);
  const normalized = normalizeGhostState(state);
  await deps.write(deps.statePath, JSON.stringify(normalized));
  return normalized;
}

/** Read the SAFETY-CRITICAL auto-post ARM flag (G7). Reused by the scheduler's arm gate in a
 *  later phase; kept here so the flag has one authoritative reader. */
export async function isAutoPostArmed(deps: StoreDeps): Promise<boolean> {
  return (await getGhostState(deps)).autoPostArmed === true;
}

/** Set the auto-post ARM flag (G7). Coerced to a strict boolean before persistence. */
export async function setAutoPostArmed(deps: StoreDeps, armed: boolean): Promise<GhostState> {
  const state = await getGhostState(deps);
  return saveGhostState(deps, { ...state, autoPostArmed: armed === true });
}

// ── production wiring ─────────────────────────────────────────────────────────

/** Build the production store deps: gate on the module vault, persist via secure-fs, resolve
 *  the state-file path lazily (electron-free at import). */
export async function prodStoreDeps(): Promise<StoreDeps> {
  const [{ prodGhostSocialVault }, secureFs, paths] = await Promise.all([
    import('./vault'),
    import('../storage/secure-fs'),
    import('../storage/paths'),
  ]);
  const vault = await prodGhostSocialVault();
  return {
    isUnlocked: () => vault.isUnlocked(),
    read: (p) => secureFs.secureReadText(p),
    write: (p, data) => secureFs.secureWriteFile(p, data),
    exists: async (p) => {
      const { access } = await import('node:fs/promises');
      try {
        await access(p);
        return true;
      } catch {
        return false;
      }
    },
    statePath: paths.ghostSocialStateFile(),
  };
}
