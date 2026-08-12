/**
 * X Listening Station — per-campaign COLLECTION SETTINGS persistence (Enterprise port, F2).
 *
 * Enterprise kept one settings object per campaign in `appState.campaignSettings[id]`
 * (`electron/main.cjs`), clamping every numeric field MAIN-side in `settings:save` before it was
 * ever stored or consulted. This module rebuilds that onto OUR hardened seam: the record is a
 * per-campaign JSON sidecar (`x-collection-settings.json`) under `scrapingCaseDir('x', id)`, written
 * and read through **secure-fs** (AES-GCM at rest — never the plaintext json-fs bypass), exactly like
 * every other x-listening artifact. The clamp is applied on SAVE (`saveCollectionSettings`) and again
 * defensively on READ (`getCollectionSettings`), via the pure shared reducer — the renderer's numbers
 * are never trusted, and a legacy/partial file heals to a full record.
 *
 * Quarantine-clean at module load: no static `electron`/`node:path` import — the production paths +
 * secure-fs are resolved LAZILY inside `defaultDeps()`, mirroring `store.ts`'s `prodXStore` and
 * `campaigns.ts`'s `defaultDeps`, so importing this module in a test that injects its own fs seam
 * never evaluates electron.
 *
 * Determinism: persistence carries no clock/RNG; the clamp reducer is pure. `getCollectionSettings`
 * is resilient — ANY read failure (absent file, decrypt error, or an electron-less unit harness where
 * the lazy `paths` import throws) yields `DEFAULT_COLLECTION_SETTINGS`, so a capture/archive path that
 * consults it never crashes on a settings hiccup (fail-safe to the minimal-capture defaults).
 */
import {
  DEFAULT_COLLECTION_SETTINGS,
  clampCollectionSettings,
  type XCollectionSettings,
} from '@shared/x-listening-collection-settings';

/** The per-campaign settings sidecar filename (alongside x-posts.json etc. under the case dir). */
export const X_COLLECTION_SETTINGS_FILE = 'x-collection-settings.json';

/** Injectable fs seam so the orchestration is testable without electron/secure-fs. `read` returns
 *  the RAW persisted object (possibly partial/legacy) or `null` when no file exists; the clamp is
 *  applied by `getCollectionSettings`, never here. */
export interface XCollectionSettingsDeps {
  read(caseId: string): Promise<Record<string, unknown> | null>;
  write(caseId: string, settings: XCollectionSettings): Promise<void>;
}

function isEnoent(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/** Production defaults — lazy so importing this module never evaluates electron. Both routes hit the
 *  encrypt-at-rest choke-point (`secureReadFile`/`secureWriteFile`), never plaintext json-fs. */
function defaultDeps(): XCollectionSettingsDeps {
  const resolvePath = async (caseId: string): Promise<string> => {
    const [{ join }, paths] = await Promise.all([import('node:path'), import('../storage/paths')]);
    return join(paths.scrapingCaseDir('x', caseId), X_COLLECTION_SETTINGS_FILE);
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
    write: async (caseId, settings) => {
      const { secureWriteFile } = await import('../storage/secure-fs');
      const p = await resolvePath(caseId);
      await secureWriteFile(p, JSON.stringify(settings, null, 2));
    },
  };
}

/**
 * Read a campaign's collection settings, healed to a full clamped record. ANY read failure (absent
 * file, decrypt error, or a lazy-import failure in an electron-less unit harness) resolves to
 * `DEFAULT_COLLECTION_SETTINGS` rather than throwing — a capture/archive path that consults these
 * must never break on a settings hiccup; the minimal-capture defaults are the safe fallback.
 */
export async function getCollectionSettings(
  caseId: string,
  overrides: Partial<XCollectionSettingsDeps> = {},
): Promise<XCollectionSettings> {
  const deps: XCollectionSettingsDeps = { ...defaultDeps(), ...overrides };
  let raw: Record<string, unknown> | null = null;
  try {
    raw = await deps.read(caseId);
  } catch {
    return { ...DEFAULT_COLLECTION_SETTINGS };
  }
  return clampCollectionSettings(raw);
}

/**
 * Clamp (MAIN-side, never trusting the renderer) then persist a campaign's collection settings, and
 * return the exact clamped record that was stored — so the renderer re-renders the values main will
 * actually consult, not the raw ones it submitted. Every numeric field is bounded to its Enterprise
 * band by `clampCollectionSettings`; booleans heal to their defaults.
 */
export async function saveCollectionSettings(
  caseId: string,
  raw: Partial<XCollectionSettings> | Record<string, unknown> | null | undefined,
  overrides: Partial<XCollectionSettingsDeps> = {},
): Promise<XCollectionSettings> {
  const deps: XCollectionSettingsDeps = { ...defaultDeps(), ...overrides };
  const clamped = clampCollectionSettings(raw);
  await deps.write(caseId, clamped);
  return clamped;
}
