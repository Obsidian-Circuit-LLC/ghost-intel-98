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

// ---- read-back: cached ref -> data: URI for renderer display (Task 15) ---

/** The EXACT shape `cacheRemoteMedia` ever produces: `x-media/<64-hex sha256>`. Validated
 *  BEFORE any path is built from a caller-supplied `ref` — this is the ONLY thing standing
 *  between a renderer-controlled string and a `join()` call, so it must reject anything that
 *  isn't precisely this shape (no `..`, no absolute path, no alternate subdir) rather than a
 *  looser "no traversal characters" denylist. */
const MEDIA_REF_RE = /^x-media\/[0-9a-f]{64}$/;

/** Sniff a small, fixed set of image magic-byte signatures. `cacheRemoteMedia` only ever
 *  caches bytes `remoteMediaToDataUri` already confirmed were `image/*` at fetch time, but the
 *  MIME itself is not persisted alongside the byte-hash-named file (content-addressed, no
 *  sidecar) — sniffing on read-back avoids adding one just to remember a MIME string. Falls
 *  back to a generic binary type, which browsers still render fine inside an `<img>` for the
 *  four formats X actually serves. */
function sniffImageMime(bytes: Buffer): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6 && bytes.subarray(0, 3).toString('latin1') === 'GIF') {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return 'application/octet-stream';
}

/** Injectable seam for `readCachedMedia` — production default resolves secure-fs LAZILY,
 *  mirroring every other production default in this module. */
export interface ReadCachedMediaDeps {
  readBytes: (caseId: string, ref: string) => Promise<Buffer>;
}

function defaultReadDeps(): ReadCachedMediaDeps {
  return {
    readBytes: async (caseId, ref) => {
      const [{ join }, paths, { secureReadFile }] = await Promise.all([
        import('node:path'),
        import('../storage/paths'),
        import('../storage/secure-fs'),
      ]);
      const path = join(paths.scrapingCaseDir('x', caseId), ...ref.split('/'));
      return secureReadFile(path);
    },
  };
}

/**
 * Read back a previously-cached media ref (from `cacheRemoteMedia`) as a `data:` URI for
 * renderer display — the renderer never gets raw vault bytes or a direct filesystem path, the
 * same "convert to a display data: URI main-side" posture as `bio-images.ts`'s `thumbDataUri`.
 *
 * `ref` MUST match `MEDIA_REF_RE` exactly, checked BEFORE any path is built — a compromised or
 * malicious renderer handing back a crafted `ref` (`../../../etc/passwd`, an absolute path, a
 * different subdir) is refused here rather than ever reaching `join()`/`secureReadFile`. A
 * malformed ref or any read failure (missing file, locked vault) returns null rather than
 * throwing — a display miss, not a fault, for a regenerable display artifact.
 */
export async function readCachedMedia(
  caseId: string,
  ref: string,
  overrides: Partial<ReadCachedMediaDeps> = {},
): Promise<string | null> {
  if (!MEDIA_REF_RE.test(ref)) return null;
  const deps: ReadCachedMediaDeps = { ...defaultReadDeps(), ...overrides };
  try {
    const bytes = await deps.readBytes(caseId, ref);
    return `data:${sniffImageMime(bytes)};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}
