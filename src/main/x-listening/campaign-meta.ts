/**
 * X Listening Station — per-campaign editor META (purpose/description) persistence (Task J1).
 *
 * Enterprise kept a campaign's `purpose` + `description` on the case record inside `appState.cases`
 * (`electron/main.cjs` `campaigns:create/update`, rendered on each CAMPAIGN card + in the editor
 * modal). GI98's campaign IS a generic `ScrapingCase` (`{ id, name, createdAt, updatedAt, note? }`)
 * shared with SOCMINT — widening that shared shape for two X-only fields would ripple into an
 * unrelated namespace. So the editor's PURPOSE + DESCRIPTION live in a per-campaign encrypted
 * sidecar (`x-campaign-meta.json`) under `scrapingCaseDir('x', id)`, written + read through
 * **secure-fs** (AES-GCM at rest — never the plaintext json-fs bypass), exactly like every other
 * x-listening artifact (image-policy.ts / collection-settings.ts).
 *
 * The renderer is never trusted with the field values verbatim: `normalizeCampaignMeta` coerces
 * every field to a string and caps its length, so a hostile/oversized payload can neither crash a
 * read nor bloat the sidecar. Determinism: no clock/RNG on any path. Quarantine-clean at module
 * load: no static `electron`/`node:path` import — the production paths + secure-fs are resolved
 * LAZILY inside `defaultDeps()`, mirroring `collection-settings.ts`/`image-policy.ts`.
 */

/** The per-campaign editor-meta sidecar filename (alongside x-presets.json / x-collection-settings.json). */
export const X_CAMPAIGN_META_FILE = 'x-campaign-meta.json';

/** The persisted per-campaign editor fields. `name` stays on the ScrapingCase record itself — only
 *  the two X-specific fields the generic case shape has no home for live here. */
export interface XCampaignMeta {
  purpose: string;
  description: string;
}

export const DEFAULT_CAMPAIGN_META: XCampaignMeta = { purpose: '', description: '' };

/** Defensive cap — a purpose/description is an analyst annotation, not a document; this bounds a
 *  hostile or fat-fingered payload without truncating any realistic note. */
export const X_CAMPAIGN_META_MAX_FIELD = 2000;

/** Injectable seam so the orchestration is testable without electron/secure-fs. `read` returns the
 *  RAW persisted object (possibly partial/legacy) or `null` when no file exists. */
export interface XCampaignMetaDeps {
  read(id: string): Promise<Record<string, unknown> | null>;
  write(id: string, meta: XCampaignMeta): Promise<void>;
}

function isEnoent(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/** Coerce a raw field to a bounded string. Non-strings (numbers, objects, null, undefined) heal to
 *  the empty string rather than leaking a non-string into the UI or the sidecar. */
function normalizeField(v: unknown): string {
  return typeof v === 'string' ? v.slice(0, X_CAMPAIGN_META_MAX_FIELD) : '';
}

/** Normalize a raw persisted/submitted object into a clean `{ purpose, description }`. */
export function normalizeCampaignMeta(raw: Record<string, unknown> | null | undefined): XCampaignMeta {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CAMPAIGN_META };
  return {
    purpose: normalizeField((raw as { purpose?: unknown }).purpose),
    description: normalizeField((raw as { description?: unknown }).description),
  };
}

/** Production defaults — lazy so importing this module never evaluates electron. Persistence hits the
 *  encrypt-at-rest choke-point (`secureReadFile`/`secureWriteFile`), never plaintext json-fs. */
function defaultDeps(): XCampaignMetaDeps {
  const resolvePath = async (id: string): Promise<string> => {
    const [{ join }, paths] = await Promise.all([import('node:path'), import('../storage/paths')]);
    return join(paths.scrapingCaseDir('x', id), X_CAMPAIGN_META_FILE);
  };
  return {
    read: async (id) => {
      const { secureReadFile } = await import('../storage/secure-fs');
      const p = await resolvePath(id);
      try {
        const buf = await secureReadFile(p);
        return JSON.parse(buf.toString('utf8')) as Record<string, unknown>;
      } catch (e) {
        if (isEnoent(e)) return null;
        throw e;
      }
    },
    write: async (id, meta) => {
      const { secureWriteFile } = await import('../storage/secure-fs');
      const p = await resolvePath(id);
      await secureWriteFile(p, JSON.stringify(meta, null, 2));
    },
  };
}

/** Read a campaign's editor meta, healed. ANY read failure (absent file, decrypt error, electron-less
 *  unit harness) resolves to the EMPTY default rather than throwing — an editor load must never break
 *  on a settings hiccup. */
export async function getCampaignMeta(
  id: string,
  overrides: Partial<XCampaignMetaDeps> = {},
): Promise<XCampaignMeta> {
  const deps: XCampaignMetaDeps = { ...defaultDeps(), ...overrides };
  try {
    return normalizeCampaignMeta(await deps.read(id));
  } catch {
    return { ...DEFAULT_CAMPAIGN_META };
  }
}

/** Persist a campaign's editor meta (MAIN-side normalized — the renderer's fields are coerced to
 *  bounded strings before they touch the sidecar), returning the exact stored record. */
export async function setCampaignMeta(
  id: string,
  raw: Partial<XCampaignMeta> | Record<string, unknown> | null | undefined,
  overrides: Partial<XCampaignMetaDeps> = {},
): Promise<XCampaignMeta> {
  const deps: XCampaignMetaDeps = { ...defaultDeps(), ...overrides };
  const meta = normalizeCampaignMeta(raw as Record<string, unknown> | null | undefined);
  await deps.write(id, meta);
  return meta;
}
