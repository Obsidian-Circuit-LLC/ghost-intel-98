/**
 * X Listening Station — per-profile image-collection policy persistence + resolution (F1).
 *
 * Enterprise kept a per-profile `imageMode` on the profile record inside `appState` and resolved it
 * against the campaign-wide toggle in `effectiveImageCollection`. GI98's rebuild has NO first-class
 * profile record — sources are DERIVED client-side from the captured posts (keyed by
 * `normalizeXSourceKey`, same key `removeSource` / the Sources cards use). So the override is stored
 * as a per-campaign MAP `{ [canonicalSourceKey]: XImageMode }` in an encrypted sidecar
 * (`x-image-policy.json`) under `scrapingCaseDir('x', id)`, written + read through **secure-fs**
 * (AES-GCM at rest — never the plaintext json-fs bypass), exactly like every other x-listening
 * artifact.
 *
 * The campaign-wide fallback is F2's per-campaign `retrieveImages` (read via `getCollectionSettings`,
 * itself fail-safe to the minimal-capture defaults). The renderer is NEVER trusted with the mode
 * string — `normalizeImageMode` gates every write, and `setProfileImageMode` throws on anything that
 * is not one of the three literals.
 *
 * Quarantine-clean at module load: no static `electron`/`node:path` import — the production paths,
 * secure-fs, and the collection-settings read are resolved LAZILY inside `defaultDeps()`, mirroring
 * `collection-settings.ts`. `resolveEffectiveImageCollection` (the capture-path consult) is
 * fail-safe: a policy-map read error is treated as `inherit`, and the campaign fallback is itself
 * fail-safe, so a genuine hiccup degrades to "follow the campaign toggle" (parity behaviour) rather
 * than crashing a capture. Determinism: no clock/RNG on any path.
 */
import {
  normalizeImageMode,
  effectiveImageCollection,
  DEFAULT_IMAGE_MODE,
  type XImageMode,
} from '@shared/x-listening-image-policy';
import { normalizeXSourceKey } from '@shared/x-listening-source';

/** The per-campaign policy sidecar filename (alongside x-posts.json / x-collection-settings.json). */
export const X_IMAGE_POLICY_FILE = 'x-image-policy.json';

/** The persisted per-campaign map: canonical source key → override mode. `inherit` entries may be
 *  omitted (an absent key already reads back as `inherit`), but are tolerated if present. */
export type XImagePolicyMap = Record<string, XImageMode>;

/** Injectable seams so the orchestration is testable without electron/secure-fs. `read` returns the
 *  RAW persisted object (possibly partial/legacy) or `null` when no file exists; `loadRetrieveImages`
 *  reads F2's campaign toggle (the `inherit` fallback). */
export interface XImagePolicyDeps {
  read(caseId: string): Promise<Record<string, unknown> | null>;
  write(caseId: string, map: XImagePolicyMap): Promise<void>;
  loadRetrieveImages(caseId: string): Promise<boolean>;
}

function isEnoent(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/** Production defaults — lazy so importing this module never evaluates electron. Persistence hits the
 *  encrypt-at-rest choke-point (`secureReadFile`/`secureWriteFile`), never plaintext json-fs; the
 *  campaign fallback routes through F2's fail-safe `getCollectionSettings`. */
function defaultDeps(): XImagePolicyDeps {
  const resolvePath = async (caseId: string): Promise<string> => {
    const [{ join }, paths] = await Promise.all([import('node:path'), import('../storage/paths')]);
    return join(paths.scrapingCaseDir('x', caseId), X_IMAGE_POLICY_FILE);
  };
  return {
    read: async (caseId) => {
      const { secureReadFile } = await import('../storage/secure-fs');
      const p = await resolvePath(caseId);
      try {
        const buf = await secureReadFile(p);
        return JSON.parse(buf.toString('utf8')) as Record<string, unknown>;
      } catch (e) {
        if (isEnoent(e)) return null;
        throw e;
      }
    },
    write: async (caseId, map) => {
      const { secureWriteFile } = await import('../storage/secure-fs');
      const p = await resolvePath(caseId);
      await secureWriteFile(p, JSON.stringify(map, null, 2));
    },
    loadRetrieveImages: async (caseId) => {
      const { getCollectionSettings } = await import('./collection-settings');
      const s = await getCollectionSettings(caseId);
      return s.retrieveImages;
    },
  };
}

/** Normalize a raw persisted object into a clean `{ key: mode }` map: every key is re-canonicalized
 *  and every value healed to a valid mode. Non-`inherit` entries are kept; `inherit`/junk collapse
 *  away (an absent key already reads back as `inherit`), so the stored map stays minimal + canonical. */
function normalizePolicyMap(raw: Record<string, unknown> | null | undefined): XImagePolicyMap {
  const out: XImagePolicyMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    const key = normalizeXSourceKey(k);
    if (!key) continue;
    const mode = normalizeImageMode(v);
    if (mode !== DEFAULT_IMAGE_MODE) out[key] = mode;
  }
  return out;
}

/** Read the per-campaign policy map, healed + canonicalized. ANY read failure (absent file, decrypt
 *  error, electron-less unit harness) resolves to an EMPTY map (every source ⇒ `inherit`) rather than
 *  throwing — a capture path that consults this must never break on a settings hiccup. */
async function readPolicyMap(caseId: string, deps: XImagePolicyDeps): Promise<XImagePolicyMap> {
  try {
    return normalizePolicyMap(await deps.read(caseId));
  } catch {
    return {};
  }
}

/** The override mode for one source in a campaign (`inherit` when unset). Read-only, no fallback. */
export async function getProfileImageMode(
  caseId: string,
  sourceKey: string,
  overrides: Partial<XImagePolicyDeps> = {},
): Promise<XImageMode> {
  const deps: XImagePolicyDeps = { ...defaultDeps(), ...overrides };
  const map = await readPolicyMap(caseId, deps);
  return map[normalizeXSourceKey(sourceKey)] ?? DEFAULT_IMAGE_MODE;
}

/** The whole per-campaign policy (the override map + F2's campaign `retrieveImages`) so the renderer
 *  can render each source's Images control AND its EFFECTIVE state. `retrieveImages` fail-safes to
 *  `true` (the Enterprise default) if the campaign settings can't be read. */
export async function getImagePolicy(
  caseId: string,
  overrides: Partial<XImagePolicyDeps> = {},
): Promise<{ modes: XImagePolicyMap; retrieveImages: boolean }> {
  const deps: XImagePolicyDeps = { ...defaultDeps(), ...overrides };
  const [modes, retrieveImages] = await Promise.all([
    readPolicyMap(caseId, deps),
    deps.loadRetrieveImages(caseId).catch(() => true),
  ]);
  return { modes, retrieveImages };
}

/**
 * Set a source's override mode (MAIN-side validated — the renderer is never trusted). Rejects any
 * mode that is not exactly `on`/`off`/`inherit`, canonicalizes the source key, persists the updated
 * map, and returns the stored record plus the EFFECTIVE decision (resolved against F2's campaign
 * toggle) so the renderer re-renders what main will actually enforce. An `inherit` write removes the
 * key (keeps the map minimal); the returned `imageMode` is still `inherit`.
 */
export async function setProfileImageMode(
  caseId: string,
  sourceKey: string,
  mode: XImageMode,
  overrides: Partial<XImagePolicyDeps> = {},
): Promise<{ sourceKey: string; imageMode: XImageMode; effective: boolean }> {
  if (mode !== 'on' && mode !== 'off' && mode !== 'inherit') {
    throw new Error('Invalid image collection mode.');
  }
  const key = normalizeXSourceKey(sourceKey);
  if (!key) throw new Error('Setting an image mode requires a source key.');

  const deps: XImagePolicyDeps = { ...defaultDeps(), ...overrides };
  const map = await readPolicyMap(caseId, deps);
  if (mode === DEFAULT_IMAGE_MODE) {
    delete map[key];
  } else {
    map[key] = mode;
  }
  await deps.write(caseId, map);

  const retrieveImages = await deps.loadRetrieveImages(caseId).catch(() => true);
  return { sourceKey: key, imageMode: mode, effective: effectiveImageCollection(mode, retrieveImages) };
}

/**
 * The capture-path consult: does THIS source collect images right now? Resolves the source's override
 * mode against F2's per-campaign `retrieveImages` via the pure `effectiveImageCollection`. Fully
 * fail-safe — a policy-map read error already degrades to `inherit` (via `readPolicyMap`), and the
 * campaign fallback fail-safes to `true` — so a genuine hiccup degrades to "follow the campaign
 * toggle" (the pre-F1 behaviour) rather than crashing or silently changing egress posture.
 */
export async function resolveEffectiveImageCollection(
  caseId: string,
  sourceKey: string,
  overrides: Partial<XImagePolicyDeps> = {},
): Promise<boolean> {
  const deps: XImagePolicyDeps = { ...defaultDeps(), ...overrides };
  const [map, retrieveImages] = await Promise.all([
    readPolicyMap(caseId, deps),
    deps.loadRetrieveImages(caseId).catch(() => true),
  ]);
  const mode = map[normalizeXSourceKey(sourceKey)] ?? DEFAULT_IMAGE_MODE;
  return effectiveImageCollection(mode, retrieveImages);
}
