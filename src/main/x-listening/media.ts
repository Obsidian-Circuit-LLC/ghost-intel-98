/**
 * X Listening Station — media/avatar caching (Enterprise port, Task 9).
 *
 * Fetches a scraped media/avatar URL through the host-**anchored** `remoteMediaToDataUri`
 * (`capture/security.ts`) — an off-allowlist decoy such as `…?y=pbs.twimg.com/media`
 * (the host is `evil.example`; `pbs.twimg.com` only appears in the QUERY STRING) is refused
 * BEFORE any in-page fetch, because the allowlist check runs against `new URL(url).hostname`,
 * never a substring match. On success, `remoteMediaToDataUri` hands back a `data:` URI
 * (base64-encoded image bytes); this module decodes that payload to raw bytes, sha256's
 * them, and persists them via `secureWriteFile` (AES-GCM at rest — never a plaintext
 * `fs.writeFile`) under the case's own media directory:
 * `scrapingCaseDir('x', caseId)/x-media/<sha256>`.
 *
 * The ONLY thing a successful call ever returns is a LOCAL reference (`ref`, a relative
 * path string — never an `http(s)` URL and never the `data:` URI itself) plus the byte
 * sha256. That sha256 is the cached media's own evidence trail — `evidence.ts`'s
 * `RelationshipEvidenceSource` doc anticipates exactly this (an avatar's evidentiary weight
 * lives in its cached-media byte-hash, not in a hashed text field). A caller (capture.ts's
 * post-media pipeline, a future follower/following avatar pipeline) persists `ref` onto
 * `XPostArtifact.mediaRefs` / `XNetworkAccount.avatar` — never a remote URL, preserving the
 * Global Constraints no-remote-media-inlining invariant by construction: there is no code
 * path in this module that can produce a `ref` containing a scheme.
 *
 * Quarantine-clean at module load: `remoteMediaToDataUri`/`MEDIA_HOST_ALLOWLIST` come from
 * `capture/security.ts`, which imports only `node:path`. The secure-fs/paths wiring (which
 * pulls in electron) is a LAZY dynamic import inside the default deps — mirroring
 * `store.ts`'s `prodXStore()` / `capture.ts`'s `defaultDeps()` convention — so importing
 * this module never evaluates electron, and a test injecting its own `writeBytes` never
 * touches the filesystem at all.
 */
import { createHash } from 'node:crypto';
import {
  remoteMediaToDataUri,
  MEDIA_HOST_ALLOWLIST,
  type MediaCapturePage,
} from '../capture/security';

/** Directory name (relative to `scrapingCaseDir('x', caseId)`) that holds cached media
 *  byte files, one per distinct sha256 — content-addressed, so re-caching the same image
 *  (e.g. an avatar re-observed on a later scan) overwrites the same path with identical
 *  bytes rather than accumulating duplicates. */
const MEDIA_SUBDIR = 'x-media';

/** The result of a successful cache: a LOCAL relative reference (`x-media/<sha256>`) —
 *  never an `http(s)` URL, never a `data:` URI — plus the byte-sha256 (the media's own
 *  evidence trail). */
export interface CachedMediaRef {
  ref: string;
  sha256: string;
}

/** Injectable seams — production defaults resolve lazily so importing this module (or
 *  calling it with full overrides, as tests do) never requires electron. */
export interface MediaCacheDeps {
  /** Resolve a remote media URL to a `data:` URI inside the capture page, or null on any
   *  failure (off-allowlist host, non-image, oversized, page/fetch error). Production
   *  default is `remoteMediaToDataUri`, called with the explicit `MEDIA_HOST_ALLOWLIST`. */
  resolveMedia: (
    win: MediaCapturePage,
    url: string,
    allowedHosts: readonly string[]
  ) => Promise<string | null>;
  /** Persist raw bytes at `ref` (relative to the case's own scraping-case dir) — the
   *  production default routes through `secureWriteFile` (AES-GCM at rest); a test
   *  overriding this never touches the real filesystem. */
  writeBytes: (caseId: string, ref: string, data: Buffer) => Promise<void>;
}

/**
 * Parse a `data:<mime>;base64,<payload>` URI into raw bytes. Returns null for anything that
 * is not a well-formed base64 data URI — belt-and-braces: `remoteMediaToDataUri` already
 * guarantees a `data:`-prefixed string or null, but this function never trusts that
 * blindly, so a misbehaving/overridden `resolveMedia` handing back a raw remote URL (or any
 * other non-`data:` string) is rejected here too, before any byte ever reaches disk.
 */
function decodeDataUri(dataUri: string): Buffer | null {
  const m = /^data:[^,]*;base64,([\s\S]+)$/.exec(dataUri);
  if (!m) return null;
  try {
    const buf = Buffer.from(m[1], 'base64');
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

function defaultDeps(): MediaCacheDeps {
  return {
    resolveMedia: remoteMediaToDataUri,
    writeBytes: async (caseId, ref, data) => {
      const [{ join }, paths, { secureWriteFile }] = await Promise.all([
        import('node:path'),
        import('../storage/paths'),
        import('../storage/secure-fs'),
      ]);
      const path = join(paths.scrapingCaseDir('x', caseId), ...ref.split('/'));
      await secureWriteFile(path, data);
    },
  };
}

/**
 * Fetch + cache one remote media/avatar URL for `caseId`. Returns null on any failure along
 * the chain (off-allowlist host, non-image/oversized, page/fetch error, malformed `data:`
 * payload) — the caller DROPS the media reference entirely rather than falling back to the
 * remote URL. The only success path is a local `ref`, so no code path here can ever produce
 * a persisted remote URL.
 */
export async function cacheRemoteMedia(
  win: MediaCapturePage,
  url: string,
  caseId: string,
  overrides: Partial<MediaCacheDeps> = {}
): Promise<CachedMediaRef | null> {
  const deps: MediaCacheDeps = { ...defaultDeps(), ...overrides };

  const dataUri = await deps.resolveMedia(win, url, MEDIA_HOST_ALLOWLIST);
  if (!dataUri) return null;

  const bytes = decodeDataUri(dataUri);
  if (!bytes) return null;

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const ref = `${MEDIA_SUBDIR}/${sha256}`;
  await deps.writeBytes(caseId, ref, bytes);

  return { ref, sha256 };
}
